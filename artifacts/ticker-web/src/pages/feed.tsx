import { useState, useRef, useEffect, useCallback } from "react";
import { TicketCard } from "@/components/TicketCard";
import { Loader2, MessageCircle, Bell, TrendingUp, TrendingDown } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { scrollStore } from "@/lib/scroll-store";
import { useNotificationCount } from "@/hooks/use-notification-count";
import { useSocketFeedUpdates } from "@/hooks/use-socket";
import { cn } from "@/lib/utils";
import { ChainCard } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import { UpcomingCard, type UpcomingMovie } from "@/components/UpcomingCard";
import { useLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";

// ── TickerExtremes — highest and lowest Ticker-rated movies ──────────────────

type CommunityMovie = { imdbId: string; title: string; posterUrl: string | null; avgRating: number; ticketCount: number };

function TickerExtremes() {
  const { lang } = useLang();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const tid = setTimeout(() => setRevealed(true), 120);
    return () => clearTimeout(tid);
  }, []);
  const { data, isLoading } = useQuery<{ top: CommunityMovie[]; bottom: CommunityMovie[] }>({
    queryKey: ["ticker-community-ratings"],
    queryFn: async () => {
      const r = await fetch("/api/movies/ticker-community", { credentials: "include" });
      if (!r.ok) return { top: [], bottom: [] };
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const highest = data?.top?.[0] ?? null;
  const lowest = data?.bottom?.[0] ?? null;
  if (isLoading || (!highest && !lowest)) return null;
  const MovieMini = ({ movie, trend }: { movie: CommunityMovie; trend: "up" | "down" }) => (
    <Link href={`/movie/${encodeURIComponent(movie.imdbId)}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0 active:opacity-70">
        <div className="w-9 h-[50px] rounded-xl overflow-hidden bg-secondary flex-shrink-0 border border-border">
          {movie.posterUrl
            ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full bg-secondary" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-foreground truncate leading-tight">{movie.title}</p>
          <div className={cn("flex items-center gap-0.5 mt-0.5", trend === "up" ? "text-emerald-500" : "text-red-400")}>
            {trend === "up"
              ? <TrendingUp className="w-3 h-3 flex-shrink-0" />
              : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
            <span className="text-[11px] font-black">{movie.avgRating.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
  return (
    <div
      style={{
        opacity: revealed ? 1 : 0,
        transform: revealed ? "translateY(0)" : "translateY(-8px)",
        transition: "opacity 0.35s ease, transform 0.35s ease",
      }}
    >
      <div className="mx-4 mt-2 mb-3 rounded-2xl border border-border bg-secondary/40 px-3 py-2.5 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
            {lang === "th" ? "คะแนนสูงสุด" : "Highest"}
          </p>
          {highest && <MovieMini movie={highest} trend="up" />}
        </div>
        <div className="w-px h-10 bg-border flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
            {lang === "th" ? "คะแนนต่ำสุด" : "Lowest"}
          </p>
          {lowest && <MovieMini movie={lowest} trend="down" />}
        </div>
      </div>
    </div>
  );
}

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

export default function Feed() {
  const { t } = useLang();
  const scrollRef   = useRef<HTMLDivElement>(null);
  const headerRef   = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const firstLoadDone = useRef(false);
  const [headerH, setHeaderH]           = useState(64);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const qc = useQueryClient();

  // Pagination state for "load more"
  const [extraItems, setExtraItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { user } = useAuth();
  useSocketFeedUpdates();
  const unreadCount = useNotificationCount();

  // Logged-in users get mode=home so followed-user affinity (2×) applies.
  // Guests get mode=discover (public hotScore ranking, no personalisation).
  const feedMode = user ? "home" : "discover";

  const doRefresh = () => {
    // Allow the scroll-tracking reset (below) to fire again after this refresh.
    firstLoadDone.current = false;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    setHeaderHidden(false);
    setIsRefreshing(true);
    setExtraItems([]);
    setNextCursor(null);
    setHasMore(false);
    qc.invalidateQueries({ queryKey: ["mixed-feed", feedMode] }).then(() => {
      setTimeout(() => setIsRefreshing(false), 400);
    });
  };
  // ── Unified mixed feed (personalised or discover depending on auth) ──────────
  const { data: feedData, isLoading } = useQuery<{ items: FeedItem[]; hasMore: boolean; nextCursor: string | null }>({
    queryKey: ["mixed-feed", feedMode],
    queryFn: async () => {
      const res = await fetch(`/api/feed?mode=${feedMode}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  // Sync pagination state from first-page feed data
  useEffect(() => {
    if (feedData) {
      setNextCursor(feedData.nextCursor ?? null);
      setHasMore(feedData.hasMore);
      // Reset extra items whenever the base feed refreshes
      setExtraItems([]);
    }
  }, [feedData]);

  // Fetch next page (same mode as first page)
  const fetchMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/feed?mode=${feedMode}&limit=20&before=${encodeURIComponent(nextCursor)}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data: { items: FeedItem[]; hasMore: boolean; nextCursor: string | null } = await res.json();
      setExtraItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, nextCursor, feedMode]);

  // Intersection observer — trigger fetchMore when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) fetchMore(); },
      { threshold: 0.1 },
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

  // Build display list: inject UpcomingCard every 6 items
  const items = [...(feedData?.items ?? []), ...extraItems];
  type Injected =
    | { kind: "ticket"; ticket: any; key: string }
    | { kind: "chain"; chain: ChainItem; key: string }
    | { kind: "upcoming"; movie: UpcomingMovie; key: string };

  const displayItems: Injected[] = [];
  let upcomingIdx = 0;
  items.forEach((item, i) => {
    if (item.type === "ticket") {
      displayItems.push({ kind: "ticket", ticket: item.ticket, key: item.ticket.id });
    } else {
      displayItems.push({ kind: "chain", chain: item.chain, key: `chain-${item.chain.id}` });
    }
    if ((i + 1) % 6 === 0 && upcomingIdx < upcoming.length) {
      displayItems.push({ kind: "upcoming", movie: upcoming[upcomingIdx++], key: `up-${upcomingIdx}` });
    }
  });

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
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center px-4 pt-4 pb-3">
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
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center">Ticker</h1>
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
          ) : <div className="w-9 h-9" />}
        </div>
      </div>

      {/* Refresh spinner — shown while refreshing via icon tap */}
      {isRefreshing && (
        <div
          className="absolute left-0 right-0 z-20 flex justify-center items-center pointer-events-none"
          style={{ top: headerH, height: 44 }}
        >
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Scroll container ── */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0) }}
      >
        {/* Ticker extremes — highest & lowest community-rated movies */}
        <TickerExtremes />

        {isEmpty && (
          <div className="px-4 py-16 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">{t.noPostsYet}</p>
            <p className="text-xs text-muted-foreground">{t.noPostsYetDesc}</p>
          </div>
        )}

        {!isEmpty && (
          <div className="flex flex-col">
            {displayItems.map((item) => {
              if (item.kind === "ticket") return <TicketCard key={item.key} ticket={item.ticket} />;
              if (item.kind === "chain") return <ChainCard key={item.key} chain={item.chain} />;
              return <UpcomingCard key={item.key} movie={item.movie} />;
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
