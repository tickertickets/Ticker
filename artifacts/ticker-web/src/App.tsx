import { useEffect, useState, useRef, useCallback, Component, type ReactNode } from "react";
import { SplashScreen } from "@/components/SplashScreen";
import { LangProvider } from "@/lib/i18n";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useSocketIdentify, useSocketNotificationUpdates, useSocketFollowUpdates, useSocketChatUpdates, useSocketBadgeUpdates } from "@/hooks/use-socket";
import { Layout } from "@/components/layout/Layout";
import { Loader2 } from "lucide-react";
import { navPush, navBack, navHandlePopState, peekBackNavigation } from "@/lib/nav-back";

// ── All pages eagerly imported — no lazy chunks, no URL bar spinner ─────────
import Home             from "@/pages/home";
import Feed             from "@/pages/feed";
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
import PageVerificationRequest from "@/pages/page-verification-request";
import AuthSignup        from "@/pages/auth-signup";
import AuthLogin         from "@/pages/auth-login";
import AdminPanel       from "@/pages/admin";
import FeedPost         from "@/pages/feed-post";
import PersonDetail     from "@/pages/person-detail";
import CharacterDetail  from "@/pages/character-detail";
import WikiDetail       from "@/pages/wiki-detail";
import { TicketLarge, BadgeIconStatic } from "@/components/BadgeIcon";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
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
    <div className="flex justify-center overflow-hidden" style={{ height: "100%", background: "var(--app-chrome)" }}>
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

// ── Tab paths & swipe order ────────────────────────────────────────────────
// Order matches the bottom-nav left→right: Home / Search / Compass / Profile
const TAB_PATHS = ["/", "/following", "/search"];

// Instagram-style swipe order: Home ← → Search only.
// /following (Compass) handles its own internal pill swipes — never navigates away.
const SWIPE_TAB_ORDER = ["/", "/search"];

