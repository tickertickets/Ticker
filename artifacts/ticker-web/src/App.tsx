import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ShimmerContext } from "@/lib/shimmer-context";
import { LangProvider } from "@/lib/i18n";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useSocketIdentify, useSocketNotificationUpdates, useSocketFollowUpdates, useSocketChatUpdates } from "@/hooks/use-socket";
import { Layout } from "@/components/layout/Layout";
import { Loader2 } from "lucide-react";
import { navPush } from "@/lib/nav-back";

// ── All pages eagerly imported — no lazy chunks, no URL bar spinner ─────────
import Home             from "@/pages/home";
import Following        from "@/pages/following";
import Search           from "@/pages/search";
import TermsPage        from "@/pages/terms";
import PrivacyPage      from "@/pages/privacy";
import CreateTicket     from "@/pages/create-ticket";
import TicketDetail     from "@/pages/ticket-detail";
import EditTicket       from "@/pages/edit-ticket";
import Profile          from "@/pages/profile";
import Bookmarks        from "@/pages/bookmarks";
import Notifications    from "@/pages/notifications";
import MovieDetail      from "@/pages/movie-detail";
import CreateChain      from "@/pages/create-chain";
import ChainDetail      from "@/pages/chain-detail";
import EditChain        from "@/pages/edit-chain";
import Onboarding       from "@/pages/onboarding";
import Settings         from "@/pages/settings";
import ChatList         from "@/pages/chat";
import ChatConversation from "@/pages/chat-conversation";
import NotFound         from "@/pages/not-found";
import SupporterRequest from "@/pages/supporter-request";
import PageVerificationRequest from "@/pages/page-verification-request";
import AuthSignup        from "@/pages/auth-signup";
import AuthLogin         from "@/pages/auth-login";
import AdminPanel       from "@/pages/admin";
import { TicketLarge, BadgeIconStatic } from "@/components/BadgeIcon";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
function BadgePreview() {
  return (
    <div style={{ background: "#111", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", padding: 32, gap: 40 }}>
      <h2 style={{ color: "#fff", fontFamily: "sans-serif", fontSize: 20 }}>Badge Preview — All Levels</h2>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
        {[1,2,3,4,5].map(lvl => (
          <div key={lvl} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <TicketLarge level={lvl} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BadgeIconStatic level={lvl} size={14} />
              <BadgeIconStatic level={lvl} size={20} />
              <BadgeIconStatic level={lvl} size={32} />
            </div>
            <span style={{ color: "#aaa", fontSize: 13, fontFamily: "sans-serif" }}>Level {lvl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
// ── Keep-alive ping — prevents Render free tier from sleeping ─────────────
function useKeepAlive() {
  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? "/";
    const ping = () => fetch(`${base}api/healthz`).catch(() => {});
    ping();
    const id = setInterval(ping, 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
}

function AppLoader() {
  return (
    <div className="flex justify-center overflow-hidden" style={{ height: "100dvh", background: "var(--app-chrome)" }}>
      <div className="relative w-full max-w-[430px] h-full bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-foreground flex items-center justify-center">
            <span className="font-display font-bold text-xl text-background">T</span>
          </div>
          <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
}

// ── Tab paths ─────────────────────────────────────────────────────────────
const TAB_PATHS = ["/", "/following", "/search"];

function extractMovieId(path: string) {
  const m = path.match(/^\/movie\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isTabPath(path: string) {
  return TAB_PATHS.includes(path);
}

// ── Single persistent tab — handles shimmer activation on visibility ──────
function PersistentTab({
  path,
  Component,
  isActive,
}: {
  path: string;
  Component: React.ComponentType;
  isActive: boolean;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const [shimmerStartTime, setShimmerStartTime] = useState<number | null>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    if (isActive) {
      const timer = setTimeout(() => {
        el.classList.add("shimmer-active");
        setShimmerStartTime(performance.now());
      }, 500);
      return () => clearTimeout(timer);
    } else {
      el.classList.remove("shimmer-active");
      setShimmerStartTime(null);
    }
  }, [isActive]);

  return (
    <ShimmerContext.Provider value={shimmerStartTime}>
      <div
        ref={divRef}
        className="absolute inset-0"
        style={{
          transform: isActive ? "translateX(0)" : "translateX(-100%)",
          pointerEvents: isActive ? "auto" : "none",
        }}
        aria-hidden={!isActive}
      >
        <Component />
      </div>
    </ShimmerContext.Provider>
  );
}

// ── ShimmerActiveWrapper — adds shimmer-active to any overlay (sub-pages, movie detail) ──
function ShimmerActiveWrapper({ children, className }: { children: ReactNode; className?: string }) {
  const divRef = useRef<HTMLDivElement>(null);
  const [shimmerStartTime, setShimmerStartTime] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.classList.add("shimmer-active");
      setShimmerStartTime(performance.now());
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ShimmerContext.Provider value={shimmerStartTime}>
      <div ref={divRef} className={className}>
        {children}
      </div>
    </ShimmerContext.Provider>
  );
}

// ── Always-mounted guest tab shells ──────────────────────────────────────
function GuestPersistentTabs({ activeTab, subPageOpen }: { activeTab: string; subPageOpen: boolean }) {
  const tabs = [
    { path: "/",       Component: Following },
    { path: "/search", Component: Search },
  ] as const;

  return (
    <>
      {tabs.map(({ path, Component }) => (
        <PersistentTab
          key={path}
          path={path}
          Component={Component}
          isActive={!subPageOpen && activeTab === path}
        />
      ))}
    </>
  );
}

// ── Always-mounted tab shells ─────────────────────────────────────────────
function PersistentTabs({ activeTab, subPageOpen }: { activeTab: string; subPageOpen: boolean }) {
  const tabs = [
    { path: "/",          Component: Following },
    { path: "/following", Component: Home },
    { path: "/search",    Component: Search },
  ] as const;

  return (
    <>
      {tabs.map(({ path, Component }) => (
        <PersistentTab
          key={path}
          path={path}
          Component={Component}
          isActive={!subPageOpen && activeTab === path}
        />
      ))}
    </>
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user, isAuthenticating } = useAuth();
  const [location] = useLocation();
  useKeepAlive();
  useSocketIdentify();
  useSocketNotificationUpdates();
  useSocketFollowUpdates();
  useSocketChatUpdates();

  const [bgMovieId, setBgMovieId] = useState<string | null>(() => extractMovieId(location));

  useEffect(() => { navPush(location); }, [location]);

  useEffect(() => {
    const movieId = extractMovieId(location);
    if (movieId) {
      setBgMovieId(movieId);
    } else if (!/^\/ticket\//.test(location)) {
      setBgMovieId(null);
    }
  }, [location]);

  if (location === "/terms")         return <TermsPage />;
  if (location === "/privacy")       return <PrivacyPage />;
  if (location === "/badge-preview") return <BadgePreview />;

  if (!user && isAuthenticating) return (
    <Layout>
      <div className="absolute inset-0 bg-background flex items-center justify-center z-50">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    </Layout>
  );

  // ── Guest mode — public browsing without login ─────────────────────────
  if (!user) {
    const isFreshSession =
      typeof sessionStorage !== "undefined" && !sessionStorage.getItem("_nav_seen");
    if (isFreshSession) {
      try { sessionStorage.setItem("_nav_seen", "1"); } catch { /* ignore */ }
      if (location === "/login" || location === "/join") {
        return <Redirect to="/" />;
      }
    }

    const isPublic =
      location === "/" ||
      location === "/search" ||
      location === "/join" ||
      location === "/login" ||
      /^\/ticket\/(?!new$)[^/]+$/.test(location) ||
      /^\/profile\/[^/]+$/.test(location) ||
      /^\/movie\/.+$/.test(location) ||
      /^\/chain\/(?!new$)[^/]+$/.test(location);

    if (!isPublic) return <AuthLogin />;

    const GUEST_TAB_PATHS = ["/", "/search"];
    const isGuestTab      = GUEST_TAB_PATHS.includes(location);
    const guestActiveTab  = isGuestTab ? location : "/";
    const guestSubPageOpen = !isGuestTab;

    const isOnGuestMoviePage   = extractMovieId(location) !== null;
    const showGuestMovieLayer  = bgMovieId !== null && isOnGuestMoviePage;
    const showGuestSubPage     = guestSubPageOpen && !isOnGuestMoviePage;

    return (
      <Layout>
        <div className="absolute inset-0">
          <GuestPersistentTabs activeTab={guestActiveTab} subPageOpen={guestSubPageOpen} />
        </div>

        {showGuestMovieLayer && (
          <div
            className="absolute inset-0 bg-background z-40 animate-in fade-in duration-100"
            style={{
              transform:    isOnGuestMoviePage ? "translateX(0)" : "translateX(-100%)",
              pointerEvents: isOnGuestMoviePage ? "auto" : "none",
            }}
            aria-hidden={!isOnGuestMoviePage}
          >
            <MovieDetail />
          </div>
        )}

        {showGuestSubPage && (
          <ShimmerActiveWrapper className="absolute inset-0 bg-background z-50 animate-in fade-in duration-100">
            <Switch>
              <Route path="/join"              component={AuthSignup} />
              <Route path="/login"             component={AuthLogin} />
              <Route path="/ticket/:id"        component={TicketDetail} />
              <Route path="/profile/:username" component={Profile} />
              <Route path="/chain/:id"         component={ChainDetail} />
              <Route><Redirect to="/" /></Route>
            </Switch>
          </ShimmerActiveWrapper>
        )}
      </Layout>
    );
  }

  if (!user.isOnboarded)       return <Onboarding />;

  if (location.startsWith("/chat/")) return <ChatConversation />;

  const activeTab = isTabPath(location) ? location : "/";
  const subPageOpen = !isTabPath(location);

  const isOnMoviePage  = extractMovieId(location) !== null;
  const isOnTicketPage = /^\/ticket\/[^/]+$/.test(location);
  const showMovieLayer   = bgMovieId !== null && (isOnMoviePage || isOnTicketPage);
  const movieLayerActive = isOnMoviePage;
  const showOtherSubPage = subPageOpen && !isOnMoviePage;

  return (
    <Layout>
      <div className="absolute inset-0">
        <PersistentTabs activeTab={activeTab} subPageOpen={subPageOpen} />
      </div>

      {showMovieLayer && (
        <div
          className="absolute inset-0 bg-background z-40 animate-in fade-in duration-100"
          style={{
            transform:    movieLayerActive ? "translateX(0)" : "translateX(-100%)",
            pointerEvents: movieLayerActive ? "auto" : "none",
          }}
          aria-hidden={!movieLayerActive}
        >
          <MovieDetail />
        </div>
      )}

      {showOtherSubPage && (
        <ShimmerActiveWrapper className="absolute inset-0 bg-background z-50 animate-in fade-in duration-100">
          <Switch>
            <Route path="/ticket/new"        component={CreateTicket} />
            <Route path="/ticket/:id/edit"   component={EditTicket} />
            <Route path="/ticket/:id"        component={TicketDetail} />
            <Route path="/profile/:username" component={Profile} />
            <Route path="/bookmarks"         component={Bookmarks} />
            <Route path="/notifications"     component={Notifications} />
            <Route path="/settings"          component={Settings} />
            <Route path="/chat"              component={ChatList} />
            <Route path="/chain/new"         component={CreateChain} />
            <Route path="/chain/:id/edit"    component={EditChain} />
            <Route path="/chain/:id"         component={ChainDetail} />
            <Route path="/supporter"         component={SupporterRequest} />
            <Route path="/page-verify"       component={PageVerificationRequest} />
            <Route path="/admin"             component={AdminPanel} />
            <Route path="/join"><Redirect to="/" /></Route>
            <Route path="/login"><Redirect to="/" /></Route>
            <Route><Redirect to="/" /></Route>
          </Switch>
        </ShimmerActiveWrapper>
      )}
      <PushPermissionPrompt />
    </Layout>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </LangProvider>
    </QueryClientProvider>
  );
}

export default App;
