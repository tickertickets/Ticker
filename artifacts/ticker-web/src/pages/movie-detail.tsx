import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { MovieBadges, BADGE_DESC_TH, BADGE_DESC_EN } from "@/components/MovieBadges";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import type { EffectTag } from "@/lib/ranks";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Film, Star, Users, Bookmark, ChevronDown, ChevronUp, Tv, Flag } from "lucide-react";
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
  user: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null } | null;
  rating: number | null;
  ratingType: "star" | "blackhole" | null;
  rankTier: string;
  currentRankTier: string;
  isPrivateMemory: boolean;
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
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [badgeTooltip, setBadgeTooltip] = useState<string | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const communityScrollRef = useRef<HTMLDivElement>(null);
  const communityScrollKey = `community-${movieId}`;

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
  // Toggle UI always starts at EN. The displayed title/synopsis stays as the
  // original (search/native language) until the user actively presses the
  // toggle. After that, it follows detailLang.
  const [detailLang, setDetailLang] = useState<"th" | "en">("en");
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

  const community = communityData?.tickets ?? [];
  useEffect(() => {
    if (community.length === 0) return;
    const el = communityScrollRef.current;
    if (!el) return;
    const saved = scrollStore.get(communityScrollKey) ?? 0;
    if (saved > 0) requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = saved; });
    const onScroll = () => scrollStore.set(communityScrollKey, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); if (el.scrollTop > 0) scrollStore.set(communityScrollKey, el.scrollTop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.length]);

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
    if (movieLoading) return null;
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
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/85 to-transparent" />

        {/* Back button */}
        <button
          onClick={() => navBack(navigate)}
          className="absolute left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        >
          <ChevronLeft className="w-5 h-5 text-white" />
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
        {/* Wrapper has SAME right & width as the bookmark button,            */}
        {/* so flexbox centering always aligns badge center to button center. */}
        {movie && (
          <div
            className="absolute"
            style={{
              top:            "calc(max(1rem, env(safe-area-inset-top, 0px)) + 2.75rem)",
              right:          16,
              width:          36,
              display:        "flex",
              justifyContent: (_rank === "legendary" || _rank === "cult_classic") ? "flex-end" : "center",
            }}
          >
            <MovieBadges
              tier={_rank}
              effects={_attrs}
              size="md"
              layout="col"
              asButton
              onRankClick={() => setBadgeTooltip(t => t ? null : ((lang === "en" ? BADGE_DESC_EN : BADGE_DESC_TH)[_rank] ?? _rank))}
              onEffectClick={(tag: EffectTag) => setBadgeTooltip(t => t ? null : ((lang === "en" ? BADGE_DESC_EN : BADGE_DESC_TH)[tag] ?? tag))}
            />
          </div>
        )}

        {/* Badge tooltip */}
        {badgeTooltip && (
          <div
            className="absolute top-16 right-16 z-50 bg-zinc-900/95 text-white text-xs rounded-xl px-3 py-2 max-w-[200px] whitespace-pre-line shadow-xl leading-relaxed"
            onClick={() => setBadgeTooltip(null)}
          >
            {badgeTooltip}
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
                <span className="text-sm text-muted-foreground">{movie.runtime}</span>
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
        <div className="px-5 pt-4">
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

      {/* ── Divider ── */}
      <div className="mx-5 my-6 border-t border-border" />

      {/* ── Ticker Community section ── */}
      <div className="px-5">
        <h3 className="font-display font-bold text-base text-foreground mb-4">{t.tickerCommunity}</h3>

        {/* Ratings summary — total stars from all users */}
        {ratingsData && ratingsData.total > 0 && (
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

        {ratingsData && ratingsData.total === 0 && (
          <div className="bg-secondary rounded-2xl p-6 text-center mb-6">
            <p className="text-sm text-muted-foreground">{t.noOnePosted}</p>
          </div>
        )}
      </div>

      {/* ── Posted cards — no rank badge in memory rows ── */}
      {community.length > 0 && (
        <>
          <div className="mx-5 mb-4 border-t border-border" />
          <div className="px-5 pb-8">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-display font-bold text-sm text-foreground">{t.postedCards}</h4>
              <span className="text-xs text-muted-foreground ml-auto">{community.length} {t.cardsUnit}</span>
            </div>
            <div
              ref={communityScrollRef}
              className="overflow-y-auto max-h-[360px] flex flex-col gap-5"
            >
              {community.map(ticket => (
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

                    {(ticket as unknown as Record<string, unknown>)["episodeLabel"] && (
                      <p className="text-xs font-semibold text-primary/80 tracking-wide">
                        {(ticket as unknown as Record<string, unknown>)["episodeLabel"] as string}
                      </p>
                    )}

                    {(ticket as unknown as Record<string, unknown>)["caption"] && (
                      <p className="text-sm text-foreground leading-relaxed bg-secondary rounded-xl px-3 py-2.5 line-clamp-2 break-words" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                        {(ticket as unknown as Record<string, unknown>)["caption"] as string}
                      </p>
                    )}

                    {ticket.watchedAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(ticket.watchedAt).toLocaleDateString(t.dateLocale, { month: "short", day: "numeric", year: "2-digit" })}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
