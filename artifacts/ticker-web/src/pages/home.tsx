import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useLang } from "@/lib/i18n";
import { useHorizWheel } from "@/hooks/use-horiz-wheel";
import { useListTickets, ListTicketsFeed, ListTicketsType } from "@workspace/api-client-react";
import { TicketCard, FeedPostSkeleton } from "@/components/TicketCard";
import { ChainsSection, ChainCard } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import { UpcomingCard, TabActiveCtx, type UpcomingMovie } from "@/components/UpcomingCard";
import {
  Loader2, Search as SearchIcon, User, Users, X as XIcon,
  Ticket, Link2, Newspaper, EyeOff, Eye, Clock,
} from "lucide-react";
import { useHiddenItems } from "@/hooks/use-hidden-items";
import { Link, useSearch } from "wouter";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { scrollStore } from "@/lib/scroll-store";
import { useSocketFeedUpdates } from "@/hooks/use-socket";
import { useAuth } from "@/hooks/use-auth";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";

function useUpcomingFeed() {
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

type ExploreTab = "tickets" | "chains" | "news" | "users";

// ── UserRow ──────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: any }) {
  return (
    <Link href={`/profile/${user.username}`}>
      <div className="flex items-center gap-3 bg-secondary rounded-2xl p-3 border border-border active:opacity-70 transition-opacity cursor-pointer">
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-border bg-background flex items-center justify-center">
          {user.avatarUrl
            ? <img src={user.avatarUrl} className="w-full h-full object-cover" alt="" />
            : <User className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <p className="font-bold text-sm text-foreground leading-tight truncate">
              {user.displayName ?? user.username}
            </p>
            {isVerified(user.username) && <VerifiedBadge className="w-3.5 h-3.5 flex-shrink-0" />}
            <BadgeIcon userId={user.id} />
          </div>
          <p className="text-xs text-muted-foreground">@{user.username}</p>
        </div>
      </div>
    </Link>
  );
}

// ── Search history helpers ─────────────────────────────────────────────────────
const SEARCH_HIST_KEY = "ticker_user_search_history";
function getSearchHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(SEARCH_HIST_KEY) ?? "[]"); } catch { return []; }
}
export function saveUserSearchHistory(q: string) {
  if (!q.trim()) return;
  try {
    const hist = getSearchHistory().filter(h => h !== q.trim());
    hist.unshift(q.trim());
    localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(hist.slice(0, 10)));
  } catch {}
}

// ── UsersFeed (recommended users, shown when no search query) ─────────────────

