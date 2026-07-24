import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { TicketCard, FeedPostSkeleton } from "@/components/TicketCard";
import { Loader2, MessageCircle, Bell, EyeOff, Eye, Sparkles, Users } from "lucide-react";
import { useHiddenItems } from "@/hooks/use-hidden-items";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { scrollStore } from "@/lib/scroll-store";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { useNotificationCount } from "@/hooks/use-notification-count";
import { useSocketFeedUpdates } from "@/hooks/use-socket";
import { cn } from "@/lib/utils";
import { ChainCard } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import { FeedUpcomingCard, TabActiveCtx, type UpcomingMovie } from "@/components/UpcomingCard";
import { useLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";


type FeedItem =
  | { type: "ticket"; ticket: any }
  | { type: "chain"; chain: ChainItem };

function useUpcomingMovies() {
  return useQuery<UpcomingMovie[]>({
    queryKey: ["upcoming-feed"],
    queryFn: async () => {
      const res = await fetch("/api/movies/upcoming-feed", { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.movies ?? [];
    },
    staleTime: 1000 * 60 * 30,
  });
}

export default function Feed({ isActive = true }: { isActive?: boolean } = {}) {
  const { t } = useLang();
  const scrollRef   = useRef<HTMLDivElement>(null);
  const headerRef   = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const firstLoadDone = useRef(false);
  const [headerH, setHeaderH]           = useState(64);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [subMode, setSubMode] = useState<"home" | "following">(() => {
    try { return (localStorage.getItem("feed-sub-mode") as "home" | "following") || "home"; }
    catch { return "home"; }
  });
  const [showFeedPanel, setShowFeedPanel] = useState(false);
  const [feedPanelHighlight, setFeedPanelHighlight] = useState(() => !sessionStorage.getItem("ticker_feed_panel_seen"));
  const [feedPanelAnimDone, setFeedPanelAnimDone] = useState(false);
  const qc = useQueryClient();

  // Pagination state for "load more"
  const [extraItems, setExtraItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Track all item IDs shown this session for deduplication on load-more
  const seenIdsRef = useRef<Set<string>>(new Set());

  // pendingRefreshRef = true whenever we're expecting a "fresh" first page
  // (initial mount, user-triggered refresh, or feed-mode change).
  // The feedData useEffect only resets cursor/extraItems/seenIds when this
  // flag is true — background refetches (refetchInterval, refetchOnWindowFocus)
  // leave the flag false so they never wipe the user's accumulated pages.
  const pendingRefreshRef = useRef(true);
  // Once the server reports "recycled" (mode=home/discover ran out of genuinely
  // new content and started re-serving the ranked list from the top, re-scored),
  // repeats are intentional — stop de-duping and show a one-time divider instead
  // of silently dropping every item (which would look like the feed froze).
  // recycleStartIndex marks where in `extraItems` the divider belongs (null = not caught up yet).
  const [recycleStartIndex, setRecycleStartIndex] = useState<number | null>(null);

  const { user } = useAuth();
  useSocketFeedUpdates();
  const unreadCount = useNotificationCount();

  // Logged-in users toggle between mode=home ("For You" — unified, all users,
  // smart algorithm) and mode=following ("Following" — unified, only followed).
  // Guests always get mode=discover (all public content, hotScore ranked).
  const feedMode = user ? subMode : "discover";

  const selectSubMode = (m: "home" | "following") => {
    setSubMode(m);
    try { localStorage.setItem("feed-sub-mode", m); } catch {}
    setShowFeedPanel(false);
  };

  // First-visit: auto-animate the panel in, pause, then slide back out.
  // Gated on `isActive` — this tab is always mounted (even off-screen, for
  // instant swiping), so without this check the intro would play invisibly
  // before the user ever looks at this tab.
  useEffect(() => {
    if (!isActive || !feedPanelHighlight || !user) return;
    const tid0 = setTimeout(() => setShowFeedPanel(true), 500);
    const tid1 = setTimeout(() => setShowFeedPanel(false), 3800);
    const tid2 = setTimeout(() => {
      sessionStorage.setItem("ticker_feed_panel_seen", "1");
      setFeedPanelHighlight(false);
    }, 4700);
    return () => { clearTimeout(tid0); clearTimeout(tid1); clearTimeout(tid2); };
  }, [isActive, feedPanelHighlight, user]);

  // Delay bounce class until after the open transition completes so the icon
  // is never clipped by overflow-hidden during the reveal. The panel + inner
  // content transition finishes at ~390ms (340ms max-height + 50ms inner
  // delay); the old 920ms wait left the icon looking frozen for half a
  // second after the panel had visibly finished sliding down.
  useEffect(() => {
    if (!showFeedPanel) { setFeedPanelAnimDone(false); return; }
    const tid = setTimeout(() => setFeedPanelAnimDone(true), 420);
    return () => clearTimeout(tid);
  }, [showFeedPanel]);

  const doRefresh = useCallback((): Promise<void> => {
    firstLoadDone.current = false;
    pendingRefreshRef.current = true;   // tell feedData effect to reset on next data
    seenIdsRef.current = new Set();
    window.dispatchEvent(new CustomEvent("feed-cards-reset"));
    const el = scrollRef.current;
    if (el) {
      try { el.scrollTo({ top: 0, behavior: "auto" }); }
      catch { el.scrollTop = 0; }
    }
    setHeaderHidden(false);
    setIsRefreshing(true);
    setExtraItems([]);
    setNextCursor(null);
    setHasMore(false);
    setRecycleStartIndex(null);
    return qc.invalidateQueries({ queryKey: ["mixed-feed", feedMode] })
      .then(() => new Promise<void>(r => setTimeout(r, 400)))
      .then(() => {
        setIsRefreshing(false);
        // Return the user to the top if they scrolled during the refresh spin.
        const elAfter = scrollRef.current;
        if (elAfter && elAfter.scrollTop > 0) elAfter.scrollTo({ top: 0, behavior: "smooth" });
      });
  }, [qc, feedMode]);

  // Pull-to-refresh for the main feed scroll container.
  const { pullY: ptrPullY, progress: ptrProgress, isPulling: ptrIsPulling } = usePullToRefresh(scrollRef, doRefresh);

  // When the socket emits feed:new (someone posted), do a full feed reset so
  // the new post appears at the top — same behaviour as pull-to-refresh but
  // triggered automatically instead of by the user.
  useEffect(() => {
    const handler = () => { doRefresh(); };
    window.addEventListener("ticker:feed-socket-new", handler);
    return () => window.removeEventListener("ticker:feed-socket-new", handler);
  }, [doRefresh]);

  // ── Unified mixed feed (personalised or discover depending on auth) ──────────
  const { data: feedData, isLoading } = useQuery<{ items: FeedItem[]; hasMore: boolean; nextCursor: string | null; recycled?: boolean }>({
    queryKey: ["mixed-feed", feedMode],
    queryFn: async () => {
      const res = await fetch(`/api/feed?mode=${feedMode}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    // structuralSharing must be OFF so that feedData always gets a new
    // reference after a refetch, even when the server returns content that
    // is deeply identical to the previous page (same 20 items, same scores,
    // same cursor — common when the feed hasn't changed between refreshes).
    // Without this, React Query reuses the old reference → the useEffect
    // below never fires → pendingRefreshRef stays true, hasMore stays false,
    // nextCursor stays null → feed appears to have no more posts.
    structuralSharing: false,
  });

  // Reset pagination when the user switches feed modes (home ↔ following).
  // This must run before the new query's feedData arrives so the display
  // doesn't flash old mode's extra pages while the network round-trip is
  // in flight.  firstLoadDone is already reset in its own feedMode effect.
  useEffect(() => {
    pendingRefreshRef.current = true;
    setExtraItems([]);
    setNextCursor(null);
    setHasMore(false);
    setRecycleStartIndex(null);
    seenIdsRef.current = new Set();
  }, [feedMode]);

  // Sync pagination state from first-page feed data + track seen IDs for dedup.
  //
  // IMPORTANT: only reset cursor/extraItems when pendingRefreshRef is true
  // (user-initiated refresh, mode change, or initial mount).  Background
  // refetches — refetchInterval every 2 min, refetchOnWindowFocus — must NOT
  // clear extraItems: that would silently erase every page the user has
  // accumulated and make the feed appear to reset mid-session.
  useEffect(() => {
    if (!feedData) return;
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      setNextCursor(feedData.nextCursor ?? null);
      setHasMore(feedData.hasMore);
      setExtraItems([]);          // safe redundant clear (doRefresh already did it)
      seenIdsRef.current = new Set();
    }
    // Always register page-1 items in seenIds — prevents cross-request
    // duplicates if score drift puts the same item on both page 1 and page 2.
    feedData.items.forEach((item) => {
      seenIdsRef.current.add(item.type === "ticket" ? item.ticket.id : item.chain.id);
    });
  }, [feedData]);

  const { hiddenIds, hideItem, hideChain, restoreItem } = useHiddenItems();

  // "Not interested" — soft-hide (stays in list) + persist to backend
  const handleNotInterested = useCallback((itemId: string, itemType: "ticket" | "chain") => {
    seenIdsRef.current.add(itemId);
    if (itemType === "ticket") hideItem(itemId);
    else hideChain(itemId);
  }, [hideItem, hideChain]);

  // Fetch next page. The server slices a fresh offset into a freshly re-ranked
  // pool on every request (not a cached snapshot), so minor score drift between
  // two requests can occasionally re-surface an item at a different offset —
  // filter against seenIdsRef before appending so it never renders twice
  // (same guard used by the Tickets/Chains discovery tabs).
  const fetchMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ mode: feedMode, limit: "20", cursor: nextCursor });
      const res = await fetch(`/api/feed?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const data: { items: FeedItem[]; hasMore: boolean; nextCursor: string | null; recycled?: boolean } = await res.json();
      if (data.recycled) {
        // Server has started re-serving the ranked list from the top (freshly
        // re-scored) — repeats are intentional from here on, so stop filtering
        // against seenIds (that would silently drop every item and look like
        // the feed froze).
        setExtraItems((prev) => {
          setRecycleStartIndex((current) => current ?? prev.length);
          return [...prev, ...data.items];
        });
      } else {
        const newItems = data.items.filter((item) => {
          const id = item.type === "ticket" ? item.ticket.id : item.chain.id;
          return !seenIdsRef.current.has(id);
        });
        newItems.forEach((item) => {
          seenIdsRef.current.add(item.type === "ticket" ? item.ticket.id : item.chain.id);
        });
        if (newItems.length > 0) setExtraItems((prev) => [...prev, ...newItems]);
      }
      setNextCursor(data.nextCursor ?? null);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, nextCursor, feedMode]);

  // Intersection observer — trigger fetchMore when sentinel nears viewport.
  // rootMargin: "400px" starts the next-page fetch 400px before the sentinel
  // is actually visible, giving the server response time to arrive before the
  // user reaches the bottom — same pattern as the Explore tabs in home.tsx
  // (which use 300px).  Without this, users who scroll quickly past the last
  // real card see a brief blank gap while the next page loads.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) fetchMore(); },
      { rootMargin: "400px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [fetchMore]);

  // ── Upcoming movies (injected every 6 posts) ─────────────────────────────────
  const { data: upcomingMovies } = useUpcomingMovies();
  const upcoming = upcomingMovies ?? [];

  // ── Chat unread count ─────────────────────────────────────────────────────────
  const { data: chatData } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/chat/unread-count", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 30000,
  });
  const chatUnread = chatData?.count ?? 0;

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const t = setTimeout(measure, 300);
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, []);

  // Reset scroll-tracking flag whenever the feed mode switches (login/logout),
  // so the Android Chrome PWA touch-scroll re-init fires for the new feed.
  useEffect(() => {
    firstLoadDone.current = false;
  }, [feedMode]);

  // After the feed data first appears (isLoading → false), force a no-op
  // scrollTop assignment so Android Chrome PWA re-initialises touch-scroll
  // tracking for this container. Without this the container appears frozen
  // right after the initial loading spinner disappears.  Also fires after
  // doRefresh() or a feedMode change because firstLoadDone is reset above.
  useEffect(() => {
    if (!isLoading && feedData && !firstLoadDone.current) {
      firstLoadDone.current = true;
      const el = scrollRef.current;
      if (!el) return;
      requestAnimationFrame(() => {
        if (el.isConnected) el.scrollTop = el.scrollTop;
      });
    }
  }, [isLoading, feedData]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = scrollStore.get("feed") ?? 0;
    let lastY = saved;
    if (saved > 0) requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = saved; });
    let scrollUpDelta = 0;
    const SHOW_THRESHOLD = 150;
    const onScroll = () => {
      const y = el.scrollTop;
      scrollStore.set("feed", y);
      if (y <= 0) {
        setHeaderHidden(false);
        scrollUpDelta = 0;
      } else if (y > lastY && y > headerH) {
        setHeaderHidden(true);
        scrollUpDelta = 0;
      } else if (y < lastY) {
        scrollUpDelta += lastY - y;
        if (scrollUpDelta >= SHOW_THRESHOLD) {
          setHeaderHidden(false);
          scrollUpDelta = 0;
        }
      } else {
        // y === lastY — no movement
      }
      lastY = y;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollStore.set("feed", el.scrollTop);
    };
  }, [headerH]);

  // PWA scroll-lock fix: clamp scrollTop when content height shrinks so
  // Android Chrome doesn't get stuck past the new maximum scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === 0 || el.scrollHeight === 0) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0 && el.scrollTop > maxScroll) el.scrollTop = maxScroll;
      // Re-initialise Android Chrome touch tracking after layout change
      // (no-op read+write that forces the browser to commit the scroll position)
      void el.scrollTop;
    });
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.href !== "/") return;
      doRefresh();
    };
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build display list: inject UpcomingCard every 6 items, plus a one-time
  // "caught up" divider right before recycled (repeat) content begins.
  const firstPageCount = feedData?.items.length ?? 0;
  type Injected =
    | { kind: "ticket"; ticket: any; key: string }
    | { kind: "chain"; chain: ChainItem; key: string }
    | { kind: "upcoming"; movie: UpcomingMovie; key: string }
    | { kind: "caught-up"; key: string };
  // useMemo — this rebuild used to run on every render (including scroll-driven
  // state changes like header-hide and pull-to-refresh), which meant every card
  // in the feed was reconstructed as a new object each tick, defeating
  // TicketCard/ChainCard's React.memo and re-rendering the whole visible list
  // on every scroll tick. Only rebuild when the underlying data actually changes.
  const displayItems: Injected[] = useMemo(() => {
    const items = [...(feedData?.items ?? []), ...extraItems];
    const list: Injected[] = [];
    let upcomingIdx = 0;
    items.forEach((item, i) => {
      if (recycleStartIndex !== null && i === firstPageCount + recycleStartIndex) {
        list.push({ kind: "caught-up", key: "caught-up" });
      }
      // Suffix keys with the index — recycled laps intentionally repeat the
      // same underlying ticket/chain id, so the id alone is not a unique key.
      if (item.type === "ticket") {
        list.push({ kind: "ticket", ticket: item.ticket, key: `t-${item.ticket.id}-${i}` });
      } else {
        list.push({ kind: "chain", chain: item.chain, key: `c-${item.chain.id}-${i}` });
      }
      if ((i + 1) % 6 === 0 && upcomingIdx < upcoming.length && feedMode !== "following") {
        list.push({ kind: "upcoming", movie: upcoming[upcomingIdx++], key: `up-${upcomingIdx}` });
      }
    });
    return list;
  }, [feedData?.items, extraItems, recycleStartIndex, firstPageCount, upcoming, feedMode]);
  const items = [...(feedData?.items ?? []), ...extraItems];

  const isEmpty = !isLoading && items.length === 0;

  return (
    <div className="relative h-full overflow-hidden">
      {/* ── Absolute header ── */}
      <div
        ref={headerRef}
        className={cn(
          "absolute top-0 left-0 right-0 z-30",
          "bg-background border-b border-border",
          "transition-transform duration-300 ease-in-out",
          headerHidden && "-translate-y-full"
        )}
        style={{ paddingTop: "max(16px, var(--sai-top))" }}
      >
        <div className="flex items-center px-4 pb-3">
          {user ? (
            <Link href="/chat">
              <button className="relative flex items-center justify-center w-9 h-9">
                <MessageCircle className="w-6 h-6 text-foreground" />
                {chatUnread > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-foreground rounded-full flex items-center justify-center px-1">
                    <span className="text-[9px] font-black text-background leading-none">{chatUnread > 99 ? "99+" : chatUnread}</span>
                  </span>
                )}
              </button>
            </Link>
          ) : <LangToggle />}
          <div className="flex-1 flex justify-center">
            {user ? (
              <button
                onClick={() => setShowFeedPanel(v => !v)}
                className="font-display font-bold text-xl tracking-tight text-foreground active:opacity-60 transition-opacity select-none"
              >
                Ticker
              </button>
            ) : (
              <h1 className="font-display font-bold text-xl tracking-tight text-foreground">Ticker</h1>
            )}
          </div>
          {user ? (
            <Link href="/notifications">
              <button className="relative flex items-center justify-center w-9 h-9">
                <Bell className="w-6 h-6 text-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-foreground rounded-full flex items-center justify-center px-1">
                    <span className="text-[9px] font-black text-background leading-none">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  </span>
                )}
              </button>
            </Link>
          ) : <div style={{ width: 64 }} />}
        </div>

        {/* Feed mode panel — slides out from under "Ticker" heading.
            Uses max-height instead of grid-template-rows for broad browser
            compat — grid-template-rows 0fr→1fr does not animate reliably on
            older Android WebView / Chrome < 107. max-height with overflow:hidden
            collapses the panel smoothly on all targets. */}
        {user && (
          <div
            style={{
              maxHeight: showFeedPanel ? "90px" : "0px",
              overflow: "hidden",
              transition: "max-height 320ms cubic-bezier(0.65, 0, 0.35, 1)",
            }}
          >
            <div
              className="h-[90px] w-full flex items-center justify-center overflow-hidden"
            >
              <div
                className="flex items-center gap-6"
                style={{
                  opacity: showFeedPanel ? 1 : 0,
                  transform: showFeedPanel ? "translateY(0)" : "translateY(-16px)",
                  transition: "opacity 260ms ease, transform 320ms cubic-bezier(0.65, 0, 0.35, 1)",
                }}
              >
                <button
                  onClick={() => selectSubMode("home")}
                  className="flex flex-col items-center gap-1 min-w-[64px]"
                >
                  <div className={cn(
                    "w-10 h-10 rounded-2xl border flex items-center justify-center transition-colors shadow-sm",
                    subMode === "home"
                      ? "bg-foreground border-foreground"
                      : "bg-secondary border-border",
                    feedPanelHighlight && feedPanelAnimDone && "animate-bounce"
                  )}>
                    <Sparkles className={cn("w-5 h-5", subMode === "home" ? "text-background" : "text-foreground")} />
                  </div>
                  <span className="text-[10px] font-semibold text-foreground leading-none text-center">{t.feedForYou}</span>
                </button>
                <button
                  onClick={() => selectSubMode("following")}
                  className="flex flex-col items-center gap-1 min-w-[64px]"
                >
                  <div className={cn(
                    "w-10 h-10 rounded-2xl border flex items-center justify-center transition-colors shadow-sm",
                    subMode === "following"
                      ? "bg-foreground border-foreground"
                      : "bg-secondary border-border",
                    feedPanelHighlight && feedPanelAnimDone && "animate-bounce"
                  )}>
                    <Users className={cn("w-5 h-5", subMode === "following" ? "text-background" : "text-foreground")} />
                  </div>
                  <span className="text-[10px] font-semibold text-foreground leading-none text-center">{t.feedFollowing}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Refresh spinner — shown during nav-tap refresh and pull-to-refresh.
          During an active drag (ptrIsPulling=true) height and opacity are
          driven by CSS custom properties (--ptr-y / --ptr-progress) that the
          hook writes directly to :root — no React re-render per touchmove
          pixel, so the drag is buttery-smooth at 60 fps on mid-range Android.
          After release those CSS vars reset to 0 and React state drives the
          settled height / opacity instead. */}
      {(isRefreshing || ptrIsPulling || ptrPullY > 0) && (
        <div
          className="absolute left-0 right-0 z-20 flex justify-center items-center pointer-events-none"
          style={{
            top: headerH,
            height: ptrIsPulling
              ? "var(--ptr-y, 0px)"
              : Math.max(ptrPullY, isRefreshing ? 44 : 0),
            transition: ptrIsPulling ? undefined : "height 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <Loader2
            className={cn("w-5 h-5 text-muted-foreground", isRefreshing && "animate-spin")}
            style={{
              opacity: isRefreshing ? 1 : (ptrIsPulling ? "var(--ptr-progress, 0)" as any : ptrProgress),
              transform: ptrIsPulling ? "rotate(calc(var(--ptr-progress, 0) * 270deg))" : undefined,
              transition: ptrIsPulling ? undefined : "opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </div>
      )}

      {/* ── Scroll container ── */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: ptrIsPulling
            ? `calc(${headerH}px + var(--ptr-y, 0px))`
            : headerH + Math.max(ptrPullY, isRefreshing ? 44 : 0),
          transition: ptrIsPulling ? undefined : "padding-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >

        {isLoading && (
          <div className="flex flex-col">
            {Array.from({ length: 4 }).map((_, i) => <FeedPostSkeleton key={i} />)}
          </div>
        )}

        {isEmpty && user && (
          <div className="px-4 py-16 text-center flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-foreground">{t.feedHomeEmptyTitle}</p>
            <p className="text-xs text-muted-foreground">{t.feedHomeEmptyDesc}</p>
            <Link href="/following?tab=users">
              <button className="mt-1 px-4 py-2 text-xs font-semibold rounded-full bg-foreground text-background">
                {t.feedHomeEmptyBtn}
              </button>
            </Link>
          </div>
        )}
        {isEmpty && !user && (
          <div className="px-4 py-16 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">{t.noPostsYet}</p>
            <p className="text-xs text-muted-foreground">{t.noPostsYetDesc}</p>
          </div>
        )}

        {!isEmpty && (
          <div className="flex flex-col">
            {displayItems.map((item) => {
              if (item.kind === "caught-up") {
                return (
                  <div key={item.key} className="flex items-center gap-3 px-4 py-4">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[11px] font-medium text-muted-foreground text-center shrink-0">
                      {t.feedCaughtUp}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                );
              }
              if (item.kind === "ticket") {
                const id = String(item.ticket.id);
                if (hiddenIds.has(id)) return (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <EyeOff className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">{t.notInterested}</span>
                    </div>
                    <button
                      onClick={() => restoreItem(id)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-foreground px-2.5 py-1 rounded-lg bg-secondary"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{t.notInterestedRestore}</span>
                    </button>
                  </div>
                );
                return (
                  <TicketCard
                    key={item.key}
                    ticket={item.ticket}
                    onNotInterested={user ? () => handleNotInterested(id, "ticket") : undefined}
                  />
                );
              }
              if (item.kind === "chain") {
                const id = item.chain.id;
                if (hiddenIds.has(id)) return (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <EyeOff className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">{t.notInterested}</span>
                    </div>
                    <button
                      onClick={() => restoreItem(id)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-foreground px-2.5 py-1 rounded-lg bg-secondary"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{t.notInterestedRestore}</span>
                    </button>
                  </div>
                );
                return (
                  <ChainCard
                    key={item.key}
                    chain={item.chain}
                    onNotInterested={user ? () => handleNotInterested(id, "chain") : undefined}
                  />
                );
              }
              return (
                // -mt-px + h-px bg-background strip hides the preceding card's
                // border-b, which would otherwise look like a top border here.
                <div key={item.key} className="relative">
                  <div className="absolute -top-px left-0 right-0 h-px bg-background z-10" />
                  <TabActiveCtx.Provider value={isActive}>
                    <FeedUpcomingCard movie={item.movie} />
                  </TabActiveCtx.Provider>
                </div>
              );
            })}
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-12 flex items-center justify-center">
              {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
