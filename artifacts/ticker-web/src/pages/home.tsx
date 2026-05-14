import { useState, useEffect, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { flushSync } from "react-dom";
import { useListTickets, ListTicketsFeed, ListTicketsType } from "@workspace/api-client-react";
import { TicketCard } from "@/components/TicketCard";
import { ChainsSection, ChainCard } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import { UpcomingCard, type UpcomingMovie } from "@/components/UpcomingCard";
import {
  Loader2, Search as SearchIcon, User, Users, X as XIcon,
  Ticket, Link2, Newspaper,
} from "lucide-react";
import { Link, useSearch } from "wouter";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
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

// ── UsersFeed (recommended users, shown when no search query) ─────────────────

function UsersFeed() {
  const { lang } = useLang();
  const { data, isLoading } = useQuery<{ users: any[] }>({
    queryKey: ["users-featured"],
    queryFn: () =>
      fetch("/api/users/featured", { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const users = data?.users ?? [];

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
        <p className="text-sm text-muted-foreground">{lang === "th" ? "ยังไม่มีผู้ใช้ที่แนะนำ" : "No suggested users yet"}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-4 pt-4 pb-8">
      {users.map((u: any) => <UserRow key={u.id} user={u} />)}
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
    <div className="mx-4 my-1 h-28 rounded-2xl bg-secondary/40 animate-pulse" />
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
    <div className="mx-4 my-1 h-28 rounded-2xl bg-secondary/40 animate-pulse" />
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
    <div className="flex flex-col gap-2 px-4 pt-4 pb-8">
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

// ── Tickets tab ───────────────────────────────────────────────────────────────
function TicketsFeed() {
  const { t } = useLang();
  const { user } = useAuth();
  // Use home mode for logged-in users so followed private-account users' content appears
  const feedMode = user ? ListTicketsFeed.home : ListTicketsFeed.discovery;
  const { data, isLoading } = useListTickets(
    { feed: feedMode, type: ListTicketsType.ticket, limit: 20 },
    { query: { staleTime: 60_000, refetchInterval: 60_000, refetchOnWindowFocus: true } as any },
  );

  const allTickets = data?.tickets ?? [];

  useEffect(() => {
    if (allTickets.length > 0) markSeen(allTickets.map((tk: any) => tk.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTickets.map((tk: any) => tk.id).join(",")]);

  if (isLoading) return null;
  if (allTickets.length === 0) return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t.noTicketsFeed}</div>;

  return (
    <div className="flex flex-col">
      {allTickets.map((ticket: any) => <TicketCard key={ticket.id} ticket={ticket} />)}
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
  { id: "users",   label: "Users",    icon: Users     },
];

export default function Home() {
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

  // Scroll hide/show on active tab scroll
  useEffect(() => {
    const el = refMap[tab]?.current;
    if (!el) return;
    let lastY = scrollStore.get(`home-${tab}`) ?? el.scrollTop;
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

    flushSync(() => {
      setHeaderHidden(false);
      setTab(newTab);
    });
    sessionStorage.setItem("home_tab", newTab);

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

  const triggerRefresh = () => {
    const el = refMap[tab]?.current;
    if (el) {
      el.scrollTop = 0;
      scrollStore.set(`home-${tab}`, 0);
    }
    setHeaderHidden(false);
    setIsRefreshing(true);
    Promise.all([
      qc.invalidateQueries({ queryKey: ["feed"] }),
      qc.invalidateQueries({ queryKey: ["/api/tickets"] }),
      qc.invalidateQueries({ queryKey: ["chains-feed"] }),
      qc.invalidateQueries({ queryKey: ["mixed-feed"] }),
      qc.invalidateQueries({ queryKey: ["users-featured"] }),
    ]).then(() => setTimeout(() => setIsRefreshing(false), 400));
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.href !== "/following") return;
      if (searchQuery) return;
      triggerRefresh();
    };
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, searchQuery]);

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
        {/* Title row */}
        <div className="flex items-center px-4 pt-4 pb-3">
          <div className="w-16 h-9" />
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center">Ticker</h1>
          <div className="w-16 h-9" />
        </div>
        {/* Search bar */}
        <div className="px-4 pb-3">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <input
              type="text"
              placeholder="ค้นหา Users, Tickets, Chains..."
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

      {/* Refresh spinner */}
      {isRefreshing && (
        <div
          className="absolute left-0 right-0 z-20 flex justify-center items-center pointer-events-none"
          style={{ top: headerH, height: 44 }}
        >
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Tickets tab ── */}
      <div
        ref={ticketsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: tab === "tickets" ? "block" : "none" }}
      >
        {searchQuery ? <SearchTicketsFeed query={searchQuery} /> : <TicketsFeed />}
      </div>

      {/* ── Chains tab ── */}
      <div
        ref={chainsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: tab === "chains" ? "block" : "none" }}
      >
        {searchQuery ? <SearchChainsFeed query={searchQuery} /> : <ChainsSection />}
      </div>

      {/* ── Upcoming tab ── */}
      <div
        ref={newsRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: tab === "news" ? "block" : "none" }}
      >
        <NewsFeed />
      </div>

      {/* ── Users tab ── */}
      <div
        ref={usersRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-none"
        style={{ paddingTop: headerH + (isRefreshing ? 44 : 0), display: tab === "users" ? "block" : "none" }}
      >
        {searchQuery ? <SearchUsersFeed query={searchQuery} /> : <UsersFeed />}
      </div>


    </div>
  );
}
