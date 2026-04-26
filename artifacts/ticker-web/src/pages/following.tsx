import { useState, useRef, useEffect } from "react";
import { TicketCard } from "@/components/TicketCard";
import { Loader2, MessageCircle, Bell } from "lucide-react";
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

export default function Following() {
  const { t } = useLang();
  const scrollRef   = useRef<HTMLDivElement>(null);
  const headerRef   = useRef<HTMLDivElement>(null);
  const firstLoadDone = useRef(false);
  const [headerH, setHeaderH]           = useState(64);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const qc = useQueryClient();

  const doRefresh = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    setHeaderHidden(false);
    setIsRefreshing(true);
    qc.invalidateQueries({ queryKey: ["home-mixed-feed"] }).then(() => {
      setTimeout(() => setIsRefreshing(false), 400);
    });
  };

  const { user } = useAuth();
  useSocketFeedUpdates();
  const unreadCount = useNotificationCount();

  // ── Unified mixed feed ────────────────────────────────────────────────────────
  // Authenticated: mode=home (affinity boost for followed users)
  // Guest: mode=discover (public, no auth required)
  const feedMode = user ? "home" : "discover";
  const { data: feedData, isLoading } = useQuery<{ items: FeedItem[]; hasMore: boolean }>({
    queryKey: ["home-mixed-feed", feedMode],
    queryFn: async () => {
      const res = await fetch(`/api/feed?mode=${feedMode}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

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

  // After the feed data first appears (isLoading → false), force a no-op
  // scrollTop assignment so Android Chrome PWA re-initialises touch-scroll
  // tracking for this container. Without this the container appears frozen
  // right after the initial loading spinner disappears.
  useEffect(() => {
    if (!isLoading && feedData && !firstLoadDone.current) {
      firstLoadDone.current = true;
      const el = scrollRef.current;
      if (!el) return;
      // Tiny forced assignment wakes up Android PWA scroll tracking
      requestAnimationFrame(() => {
        if (el.isConnected) el.scrollTop = el.scrollTop;
      });
    }
  }, [isLoading, feedData]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = scrollStore.get("following") ?? 0;
    let lastY = saved;
    if (saved > 0) requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = saved; });
    const onScroll = () => {
      const y = el.scrollTop;
      scrollStore.set("following", y);
      if (y <= 0) {
        setHeaderHidden(false);
      } else if (y > lastY && y > headerH) {
        setHeaderHidden(true);
      } else if (y < lastY) {
        setHeaderHidden(false);
      }
      lastY = y;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollStore.set("following", el.scrollTop);
    };
  }, [headerH]);

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
  const items = feedData?.items ?? [];
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
          </div>
        )}
      </div>
    </div>
  );
}
