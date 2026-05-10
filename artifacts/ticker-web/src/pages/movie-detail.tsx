import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { MovieBadges, BADGE_DESC_TH, BADGE_DESC_EN } from "@/components/MovieBadges";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Film, Star, Users, Bookmark, ChevronDown, ChevronUp, Tv, Flag, Loader2, EyeOff, Lock, ArrowUpDown } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { cn, fmtCount } from "@/lib/utils";
import { scrollStore } from "@/lib/scroll-store";
import { useLang, displayYear } from "@/lib/i18n";
import { localizeGenreIds } from "@/lib/tmdb-genres";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type WatchProvider = { name: string; logoUrl: string; providerId: number };
type WatchProviders = {
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};

type MovieDetail = {
  imdbId: string;
  mediaType?: "movie" | "tv";
  title: string;
  originalTitle?: string | null;
  year?: string | null;
  genre?: string | null;
  genreList?: string[];
  genreIds?: number[];
  franchiseIds?: number[];
  plot?: string | null;
  director?: string | null;
  actors?: string | null;
  imdbRating?: string | null;
  tmdbRating?: string | null;
  voteCount?: number;
  popularity?: number;
  runtime?: string | null;
  posterUrl?: string | null;
  numberOfSeasons?: number | null;
  watchProviders?: WatchProviders | null;
};

type CommunityTicket = {
  id: string;
  user: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null; isPrivate?: boolean } | null;
  rating: number | null;
  ratingType: "star" | "blackhole" | null;
  rankTier: string;
  currentRankTier: string;
  isPrivate?: boolean;
  isPrivateMemory: boolean;
  isUserPrivate?: boolean;
  isFollowedByMe?: boolean;
  memoryNote: string | null;
  watchedAt: string | null;
  createdAt: string;
  isSpoiler?: boolean;
};

type RatingsSummary = {
  total: number;
  totalStars: number;
  average: number | null;
};

type CollectionMovie = {
  imdbId: string;
  tmdbId: number;
  title: string;
  year: string | null;
  releaseDate: string | null;
  posterUrl: string | null;
  isCurrent: boolean;
  collectionIndex?: number;
  isSpinoff?: boolean;
};

function StarRow({ value, type }: { value: number | null; type?: string | null }) {
  if (!value) return null;
  const filled = Math.min(Math.max(1, Math.round(value)), 5);
  const isDyingStar = type === "blackhole";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`w-3 h-3 ${
          i < filled
            ? isDyingStar ? "fill-green-500 text-green-500" : "fill-amber-400 text-amber-400"
            : "fill-zinc-300 text-zinc-300"
        }`} />
      ))}
    </div>
  );
}

function Avatar({ user, size = "sm" }: {
  user: { username?: string | null; displayName?: string | null; avatarUrl?: string | null } | null;
  size?: "sm" | "md";
}) {
  const name = user?.displayName || user?.username || "?";
  const initials = name.slice(0, 2).toUpperCase();
  const cls = size === "md" ? "w-10 h-10" : "w-8 h-8";
  if (user?.avatarUrl) {
    const rounded = size === "md" ? "rounded-xl" : "rounded-lg";
    return <img src={user.avatarUrl} alt={name} className={`${cls} ${rounded} object-cover`} />;
  }
  const rounded = size === "md" ? "rounded-xl" : "rounded-lg";
  return (
    <div className={`${cls} ${rounded} bg-black flex items-center justify-center flex-shrink-0 border border-white/10`}>
      <span className="text-xs font-bold text-white">{initials}</span>
    </div>
  );
}

// Persists the active movieId across URL changes. When this component is kept
// mounted but hidden behind a ticket-detail overlay (URL = /ticket/:id), the
// route no longer matches — so we fall back to the last known id to avoid
// firing empty API requests or showing an error state.
let _lastMovieId = "";

