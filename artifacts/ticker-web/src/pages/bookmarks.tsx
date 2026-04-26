import { useGetMyBookmarks } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCard } from "@/components/TicketCard";
import {
  Bookmark as BookmarkIcon, Film, ChevronLeft, Ticket as TicketIcon, Link2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChainItem } from "@/components/ChainsSection";
import { PosterCollage } from "@/components/ChainsSection";
import { useLang, displayYear } from "@/lib/i18n";

type Filter = "all" | "movies" | "tickets" | "chains";

function BookmarkedMovieCard({ movieId, onRemoved }: { movieId: string; onRemoved: () => void }) {
  const [, navigate] = useLocation();
  const [removing, setRemoving] = useState(false);
  const { lang } = useLang();

  const { data, isLoading } = useQuery<{
    title: string;
    posterUrl: string | null;
    backdropUrl: string | null;
    releaseDate: string | null;
  }>({
    queryKey: ["/api/movies", movieId, "basic"],
    queryFn: async () => {
      const r = await fetch(`/api/movies/${encodeURIComponent(movieId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("not found");
      return r.json();
    },
    staleTime: 1000 * 60 * 10,
  });

  const thumb = data?.posterUrl ?? data?.backdropUrl;
  const releaseYear = data?.releaseDate ? new Date(data.releaseDate).getFullYear() : null;

  async function handleRemove() {
    setRemoving(true);
    try {
      await fetch(`/api/movies/${encodeURIComponent(movieId)}/bookmark`, {
        method: "POST",
        credentials: "include",
      });
      onRemoved();
    } catch {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 w-full">
      <button
        onClick={() => navigate(`/movie/${encodeURIComponent(movieId)}`)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <div className="w-10 h-14 rounded-lg bg-secondary overflow-hidden flex-shrink-0 flex items-center justify-center">
          {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" />}
          {!isLoading && !thumb && <Film className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="h-4 bg-secondary rounded w-32 animate-pulse" />
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground truncate">{data?.title ?? movieId}</p>
              {releaseYear && <p className="text-xs text-muted-foreground mt-0.5">{displayYear(releaseYear, lang)}</p>}
            </>
          )}
        </div>
      </button>
    </div>
  );
}

function BookmarkedChainCard({ chain }: { chain: ChainItem }) {
  const { t } = useLang();
  const [, navigate] = useLocation();
  const posters = chain.movies.slice(0, 4).map(m => m.posterUrl).filter(Boolean) as string[];

  return (
    <button
      onClick={() => navigate(`/chain/${chain.id}`)}
      className="flex items-center gap-3 px-4 py-3 w-full text-left active:bg-secondary/40 transition-colors"
    >
      <div className="w-10 h-[60px] rounded-lg overflow-hidden flex-shrink-0 relative bg-secondary">
        <PosterCollage posters={posters} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{chain.title}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <Link2 className="w-3 h-3 text-muted-foreground" strokeWidth={2.5} />
          <span className="text-xs text-muted-foreground">{chain.chainCount ?? 0} {t.chainTimes} · {chain.movieCount} {t.movieCount}</span>
        </div>
      </div>
    </button>
  );
}

export default function Bookmarks() {
  const { t } = useLang();
  const scrollRef = usePageScroll("bookmarks");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useGetMyBookmarks({ limit: 50 });
  const allTickets = data?.tickets ?? [];
  const regularTickets = allTickets;
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");

  const { data: movieBmData, isLoading: movieBmLoading } = useQuery<{ movieIds: string[] }>({
    queryKey: ["/api/movies/bookmarked"],
    queryFn: async () => {
      const r = await fetch("/api/movies/bookmarked", { credentials: "include" });
      if (!r.ok) return { movieIds: [] };
      return r.json();
    },
    enabled: !!user,
  });
  const bookmarkedMovieIds = movieBmData?.movieIds ?? [];

  const { data: chainBmData, isLoading: chainBmLoading } = useQuery<{ chains: ChainItem[] }>({
    queryKey: ["/api/chains/bookmarked"],
    queryFn: async () => {
      const r = await fetch("/api/chains/bookmarked", { credentials: "include" });
      if (!r.ok) return { chains: [] };
      return r.json();
    },
    enabled: !!user,
  });
  const bookmarkedChains = chainBmData?.chains ?? [];

  if (!user) {
    return (
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
          <BookmarkIcon className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-display font-bold text-foreground">Sign in to view Saved</p>
        <Link href="/">
          <div className="px-6 py-3 bg-foreground text-background rounded-2xl text-sm font-bold">Sign In</div>
        </Link>
      </div>
    );
  }

  const totalSaved = allTickets.length + bookmarkedMovieIds.length + bookmarkedChains.length;

  const showMovies  = filter === "all" || filter === "movies";
  const showTickets = filter === "all" || filter === "tickets";
  const showChains  = filter === "all" || filter === "chains";

  const anyLoading = isLoading || movieBmLoading || chainBmLoading;

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all",     label: t.tabAll  },
    { id: "movies",  label: "Movies"  },
    { id: "tickets", label: "Tickets" },
    { id: "chains",  label: "Chains"  },
  ];

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Header */}
      <div
        className="sticky top-0 z-30 bg-background border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-4 py-4 flex items-center gap-2">
          <button
            onClick={() => navBack(navigate)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-secondary active:bg-secondary/70 transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-xl text-foreground">{t.bookmarksTitle}</h1>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn("filter-pill", filter === f.id && "active")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty states — per tab */}
      {!error && filter === "all" && totalSaved === 0 && !anyLoading && (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <BookmarkIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">{t.noBookmarks}</p>
            <p className="text-sm text-muted-foreground">{t.noBookmarksDesc}</p>
          </div>
        </div>
      )}
      {!error && filter === "movies" && bookmarkedMovieIds.length === 0 && !anyLoading && (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <Film className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">{t.noMovieBookmarks}</p>
            <p className="text-sm text-muted-foreground">{t.noMovieBookmarksDesc}</p>
          </div>
        </div>
      )}
      {!error && filter === "tickets" && regularTickets.length === 0 && !anyLoading && (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <TicketIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">{t.noTicketBookmarks}</p>
            <p className="text-sm text-muted-foreground">{t.noTicketBookmarksDesc}</p>
          </div>
        </div>
      )}
      {!error && filter === "chains" && bookmarkedChains.length === 0 && !anyLoading && (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <Link2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">{t.noChainBookmarks}</p>
            <p className="text-sm text-muted-foreground">{t.noChainBookmarksDesc}</p>
          </div>
        </div>
      )}

      {/* Movies section */}
      {bookmarkedMovieIds.length > 0 && showMovies && (
        <div>
          <p className="px-4 pt-4 pb-1 text-[11px] font-bold text-muted-foreground tracking-wider">Movies</p>
          <div className="divide-y divide-border">
            {bookmarkedMovieIds.map(id => (
              <BookmarkedMovieCard
                key={id}
                movieId={id}
                onRemoved={() => queryClient.invalidateQueries({ queryKey: ["/api/movies/bookmarked"] })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Chains section */}
      {bookmarkedChains.length > 0 && showChains && (
        <div>
          <p className="px-4 pt-4 pb-1 text-[11px] font-bold text-muted-foreground tracking-wider">Chains</p>
          <div className="divide-y divide-border">
            {bookmarkedChains.map(chain => (
              <BookmarkedChainCard key={chain.id} chain={chain} />
            ))}
          </div>
        </div>
      )}

      {/* Tickets section */}
      {regularTickets.length > 0 && showTickets && (
        <div>
          <p className="px-4 pt-4 pb-1 text-[11px] font-bold text-muted-foreground tracking-wider">Tickets</p>
          {regularTickets.map(ticket => (
            <TicketCard
              key={ticket.id}
              ticket={ticket as Parameters<typeof TicketCard>[0]["ticket"]}
            />
          ))}
        </div>
      )}

    </div>
  );
}
