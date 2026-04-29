import { useState, useEffect, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { flushSync } from "react-dom";
import { useListTickets, ListTicketsFeed, ListTicketsType } from "@workspace/api-client-react";
import { TicketCard } from "@/components/TicketCard";
import { ChainsSection } from "@/components/ChainsSection";
import { UpcomingCard, type UpcomingMovie } from "@/components/UpcomingCard";
import {
  Loader2, Search as SearchIcon, User, X as XIcon,
  Ticket, Link2, Newspaper,
} from "lucide-react";
import { Link, useSearch } from "wouter";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { scrollStore } from "@/lib/scroll-store";
import { useSocketFeedUpdates } from "@/hooks/use-socket";
import { useAuth } from "@/hooks/use-auth";

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

type ExploreTab = "tickets" | "chains" | "news";

function UserSearchResults({ query }: { query: string }) {
  const { t } = useLang();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}&limit=15`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: any) => { setResults(d.users ?? []); setLoading(false); })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, [query]);
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      {results.map(user => (
        <Link key={user.id} href={`/profile/${user.username}`}>
          <div className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border active:bg-secondary transition-colors">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-border bg-secondary flex items-center justify-center">
              {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-0.5">
                <p className="font-bold text-sm text-foreground leading-tight truncate">{user.displayName ?? user.username}</p>
                {isVerified(user.username) && <VerifiedBadge className="w-3.5 h-3.5 flex-shrink-0" />}
                <BadgeIcon userId={user.id} />
              </div>
              <p className="text-xs text-muted-foreground">@{user.username}</p>
            </div>
          </div>
        </Link>
      ))}
      {results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <User className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">{t.noUserFound}</p>
            <p className="text-sm text-muted-foreground">{t.noUserFoundDesc}</p>
          </div>
        </div>
      )}
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

// ── Tickets tab ───────────────────────────────────────────────────────────────
function TicketsFeed() {
  const { t } = useLang();
  const { data, isLoading } = useListTickets(
    { feed: ListTicketsFeed.discovery, type: ListTicketsType.ticket, limit: 20 },
    { query: { staleTime: 60_000, refetchInterval: 60_000, refetchOnWindowFocus: true } as any },
  );
  const { data: upcomingMovies } = useUpcomingFeed();

  const allTickets = data?.tickets ?? [];

  useEffect(() => {
    if (allTickets.length > 0) markSeen(allTickets.map((t) => t.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTickets.map((t) => t.id).join(",")]);

  if (isLoading) return null;
  if (allTickets.length === 0) return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t.noTicketsFeed}</div>;

  const upcoming = upcomingMovies ?? [];
  type FeedItem =
    | { kind: "ticket"; ticket: typeof allTickets[0]; key: string }
    | { kind: "upcoming"; movie: UpcomingMovie; key: string };

  const feedItems: FeedItem[] = [];
  let upcomingIdx = 0;

  allTickets.forEach((ticket, i) => {
    feedItems.push({ kind: "ticket", ticket, key: ticket.id });
    if ((i + 1) % 5 === 0 && upcomingIdx < upcoming.length) {
      feedItems.push({ kind: "upcoming", movie: upcoming[upcomingIdx++], key: `upcoming-inj-${upcomingIdx}` });
    }
  });

  return (
    <div className="flex flex-col">
      {feedItems.map((item) =>
        item.kind === "ticket"
          ? <TicketCard key={item.key} ticket={item.ticket} />
          : <UpcomingCard key={item.key} movie={item.movie} />
      )}
    </div>
  );
}

function NewsFeed() {
  const { data: upcomingMovies, isLoading } = useUpcomingFeed();
  const movies = upcomingMovies ?? [];
  if (isLoading) return null;
  return (
    <div className="flex flex-col">
      {movies.map((m, idx) => <UpcomingCard key={`news-${idx}`} movie={m} />)}
    </div>
  );
}

const TABS: { id: ExploreTab; label: string; icon: any }[] = [
  { id: "tickets", label: "Tickets",  icon: Ticket    },
  { id: "chains",  label: "Chains",   icon: Link2     },
  { id: "news",    label: "Upcoming", icon: Newspaper },
];

export default function Home() {
  useSocketFeedUpdates();
  const { t } = useLang();
  const search = useSearch();
  const [tab, setTab] = useState<ExploreTab>(() => {
    const params = new URLSearchParams(search);
    const tabParam = params.get("tab") as ExploreTab;
    if (tabParam === "tickets" || tabParam === "chains" || tabParam === "news") return tabParam;
    const saved = sessionStorage.getItem("home_tab") as ExploreTab;
    return (saved === "tickets" || saved === "chains" || saved === "news") ? saved : "tickets";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [headerHidden, setHeaderHidden] = useState(false);

  // When navigated to with ?tab=X, switch to that tab and clean the URL
  useEffect(() => {
    const params = new URLSearchParams(search);
    const tabParam = params.get("tab") as ExploreTab;
    if (tabParam === "tickets" || tabParam === "chains" || tabParam === "news") {
      flushSync(() => {
        setHeaderHidden(false);
        setTab(tabParam);
      });
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
    // Re-measure after env(safe-area-inset-top) settles on first PWA launch
    const t = setTimeout(measure, 300);
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, []);

  const ticketsRef = useRef<HTMLDivElement>(null);
  const chainsRef  = useRef<HTMLDivElement>(null);
  const newsRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLDivElement>(null);

  const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
    tickets: ticketsRef,
    chains:  chainsRef,
    news:    newsRef,
    search:  searchRef,
  };

  const activeKey = searchQuery ? "search" : tab;
  useEffect(() => {
    const el = refMap[activeKey]?.current;
    if (!el) return;
    let lastY = scrollStore.get(`home-${activeKey}`) ?? el.scrollTop;
    const onScroll = () => {
      const y = el.scrollTop;
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
    return () => el.removeEventListener("scroll", onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, headerH]);

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
  // Guard: only clamp when the container is actually visible (clientHeight > 0)
  // to avoid resetting scroll to 0 when tabs are hidden via display:none
  useEffect(() => {
    const refs = [ticketsRef, chainsRef, newsRef, searchRef];
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
    // Save current scroll before React re-renders and display toggles
    const curEl = refMap[activeKey]?.current;
    if (curEl) scrollStore.set(`home-${activeKey}`, curEl.scrollTop);

    // flushSync forces synchronous render so DOM is updated before browser paints —
    // this prevents the one-frame flash at scrollTop=0 that display:none can cause on mobile
    flushSync(() => {
      setHeaderHidden(false);
      setTab(newTab);
    });
    sessionStorage.setItem("home_tab", newTab);

    // Restore new tab's scroll immediately after DOM update, before next paint
    const newEl = refMap[newTab]?.current;
    if (newEl) {
      const saved = scrollStore.get(`home-${newTab}`) ?? 0;
      if (saved > 0) newEl.scrollTop = saved;
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
    // scroll all tabs to top and invalidate feed queries
    [ticketsRef, chainsRef, newsRef, searchRef].forEach(r => {
      if (r.current) r.current.scrollTop = 0;
    });
    scrollStore.set("tickets", 0);
    scrollStore.set("chains", 0);
    scrollStore.set("news", 0);
    scrollStore.set("search", 0);
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["chains-recent"] });
    qc.invalidateQueries({ queryKey: ["chains-hot"] });
  }, [user?.id, qc]);

  const triggerRefresh = () => {
    const el = refMap[activeKey]?.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    setHeaderHidden(false);
    setIsRefreshing(true);
    Promise.all([
      qc.invalidateQueries({ queryKey: ["feed"] }),
      qc.invalidateQueries({ queryKey: ["chains-recent"] }),
      qc.invalidateQueries({ queryKey: ["chains-hot"] }),
    ]).then(() => setTimeout(() => setIsRefreshing(false), 400));
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.href !== "/following") return;
      if (activeKey === "search") return;
      triggerRefresh();
    };
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <div className="relative h-full overflow-hidden">
      {/* ── Absolute header ── */}
      <div
        ref={headerRef}
        className={cn(
          "absolute top-0 left-0 right-0 z-30",
          "bg-background",
          !searchQuery && "border-b border-border",
          "transition-transform duration-300 ease-in-out",
          headerHidden && "-translate-y-full"
        )}
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)" }}
      >
        {/* Title row */}
        <div className="flex items-center px-4 pb-3">
          <div className="w-16 h-9" />
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center">Ticker</h1>
          <div className="w-16 h-9" />
        </div>
        {/* Search bar */}
        <div className={`px-4 ${searchQuery ? "pb-2" : "pb-3"}`}>
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <input
              type="text"
              placeholder={t.searchUsersPlaceholder}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setHeaderHidden(false); }}
              className="search-bar w-full"
              style={{ paddingLeft: "2.75rem", paddingRight: searchQuery ? "2.75rem" : undefined }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10">
                <XIcon className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        {/* Tab pills — hidden while searching, shown otherwise */}
        {!searchQuery && (
          <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {TABS.map(t => (
              <button key={t.id} onClick={() => handleTabChange(t.id)} className={cn("filter-pill flex items-center gap-1", tab === t.id ? "active" : "")}>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        )}

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

      {/* User search results */}
      <div
        ref={searchRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH, display: searchQuery ? "block" : "none" }}
      >
        <UserSearchResults query={searchQuery} />
      </div>

      {/* Tickets tab */}
      <div
        ref={ticketsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: !searchQuery && tab === "tickets" ? "block" : "none" }}
      >
        <TicketsFeed />
      </div>

      {/* Chains tab */}
      <div
        ref={chainsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: !searchQuery && tab === "chains" ? "block" : "none" }}
      >
        <ChainsSection />
      </div>

      {/* Upcoming tab */}
      <div
        ref={newsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: !searchQuery && tab === "news" ? "block" : "none" }}
      >
        <NewsFeed />
      </div>
    </div>
  );
}