export default function MovieDetail() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, params] = useRoute("/movie/:movieId");
  const routeMovieId = params?.movieId ? decodeURIComponent(params.movieId) : "";
  // Update module variable synchronously during render (safe: idempotent write)
  if (routeMovieId) _lastMovieId = routeMovieId;
  const movieId = routeMovieId || _lastMovieId;
  // Self-contained scroll save + restore — replaces usePageScroll entirely
  // so we have full control without interference from the hook's own RAF.
  const scrollRef = useRef<HTMLDivElement>(null);
  const communityScrollRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  // Open badge popup — tracks key + visual index so we can position the popup
  // directly under the specific badge that was tapped, regardless of scroll.
  const [openBadge, setOpenBadge] = useState<{ key: string; idx: number; text: string } | null>(null);
  const badgeColRef = useRef<HTMLDivElement>(null);
  const badgePopupRef = useRef<HTMLDivElement>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const episodeRatingsRef = useRef<HTMLDivElement>(null);
  const [collectionSort, setCollectionSort] = useState<"chronological" | "year">("chronological");

  // SCROLL GUARD: when the community inner-scroll is at the top and the user
  // swipes upward (finger moves down), hand the gesture off to the outer scroll
  // container instead of letting the inner element absorb it.
  useEffect(() => {
    const inner = communityScrollRef.current;
    const outer = scrollRef.current;
    if (!inner || !outer) return;
    let startY = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      if (dy > 0 && inner.scrollTop === 0) {
        e.preventDefault();
      }
    };
    inner.addEventListener("touchstart", onStart, { passive: true });
    inner.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      inner.removeEventListener("touchstart", onStart);
      inner.removeEventListener("touchmove", onMove);
    };
  });

  // FORCE-TOP: whenever the movie changes, immediately reset scroll to 0.
  // This runs before the restore effect so spinoff navigation always starts at top.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    scrollStore.delete(`movie-${movieId}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // SAVE: persist scroll position on every scroll event and on unmount.
  // When the scroll element is not yet mounted (data still loading), we cannot
  // add the event listener — but we still return a cleanup so that if data
  // loads while the component is mounted, we save the final position on unmount
  // by reading scrollRef.current at cleanup time (not the captured null value).
  useEffect(() => {
    const el = scrollRef.current;
    const key = `movie-${movieId}`;

    if (!el) {
      // No scroll container yet. Save on unmount using a live ref read.
      return () => {
        const late = scrollRef.current;
        if (late) scrollStore.set(key, late.scrollTop);
      };
    }

    const onScroll = () => scrollStore.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollStore.set(key, el.scrollTop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // RESTORE: scroll to the saved position once there is enough content.
  // Strategy: ResizeObserver fires whenever scrollHeight grows (images load,
  // community cards arrive, etc.) — each time we re-attempt the scroll.
  // Gives up after 350 ms, or immediately if the user scrolls manually.
  useEffect(() => {
    const key = `movie-${movieId}`;
    const target = scrollStore.get(key) ?? 0;
    if (target <= 0) return;

    let done = false;
    let lastProgrammatic = 0;

    const attempt = () => {
      if (done) return;
      const el = scrollRef.current;
      if (!el || !el.isConnected) return;
      if (el.scrollHeight < target + el.clientHeight * 0.5) return;
      lastProgrammatic = Date.now();
      el.scrollTop = target;
      if (el.scrollTop >= target - 5) {
        done = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
      }
    };

    // If the user scrolls manually (not triggered by our attempt), abort restoration
    const onUserScroll = () => {
      if (Date.now() - lastProgrammatic > 50) {
        done = true;
        ro.disconnect();
        scrollRef.current?.removeEventListener("scroll", onUserScroll);
      }
    };

    const ro = new ResizeObserver(attempt);
    const el0 = scrollRef.current;
    if (el0) {
      ro.observe(el0);
      el0.addEventListener("scroll", onUserScroll, { passive: true });
    }

    attempt();
    const t1 = setTimeout(attempt, 80);
    const t2 = setTimeout(() => {
      attempt();
      done = true;
      ro.disconnect();
      scrollRef.current?.removeEventListener("scroll", onUserScroll);
    }, 350);

    return () => {
      done = true;
      ro.disconnect();
      scrollRef.current?.removeEventListener("scroll", onUserScroll);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  const _searchParams = new URLSearchParams(window.location.search);
  const srclang = _searchParams.get("srclang") ?? "";
  const srcposter = _searchParams.get("srcposter") ?? "";
  const srctitle = _searchParams.get("srctitle") ?? "";

  // ── EN/TH detail-lang toggle (additive, does not change existing logic) ───
  // Scope: ONLY title and synopsis on this page. Does not touch global UI lang
  // or any outside logic.
  // Toggle starts at the same language as the search source language so that
  // the pill always reflects what is currently displayed.
  const [detailLang, setDetailLang] = useState<"th" | "en">(
    () => (srclang === "th" || srclang.startsWith("th")) ? "th" : "en"
  );
  const [userToggled, setUserToggled] = useState(false);

  const { data: movie, isLoading: movieLoading } = useQuery<MovieDetail>({
    queryKey: ["/api/movies", movieId, lang, srclang],
    queryFn: async () => {
      const apiLang = lang === "en" ? "en-US" : "th";
      const qs = srclang
        ? `?lang=${apiLang}&srclang=${encodeURIComponent(srclang)}`
        : `?lang=${apiLang}`;
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}${qs}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!movieId,
  });

  // Propagate real-time detail data into the card cache key so that movie cards
  // in the search page always reflect the same rank/badge as this detail page.
  // The card uses queryKey ["/api/movies", imdbId] (no lang/srclang suffix).
  useEffect(() => {
    if (!movie || !movieId) return;
    qc.setQueryData(["/api/movies", movieId], (old: any) => {
      // Merge: keep existing data, override only the rating-related fields
      // so rank computation in cards uses the same values as here.
      // _detailLoaded signals to useEnsureMovieCores that authoritative TMDB
      // data is already present and no further /movies/core fetch is needed.
      if (!old) return { ...movie, _detailLoaded: true };
      return {
        ...old,
        tmdbRating: movie.tmdbRating ?? old.tmdbRating,
        imdbRating: movie.imdbRating ?? old.imdbRating,
        voteCount: movie.voteCount ?? old.voteCount,
        popularity: movie.popularity ?? old.popularity,
        genreIds: movie.genreIds ?? old.genreIds,
        franchiseIds: movie.franchiseIds ?? old.franchiseIds,
        releaseDate: (movie as any).releaseDate ?? old.releaseDate,
        year: movie.year ?? old.year,
        _detailLoaded: true,
      };
    });
  }, [movie, movieId, qc]);

  // Secondary fetch for the toggled language. Only runs once the user has
  // pressed the toggle, so initial view never changes language on its own.
  const { data: langMovie } = useQuery<MovieDetail>({
    queryKey: ["/api/movies", movieId, "forceLang", detailLang],
    queryFn: async () => {
      const apiLang = detailLang === "en" ? "en-US" : "th";
      const res = await fetch(
        `/api/movies/${encodeURIComponent(movieId)}?forceLang=${apiLang}`,
      );
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!movieId && userToggled,
    staleTime: 1000 * 60 * 30,
  });

  // Until the user toggles, show the original title/synopsis exactly as before.
  // After toggling, follow detailLang; while the new language is loading, keep
  // the previous title visible so the heading never goes blank.
  const displayTitle = userToggled
    ? (langMovie?.title ?? srctitle ?? movie?.title ?? "")
    : ((srctitle || movie?.title) ?? "");
  const displayPlot = userToggled
    ? (langMovie?.plot || movie?.plot || null)
    : (movie?.plot || null);

  const { data: communityData } = useQuery<{ tickets: CommunityTicket[] }>({
    queryKey: ["/api/movies", movieId, "community"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/community`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!movieId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: ratingsData } = useQuery<RatingsSummary>({
    queryKey: ["/api/movies", movieId, "ratings-summary"],
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/ratings-summary`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!movieId,
  });

  const isTvShowEarly = movieId.startsWith("tmdb_tv:");
  const { data: collectionData } = useQuery<{ movies: CollectionMovie[]; collectionName: string | null }>({
    queryKey: ["/api/movies", movieId, "collection", lang, srclang],
    queryFn: async () => {
      const apiLang = lang === "en" ? "en-US" : "th-TH";
      const qs = new URLSearchParams({ lang: apiLang });
      if (srclang) qs.set("srclang", srclang);
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/collection?${qs}`);
      if (!res.ok) return { movies: [], collectionName: null };
      return res.json();
    },
    enabled: !!movieId && !isTvShowEarly,
    staleTime: 30 * 60 * 1000,
  });

  const { data: videosData } = useQuery<{ trailerKey: string | null; trailerName: string | null }>({
    queryKey: ["/api/movies", movieId, "videos"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/videos`);
      if (!res.ok) return { trailerKey: null, trailerName: null };
      return res.json();
    },
    enabled: !!movieId,
  });


  const isTvShow = movie?.mediaType === "tv" || movieId.startsWith("tmdb_tv:");
  const { data: seasonsData } = useQuery<{
    seasons: Array<{
      seasonNumber: number;
      name: string;
      episodes: Array<{
        episodeNumber: number;
        name: string;
        airDate: string | null;
        rating: number | null;
        voteCount: number;
      }>;
    }>;
  }>({
    queryKey: ["/api/movies", movieId, "seasons"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/seasons`);
      if (!res.ok) return { seasons: [] };
      return res.json();
    },
    enabled: !!movieId && isTvShow,
    staleTime: 10 * 60 * 1000,
  });

  const { data: bookmarkData, isLoading: bookmarkLoading } = useQuery<{ isBookmarked: boolean }>({
    queryKey: ["/api/movies", movieId, "social-status"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/social-status`, { credentials: "include" });
      if (!res.ok) return { isBookmarked: false };
      return res.json();
    },
    enabled: !!movieId,
  });

  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/bookmark`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ bookmarked: boolean }>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/movies", movieId, "social-status"], (old: { isBookmarked: boolean } | undefined) => ({
        ...(old ?? {}),
        isBookmarked: data.bookmarked,
      }));
    },
  });

  const isBookmarked = bookmarkData?.isBookmarked ?? false;

  // Auto-scroll to episode ratings section when it first opens
  useEffect(() => {
    if (expandedSeason === null) return;
    const el = episodeRatingsRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop;
    const targetScroll = elTop - 16;
    container.scrollTo({ top: targetScroll, behavior: "smooth" });
  }, [expandedSeason !== null]);

  // Close the badge popup when tapping anywhere outside the badge column
  // and outside the popup itself. Tapping a badge is handled by its own
  // onClick (toggle / switch) so we exclude the badge column from this check.
  useEffect(() => {
    if (!openBadge) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (badgeColRef.current?.contains(t))   return;
      if (badgePopupRef.current?.contains(t)) return;
      setOpenBadge(null);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [openBadge]);

  const community = communityData?.tickets ?? [];

  // Badge rank computed from TMDB detail data
  const _rating      = parseFloat(movie?.tmdbRating ?? movie?.imdbRating ?? "0");
  const _voteCount   = movie?.voteCount   ?? 0;
  const _popularity  = movie?.popularity  ?? 0;
  const _genreIds    = movie?.genreIds    ?? [];
  const _franchiseIds = movie?.franchiseIds ?? [];
  const _year        = movie?.year ? parseInt(movie.year) : undefined;
  const _releaseDate = (movie as any)?.releaseDate ?? null;
  const _scoreInput  = { tmdbRating: _rating, voteCount: _voteCount, popularity: _popularity, genreIds: _genreIds, franchiseIds: _franchiseIds, year: _year, releaseDate: _releaseDate };
  const _rank  = movie ? computeCardTier(_scoreInput) : "common";
  const _attrs = movie ? computeEffectTags(_scoreInput, _rank) : [];

  // Flatten all providers (deduplicated by providerId, skip missing logos)
  const allProviders: WatchProvider[] = [];
  if (movie?.watchProviders) {
    const seen = new Set<number>();
    for (const p of [...movie.watchProviders.flatrate, ...movie.watchProviders.rent, ...movie.watchProviders.buy]) {
      if (!seen.has(p.providerId) && p.logoUrl) { seen.add(p.providerId); allProviders.push(p); }
    }
  }

  if (!movie) {
    if (movieLoading) return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
    return (
      <div className="bg-background flex flex-col items-center justify-center py-32 gap-4 px-6 text-center">
        <Film className="w-10 h-10 text-muted-foreground" />
        <p className="font-display font-bold text-foreground">ไม่พบหนังนี้</p>
        <button onClick={() => navBack(navigate)} className="text-sm text-muted-foreground underline">ย้อนกลับ</button>
      </div>
    );
  }

  const isTv = movie.mediaType === "tv";
  const localizedGenres = localizeGenreIds(movie.genreIds ?? [], isTv, lang);
  const genres = localizedGenres.length > 0
    ? localizedGenres
    : (movie.genre?.split(",").map(g => g.trim()).filter(Boolean) ?? []);
  const castList = movie.actors?.split(",").map(a => a.trim()).filter(Boolean) ?? [];

  // Language to carry forward when navigating to related / collection movies.
  // Always use the srclang from the current URL — this is the original search
  // language and can be any locale (en, th, ko, ja, fr, …). The EN/TH toggle
  // on this page is independent and does not affect collection navigation.
  const navSrclang = srclang;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">

      {/* ── Hero poster — full 2:3 ratio ── */}
      <div className="relative w-full overflow-hidden">
        {(srcposter || movie.posterUrl) ? (
          <img
            src={srcposter || movie.posterUrl!}
            alt={srctitle || movie.title}
            className="w-full object-cover"
            style={{ aspectRatio: "2/3", display: "block" }}
          />
        ) : (
          <div className="w-full bg-secondary flex items-center justify-center" style={{ aspectRatio: "2/3" }}>
            <Film className="w-20 h-20 text-muted-foreground" />
          </div>
        )}

        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white via-white/85 dark:from-black dark:via-black/85 to-transparent" />

        {/* Back button */}
        <button
          onClick={() => navBack(navigate)}
          className="absolute left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        >
          <ChevronLeft className="w-5 h-5 text-white translate-x-[-1px]" />
        </button>

        {/* Bookmark button */}
        <button
          onClick={() => { if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; } bookmarkMutation.mutate(); }}
          disabled={bookmarkLoading || bookmarkMutation.isPending}
          className="absolute right-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        >
          <Bookmark className={cn("w-4.5 h-4.5", isBookmarked ? "fill-white text-white" : "text-white")} />
        </button>


        {/* Rank + effect badges — below bookmark, centred with it */}
        {/* For regular tiers: badge = 26px (px.side 20 + PAD*2 6).          */}
        {/* right:21 → badge right edge at 21px → badge center = 21+13 = 34. */}
        {/* Bookmark center = right(16) + w-9/2(18) = 34. Perfect alignment. */}
        {/* For legendary/cult_classic: right:16 aligns wide badge to button. */}
        {movie && (
          <div
            ref={badgeColRef}
            className="absolute"
            style={{
              top:   "calc(max(1rem, env(safe-area-inset-top, 0px)) + 2.75rem)",
              right: (_rank === "legendary" || _rank === "cult_classic") ? 16 : 21,
            }}
          >
            <MovieBadges
              tier={_rank}
              effects={_attrs}
              size="md"
              layout="col"
              asButton
              onBadgeClick={(key, idx) => {
                setOpenBadge(prev => {
                  if (prev && prev.key === key) return null; // re-tap same badge → close
                  const text = (lang === "en" ? BADGE_DESC_EN : BADGE_DESC_TH)[key] ?? key;
                  return { key, idx, text };                  // new / different badge → open
                });
              }}
            />
          </div>
        )}

        {/* Badge popup — positioned directly below the tapped badge.
            Each badge has a fixed designated spot in this container's coord
            system, so the popup always lands at the same offset for a given
            badge regardless of how the page has been scrolled.
            The popup's right edge lines up exactly with the badge's right
            edge:
              • Regular tiers — badge column = 26px wide, centred in a 36px
                wrapper at right=16 → badge right edge = 16 + (36-26)/2 = 21.
              • Special wide badges (LEGENDARY / CULT CLASSIC) — pinned to the
                wrapper's right edge → popup right = 16. */}
        {openBadge && (
          <div
            ref={badgePopupRef}
            className="absolute z-50 bg-zinc-900/95 text-white text-xs rounded-xl px-3 py-2 shadow-xl leading-relaxed text-left"
            style={{
              // Badge container starts at: max(1rem, safe-area) + 2.75rem
              // Inside the container (size="md"): PAD(3) + idx*(side+gap=24) + side(20) = 23 + 24*idx
              // + 6px breathing gap below the badge
              top:           `calc(max(1rem, env(safe-area-inset-top, 0px)) + 2.75rem + ${29 + 24 * openBadge.idx}px)`,
              right:         (_rank === "legendary" || _rank === "cult_classic") ? 16 : 21,
              whiteSpace:    "pre",
              pointerEvents: "auto",
            }}
            onClick={() => setOpenBadge(null)}
          >
            {openBadge.text}
          </div>
        )}

        {/* Title + metadata */}
        <div className="absolute bottom-0 inset-x-0 px-5 pb-5 space-y-1.5">
          <div className="flex items-start gap-2">
            <h1 className="font-display font-bold text-2xl text-foreground leading-tight flex-1">{displayTitle}</h1>
            {/* In-page EN/TH toggle — same pill style as pre-login home.
                Affects ONLY title + synopsis on this page. */}
            <button
              type="button"
              onClick={() => {
                setDetailLang(detailLang === "en" ? "th" : "en");
                setUserToggled(true);
              }}
              aria-label="Toggle language"
              className="relative inline-flex items-center select-none shrink-0 mt-1"
              style={{
                background: "#e5e5ea",
                border: "1px solid #d1d1d6",
                borderRadius: 999,
                padding: 2,
                height: 28,
                width: 64,
              }}
            >
              <span
                aria-hidden
                className="absolute top-0.5 bottom-0.5 rounded-full transition-transform duration-200 ease-out"
                style={{
                  background: "#111",
                  width: 30,
                  left: 2,
                  transform: detailLang === "en" ? "translateX(0)" : "translateX(30px)",
                }}
              />
              <span
                className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
                style={{ color: detailLang === "en" ? "#fff" : "#888" }}
              >
                EN
              </span>
              <span
                className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
                style={{ color: detailLang === "th" ? "#fff" : "#888" }}
              >
                TH
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {movie.year && <span className="text-sm text-muted-foreground">{displayYear(movie.year, lang)}</span>}
            {movie.runtime && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-sm text-muted-foreground">{(() => {
                  const mins = parseInt(String(movie.runtime), 10);
                  if (isNaN(mins) || mins <= 0) return movie.runtime;
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
                })()}</span>
              </>
            )}
            {movie.imdbRating && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1">
                  <a
                    href="https://www.themoviedb.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                  >
                    <img
                      src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
                      alt="TMDB"
                      className="h-3.5 w-auto opacity-70 hover:opacity-100 transition-opacity"
                    />
                  </a>
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-sm font-semibold text-foreground">{movie.imdbRating}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Movie details ── */}
      <div className="px-5 pt-4 space-y-4">
        {genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {genres.map(g => (
              <span key={g} className="text-xs font-medium bg-secondary text-muted-foreground px-3 py-1.5 rounded-full border border-border">
                {g}
              </span>
            ))}
          </div>
        )}

        {displayPlot && <p className="text-sm text-foreground leading-relaxed">{displayPlot}</p>}

        {/* ── Trailer embed ── */}
        {videosData?.trailerKey && (
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-foreground mb-2">{t.trailerLabel}</p>
            <div
              className="w-full rounded-2xl overflow-hidden bg-zinc-900"
              style={{ aspectRatio: "16/9" }}
            >
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videosData.trailerKey}?rel=0&modestbranding=1&hl=${lang}`}
                title={videosData.trailerName ?? "Trailer"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          {movie.director && (
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-14 flex-shrink-0 pt-0.5">{t.directorLabel}</span>
              <span className="text-xs text-foreground font-medium">{movie.director}</span>
            </div>
          )}
          {castList.length > 0 && (
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground w-14 flex-shrink-0 pt-0.5">{t.castLabel}</span>
              <span className="text-xs text-foreground">{castList.slice(0, 4).join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Watch Providers — flat horizontal row, logos only ── */}
      {allProviders.length > 0 && (
        <div className="px-5 pt-4">
          <h3 className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wide">{t.watchOnLabel}</h3>
          <div className="flex flex-wrap gap-2">
            {allProviders.map(p => (
              <img
                key={p.providerId}
                src={p.logoUrl}
                alt={p.name}
                title={p.name}
                className="w-9 h-9 rounded-xl object-cover border border-border"
                loading="eager"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.dataset.retried) {
                    img.dataset.retried = "1";
                    const orig = img.src;
                    setTimeout(() => { img.src = ""; img.src = orig; }, 1200);
                  } else {
                    img.style.display = "none";
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}


      {/* ── Episode ratings (TV shows) ── */}
      {isTvShow && seasonsData && seasonsData.seasons.length > 0 && (
        <div ref={episodeRatingsRef} className="px-5 pt-4">
          <div className="rounded-2xl border border-border overflow-hidden">
            <button
              onClick={() => setExpandedSeason(v => v === null ? seasonsData.seasons[0]?.seasonNumber ?? null : null)}
              className="w-full flex items-center justify-between px-4 py-3 bg-secondary hover:bg-muted/60 transition-colors text-sm font-semibold text-foreground"
            >
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-muted-foreground -translate-y-0.5" />
                <span className="leading-none font-normal">{t.episodeRatings}</span>
              </div>
              {expandedSeason !== null
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </button>
            {expandedSeason !== null && seasonsData && seasonsData.seasons.length > 0 && (
              <div className="space-y-0 divide-y divide-border">
                {seasonsData.seasons.map((season) => (
                  <div key={season.seasonNumber}>
                    <button
                      onClick={() => setExpandedSeason(v => v === season.seasonNumber ? null : season.seasonNumber)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-background hover:bg-muted/40 transition-colors text-sm font-semibold text-foreground"
                    >
                      <span>{season.name}</span>
                      {expandedSeason === season.seasonNumber
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      }
                    </button>
                    {expandedSeason === season.seasonNumber && (
                      <div className="space-y-0 divide-y divide-border">
                        {season.episodes.map((ep) => (
                          <div key={ep.episodeNumber} className="py-2.5 px-3 bg-background space-y-0.5">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <span className="font-mono text-xs text-muted-foreground shrink-0 pt-0.5">
                                  E{String(ep.episodeNumber).padStart(2, "0")}
                                </span>
                                <span className="text-xs font-semibold text-foreground leading-tight">{ep.name}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0 ml-3">
                                {ep.rating !== null && ep.rating > 0 ? (
                                  <>
                                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                    <span className="text-xs font-semibold text-foreground">{ep.rating.toFixed(1)}</span>
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Collection / Related films ── */}
      {collectionData && collectionData.movies.length > 0 && (() => {
        const mainMovies = collectionData.movies.filter(m => !m.isSpinoff);
        const spinoffMovies = collectionData.movies.filter(m => m.isSpinoff);

        // "chronological" = story order: extract episode/part number from title first,
        //   fall back to release date if no episode number found.
        // "year" = strict release date order
        //
        // TMDB's `order` field in collection parts is often missing or equals the
        // release-date index — it does NOT reliably encode in-universe story order.
        // Parsing "Episode I / II / III" etc. from the title is the most reliable
        // method for franchises like Star Wars where story ≠ release order.
        function romanToInt(s: string): number | null {
          const map: Record<string, number> = {
            I: 1, II: 2, III: 3, IV: 4, V: 5,
            VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
            XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15,
          };
          return map[s.toUpperCase()] ?? null;
        }
        function getStoryOrder(title: string, releaseDate: string | null): number {
          // Match "Episode I", "Part 2", "Vol. III", "Chapter 4", etc.
          const romanMatch = title.match(/\b(?:Episode|Part|Vol(?:ume)?\.?|Chapter|Pt\.?)\s+(XIV|XIII|XII|XI|IX|VIII|VII|VI|IV|III|II|I|X|V|\d+)\b/i);
          if (romanMatch?.[1]) {
            const digit = parseInt(romanMatch[1], 10);
            if (!isNaN(digit)) return digit;
            const roman = romanToInt(romanMatch[1]);
            if (roman !== null) return roman;
          }
          // Fall back to release year as a proxy for story order
          if (releaseDate) return parseInt(releaseDate.slice(0, 4), 10) || 9999;
          return 9999;
        }
        const sorted = collectionSort === "year"
          ? [...mainMovies].sort((a, b) => {
              if (!a.releaseDate && !b.releaseDate) return 0;
              if (!a.releaseDate) return 1;
              if (!b.releaseDate) return -1;
              return a.releaseDate.localeCompare(b.releaseDate);
            })
          : [...mainMovies].sort((a, b) => {
              return getStoryOrder(a.title, a.releaseDate ?? null) - getStoryOrder(b.title, b.releaseDate ?? null);
            });

        // Navigate to a movie, always starting at the top of the target page
        const goToMovie = (targetImdbId: string) => {
          scrollStore.delete(`movie-${targetImdbId}`);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        };

        return (
          <div className="pt-4 pb-2">
            {mainMovies.length > 0 && (
              <>
                <div className="px-5 mb-3 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                    {collectionData.collectionName ?? (lang === "th" ? "ภาคทั้งหมด" : "All Parts")}
                  </p>
                  {mainMovies.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCollectionSort("chronological")}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${collectionSort === "chronological" ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}
                      >
                        {lang === "th" ? "เนื้อเรื่อง" : "Story"}
                      </button>
                      <button
                        onClick={() => setCollectionSort("year")}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${collectionSort === "year" ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}
                      >
                        {lang === "th" ? "ปีออก" : "Year"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex overflow-x-auto gap-2.5 px-5 pb-1 scrollbar-hide" style={{ WebkitOverflowScrolling: "touch" }}>
                  {sorted.map(m => (
                    <Link
                      key={m.imdbId}
                      href={`/movie/${encodeURIComponent(m.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                      onClick={() => goToMovie(m.imdbId)}
                    >
                      <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                        <div className="relative" style={{ aspectRatio: "2/3" }}>
                          {m.posterUrl
                            ? <img src={m.posterUrl} alt={m.title} className="w-full h-full object-cover" loading="lazy" />
                            : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><Film className="w-4 h-4 text-muted-foreground" /></div>
                          }
                          {m.isCurrent && (
                            <div className="absolute inset-x-0 bottom-0 bg-foreground/90 py-0.5 text-center">
                              <span className="text-[9px] text-background font-bold">{lang === "th" ? "กำลังดู" : "NOW"}</span>
                            </div>
                          )}
                        </div>
                        <div className="p-1.5 pb-2 h-[44px] overflow-hidden">
                          <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                          {m.year && <p className="text-[8px] text-muted-foreground mt-0.5">{displayYear(m.year, lang)}</p>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {spinoffMovies.length > 0 && (
              <>
                <div className="px-5 mt-4 mb-3 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                    {lang === "th" ? "ภาคเสริม / ที่เกี่ยวข้อง" : "Spin-offs / Related"}
                  </p>
                </div>
                <div className="flex overflow-x-auto gap-2.5 px-5 pb-1 scrollbar-hide" style={{ WebkitOverflowScrolling: "touch" }}>
                  {spinoffMovies.map(m => (
                    <Link
                      key={m.imdbId}
                      href={`/movie/${encodeURIComponent(m.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                      onClick={() => goToMovie(m.imdbId)}
                    >
                      <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                        <div className="relative" style={{ aspectRatio: "2/3" }}>
                          {m.posterUrl
                            ? <img src={m.posterUrl} alt={m.title} className="w-full h-full object-cover" loading="lazy" />
                            : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><Film className="w-4 h-4 text-muted-foreground" /></div>
                          }
                        </div>
                        <div className="p-1.5 pb-2 h-[44px] overflow-hidden">
                          <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                          {m.year && <p className="text-[8px] text-muted-foreground mt-0.5">{displayYear(m.year, lang)}</p>}
                        </div>
                        </div>
                      </Link>
                    ))}
                  </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Ticker Community section ── */}
      {(community.length >= 5 || (ratingsData && ((ratingsData.totalStars ?? 0) >= 5 || (ratingsData.totalStars ?? 0) <= -1))) && (
      <>
      <div className="mx-5 my-6 border-t border-border" />

      <div className="px-5">
        <h3 className="font-display font-bold text-base text-foreground mb-4">{t.tickerCommunity}</h3>

        {/* Ratings summary — shown when threshold is met, independent of ticket count */}
        {ratingsData && ((ratingsData.totalStars ?? 0) >= 5 || (ratingsData.totalStars ?? 0) <= -1) && (
          <div className="flex flex-col items-center gap-2 mb-6">
            {(() => {
              const n = ratingsData.totalStars ?? 0;
              const isNeg = n < 0;
              const abs = Math.abs(n);
              const fmt = fmtCount(abs);
              return (
                <>
                  <Star className={`w-10 h-10 ${isNeg ? "fill-green-500 text-green-500" : "fill-amber-400 text-amber-400"}`} />
                  <p className="text-4xl font-black leading-none text-foreground relative">
                    {isNeg && (
                      <span className="absolute font-black" style={{ right: "100%", top: 0, paddingRight: 2 }}>−</span>
                    )}
                    {fmt}
                  </p>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Posted cards — only shown when ≥5 tickets ── */}
      {community.length >= 5 && (
      <>
          <div className="mx-5 mb-4 border-t border-border" />
          <div className="px-5 pb-8">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-display font-bold text-sm text-foreground">{t.postedCards}</h4>
              <span className="text-xs text-muted-foreground ml-auto">{community.length} {t.cardsUnit}</span>
            </div>
            <div ref={communityScrollRef} className="flex flex-col gap-5 overflow-y-auto overscroll-y-none" style={{ maxHeight: "55vh" }}>
              {community.map(ticket => {
                const isTicketExplicitPrivate = ticket.isPrivate === true;
                const isPrivateMemoryOnly = ticket.isPrivateMemory;
                const isAccountPrivateBlocked = ticket.isUserPrivate && !ticket.isFollowedByMe && !isTicketExplicitPrivate;
                const showPrivateMask = isTicketExplicitPrivate || isPrivateMemoryOnly || (ticket.isUserPrivate && !ticket.isFollowedByMe);
                return showPrivateMask ? (
                  <Link key={ticket.id} href={ticket.user?.username ? `/profile/${ticket.user.username}` : "#"}>
                    <div className="bg-background border border-border rounded-2xl p-4 space-y-2 active:bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <Avatar user={ticket.user} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="font-bold text-sm text-foreground truncate">
                              {ticket.user?.displayName || ticket.user?.username || "Unknown"}
                            </p>
                          </div>
                          {ticket.user?.username && (
                            <p className="text-xs text-muted-foreground">@{ticket.user.username}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-secondary border border-border">
                          <Lock className="w-3 h-3 text-muted-foreground" />
                          <p className="text-xs font-semibold text-muted-foreground">
                            {lang === "th" ? "ส่วนตัว" : "Private"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ) : (
                <Link key={ticket.id} href={`/ticket/${ticket.id}`}>
                  <div className="bg-background border border-border rounded-2xl p-4 space-y-2 active:bg-secondary/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <Avatar user={ticket.user} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-bold text-sm text-foreground truncate">
                            {ticket.user?.displayName || ticket.user?.username || "Unknown"}
                          </p>
                          {isVerified(ticket.user?.username) && <VerifiedBadge className="w-3.5 h-3.5 flex-shrink-0" />}
                          {ticket.user?.id && <BadgeIcon userId={ticket.user.id} />}
                        </div>
                        {ticket.user?.username && (
                          <p className="text-xs text-muted-foreground">@{ticket.user.username}</p>
                        )}
                      </div>
                      {ticket.isSpoiler && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border flex-shrink-0"
                          style={{ background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }}
                          title={t.spoilerAlertDesc}
                        >
                          <span aria-hidden className="font-black leading-none">!</span>
                          {t.spoiler}
                        </span>
                      )}
                    </div>

                    <StarRow value={ticket.rating} type={ticket.ratingType} />

                    {!!((ticket as Record<string, unknown>)["episodeLabel"]) && (
                      <p className="text-xs font-semibold text-primary/80 tracking-wide">
                        {String((ticket as Record<string, unknown>)["episodeLabel"])}
                      </p>
                    )}

                    {!!((ticket as Record<string, unknown>)["caption"]) && (
                      ticket.isSpoiler ? (
                        <p className="text-xs font-semibold text-red-400/80 italic">{t.spoilerCommunityMsg}</p>
                      ) : (
                        <p className="text-sm text-foreground leading-relaxed bg-secondary rounded-xl px-3 py-2.5 line-clamp-2 break-words" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                          {String((ticket as Record<string, unknown>)["caption"])}
                        </p>
                      )
                    )}

                    {ticket.watchedAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(ticket.watchedAt).toLocaleDateString(t.dateLocale, { month: "short", day: "numeric", year: "2-digit" })}
                      </p>
                    )}
                  </div>
                </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
      </>
      )}
      {/* Bottom spacer — small breathing room above the nav bar.
          The nav bar itself is outside this scroll container (it's a flex
          sibling in Layout.tsx), so we only need a visual gap here. */}
      <div className="shrink-0" style={{ height: "1.5rem" }} aria-hidden />
    </div>
  );
}