function extractMovieId(path: string) {
  const m = path.match(/^\/movie\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isTabPath(path: string) {
  return TAB_PATHS.includes(path);
}

// ── Single persistent tab — Instagram-style horizontal slide ─────────────
//
// position controls where the tab lives:
//   "center" → on-screen (translateX 0)
//   "left"   → off-screen left  (translateX -100%)
//   "right"  → off-screen right (translateX +100%)
//
// All three tabs stay mounted so their scroll positions are preserved.
// The CSS transition makes every tab switch a smooth slide (280 ms ease-out).
function PersistentTab({
  Component,
  isActive,
  position = "left",
}: {
  path: string;
  Component: React.ComponentType<{ isActive?: boolean }>;
  isActive: boolean;
  position?: "left" | "center" | "right";
}) {
  const tx =
    position === "center" ? "translateX(0)"
    : position === "right" ? "translateX(100%)"
    : "translateX(-100%)";
  return (
    <div
      className="absolute inset-0"
      style={{
        transform: tx,
        pointerEvents: isActive ? "auto" : "none",
        transition: "transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        willChange: "transform",
      }}
      {...(!isActive ? { inert: "" } as Record<string, string> : {})}
    >
      {/* isActive lets a tab defer "first visit" intro animations (e.g. the
          Roll/Vs and For You/Following reveal panels) until the tab is
          actually the one on screen — these tabs are always mounted
          off-screen for instant swiping, so a mount-time timer alone would
          fire invisibly before the user ever sees the tab. */}
      <Component isActive={isActive} />
    </div>
  );
}

// ── Error boundary — catches JS crashes in sub-pages ─────────────────────
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean; error: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false, error: "" };
  }
  static getDerivedStateFromError(err: unknown) {
    return { crashed: true, error: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch() {}
  render() {
    if (this.state.crashed) {
      const isEn = (() => { try { return localStorage.getItem("ticker_lang") !== "th"; } catch { return true; } })();
      return (
        <div className="h-full bg-background flex flex-col items-center justify-center gap-4 px-6">
          <p className="text-sm text-muted-foreground text-center">
            {isEn ? "Something went wrong. Please go back to the main page." : "เกิดข้อผิดพลาด กรุณากลับหน้าหลัก"}
          </p>
          <button
            onClick={() => { this.setState({ crashed: false, error: "" }); window.location.href = "/"; }}
            className="text-sm text-foreground underline"
          >
            {isEn ? "Go to main page" : "กลับหน้าหลัก"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Plain wrapper (legacy name kept; just renders children) ───────────────
function ShimmerActiveWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}><PageErrorBoundary>{children}</PageErrorBoundary></div>;
}

// ── Always-mounted guest tab shells ──────────────────────────────────────
function GuestPersistentTabs({ activeTab, subPageOpen }: { activeTab: string; subPageOpen: boolean }) {
  const GUEST_ORDER = ["/", "/search"];
  const tabs = [
    { path: "/",       Component: Feed },
    { path: "/search", Component: Search },
  ] as const;

  const activeIdx = GUEST_ORDER.indexOf(activeTab);

  return (
    <>
      {tabs.map(({ path, Component }) => {
        const tabIdx = GUEST_ORDER.indexOf(path);
        const isActive = !subPageOpen && activeTab === path;
        // Always keep tabs at their natural positions (behind the sub-page
        // overlay which is at z-50). Moving them all to "left" while a
        // sub-page is open caused the wrong tab to flash into view during
        // the exit animation, because the tabs had to animate in from -100%
        // at the same time the sub-page was sliding out to +100%.
        const position: "left" | "center" | "right" =
          tabIdx < activeIdx ? "left"
          : tabIdx > activeIdx ? "right"
          : "center";
        return (
          <PersistentTab
            key={path}
            path={path}
            Component={Component}
            isActive={isActive}
            position={position}
          />
        );
      })}
    </>
  );
}

// ── Always-mounted tab shells ─────────────────────────────────────────────
function PersistentTabs({ activeTab, subPageOpen }: { activeTab: string; subPageOpen: boolean }) {
  const tabs = [
    { path: "/",          Component: Feed },
    { path: "/following", Component: Home },
    { path: "/search",    Component: Search },
  ] as const;

  const activeIdx = SWIPE_TAB_ORDER.indexOf(activeTab);

  return (
    <>
      {tabs.map(({ path, Component }) => {
        const tabIdx = SWIPE_TAB_ORDER.indexOf(path);
        const isActive = !subPageOpen && activeTab === path;
        // Always keep tabs at their natural positions so that when a
        // sub-page exit-animates (slides right), the correct tab is already
        // in place behind it — not sliding in from the left simultaneously.
        const position: "left" | "center" | "right" =
          tabIdx < activeIdx ? "left"
          : tabIdx > activeIdx ? "right"
          : "center";
        return (
          <PersistentTab
            key={path}
            path={path}
            Component={Component}
            isActive={isActive}
            position={position}
          />
        );
      })}
    </>
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user, isAuthenticating } = useAuth();
  const [location, navigate] = useLocation();
  useKeepAlive();
  useSocketIdentify();
  useSocketNotificationUpdates();
  useSocketFollowUpdates();
  useSocketChatUpdates();
  useSocketBadgeUpdates();

  // ── Movie-layer lifecycle ────────────────────────────────────────────────
  // Two-phase enter / exit replaces the old bgMovieId + 450 ms delayed-clear.
  // movieMounted: whether the MovieDetail div is in the DOM at all.
  // movieExiting: true during the 300 ms slide-out after leaving the movie group.
  const [movieMounted, setMovieMounted] = useState<boolean>(() => {
    const onMovie  = extractMovieId(location) !== null;
    const onTicket = /^\/ticket\/[^/]+$/.test(location);
    const onStack  = /^\/(?:person|character|wiki)\//.test(location);
    return onMovie || onTicket || onStack;
  });
  const [movieExiting, setMovieExiting] = useState(false);
  const movieMountedRef = useRef(movieMounted);
  const movieExitTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sub-page overlay lifecycle ───────────────────────────────────────────
  // ROOT-CAUSE FIX for "User not found" / "ไม่พบ Chain นี้" ghost-page flashes:
  //
  // Old code used key={bgSubPage} on ShimmerActiveWrapper.  Every time bgSubPage
  // changed (including during exit), the wrapper UNMOUNTED + REMOUNTED with the
  // new location, triggering fresh API calls whose loading/error states flashed
  // on screen before data arrived.
  //
  // New approach — two independent mechanisms:
  //   • subMounted / subExiting drive mount lifecycle and the slide-out transform.
  //   • frozenSubLoc (ref, NOT state) freezes the last-known sub-page path so
  //     the Switch keeps rendering the correct page during the exit slide.
  //   • subOverlayKey (= frozenSubLoc.current ?? location) is used as the
  //     ShimmerActiveWrapper key; it changes only on genuine forward navigation,
  //     NOT during exit — so the wrapper never remounts mid-slide.
  const [subMounted, setSubMounted] = useState<boolean>(() => {
    const onMovie = extractMovieId(location) !== null;
    return !isTabPath(location) && !onMovie;
  });
  const [subExiting, setSubExiting] = useState(false);
  const frozenSubLoc  = useRef<string | null>(subMounted ? location : null);
  const subMountedRef = useRef(subMounted);
  const subExitTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the last persistent tab — declared here (before any conditional
  // early return) to satisfy React's Rules of Hooks. The computed activeTab
  // value is derived later, after the early-return guards.
  const [lastActiveTab, setLastActiveTab] = useState<string>(() =>
    isTabPath(location) ? location : "/"
  );
  useEffect(() => {
    if (isTabPath(location)) setLastActiveTab(location);
  }, [location]);

  // ── Horizontal swipe navigation between main tabs ──────────────────────
  // Instagram-style: swipe left/right to move between Feed / Search / Compass.
  // Only fires when the horizontal delta clearly dominates the vertical delta
  // (prevents accidental triggers while the user is scrolling content).
  const swipeXRef = useRef<number | null>(null);
  const swipeYRef = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    swipeXRef.current = e.touches[0]!.clientX;
    swipeYRef.current = e.touches[0]!.clientY;
  }, []);

  // Returns true if the touch started inside a horizontally-scrollable
  // container — in that case we should NOT swipe between tabs.
  const startsInHorizScroller = useCallback((e: TouchEvent): boolean => {
    let el = e.target as Element | null;
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth) {
        const style = getComputedStyle(el);
        const ox = style.overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (swipeXRef.current === null || swipeYRef.current === null) return;
    const startX = swipeXRef.current;
    const dx = e.changedTouches[0]!.clientX - startX;
    const dy = e.changedTouches[0]!.clientY - swipeYRef.current;
    swipeXRef.current = null;
    swipeYRef.current = null;
    // Require: |dx| > 55 px AND horizontal motion dominates 2:1
    if (Math.abs(dx) < 55 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
    // Skip if gesture started inside a horizontal scroll container (backdrop,
    // carousel, chip-row, etc.) so internal scrollers still work normally.
    if (startsInHorizScroller(e)) return;

    // ── Edge-swipe-to-go-back on sub-pages ──────────────────────────────
    // A rightward swipe starting within the left 30 px edge triggers navBack
    // on any sub-page (person/character/wiki/profile and other detail pages).
    // This mirrors iOS edge-swipe-back and avoids conflicting with carousels
    // because we already filtered out horiz-scroll containers above.
    if (dx > 0 && startX <= 30 && !isTabPath(location)) {
      navBack(navigate);
      return;
    }

    // ── Horizontal tab swipe — main-tab surfaces only ──────────────────
    if (!isTabPath(location)) return;
    // NOTE: /following was previously excluded here to avoid conflicting with
    // its internal pill-switching swipes, but the startsInHorizScroller()
    // guard above already filters out touches that begin inside the pill row,
    // so tab-level swipes (which start in open space) work correctly on
    // /following too. Removing the early-return restores swipe navigation
    // from /following → /search and /following → / as the user expects.
    const cur = SWIPE_TAB_ORDER.indexOf(location);
    if (cur === -1) return;
    if (dx < 0 && cur < SWIPE_TAB_ORDER.length - 1) navigate(SWIPE_TAB_ORDER[cur + 1]!);
    else if (dx > 0 && cur > 0) navigate(SWIPE_TAB_ORDER[cur - 1]!);
  }, [location, navigate, startsInHorizScroller]);

  useEffect(() => {
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend",   handleTouchEnd,   { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend",   handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);

  useEffect(() => { navPush(location + window.location.search); }, [location]);

  // Hardware back button (popstate) — keep our navStack in sync when the
  // browser pops its own history (e.g. device back button on Android / iOS PWA).
  // Must fire BEFORE navPush so navHandlePopState can adjust the stack first,
  // then navPush's duplicate-guard prevents double-adding the destination.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // chat-conversation.tsx pushes a fake guard entry (chatConversationGuard: true)
      // into browser history to intercept the device back button.  When that guard is
      // popped we must NOT call navHandlePopState() — the user hasn't actually left
      // /chat/:id, the nav-stack pop will be handled by chat-conversation's own handler.
      if ((e.state as Record<string, unknown> | null)?.chatConversationGuard) return;
      navHandlePopState();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Movie-layer lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    const onMovie  = extractMovieId(location) !== null;
    const onTicket = /^\/ticket\/[^/]+$/.test(location);
    const onStack  = /^\/(?:person|character|wiki)\//.test(location);
    const shouldShow = onMovie || onTicket || onStack;
    if (shouldShow) {
      if (movieExitTimer.current) { clearTimeout(movieExitTimer.current); movieExitTimer.current = null; }
      movieMountedRef.current = true;
      setMovieMounted(true);
      setMovieExiting(false);
    } else if (movieMountedRef.current) {
      movieMountedRef.current = false;
      setMovieExiting(true);
      movieExitTimer.current = setTimeout(() => {
        setMovieMounted(false);
        setMovieExiting(false);
        movieExitTimer.current = null;
      }, 300);
    }
    return () => { if (movieExitTimer.current) { clearTimeout(movieExitTimer.current); movieExitTimer.current = null; } };
  }, [location]);

  // ── Sub-page overlay lifecycle ────────────────────────────────────────────
  // /chat/:id uses an early return so the overlay is never rendered on that
  // route.  When the user navigates back to /chat (the list) isOnOtherSubPage
  // becomes true again and the overlay mounts cleanly with the correct path.
  useEffect(() => {
    const isOnOtherSubPage = !isTabPath(location) && extractMovieId(location) === null;
    if (isOnOtherSubPage) {
      if (subExitTimer.current) { clearTimeout(subExitTimer.current); subExitTimer.current = null; }
      frozenSubLoc.current = location;
      subMountedRef.current = true;
      setSubMounted(true);
      setSubExiting(false);
    } else if (subMountedRef.current) {
      subMountedRef.current = false;
      setSubExiting(true);
      subExitTimer.current = setTimeout(() => {
        setSubMounted(false);
        setSubExiting(false);
        frozenSubLoc.current = null;
        subExitTimer.current = null;
      }, 280);
    }
    return () => { if (subExitTimer.current) { clearTimeout(subExitTimer.current); subExitTimer.current = null; } };
  }, [location]);

  if (location === "/terms")         return <TermsPage />;
  if (location === "/privacy")       return <PrivacyPage />;
  if (location === "/badge-preview") return <BadgePreview />;

  // /@username → /profile/username — resolve before auth check so deep-links work for guests
  if (/^\/@[^/]+$/.test(location)) {
    return <Redirect to={`/profile/${location.slice(2)}`} />;
  }

  if (!user && isAuthenticating) return (
    <Layout>
      <div className="absolute inset-0 bg-background flex items-center justify-center z-50">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    </Layout>
  );

  // ── Shared computed variables — used in both guest and authenticated sections ──
  // These must be computed before any conditional return so they are always
  // available for both branches without re-declaring (which caused the
  // ReferenceError crash that produced ghost pages and the infinite logout spinner).
  const isOnMoviePage      = extractMovieId(location) !== null;
  const isOnTicketPage     = /^\/ticket\/[^/]+$/.test(location);
  const isOnMovieStackPage = /^\/(?:person|character|wiki)\//.test(location);
  const movieLayerActive   = isOnMoviePage;
  const otherSubPageActive = !isTabPath(location) && !isOnMoviePage;
  // Location rendered inside the sub-page overlay:
  //   active → real current location (always correct; no ghost-page risk)
  //   exiting → frozen last-known sub-page path (page content visible during slide-out)
  const subSwitchLoc  = otherSubPageActive ? location : (frozenSubLoc.current ?? location);
  // Stable key: changes only on genuine forward navigation to a new sub-page,
  // NOT during the exit slide — so ShimmerActiveWrapper never remounts mid-transition.
  const subOverlayKey = frozenSubLoc.current ?? location;

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
      /^\/@[^/]+$/.test(location) ||
      /^\/movie\/.+$/.test(location) ||
      /^\/chain\/(?!new$)[^/]+$/.test(location) ||
      /^\/person\/[^/]+$/.test(location) ||
      /^\/character\/[^/]+$/.test(location) ||
      /^\/wiki\/[^/]+$/.test(location);

    if (!isPublic) return <AuthLogin />;

    const GUEST_TAB_PATHS = ["/", "/search"];
    const isGuestTab      = GUEST_TAB_PATHS.includes(location);
    const guestActiveTab  = isGuestTab ? location : "/";
    const guestSubPageOpen = !isGuestTab;

    return (
      <Layout>
        <div className="absolute inset-0">
          <PageErrorBoundary><GuestPersistentTabs activeTab={guestActiveTab} subPageOpen={guestSubPageOpen} /></PageErrorBoundary>
        </div>

        {/* Movie / ticket / person stack layer (z-40) — same two-phase lifecycle
            as the authenticated view. movieMounted / movieExiting are already
            computed by the useEffect at the top of AppRoutes. */}
        {movieMounted && (
          <div
            className="absolute inset-0 bg-background z-40"
            style={{
              transform:     movieExiting ? "translateX(100%)" : "translateX(0)",
              transition:    "transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              willChange:    "transform",
              pointerEvents: movieLayerActive ? "auto" : "none",
            }}
            {...(!movieLayerActive || movieExiting ? { inert: "" } as Record<string, string> : {})}
          >
            <PageErrorBoundary><MovieDetail /></PageErrorBoundary>
          </div>
        )}

        {/* Sub-page overlay (z-50) — same two-phase lifecycle as the authenticated
            view. subMounted / subExiting / frozenSubLoc are already computed. */}
        {subMounted && (
          <div
            className="absolute inset-0 bg-background z-50"
            style={{
              transform:     subExiting ? "translateX(100%)" : "translateX(0)",
              transition:    subExiting ? "transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none",
              willChange:    "transform",
              pointerEvents: subExiting ? "none" : "auto",
            }}
            {...(subExiting ? { inert: "" } as Record<string, string> : {})}
          >
            <ShimmerActiveWrapper
              key={subOverlayKey}
              className={`absolute inset-0 bg-background animate-in duration-[250ms] ease-out ${peekBackNavigation() ? "fade-in" : "slide-in-from-right"}`}
            >
              <Switch location={subSwitchLoc}>
                <Route path="/join"              component={AuthSignup} />
                <Route path="/login"             component={AuthLogin} />
                <Route path="/ticket/:id"        component={TicketDetail} />
                <Route path="/profile/:username" component={Profile} />
                <Route path="/@:username">{(p: Record<string,string>) => <Redirect to={`/profile/${p.username}`} />}</Route>
                <Route path="/chain/:id"         component={ChainDetail} />
                <Route path="/person/:personId"  component={PersonDetail} />
                <Route path="/character/:wikidataId" component={CharacterDetail} />
                <Route path="/wiki/:wikiPageId"  component={WikiDetail} />
                <Route><div className="h-full bg-background" /></Route>
              </Switch>
            </ShimmerActiveWrapper>
          </div>
        )}
      </Layout>
    );
  }

  if (!user.isOnboarded)       return <Onboarding />;

  if (location.startsWith("/chat/")) return <ChatConversation />;

  // activeTab: use current location if it's a tab, otherwise stick to the last tab.
  // (useState/useEffect for lastActiveTab are declared earlier to satisfy Rules of Hooks.)
  const activeTab  = isTabPath(location) ? location : lastActiveTab;
  const subPageOpen = !isTabPath(location);
  // isOnMoviePage, movieLayerActive, otherSubPageActive, subSwitchLoc, subOverlayKey
  // are all declared in the shared section above (before the !user block).

  return (
    <Layout>
      {/* ── Persistent tabs ── */}
      <div className="absolute inset-0">
        <PageErrorBoundary><PersistentTabs activeTab={activeTab} subPageOpen={subPageOpen} /></PageErrorBoundary>
      </div>

      {/* ── Movie / ticket / person stack layer (z-40) ─────────────────────
          Kept mounted while on movie, ticket, or person/wiki/character pages
          so navigating movie → ticket → back to movie doesn't re-fetch.
          Two-phase lifecycle: movieExiting drives the slide-out transform for
          300 ms, then movieMounted flips to false and the div is removed. */}
      {movieMounted && (
        <div
          className="absolute inset-0 bg-background z-40"
          style={{
            transform:     movieExiting ? "translateX(100%)" : "translateX(0)",
            transition:    "transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            willChange:    "transform",
            pointerEvents: movieLayerActive ? "auto" : "none",
          }}
          {...(!movieLayerActive || movieExiting ? { inert: "" } as Record<string, string> : {})}
        >
          <PageErrorBoundary><MovieDetail /></PageErrorBoundary>
        </div>
      )}

      {/* ── Sub-page overlay (z-50) ─────────────────────────────────────────
          Two-phase lifecycle:
            subExiting = false → at translateX(0), pointer-events on
            subExiting = true  → transitions to translateX(100%) for 280 ms,
                                  then subMounted → false and div is removed.
          ShimmerActiveWrapper key = subOverlayKey (frozen during exit) so the
          wrapper is NEVER remounted mid-slide — the root fix for ghost pages. */}
      {subMounted && (
        <div
          className="absolute inset-0 bg-background z-50"
          style={{
            transform:     subExiting ? "translateX(100%)" : "translateX(0)",
            transition:    subExiting ? "transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none",
            willChange:    "transform",
            pointerEvents: subExiting ? "none" : "auto",
          }}
          {...(subExiting ? { inert: "" } as Record<string, string> : {})}
        >
          <ShimmerActiveWrapper
            key={subOverlayKey}
            className={`absolute inset-0 bg-background animate-in duration-[250ms] ease-out ${peekBackNavigation() ? "fade-in" : "slide-in-from-right"}`}
          >
            <Switch location={subSwitchLoc}>
              <Route path="/post/ticket/:id"   component={FeedPost} />
              <Route path="/post/chain/:id"    component={FeedPost} />
              <Route path="/ticket/new"        component={CreateTicket} />
              <Route path="/ticket/:id/edit"   component={EditTicket} />
              <Route path="/ticket/:id"        component={TicketDetail} />
              <Route path="/profile/:username" component={Profile} />
              <Route path="/@:username">{(p: Record<string,string>) => <Redirect to={`/profile/${p.username}`} />}</Route>
              <Route path="/bookmarks"         component={Bookmarks} />
              <Route path="/notifications"     component={Notifications} />
              <Route path="/settings"          component={Settings} />
              <Route path="/chat"              component={ChatList} />
              <Route path="/chain/new"         component={CreateChain} />
              <Route path="/chain/:id/edit"    component={EditChain} />
              <Route path="/chain/:id"         component={ChainDetail} />
              <Route path="/person/:personId"  component={PersonDetail} />
              <Route path="/character/:wikidataId" component={CharacterDetail} />
              <Route path="/wiki/:wikiPageId"  component={WikiDetail} />
              <Route path="/page-verify"       component={PageVerificationRequest} />
              <Route path="/admin"             component={AdminPanel} />
              <Route path="/join"><Redirect to="/" /></Route>
              <Route path="/login"><Redirect to="/" /></Route>
              <Route><div className="h-full bg-background" /></Route>
            </Switch>
          </ShimmerActiveWrapper>
        </div>
      )}
      <PushPermissionPrompt />
      <PwaInstallPrompt />
    </Layout>
  );
}

// ── Root-level catch-all boundary — prevents blank white screen on any crash ──
class RootErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error: unknown) {
    try { console.error("[RootErrorBoundary]", error); } catch {}
  }
  componentDidUpdate(_: Record<string, unknown>, prevState: { crashed: boolean }) {
    if (!prevState.crashed && this.state.crashed) {
      // Auto-recover: navigate to home without showing an error screen.
      // Short timeout lets React flush the render before we navigate.
      setTimeout(() => {
        try { this.setState({ crashed: false }); } catch { /* ignore */ }
        window.location.href = "/";
      }, 350);
    }
  }
  render() {
    if (this.state.crashed) {
      // Show a plain loading spinner while auto-redirecting — user never sees the error.
      return (
        <div style={{ height: "100dvh", background: "var(--background, #000)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <style>{`@keyframes _rSpinX{to{transform:rotate(360deg)}}`}</style>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid rgba(128,128,128,0.3)", borderTopColor: "rgba(128,128,128,0.8)", animation: "_rSpinX 0.8s linear infinite" }} />
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Root ───────────────────────────────────────────────────────────────────
function App() {
  const [splashDone, setSplashDone] = useState(false);

  return (
    <>
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      <RootErrorBoundary>
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
      </RootErrorBoundary>
    </>
  );
}

export default App;
