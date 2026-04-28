import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, type UserSession } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { scrollStore } from "@/lib/scroll-store";
import { clearAccountState } from "@/lib/query-client";
import { applyThemeForUser, resetTheme } from "@/lib/theme";

const USER_CACHE_KEY = "_usr";

function loadCachedUser(): UserSession | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserSession) : null;
  } catch {
    return null;
  }
}

interface AuthContextType {
  user: UserSession | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  login: () => void;
  logout: () => void;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (email: string, password: string) => Promise<void>;
  /**
   * Force-refresh the cached user session by re-fetching `/api/auth/me`.
   * Clears stale 401 cache entries first so a previously-failed query will
   * actually re-execute. Returns the fresh user or `null` if still not logged in.
   *
   * Use this in custom login/signup flows after the login POST has succeeded,
   * so that AuthProvider state is updated BEFORE you navigate away.
   */
  refreshUser: () => Promise<UserSession | null>;
  authError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // Prevents getMe from re-fetching (and restoring user) while logout is in flight
  const [loggingOut, setLoggingOut] = useState(false);

  // Cached user from last session — shown immediately so the feed renders
  // before the server responds (Render free tier cold-start can take ~60s).
  const [cachedUser, setCachedUser] = useState<UserSession | null>(() => loadCachedUser());

  const { data: serverUser, isLoading, error, refetch } = useGetMe({
    query: {
      enabled: !loggingOut,
      retry: (failureCount, err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // Genuinely not logged in → stop immediately
        if (status === 401 || status === 403) return false;
        // Network / server error → retry until Render wakes (~60s)
        return failureCount < 12;
      },
      retryDelay: (attemptIndex: number) => Math.min(3000 + attemptIndex * 2000, 10000),
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    } as any,
  });

  // Keep localStorage in sync with server truth
  useEffect(() => {
    if (serverUser) {
      // If the confirmed user differs from the cached one (e.g. Google OAuth
      // after a different account was previously cached), wipe per-user state
      // before accepting the new identity.
      const prevRaw = localStorage.getItem(USER_CACHE_KEY);
      const prevId = prevRaw ? (JSON.parse(prevRaw) as UserSession).id : null;
      if (prevId && prevId !== serverUser.id) {
        clearAccountState();
        sessionStorage.clear();
        scrollStore.clear();
      }

      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(serverUser));
      setCachedUser(serverUser);
      // Apply this user's theme preference immediately
      applyThemeForUser(serverUser.id);
    } else if (!isLoading) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) {
        // Server says "not logged in" → clear cache, show login
        localStorage.removeItem(USER_CACHE_KEY);
        setCachedUser(null);
        resetTheme();
      }
      // Any other error (502, timeout, network) → keep cachedUser so the
      // feed stays visible while retrying in the background.
    }
  }, [serverUser, isLoading, error]);

  // The effective user: prefer fresh server data, fall back to cached.
  // During logout, treat as signed-out immediately regardless of query state.
  const user = loggingOut ? null : (serverUser ?? cachedUser);

  // Onboarding is handled in App.tsx via !user.isOnboarded guard — no redirect needed here

  const login = () => {
    window.location.href = "/api/auth/google";
  };

  // ── refreshUser ───────────────────────────────────────────────────────────
  // Reliable post-login refresh: clears any cached 401 error so the query
  // actually re-runs, awaits the new fetch, then writes the result into the
  // query cache + cachedUser state BEFORE returning.  Callers can safely
  // navigate away as soon as this resolves.
  const refreshUser = async (): Promise<UserSession | null> => {
    // Drop any stale cached error/data so the next observer fetches fresh.
    queryClient.removeQueries({ queryKey: ["/api/auth/me"] });
    try {
      const result = await refetch?.();
      const fresh = result?.data ?? null;
      if (fresh) {
        // Pre-seed the query cache so the very next render sees the user.
        queryClient.setQueryData(["/api/auth/me"], fresh);
        setCachedUser(fresh);
        try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(fresh)); } catch { /* ignore quota errors */ }
        if (fresh.id) applyThemeForUser(fresh.id);
      } else {
        setCachedUser(null);
        try { localStorage.removeItem(USER_CACHE_KEY); } catch { /* ignore */ }
      }
      return fresh;
    } catch {
      return null;
    }
  };

  const logout = async () => {
    // Disable getMe query immediately — prevents race where the query
    // re-fetches and restores the user before the logout API call finishes.
    setLoggingOut(true);
    localStorage.removeItem(USER_CACHE_KEY);
    setCachedUser(null);
    setAuthError(null);
    sessionStorage.clear();
    scrollStore.clear();
    clearAccountState();
    resetTheme();

    // NOTE: do NOT tear down the push subscription on logout. On Android
    // Chrome a browser tab and an installed PWA share the same Service
    // Worker registration / PushSubscription endpoint, so unsubscribing
    // from the browser would kill the PWA's notifications too. Logging
    // out is an auth-session concern; the push subscription stays bound
    // to whoever last enabled notifications until they explicitly turn
    // them off in Settings.
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const list = await reg.getNotifications();
        list.forEach((n) => n.close());
      }
    } catch { /* ignore */ }

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // proceed with local cleanup even if server request fails
    }

    // Replace current history entry with home so the back button
    // doesn't return to the page the user was on (e.g. /settings).
    // Using replaceState + setLocation avoids a full-page reload,
    // which in standalone PWA mode can leave the BottomNav missing.
    window.history.replaceState(null, "", import.meta.env.BASE_URL);
    setLocation("/");
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      setAuthError(null);
      const response = await fetch("/api/auth/supabase/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Login failed");
      }

      // Immediately wipe previous account's identity so no old data flashes
      setCachedUser(null);
      localStorage.removeItem(USER_CACHE_KEY);
      sessionStorage.clear();
      scrollStore.clear();
      clearAccountState();
      resetTheme();

      // Show loader while session is being verified
      setIsAuthenticating(true);
      // refreshUser drops stale 401 cache, awaits a fresh /api/auth/me, and
      // seeds queryClient + cachedUser before returning.
      await refreshUser();
      setLocation("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setAuthError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  };

  const signupWithEmail = async (email: string, password: string) => {
    try {
      setAuthError(null);
      const response = await fetch("/api/auth/supabase/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Signup failed");
      }

      // Immediately wipe previous account's identity so no old data flashes
      setCachedUser(null);
      localStorage.removeItem(USER_CACHE_KEY);
      sessionStorage.clear();
      scrollStore.clear();
      clearAccountState();
      resetTheme();

      setIsAuthenticating(true);
      await refreshUser();
      setLocation("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setAuthError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticating, login, logout, loginWithEmail, signupWithEmail, refreshUser, authError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    return {
      user: null,
      isLoading: false,
      isAuthenticating: false,
      login: () => {},
      logout: () => {},
      loginWithEmail: async () => {},
      signupWithEmail: async () => {},
      refreshUser: async () => null,
      authError: null,
    } as AuthContextType;
  }
  return context;
}