function UsersFeed() {
  const { lang } = useLang();
  const { data } = useQuery<{ users: any[] }>({
    queryKey: ["users-featured"],
    queryFn: () =>
      fetch("/api/users/featured", { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const [history, setHistory] = useState<string[]>(() => getSearchHistory());

  const removeHistory = (q: string) => {
    const updated = history.filter(h => h !== q);
    setHistory(updated);
    try { localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(updated)); } catch {}
  };

  // Only show tickerofficial from featured
  const officialUser = (data?.users ?? []).find((u: any) => u.username === "tickerofficial");
  const officialList = officialUser ? [officialUser] : [];

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-8">
      {history.length > 0 && (
        <div className="mb-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            {lang === "th" ? "ค้นหาล่าสุด" : "Recent searches"}
          </p>
          <div className="flex flex-col gap-1">
            {history.slice(0, 6).map(q => (
              <div key={q} className="flex items-center gap-2 py-1">
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm text-foreground">{q}</span>
                <button
                  onClick={() => removeHistory(q)}
                  className="p-1 text-muted-foreground active:opacity-60 transition-opacity"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {officialList.map((u: any) => <UserRow key={u.id} user={u} />)}
    </div>
  );
}

// ── RealTicketCard — fetches full real-time ticket data then renders TicketCard ─

function RealTicketCard({ ticketId }: { ticketId: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tickets", ticketId],
    queryFn: async () => {
      const r = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
  });
  if (isLoading) return (
    <div className="mx-auto my-2 animate-pulse" style={{ width: "min(calc(100vw - 2rem), 340px)" }}>
      <div className="w-full rounded-2xl bg-secondary/60" style={{ aspectRatio: "2/3" }} />
    </div>
  );
  if (!data) return null;
  return <TicketCard ticket={data} />;
}

// ── SearchTicketsFeed — search returns IDs; each result fetches full real data ─

function SearchTicketsFeed({ query }: { query: string }) {
  const { t } = useLang();
  const [debouncedQuery] = useDebounceValue(query, 400);
  const { data, isLoading } = useQuery<{ tickets: { id: string }[] }>({
    queryKey: ["/api/tickets/search-feed", debouncedQuery],
    queryFn: () =>
      debouncedQuery.trim().length < 1
        ? Promise.resolve({ tickets: [] })
        : fetch(`/api/tickets/search?q=${encodeURIComponent(debouncedQuery.trim())}&limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 10_000,
  });
  const tickets = data?.tickets ?? [];

  if (!debouncedQuery.trim()) return null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
          <Ticket className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-bold text-foreground text-sm">{t.noUserFound}</p>
        <p className="text-xs text-muted-foreground">{t.noUserFoundDesc}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {tickets.map((tk) => (
        <RealTicketCard key={tk.id} ticketId={tk.id} />
      ))}
    </div>
  );
}

// ── RealChainCard — fetches full real-time chain data then renders ChainCard ───

function RealChainCard({ chainId }: { chainId: string }) {
  const { data, isLoading } = useQuery<ChainItem>({
    queryKey: ["/api/chains", chainId],
    queryFn: async () => {
      const r = await fetch(`/api/chains/${encodeURIComponent(chainId)}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
  });
  if (isLoading) return (
    <div className="mx-auto my-2 animate-pulse" style={{ width: "min(calc(100vw - 2rem), 340px)" }}>
      <div className="w-full rounded-2xl bg-secondary/60" style={{ aspectRatio: "2/3" }} />
    </div>
  );
  if (!data) return null;
  return <ChainCard chain={data} />;
}

// ── SearchChainsFeed — search returns IDs; each result fetches full real data ──

function SearchChainsFeed({ query }: { query: string }) {
  const { t } = useLang();
  const [debouncedQuery] = useDebounceValue(query, 400);
  const { data, isLoading } = useQuery<{ chains: { id: string }[] }>({
    queryKey: ["/api/chains/search-feed", debouncedQuery],
    queryFn: () =>
      debouncedQuery.trim().length < 1
        ? Promise.resolve({ chains: [] })
        : fetch(`/api/chains/search?q=${encodeURIComponent(debouncedQuery.trim())}&limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 10_000,
  });
  const chains = data?.chains ?? [];

  if (!debouncedQuery.trim()) return null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chains.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
          <Link2 className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-bold text-foreground text-sm">{t.noUserFound}</p>
        <p className="text-xs text-muted-foreground">{t.noUserFoundDesc}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {chains.map((c) => (
        <RealChainCard key={c.id} chainId={c.id} />
      ))}
    </div>
  );
}

// ── SearchUsersFeed — user search results ────────────────────────────────────

function SearchUsersFeed({ query }: { query: string }) {
  const { t } = useLang();
  const [debouncedQuery] = useDebounceValue(query, 400);
  const { data, isLoading } = useQuery<{ users: any[] }>({
    queryKey: ["/api/users/search-feed", debouncedQuery],
    queryFn: () =>
      debouncedQuery.trim().length < 1
        ? Promise.resolve({ users: [] })
        : fetch(`/api/users/search?q=${encodeURIComponent(debouncedQuery.trim())}&limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 10_000,
  });
  const users = data?.users ?? [];

  // Save search history when a query is active and returns results
  useEffect(() => {
    if (debouncedQuery.trim() && (data?.users ?? []).length > 0) {
      saveUserSearchHistory(debouncedQuery.trim());
    }
  }, [debouncedQuery, data]);

  if (!debouncedQuery.trim()) return <UsersFeed />;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
          <Users className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-bold text-foreground text-sm">{t.noUserFound}</p>
        <p className="text-xs text-muted-foreground">{t.noUserFoundDesc}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-8">
      {users.map((u: any) => <UserRow key={u.id} user={u} />)}
    </div>
  );
}

// ── Seen-state helpers ───────────────────────────────────────────────────────
const SEEN_KEY = "feed_seen_ids";
function getSeenIds(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); }
}
function markSeen(ids: string[]) {
  try {
    const existing = getSeenIds();
    ids.forEach((id) => existing.add(id));
    const arr = [...existing].slice(-300);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {}
}

// ── Tickets tab — infinite scroll ─────────────────────────────────────────────
//
// Page 1 is fetched via useListTickets (keeps React Query cache key consistent
// so triggerRefresh cache invalidation continues to work).
// Extra pages are fetched manually with a cursor and appended to local state.
// IntersectionObserver fires loadMore when the sentinel enters the viewport.
function TicketsFeed() {
  const { t } = useLang();
  const { user } = useAuth();
  const { hiddenIds, hideItem, restoreItem } = useHiddenItems();
  // Explore/compass tab always shows discovery content from all users
  const feedMode = ListTicketsFeed.discovery;

  const { data, isLoading } = useListTickets(
    { feed: feedMode, type: ListTicketsType.ticket, limit: 20 },
    { query: { staleTime: 60_000, refetchInterval: 60_000, refetchOnWindowFocus: true } as any },
  );

  const [extraPages, setExtraPages] = useState<any[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Dedup guard: track all shown ticket IDs so page-boundary overlap never
  // produces duplicate cards (can happen if a new post shifts score ordering).
  const shownIdsRef = useRef<Set<string>>(new Set());
  // Once the server reports "recycled" (this all-users discovery feed ran out
  // of genuinely new content and started re-serving the ranked list from the
  // top, re-scored), repeats are intentional — show a one-time divider and
  // stop de-duping (that would silently drop every item and look frozen).
  const [recycleStartIndex, setRecycleStartIndex] = useState<number | null>(null);

  // When page-1 data arrives (or refreshes), reset extra pages and seen-id set
  useEffect(() => {
    if (data) {
      const page1: any[] = (data as any).tickets ?? [];
      shownIdsRef.current = new Set(page1.map((t: any) => String(t.id)));
      setExtraPages([]);
      setCursor((data as any).nextCursor ?? null);
      setHasMore((data as any).hasMore ?? false);
      setRecycleStartIndex(null);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (isFetchingMore || !hasMore || !cursor) return;
    setIsFetchingMore(true);
    try {
      const params = new URLSearchParams({
        feed: feedMode,
        type: ListTicketsType.ticket,
        limit: "20",
        cursor,
      });
      const res = await fetch(`/api/tickets?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.recycled) {
        setExtraPages(prev => {
          setRecycleStartIndex((current) => current ?? prev.flat().length);
          return [...prev, json.tickets ?? []];
        });
      } else {
        // Deduplicate — filter out tickets already shown on previous pages
        const newTickets: any[] = (json.tickets ?? []).filter(
          (t: any) => !shownIdsRef.current.has(String(t.id)),
        );
        newTickets.forEach((t: any) => shownIdsRef.current.add(String(t.id)));
        if (newTickets.length > 0) setExtraPages(prev => [...prev, newTickets]);
      }
      setCursor(json.nextCursor ?? null);
      setHasMore(json.hasMore ?? false);
    } catch {
      // network error — silently skip, sentinel will retry next time
    } finally {
      setIsFetchingMore(false);
    }
  }, [isFetchingMore, hasMore, cursor, feedMode]);

  // IntersectionObserver: trigger loadMore when sentinel nears viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const firstPage: any[] = (data as any)?.tickets ?? [];
  const allTickets = [firstPage, ...extraPages].flat();

  useEffect(() => {
    if (allTickets.length > 0) markSeen(allTickets.map((tk: any) => tk.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTickets.map((tk: any) => tk.id).join(",")]);

  if (isLoading) return (
    <div className="flex flex-col">
      {Array.from({ length: 4 }).map((_, i) => <FeedPostSkeleton key={i} />)}
    </div>
  );
  if (allTickets.length === 0) return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t.noTicketsFeed}</div>
  );

  return (
    <div className="flex flex-col">
      {allTickets.map((ticket: any, i: number) => {
        const id = String(ticket.id);
        // Recycled laps intentionally repeat the same underlying ticket id,
        // so the id alone is not a unique React key past that point.
        const key = `${id}-${i}`;
        const divider = recycleStartIndex !== null && i === recycleStartIndex ? (
          <div key="caught-up" className="flex items-center gap-3 px-4 py-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium text-muted-foreground text-center shrink-0">{t.feedCaughtUp}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        ) : null;
        if (hiddenIds.has(id)) {
          return (
            <Fragment key={key}>
              {divider}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
            </Fragment>
          );
        }
        return (
          <Fragment key={key}>
            {divider}
            <TicketCard
              ticket={ticket}
              onNotInterested={user ? () => hideItem(id) : undefined}
            />
          </Fragment>
        );
      })}
      {/* Infinite scroll sentinel — IntersectionObserver watches this element */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function NewsFeed() {
  const { data: upcomingMovies, isLoading } = useUpcomingFeed();
  const movies = upcomingMovies ?? [];
  if (isLoading) return null;
  return (
    <div className="flex flex-col pt-3 gap-3 pb-8">
      {movies.map((m, idx) => (
        <UpcomingCard key={`news-${idx}`} movie={m} mode="images-only" isFirst={idx === 0} />
      ))}
    </div>
  );
}

const TABS: { id: ExploreTab; label: string; icon: any }[] = [
  { id: "tickets", label: "Tickets",  icon: Ticket    },
  { id: "chains",  label: "Chains",   icon: Link2     },
  { id: "news",    label: "Upcoming", icon: Newspaper },
  { id: "users",   label: "Users",    icon: Users     },
];

export default function Home({ isActive = true }: { isActive?: boolean }) {
  useSocketFeedUpdates();
  const { t } = useLang();
  const search = useSearch();
  const VALID_TABS: ExploreTab[] = ["tickets", "chains", "news", "users"];
  const [tab, setTab] = useState<ExploreTab>(() => {
    const params = new URLSearchParams(search);
    const tabParam = params.get("tab") as ExploreTab;
    if (VALID_TABS.includes(tabParam)) return tabParam;
    const saved = sessionStorage.getItem("home_tab") as ExploreTab;
    return VALID_TABS.includes(saved) ? saved : "tickets";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [headerHidden, setHeaderHidden] = useState(false);

  // When navigated to with ?tab=X, switch to that tab and clean the URL
  useEffect(() => {
    const params = new URLSearchParams(search);
    const tabParam = params.get("tab") as ExploreTab;
    if (VALID_TABS.includes(tabParam)) {
      setHeaderHidden(false);
      setTab(tabParam);
      sessionStorage.setItem("home_tab", tabParam);
      window.history.replaceState(null, "", "/following");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(130);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const timeout = setTimeout(measure, 300);
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(timeout); };
  }, []);

  const ticketsRef = useRef<HTMLDivElement>(null);
  const chainsRef  = useRef<HTMLDivElement>(null);
  const newsRef    = useRef<HTMLDivElement>(null);
  const usersRef   = useRef<HTMLDivElement>(null);

  // Refs for tab pill scroll-to-center
  const tabPillContainerRef = useRef<HTMLDivElement>(null);
  const tabPillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useHorizWheel(tabPillContainerRef); // desktop mouse-wheel → horizontal scroll

  const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
    tickets: ticketsRef,
    chains:  chainsRef,
    news:    newsRef,
    users:   usersRef,
  };

  // Scroll active tab pill to center when tab changes
  useEffect(() => {
    const container = tabPillContainerRef.current;
    const btn = tabPillRefs.current[tab];
    if (!container || !btn) return;
    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerWidth = container.offsetWidth;
    const target = btnLeft - containerWidth / 2 + btnWidth / 2;
    container.scrollTo({ left: target, behavior: "smooth" });
  }, [tab]);

  // Scroll hide/show on active tab scroll — Instagram-style: require ~60px upward scroll to reveal
  useEffect(() => {
    const el = refMap[tab]?.current;
    if (!el) return;
    let lastY = scrollStore.get(`home-${tab}`) ?? el.scrollTop;
    let scrollUpDelta = 0;
    const SHOW_THRESHOLD = 150;
    const onScroll = () => {
      const y = el.scrollTop;
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
        // y === lastY (no movement) — do nothing, preserve delta
      }
      lastY = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, headerH]);

  // Save + restore scroll per tab
  useEffect(() => {
    const el = refMap[tab]?.current;
    if (!el) return;
    const saved = scrollStore.get(`home-${tab}`) ?? 0;
    if (saved > 0) requestAnimationFrame(() => requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = saved; }));
    const onScroll = () => scrollStore.set(`home-${tab}`, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollStore.set(`home-${tab}`, el.scrollTop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── PWA scroll-lock fix: clamp scrollTop when content height shrinks ──────────
  useEffect(() => {
    const refs = [ticketsRef, chainsRef, newsRef, usersRef];
    const observers: ResizeObserver[] = [];
    refs.forEach(ref => {
      const el = ref.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        if (el.clientHeight === 0 || el.scrollHeight === 0) return;
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll > 0 && el.scrollTop > maxScroll) {
          el.scrollTop = maxScroll;
        }
      });
      if (el.firstElementChild) ro.observe(el.firstElementChild);
      ro.observe(el);
      observers.push(ro);
    });
    return () => observers.forEach(ro => ro.disconnect());
  }, []);

  const handleTabChange = (newTab: ExploreTab) => {
    const curEl = refMap[tab]?.current;
    if (curEl) scrollStore.set(`home-${tab}`, curEl.scrollTop);

    setHeaderHidden(false);
    setTab(newTab);
    sessionStorage.setItem("home_tab", newTab);

    // Always reset to top when switching tabs — Instagram behaviour.
    // Preserving the previous scroll position confuses users who expect
    // a fresh view when tapping a different category.
    const newEl = refMap[newTab]?.current;
    if (newEl) {
      scrollStore.set(`home-${newTab}`, 0);
      requestAnimationFrame(() => { if (newEl.isConnected) newEl.scrollTop = 0; });
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);
  const qc = useQueryClient();
  const { user } = useAuth();

  // ── Reset scroll + invalidate feed when auth state changes ─────────────────
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prevId = prevUserIdRef.current;
    const nextId = user?.id ?? null;
    if (prevId === undefined) { prevUserIdRef.current = nextId; return; }
    if (prevId === nextId) return;
    prevUserIdRef.current = nextId;
    [ticketsRef, chainsRef, newsRef, usersRef].forEach(r => {
      if (r.current) r.current.scrollTop = 0;
    });
    scrollStore.set("home-tickets", 0);
    scrollStore.set("home-chains", 0);
    scrollStore.set("home-news", 0);
    scrollStore.set("home-users", 0);
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["/api/tickets"] });
    qc.invalidateQueries({ queryKey: ["chains-feed"] });
    qc.invalidateQueries({ queryKey: ["mixed-feed"] });
    qc.invalidateQueries({ queryKey: ["users-featured"] });
  }, [user?.id, qc]);

  const triggerRefresh = useCallback(async () => {
    const el = refMap[tab]?.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: "instant" });
      scrollStore.set(`home-${tab}`, 0);
    }
    setHeaderHidden(false);
    setIsRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["feed"] }),
      qc.invalidateQueries({ queryKey: ["/api/tickets"] }),
      qc.invalidateQueries({ queryKey: ["chains-feed"] }),
      qc.invalidateQueries({ queryKey: ["mixed-feed"] }),
      qc.invalidateQueries({ queryKey: ["users-featured"] }),
    ]);
    await new Promise<void>(r => setTimeout(r, 400));
    setIsRefreshing(false);
    // If the user scrolled down during the refresh spin, bring them back to top.
    const elAfter = refMap[tab]?.current;
    if (elAfter && elAfter.scrollTop > 0) elAfter.scrollTo({ top: 0, behavior: "smooth" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qc]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Accept both "/" (post-create nav) and "/following" (bottom-nav tap).
      // Previously only "/following" was accepted which caused the refresh
      // never to fire after posting (create-ticket dispatches href="/").
      if (detail?.href !== "/" && detail?.href !== "/following") return;
      if (searchQuery) return;
      triggerRefresh();
    };
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, searchQuery]);

  // Pull-to-refresh — switches to the active tab's scroll container whenever tab changes.
  const { pullY: ptrPullY, progress: ptrProgress, isPulling: ptrIsPulling } = usePullToRefresh(
    refMap[tab],
    triggerRefresh,
  );

  // Left/right swipe to switch tab pills.
  // A non-passive touchmove listener (via useEffect) is required so we can
  // call preventDefault() and block browser swipe-to-go-back/forward while
  // still allowing vertical scrolls inside the tab panels.
  const exploreContainerRef = useRef<HTMLDivElement>(null);
  const tabSwipeRef = useRef<{ x: number; y: number } | null>(null);
  // Always-current refs so the event listener never captures stale closures.
  const tabRef = useRef<ExploreTab>(tab);
  const handleTabChangeRef = useRef(handleTabChange);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { handleTabChangeRef.current = handleTabChange; });

  useEffect(() => {
    const el = exploreContainerRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      const target = e.target as Element;
      if (target.closest("input, textarea, [contenteditable]")) return;
      tabSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onMove = (e: TouchEvent) => {
      if (!tabSwipeRef.current) return;
      const dx = e.touches[0].clientX - tabSwipeRef.current.x;
      const dy = Math.abs(e.touches[0].clientY - tabSwipeRef.current.y);
      // Cancel if vertical movement clearly wins — let the scroll container handle it
      if (dy > 12 && dy > Math.abs(dx) * 1.2) { tabSwipeRef.current = null; return; }
      // Prevent browser swipe-to-navigate as soon as we have any horizontal intent
      // (low threshold ensures iOS back/forward swipe gesture is blocked)
      if (Math.abs(dx) > 6) e.preventDefault();
    };

    const onEnd = (e: TouchEvent) => {
      if (!tabSwipeRef.current) return;
      const dx = e.changedTouches[0].clientX - tabSwipeRef.current.x;
      const dy = Math.abs(e.changedTouches[0].clientY - tabSwipeRef.current.y);
      tabSwipeRef.current = null;
      // Require clearly horizontal gesture (dx dominates dy, and meets minimum)
      if (Math.abs(dx) < 45 || dy > Math.abs(dx) * 0.7) return;
      const tabIds = TABS.map((tb) => tb.id);
      const ti = tabIds.indexOf(tabRef.current);
      if (dx < 0 && ti < tabIds.length - 1) handleTabChangeRef.current(tabIds[ti + 1]);
      else if (dx > 0 && ti > 0) handleTabChangeRef.current(tabIds[ti - 1]);
      // At edge tabs: do nothing — browser navigation blocked by preventDefault in onMove
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: false });
    el.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []); // empty deps — uses refs for latest values

  return (
    <div
      ref={exploreContainerRef}
      className="relative h-full overflow-hidden"
    >
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
        {/* Title row */}
        <div className="flex items-center px-4 pb-3">
          <div className="w-9 h-9" />
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center">Ticker</h1>
          <div className="w-9 h-9" />
        </div>
        {/* Search bar */}
        <div className="px-4 pb-3">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <input
              type="text"
              placeholder={t.searchHomePlaceholder ?? "Search Users, Tickets, Chains..."}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setHeaderHidden(false); }}
              className="search-bar w-full"
              style={{ paddingLeft: "2.75rem", paddingRight: searchQuery ? "2.75rem" : undefined }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10"
              >
                <XIcon className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        {/* Tab pills — always shown */}
        <div
          ref={tabPillContainerRef}
          className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide"
        >
          {TABS.map(tabItem => (
            <button
              key={tabItem.id}
              ref={el => { tabPillRefs.current[tabItem.id] = el; }}
              onClick={() => handleTabChange(tabItem.id)}
              className={cn("filter-pill flex items-center gap-1 flex-shrink-0", tab === tabItem.id ? "active" : "")}
            >
              <tabItem.icon className="w-3.5 h-3.5" />
              {tabItem.label}
            </button>
          ))}
        </div>
      </div>

      {/* Refresh spinner — CSS-var-driven during active drag (no React re-renders
          on touchmove), React-state-driven for settled states. */}
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

      {/* ── Tickets tab ── */}
      <div
        ref={ticketsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: ptrIsPulling
            ? `calc(${headerH}px + var(--ptr-y, 0px))`
            : headerH + Math.max(ptrPullY, isRefreshing ? 44 : 0),
          display: tab === "tickets" ? "block" : "none",
          transition: ptrIsPulling ? undefined : "padding-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {searchQuery ? <SearchTicketsFeed query={searchQuery} /> : <TicketsFeed />}
      </div>

      {/* ── Chains tab ── */}
      <div
        ref={chainsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: ptrIsPulling
            ? `calc(${headerH}px + var(--ptr-y, 0px))`
            : headerH + Math.max(ptrPullY, isRefreshing ? 44 : 0),
          display: tab === "chains" ? "block" : "none",
          transition: ptrIsPulling ? undefined : "padding-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {searchQuery ? <SearchChainsFeed query={searchQuery} /> : <ChainsSection />}
      </div>

      {/* ── Upcoming tab ── */}
      <div
        ref={newsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: ptrIsPulling
            ? `calc(${headerH}px + var(--ptr-y, 0px))`
            : headerH + Math.max(ptrPullY, isRefreshing ? 44 : 0),
          display: tab === "news" ? "block" : "none",
          transition: ptrIsPulling ? undefined : "padding-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <TabActiveCtx.Provider value={isActive}>
          <NewsFeed />
        </TabActiveCtx.Provider>
      </div>

      {/* ── Users tab ── */}
      <div
        ref={usersRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: ptrIsPulling
            ? `calc(${headerH}px + var(--ptr-y, 0px))`
            : headerH + Math.max(ptrPullY, isRefreshing ? 44 : 0),
          display: tab === "users" ? "block" : "none",
          transition: ptrIsPulling ? undefined : "padding-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {searchQuery ? <SearchUsersFeed query={searchQuery} /> : <UsersFeed />}
      </div>


    </div>
  );
}
