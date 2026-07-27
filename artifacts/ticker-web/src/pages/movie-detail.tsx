import { useRoute, Link, useLocation } from "wouter";
import { navBack, getMovieRestoreVersion, clearMovieRestore } from "@/lib/nav-back";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { PosterImage } from "@/components/PosterImage";
import { BadgeIcon } from "@/components/BadgeIcon";
import { MovieBadges, BADGE_DESC_TH, BADGE_DESC_EN } from "@/components/MovieBadges";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Film, Star, Users, Bookmark, ChevronDown, ChevronUp, Tv, Flag, Loader2, EyeOff, Lock, User, Link2, Heart, MessageCircle, MessagesSquare, Send, Search, Bell, BellOff, Info, Layers, GitBranch, Images, CalendarDays, Clock, X as XIcon, Clapperboard } from "lucide-react";
import { ChainCard, PosterCollage, ChainCommentSheet, ChainShareModal, type ChainItem } from "@/components/ChainsSection";
import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHorizWheel } from "@/hooks/use-horiz-wheel";
import { cn, fmtCount, IS_PWA } from "@/lib/utils";
import { scrollStore } from "@/lib/scroll-store";
import { useLang, displayYear } from "@/lib/i18n";
import { localizeGenreIds } from "@/lib/tmdb-genres";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { hasReminder, setReminder, clearReminder, requestNotifPermission, scheduleNotification, cancelScheduledNotification } from "@/lib/reminders";

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
  hideRating?: boolean;
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
  likeCount?: number;
  commentCount?: number;
  hideLikes?: boolean;
  hideComments?: boolean;
  topComment?: { content: string; username: string | null; displayName: string | null } | null;
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
  if (value === null || value === undefined) return null;
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

// Cycling comment bubble for community cards — mirrors CommentBubble in TicketCard.tsx
// Fetches up to 6 comments per ticket lazily and rotates through them.
function CommunityCyclingComment({ ticketId, commentCount }: { ticketId: string; commentCount: number }) {
  const { data } = useQuery<{ comments: Array<{ id: string; user: { displayName: string | null; username: string }; content: string }> }>({
    queryKey: [`/api/tickets/${ticketId}/comments-preview-community`],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/comments?limit=6`, { credentials: "include" });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: commentCount > 0,
  });
  const comments = data?.comments ?? [];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (comments.length <= 1) return;
    const timer = setInterval(() => {
      setShow(false);
      setTimeout(() => { setIdx(i => (i + 1) % comments.length); setShow(true); }, 300);
    }, 3500);
    return () => clearInterval(timer);
  }, [comments.length]);
  if (commentCount === 0 || comments.length === 0) return null;
  const c = comments[idx];
  return (
    <div className="flex items-start gap-2 pt-0.5">
      <MessagesSquare className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" strokeWidth={2.5} />
      <p
        className="text-xs text-muted-foreground line-clamp-1 leading-relaxed flex-1 transition-opacity duration-300"
        style={{ opacity: show ? 1 : 0 }}
      >
        <span className="font-semibold text-foreground/70">{c.user?.displayName || c.user?.username || ""}</span>
        {" "}{c.content}
      </p>
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

function MovieDetailChainCard({ chain }: { chain: ChainItem }) {
  const isHunt = chain.mode === "hunt";
  const posters = isHunt ? [] : chain.movies.slice(0, 4).map(m => m.posterUrl).filter(Boolean) as string[];
  const [liked, setLiked] = useState(chain.isLiked ?? false);
  const [likeCount, setLikeCount] = useState(chain.likeCount ?? 0);
  const [commentCount, setCommentCount] = useState(chain.commentCount ?? 0);
  const { user: me } = useAuth();
  const { t } = useLang();
  const { toast } = useToast();
  const [commentOpen, setCommentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => { setLiked(chain.isLiked ?? false); }, [chain.isLiked]);
  useEffect(() => { setLikeCount(chain.likeCount ?? 0); }, [chain.likeCount]);
  useEffect(() => { setCommentCount(chain.commentCount ?? 0); }, [chain.commentCount]);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; }
    const next = !liked;
    setLiked(next);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    try {
      await fetch(`/api/chains/${chain.id}/like`, { method: next ? "POST" : "DELETE", credentials: "include" });
    } catch {
      setLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    }
  };

  return (
    <>
      <div className="bg-background rounded-2xl border border-border overflow-hidden">
        <Link href={`/chain/${chain.id}`}>
          <div className="active:opacity-75 transition-opacity">
            <div className="relative" style={{ aspectRatio: "2/3" }}>
              {isHunt ? (
                <div className="hunt-cover-bg absolute inset-0 flex items-center justify-center">
                  <Search className="hunt-cover-icon w-8 h-8" />
                </div>
              ) : (
                <PosterCollage posters={posters} />
              )}
              {chain.isPrivate && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-black/50 rounded-full flex items-center justify-center z-10">
                  <Lock className="w-2.5 h-2.5 text-white/70" />
                </div>
              )}
              {chain.movieCount > 0 && (
                <span className="absolute bottom-1.5 right-1.5 text-[10px] font-black text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{chain.movieCount}</span>
              )}
            </div>
            <div className="px-2 pt-1.5 pb-0.5 text-center h-[38px] overflow-hidden flex flex-col justify-start">
              <p className="text-[11px] font-bold text-foreground line-clamp-2 leading-tight">{chain.title}</p>
              <div className="flex items-center justify-center gap-0.5 mt-0.5" style={{ visibility: chain.hideChainCount ? "hidden" : "visible" }}>
                <Link2 className="w-2.5 h-2.5 text-muted-foreground" strokeWidth={2.5} />
                <span className="text-[10px] text-muted-foreground tabular-nums">{fmtCount(chain.chainCount ?? 0)}</span>
              </div>
            </div>
          </div>
        </Link>
        <div className="flex items-center justify-around px-1 pb-1.5 pt-0.5">
          <button onClick={handleLike} className="flex items-center gap-1 p-1 active:opacity-50" type="button">
            <Heart className={cn("w-3.5 h-3.5 transition-colors", liked ? "fill-foreground text-foreground" : "text-muted-foreground")} />
            {likeCount > 0 && !chain.hideLikes && <span className={cn("text-[9px] tabular-nums leading-none", liked ? "text-foreground" : "text-muted-foreground")}>{fmtCount(likeCount)}</span>}
          </button>
          <button onClick={e => { e.preventDefault(); e.stopPropagation(); if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; } setCommentOpen(true); }} className="flex items-center gap-1 p-1 active:opacity-50" type="button">
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
            {commentCount > 0 && !(chain as any).hideComments && <span className="text-[9px] text-muted-foreground tabular-nums leading-none">{fmtCount(commentCount)}</span>}
          </button>
          <button onClick={e => { e.preventDefault(); e.stopPropagation(); if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; } setShareOpen(true); }} className="p-1 active:opacity-50" type="button">
            <Send className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {commentOpen && <ChainCommentSheet chainId={chain.id} onClose={() => setCommentOpen(false)} commentCount={commentCount} onCommentAdded={() => setCommentCount(c => c + 1)} onCommentDeleted={() => setCommentCount(c => Math.max(0, c - 1))} />}
      {shareOpen && <ChainShareModal chain={chain} onClose={() => setShareOpen(false)} />}
    </>
  );
}

// Accordion with JS-measured height — animates correctly on ALL browsers including iOS Safari < 16
// (grid-template-rows animation is not supported on iOS Safari < 16).
// `ready` starts false so the initial height render is instant (no animation), which lets
// scroll restoration work correctly when the section is open on remount.  After two frames
// (double-RAF) the transition is enabled so user-triggered open/close animates smoothly.
function AccordionContent({ open, children }: { open: boolean; children?: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => { const n = el.scrollHeight; setHeight(h => n !== h ? n : h); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setReady(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, []);
  return (
    <div style={{ height: open ? height : 0, overflow: "hidden", transition: ready ? "height 0.4s cubic-bezier(0.4,0,0.2,1)" : "none", overflowAnchor: "none" }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

// ── BackdropCarousel — single 16/9 auto-slide block (mirrors UpcomingCard's MovieCarousel) ──
function BackdropCarousel({ backdrops, title, paused = false }: { backdrops: string[]; title: string; paused?: boolean }) {
  const pool = backdrops.slice(0, 5);
  const totalPages = pool.length;
  const [page, setPage] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const txRef = useRef(0);

  const stopAutoSlide = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const startAutoSlide = useCallback(() => {
    stopAutoSlide();
    if (totalPages <= 1) return;
    intervalRef.current = setInterval(() => setPage(p => (p + 1) % totalPages), 4000);
  }, [totalPages, stopAutoSlide]);

  // Pause auto-slide when trailer is in view
  useEffect(() => {
    if (paused) stopAutoSlide();
  }, [paused, stopAutoSlide]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || pool.length === 0) return;
    const setup = () => {
      let root: Element | null = el.parentElement;
      while (root && root !== document.body) {
        const s = getComputedStyle(root);
        if (s.overflowY === "auto" || s.overflowY === "scroll" || s.overflow === "auto" || s.overflow === "scroll") break;
        root = root.parentElement;
      }
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { setPage(0); startAutoSlide(); }
        else { stopAutoSlide(); setPage(0); }
      }, { root: root === document.body ? null : root, threshold: 0.4 });
      obs.observe(el);
      return obs;
    };
    const id = setTimeout(() => { (containerRef as any)._obs = setup(); }, 60);
    return () => {
      clearTimeout(id);
      ((containerRef as any)._obs as IntersectionObserver | undefined)?.disconnect();
      stopAutoSlide();
    };
  }, [pool.length, startAutoSlide, stopAutoSlide]);

  const onTouchStart = (e: React.TouchEvent) => { txRef.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - txRef.current;
    if (Math.abs(dx) < 40) return;
    stopAutoSlide();
    setPage(p => dx < 0 ? Math.min(p + 1, totalPages - 1) : Math.max(p - 1, 0));
  };

  if (pool.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-black"
      style={{ aspectRatio: "16/9" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {pool.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 transition-transform duration-500 ease-out"
          style={{ transform: `translateX(${(i - page) * 100}%)` }}
        >
          <PosterImage src={src} alt={title} eager />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10 pointer-events-none" />
        </div>
      ))}
      {totalPages > 1 && (
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex gap-1 pointer-events-none">
          {Array.from({ length: totalPages }).map((_, i) => (
            <span key={i} className={cn(
              "rounded-full transition-all duration-200",
              i === page ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/45"
            )} />
          ))}
        </div>
      )}
    </div>
  );
}

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
  // Open badge popup — tracks key + visual index so we can position the popup
  // directly under the specific badge that was tapped, regardless of scroll.
  const [openBadge, setOpenBadge] = useState<{ key: string; idx: number; text: string } | null>(null);
  const badgeColRef = useRef<HTMLDivElement>(null);
  const badgePopupRef = useRef<HTMLDivElement>(null);
  const [episodeOpen, setEpisodeOpen] = useState(false);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const trailerRef = useRef<HTMLDivElement>(null);
  const [trailerInView, setTrailerInView] = useState(false);
  const episodeSectionRef = useRef<HTMLDivElement>(null);
  // Capture the restore version at mount time using useRef.
  // useRef is Strict Mode safe: the argument is evaluated once on first render
  // and the ref.current value is preserved across the double-render cycle.
  // Non-zero means navBack() targeted this movie — restore scroll + details state.
  const _restoreVersion = useRef(getMovieRestoreVersion(movieId));
  const isBackNav = _restoreVersion.current > 0;

  const [showDetails, setShowDetails] = useState(() =>
    isBackNav && (scrollStore.get(`movie-${movieId}-details`) ?? 0) === 1
  );
  const [showCollection, setShowCollection] = useState(false);
  const [showSpinoffs, setShowSpinoffs] = useState(false);

  // Consume the restore mark after mount so forward navigations to this movie
  // later don't incorrectly restore scroll. The second call in Strict Mode is a no-op.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (_restoreVersion.current > 0) clearMovieRestore(movieId); }, []);

  // Pause backdrop carousel when trailer is visible
  useEffect(() => {
    const el = trailerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setTrailerInView(e.isIntersecting), { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Horizontal scroll refs for position save/restore
  const directorScrollRef   = useRef<HTMLDivElement>(null);
  const castScrollRef       = useRef<HTMLDivElement>(null);
  const charScrollRef       = useRef<HTMLDivElement>(null);
  const collectionScrollRef  = useRef<HTMLDivElement>(null);
  const spinoffsScrollRef    = useRef<HTMLDivElement>(null);
  const communityScrollRef   = useRef<HTMLDivElement>(null);
  // Desktop mouse-wheel → horizontal scroll for all carousels
  useHorizWheel(directorScrollRef);
  useHorizWheel(castScrollRef);
  useHorizWheel(charScrollRef);
  useHorizWheel(collectionScrollRef);
  useHorizWheel(spinoffsScrollRef);


  useEffect(() => {
    const rows: Array<[{ current: HTMLDivElement | null }, string]> = [
      [directorScrollRef,   `movie-${movieId}-director-x`],
      [castScrollRef,       `movie-${movieId}-cast-x`],
      [charScrollRef,       `movie-${movieId}-char-x`],
      [collectionScrollRef, `movie-${movieId}-collection-x`],
      [spinoffsScrollRef,   `movie-${movieId}-spinoffs-x`],
    ];
    const liveCleanups: Array<() => void> = [];
    const attached = new Set<Element>();

    // Attach listener + restore scroll — safe to call many times (deduped via `attached`)
    // Retried at 80ms / 500ms / 1500ms to cover refs that become available after data loads.
    const tryAttach = () => {
      rows.forEach(([ref, key]) => {
        const el = ref.current;
        if (!el || attached.has(el)) return;
        attached.add(el);
        const saved = scrollStore.get(key);
        if (saved != null) el.scrollLeft = saved;
        const onScroll = () => scrollStore.set(key, el.scrollLeft);
        el.addEventListener("scroll", onScroll, { passive: true });
        liveCleanups.push(() => {
          el.removeEventListener("scroll", onScroll);
          scrollStore.set(key, el.scrollLeft);
        });
      });
    };

    const t1 = setTimeout(tryAttach, 80);
    const t2 = setTimeout(tryAttach, 500);
    const t3 = setTimeout(tryAttach, 1500);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      liveCleanups.forEach(fn => fn());
      rows.forEach(([ref, key]) => {
        const el = ref.current;
        if (el) scrollStore.set(key, el.scrollLeft);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);


  // Keep a ref always in sync with the current showDetails so the transition
  // effect below can read the PREVIOUS movie's value (not the stale closure value).
  const showDetailsRef = useRef(showDetails);
  showDetailsRef.current = showDetails;

  // FORCE-TOP: reset scroll when navigating forward, or when navigating to a
  // different movie within the same component lifetime (e.g. spinoffs/collection).
  // On first mount via back-navigation we leave the stored position intact so
  // the RESTORE effect can scroll back to where the user was.
  const prevMovieIdRef = useRef("");
  // Tracks pending scroll-to-top for the case where movie data hasn't loaded yet
  // (scrollRef.current is null at effect time). Applied when data first renders.
  const needsScrollResetRef = useRef(false);
  // Set by the FORCE-TOP effect below whenever it already resolved a movieId
  // transition (forward OR back) in this commit. The REACTIVATION-TOP effect
  // (keyed on routeMovieId) can fire in the SAME commit when both movieId and
  // routeMovieId change together (e.g. person-page → filmography movie → back →
  // same person page → back again to the original movie). Without this guard,
  // REACTIVATION-TOP re-checks the restore version AFTER FORCE-TOP already
  // consumed it, sees 0, and wrongly treats a correct back-navigation restore
  // as a fresh forward navigation — clobbering the just-restored scroll
  // position and closing the Details panel.
  const movieIdChangeHandledRef = useRef(false);
  // useLayoutEffect: runs synchronously before browser paints so scroll
  // position is set to 0 / restored BEFORE the first visible frame, which
  // prevents the brief "jerk" caused by the browser rendering the old position
  // and then jumping to the new one after a regular useEffect fires.
  useLayoutEffect(() => {
    const prev = prevMovieIdRef.current;
    prevMovieIdRef.current = movieId;

    if (!prev) {
      // First mount — clear stored state for forward navigation so page always
      // starts at top with Details closed. Back navigation keeps the saved state.
      if (!isBackNav) {
        scrollStore.delete(`movie-${movieId}`);
        scrollStore.delete(`movie-${movieId}-details`);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        } else {
          // Data still loading — mark for reset once scrollRef is available
          needsScrollResetRef.current = true;
        }
      }
      return;
    }

    if (prev && prev !== movieId) {
      movieIdChangeHandledRef.current = true;
      // Save the PREVIOUS movie's showDetails state (ref holds the real current value)
      scrollStore.set(`movie-${prev}-details`, showDetailsRef.current ? 1 : 0);

      // Determine navigation direction for the INCOMING movie.
      // navBack() sets a restore version for the target movie — non-zero means back nav.
      // Forward navigation from PersonMovieCard / spinoffs does NOT set a restore version,
      // so we must clear any stale saved state and reset to top (fresh start).
      // BUG FIX: previously this branch always restored the saved scroll position,
      // causing forward navigation from a person page to a previously-visited movie
      // to open mid-page at the old scroll position instead of the top.
      const incomingRestoreVersion = getMovieRestoreVersion(movieId);
      if (incomingRestoreVersion > 0) {
        // Back navigation — restore saved scroll and details state.
        // Consume the restore mark so a subsequent forward navigation to the same
        // movie doesn't incorrectly restore the old position again.
        clearMovieRestore(movieId);
        const _savedPos = scrollStore.get(`movie-${movieId}`) ?? 0;
        if (scrollRef.current) {
          scrollRef.current.scrollTop = _savedPos;
        }
        // RESTORE effect (keyed on movieId) will retry scroll once content loads.
        setShowDetails((scrollStore.get(`movie-${movieId}-details`) ?? 0) === 1);
      } else {
        // Forward navigation — clear any stale saved state and reset to top.
        scrollStore.delete(`movie-${movieId}`);
        scrollStore.delete(`movie-${movieId}-details`);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        } else {
          // Scroll container not yet in DOM (data loading) — mark for reset.
          needsScrollResetRef.current = true;
        }
        setShowDetails(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // Save showDetails on unmount so back-navigation from person/character pages restores the open state.
  // Without this, showDetails always resets to false, which changes page height and breaks scroll restoration.
  useEffect(() => {
    return () => {
      scrollStore.set(`movie-${movieId}-details`, showDetailsRef.current ? 1 : 0);
    };
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

    // Seed from store so cleanup always preserves the last-known position,
    // even if the scroll container hasn't rendered yet (movie data still loading).
    let lastScrollTop = scrollStore.get(key) ?? 0;

    if (!el) {
      // Scroll container not yet in the DOM (data loading). On unmount, carry
      // forward the seed value so the stored position is never overwritten with 0.
      return () => { scrollStore.set(key, lastScrollTop); };
    }

    // Cache last known scrollTop in a closure variable — reading el.scrollTop
    // after the element is detached from the DOM returns 0 in many browsers,
    // which would overwrite a correctly-saved position in the cleanup function.
    const onScroll = () => {
      lastScrollTop = el.scrollTop;
      scrollStore.set(key, lastScrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      // Use cached lastScrollTop — NOT el.scrollTop — because the element
      // may already be detached from the DOM when cleanup runs.
      scrollStore.set(key, lastScrollTop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // PENDING-RESET: when data was still loading at FORCE-TOP time, retry the
  // scroll-to-top once the scroll container becomes available (data loads).
  // Uses timed retries so we don't reference `movie` before its declaration.
  useEffect(() => {
    const tryReset = () => {
      if (needsScrollResetRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        needsScrollResetRef.current = false;
      }
    };
    const t1 = setTimeout(tryReset, 100);
    const t2 = setTimeout(tryReset, 500);
    const t3 = setTimeout(tryReset, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  // REACTIVATION-TOP: movie layer can stay mounted while on sub-pages (person,
  // character, wiki). When the user navigates forward from such a sub-page to
  // the SAME movie, routeMovieId transitions from "" → non-empty but movieId
  // is unchanged, so the FORCE-TOP effect (keyed on movieId) doesn't re-run.
  // Detect this transition and reset scroll for forward nav.
  // useLayoutEffect (not useEffect) — runs before browser paints so the first
  // visible frame of the movie page is always at scrollTop=0, preventing the
  // brief "jerk" where the old scroll position flashes before resetting.
  const prevRouteIdRef = useRef(routeMovieId);
  useLayoutEffect(() => {
    const prev = prevRouteIdRef.current;
    prevRouteIdRef.current = routeMovieId;
    if (movieIdChangeHandledRef.current) {
      // FORCE-TOP already fully resolved a movieId change in this same commit
      // (e.g. a detour through a person page's filmography changed movieId
      // independently of routeMovieId — see movieIdChangeHandledRef comment
      // above). Re-running this logic here would re-check an already-consumed
      // restore version and wrongly reset the scroll/Details state it just
      // correctly restored.
      movieIdChangeHandledRef.current = false;
      return;
    }
    if (!prev && routeMovieId) {
      // Movie layer just became active again for the SAME movieId (the div stayed
      // mounted but CSS-transformed off-screen while on a sub-page like /person).
      // FORCE-TOP (keyed on movieId) does not re-run here, so we handle it:
      //
      //   back navigation  → navBack() already set a restore version.
      //                       Scroll is already at the correct position (the div
      //                       stayed in DOM off-screen, scrollTop was not disturbed).
      //                       Just consume the restore mark and leave scroll alone.
      //
      //   forward navigation → person page poster → same movie tapped again.
      //                        Clear any stale state and reset to top so the movie
      //                        always opens fresh, not mid-page at the old position.
      const restoreVersion = getMovieRestoreVersion(movieId);
      if (restoreVersion > 0) {
        // Back navigation — consume the restore mark; scroll is already correct.
        clearMovieRestore(movieId);
      } else {
        // Forward navigation — clear stale state and reset to top.
        scrollStore.delete(`movie-${movieId}`);
        scrollStore.delete(`movie-${movieId}-details`);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        } else {
          needsScrollResetRef.current = true;
        }
        setShowDetails(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMovieId]);

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
      // Observe the content child so ResizeObserver fires when inner content grows
      // (images load, community cards arrive) — the container itself is fixed height.
      ro.observe(el0.firstElementChild ?? el0);
      el0.addEventListener("scroll", onUserScroll, { passive: true });
    }

    attempt();
    const t1 = setTimeout(attempt, 80);
    const t2 = setTimeout(attempt, 300);
    const t3 = setTimeout(() => {
      attempt();
      done = true;
      ro.disconnect();
      scrollRef.current?.removeEventListener("scroll", onUserScroll);
    }, 1200);

    return () => {
      done = true;
      ro.disconnect();
      scrollRef.current?.removeEventListener("scroll", onUserScroll);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
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
  const movieIdForReminder = movieId;
  const [reminderSet, setReminderSet] = useState(() => hasReminder(movieIdForReminder));
  const [showReminderModal, setShowReminderModal] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [reminderDate, setReminderDate] = useState(todayStr);
  const [reminderTime, setReminderTime] = useState("20:00");
  const [reminderNote, setReminderNote] = useState("");
  // Derived hours / minutes for the drum-style time picker
  const reminderH = parseInt(reminderTime.split(":")[0] ?? "20", 10);
  const reminderM = parseInt(reminderTime.split(":")[1] ?? "0", 10);
  const setReminderHours   = (h: number) => setReminderTime(`${String(((h % 24) + 24) % 24).padStart(2, "0")}:${reminderTime.split(":")[1] ?? "00"}`);
  const setReminderMinutes = (m: number) => setReminderTime(`${reminderTime.split(":")[0] ?? "20"}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`);

  const { data: movie, isLoading: movieLoading, isPending: moviePending } = useQuery<MovieDetail>({
    queryKey: ["/api/movies", movieId, lang, srclang],
    queryFn: async () => {
      const apiLang = lang === "en" ? "en-US" : "th";
      const qs = srclang
        ? `?lang=${apiLang}&srclang=${encodeURIComponent(srclang)}`
        : `?lang=${apiLang}`;
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}${qs}`, { credentials: "include" });
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
        `/api/movies/${encodeURIComponent(movieId)}?forceLang=${apiLang}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!movieId && userToggled,
    staleTime: 1000 * 60 * 30,
  });

  // ── Movie follow state ────────────────────────────────────────────────────
  const { data: followData } = useQuery<{ following: boolean }>({
    queryKey: ["/api/movies", movieId, "follow"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/follow`, { credentials: "include" });
      if (!res.ok) return { following: false };
      return res.json();
    },
    enabled: !!movieId && !!user,
  });
  const isFollowingMovie = followData?.following ?? false;
  const followMutation = useMutation({
    mutationFn: async (follow: boolean) => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/follow`, { credentials: "include",
        method: follow ? "POST" : "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/movies", movieId, "follow"], data);
    },
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

  // Update document title + og meta tags when movie loads
  useEffect(() => {
    if (!displayTitle) return;
    const year = movie?.year;
    const title = year
      ? `${displayTitle} (${year}) | Ticker`
      : `${displayTitle} | Ticker`;
    document.title = title;
    const posterUrl = (movie as any)?.posterUrl ?? "";
    const plot = displayPlot ?? "";
    const desc = plot
      ? `${plot.slice(0, 150)}${plot.length > 150 ? "…" : ""}`
      : `Discover ${displayTitle} on Ticker — the movie social platform.`;
    const setMeta = (prop: string, val: string, isName = false) => {
      const sel = isName ? `meta[name="${prop}"]` : `meta[property="${prop}"]`;
      let el = document.querySelector(sel) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        if (isName) el.setAttribute("name", prop); else el.setAttribute("property", prop);
        document.head.appendChild(el);
      }
      el.setAttribute("content", val);
    };
    setMeta("og:title", title);
    setMeta("og:description", desc);
    setMeta("og:type", "video.movie");
    if (posterUrl) setMeta("og:image", posterUrl);
    setMeta("twitter:card", "summary_large_image", true);
    setMeta("twitter:title", title, true);
    setMeta("twitter:description", desc, true);
    if (posterUrl) setMeta("twitter:image", posterUrl, true);
    return () => {
      document.title = "Ticker";
      ["og:title","og:description","og:type","og:image"].forEach(p => {
        const el = document.querySelector(`meta[property="${p}"]`) as HTMLMetaElement | null;
        if (el) el.setAttribute("content", "");
      });
    };
  }, [displayTitle, movie?.year, displayPlot, (movie as any)?.posterUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: communityData } = useQuery<{ tickets: CommunityTicket[] }>({
    queryKey: ["/api/movies", movieId, "community"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/community`, { credentials: "include" });
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/ratings-summary`, { credentials: "include" });
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/collection?${qs}`, { credentials: "include" });
      if (!res.ok) return { movies: [], collectionName: null };
      return res.json();
    },
    enabled: !!movieId && !isTvShowEarly,
    staleTime: 30 * 60 * 1000,
  });

  const { data: movieChainsData } = useQuery<{ chains: ChainItem[] }>({
    queryKey: ["/api/movies", movieId, "chains"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/chains`, { credentials: "include" });
      if (!res.ok) return { chains: [] };
      return res.json();
    },
    enabled: !!movieId,
    staleTime: 0,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const { data: videosData } = useQuery<{ trailerKey: string | null; trailerName: string | null }>({
    queryKey: ["/api/movies", movieId, "videos"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/videos`, { credentials: "include" });
      if (!res.ok) return { trailerKey: null, trailerName: null };
      return res.json();
    },
    enabled: !!movieId,
  });

  type CreditPerson = { id: number; name: string; character?: string; profileUrl: string | null };
  const { data: creditsData } = useQuery<{ cast: CreditPerson[]; directors: CreditPerson[]; isVoiceCast?: boolean }>({
    queryKey: ["/api/movies", movieId, "credits", lang],
    queryFn: async () => {
      const apiLang = lang === "en" ? "en-US" : "th-TH";
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/credits?lang=${apiLang}`, { credentials: "include" });
      if (!res.ok) return { cast: [], directors: [] };
      return res.json();
    },
    enabled: !!movieId,
    staleTime: 30 * 60 * 1000,
  });

  type CharResult = {
    name: string;
    wikidataId: string;
    imageUrl: string | null;
    alias: string | null;
    source?: string;
  };
  const { data: charsData } = useQuery<{ results: CharResult[] }>({
    queryKey: ["/api/character/by-movie", movieId],
    queryFn: async () => {
      const res = await fetch(
        `/api/character/by-movie/${encodeURIComponent(movieId)}`, { credentials: "include" });
      if (!res.ok) return { results: [] };
      return res.json();
    },
    enabled: !!movieId,
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
  });

  const { data: backdropsData } = useQuery<{ backdrops: string[] }>({
    queryKey: ["/api/movies", movieId, "backdrops"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/backdrops`, { credentials: "include" });
      if (!res.ok) return { backdrops: [] };
      return res.json();
    },
    enabled: !!movieId,
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
  });

  const collectionMovieCount = (collectionData?.movies ?? []).filter(m => !m.isSpinoff).length;
  const isFranchise = isTvShowEarly || collectionMovieCount > 1;

  const isTvShow = movie?.mediaType === "tv" || movieId.startsWith("tmdb_tv:");
  const { data: seasonsData, isLoading: seasonsLoading } = useQuery<{
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/seasons`, { credentials: "include" });
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


  // Close the badge popup when tapping anywhere outside the badge column
  // and outside the popup itself. Tapping a badge is handled by its own
  // onClick (toggle / switch) so we exclude the badge column from this check.
  // Use bubble phase (not capture) so badge onClick fires first; a 0ms
  // delay ensures the toggle completes before this handler runs.
  useEffect(() => {
    if (!openBadge) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (badgeColRef.current?.contains(t))   return;
      if (badgePopupRef.current?.contains(t)) return;
      setTimeout(() => setOpenBadge(null), 0);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
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
    // Wrap loading/error states in the SAME scroll container as the main content,
    // with key={movieId}.  This is critical for preventing the scroll-position jerk:
    //
    // 1. key={movieId} forces React to destroy and recreate the div whenever the
    //    movie changes — the new div always starts at scrollTop=0, eliminating the
    //    stale-position jerk from the previous movie.
    //
    // 2. By using the same wrapper element shape for ALL three render paths
    //    (loading / error / main-content), React reconciles them as the same DOM node
    //    within a movieId lifetime.  This means scrollRef.current is ALWAYS set when
    //    the FORCE-TOP useLayoutEffect runs — it can reset scrollTop=0 synchronously
    //    before the first visible frame instead of falling back to setTimeout retries.
    if (movieLoading || moviePending) return (
      <div key={movieId} ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none" style={{ overflowAnchor: "none" }}>
        <div className="h-full flex items-center justify-center bg-background">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
    return (
      <div key={movieId} ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none" style={{ overflowAnchor: "none" }}>
        <div className="bg-background flex flex-col items-center justify-center py-32 gap-4 px-6 text-center">
          <Film className="w-10 h-10 text-muted-foreground" />
          <p className="font-display font-bold text-foreground">ไม่พบหนังนี้</p>
          <button onClick={() => navBack(navigate)} className="text-sm text-muted-foreground underline">ย้อนกลับ</button>
        </div>
      </div>
    );
  }

  const isTv = movie.mediaType === "tv";
  const localizedGenres   = localizeGenreIds(movie.genreIds ?? [], isTv, lang);
  // English names used for navigation so smart-search can reliably detect the genre
  const localizedGenresEN = localizeGenreIds(movie.genreIds ?? [], isTv, "en");
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
    <div key={movieId} ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none" style={{ overflowAnchor: "none" }}>

      {/* ── Hero poster — full 2:3 ratio ── */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: "2/3" }}>
        <PosterImage
          src={srcposter || movie.posterUrl}
          alt={srctitle || movie.title}
          eager
          fallbackIcon={<Film className="w-20 h-20 text-muted-foreground" />}
        />

        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
        {/* ── Nav buttons — inside hero so they scroll away naturally ── */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between pointer-events-none z-10"
          style={{ paddingTop: "max(1rem, var(--sai-top))" }}>
          <button
            onClick={() => navBack(navigate)}
            className="ml-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20 pointer-events-auto"
          >
            <ChevronLeft className="w-5 h-5 text-white translate-x-[-1px]" />
          </button>
          <button
            onClick={() => { if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; } bookmarkMutation.mutate(); }}
            disabled={bookmarkLoading || bookmarkMutation.isPending}
            className="mr-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20 pointer-events-auto"
          >
            <Bookmark className={cn("w-4.5 h-4.5", isBookmarked ? "fill-white text-white" : "text-white")} />
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white via-white/85 dark:from-black dark:via-black/85 to-transparent" />


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
              top:   "calc(max(1rem, var(--sai-top)) + 2.75rem)",
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
              top:           `calc(max(1rem, var(--sai-top)) + 2.75rem + ${29 + 24 * openBadge.idx}px)`,
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
        <div className="absolute bottom-0 inset-x-0 px-5 pb-3 space-y-1.5">
          <div className="flex items-start gap-2">
            <h1 className="font-display font-bold text-2xl text-foreground leading-tight flex-1">{displayTitle}</h1>
            {/* In-page EN/TH toggle + Follow button — stacked column */}
            <div className="flex flex-col items-end gap-1.5 shrink-0 mt-1">
              <button
                type="button"
                onClick={() => {
                  setDetailLang(detailLang === "en" ? "th" : "en");
                  setUserToggled(true);
                }}
                aria-label="Toggle language"
                className="relative inline-flex items-center select-none"
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
                    transform: detailLang === "th" ? "translateX(0)" : "translateX(30px)",
                  }}
                />
                <span
                  className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
                  style={{ color: detailLang === "th" ? "#fff" : "#888" }}
                >
                  TH
                </span>
                <span
                  className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
                  style={{ color: detailLang === "en" ? "#fff" : "#888" }}
                >
                  EN
                </span>
              </button>
              {/* SHOW_REMINDER_BUTTON = false — hide until feature is ready */}
              {false && user && (
                <button
                  type="button"
                  onClick={() => {
                    if (reminderSet) {
                      clearReminder(movieIdForReminder);
                      cancelScheduledNotification(movieIdForReminder);
                      setReminderSet(false);
                      toast({ title: lang === "th" ? "ยกเลิกการแจ้งเตือนแล้ว" : "Reminder removed" });
                    } else {
                      setShowReminderModal(true);
                    }
                  }}
                  aria-label={reminderSet ? "Remove reminder" : "Set reminder"}
                  className={cn(
                    "flex items-center justify-center rounded-full transition-all active:scale-95",
                    reminderSet
                      ? "bg-foreground text-background border border-foreground/20"
                      : "bg-secondary text-foreground border border-border",
                  )}
                  style={{ width: 64, height: 28 }}
                >
                  {reminderSet
                    ? <BellOff className="w-3.5 h-3.5 shrink-0" />
                    : <Bell className="w-3.5 h-3.5 shrink-0" />
                  }
                </button>
              )}
            </div>
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
      <div className="px-5 pt-1 space-y-2">
        {(genres.length > 0 || (movie as any)?.certification) && (
          <div className="flex flex-wrap gap-2">
            {(movie as any)?.certification && (
              <span className="text-xs font-bold bg-secondary text-foreground px-3 py-1.5 rounded-full border border-border">
                {(movie as any).certification}
              </span>
            )}
            {genres.map((g, idx) => {
              // Navigate with the English genre name so the backend smart-search
              // maps it to a TMDB genre ID and returns actual genre-filtered results
              // instead of a keyword title-match (which Thai names produce).
              const enName = localizedGenresEN[idx] ?? g;
              return (
                <button
                  key={g}
                  onClick={() => navigate(`/search?q=${encodeURIComponent(enName)}`)}
                  className="text-xs font-medium bg-secondary text-muted-foreground px-3 py-1.5 rounded-full border border-border active:bg-secondary/70 transition-colors"
                >
                  {g}
                </button>
              );
            })}
          </div>
        )}

        {displayPlot && <p className="text-sm text-foreground leading-relaxed" translate={IS_PWA ? "no" : "yes"}>{displayPlot}</p>}

        {/* ── Trailer embed ── */}
        {videosData?.trailerKey && (
          <div ref={trailerRef}>
            <div className="flex items-center gap-2 mb-2">
              <Clapperboard className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
              <p className="text-xs font-bold text-foreground">{t.trailerLabel}</p>
            </div>
            {/* Container: rounded corners + overflow-hidden clips the iframe */}
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-zinc-900"
              style={{ aspectRatio: "16/9" }}
            >
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videosData.trailerKey}?rel=0&controls=1&playsinline=1&modestbranding=1&iv_load_policy=3&hl=${lang}`}
                title={videosData.trailerName ?? "Trailer"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
          </div>
        )}

      </div>

      {/* ── Backdrops gallery ── */}
      {(backdropsData?.backdrops ?? []).length > 0 && (
        <div className="pt-4">
          <div className="flex items-center gap-2 mb-2 px-5">
            <Images className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
            <p className="text-xs font-bold text-foreground">{lang === "th" ? "ภาพฉาก" : "Scenes"}</p>
          </div>
          <div className="px-5">
            <div className="rounded-2xl overflow-hidden">
              <BackdropCarousel backdrops={backdropsData?.backdrops ?? []} title={movie?.title ?? ""} paused={trailerInView} />
            </div>
          </div>
        </div>
      )}

      {/* ── Available on — standalone ── */}
      {allProviders.length > 0 && (
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Tv className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <p className="text-xs font-bold text-foreground flex-1">{t.watchOnLabel}</p>
          </div>
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

      {/* ── Related Chains — standalone ── */}
      {(() => {
        const visibleChains = (movieChainsData?.chains ?? []).filter(
          chain => chain.mode !== "hunt" && !chain.isPrivate && !(chain.user as any)?.isPrivate
        );
        return visibleChains.length > 0 ? (
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <p className="text-xs font-bold text-foreground flex-1">{"Chains"}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {visibleChains.map(chain => (
                <MovieDetailChainCard key={chain.id} chain={chain} />
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* ── Episode ratings — standalone (TV shows only, before Details) ── */}
      {isTvShow && (seasonsLoading || (seasonsData && seasonsData.seasons.length > 0)) && (
        <div ref={episodeSectionRef} className="px-5 pt-4">
          <div className="rounded-2xl border border-border overflow-hidden">
            <button
              disabled={seasonsLoading}
              onClick={() => {
                setEpisodeOpen(v => {
                  const next = !v;
                  if (next && expandedSeason === null && seasonsData?.seasons && seasonsData.seasons.length > 0) {
                    setExpandedSeason(seasonsData.seasons[0]!.seasonNumber);
                  }
                  if (next) {
                    setTimeout(() => {
                      const el = episodeSectionRef.current;
                      const scrollEl = scrollRef.current;
                      if (el && scrollEl) {
                        const elTop = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
                        scrollEl.scrollTo({ top: scrollEl.scrollTop + elTop - 16, behavior: "smooth" });
                      }
                    }, 60);
                  }
                  return next;
                });
              }}
              className="w-full flex items-center justify-between px-4 py-3 bg-secondary hover:bg-muted/60 transition-colors text-sm font-semibold text-foreground disabled:opacity-70"
            >
              <div className="flex items-center gap-2">
                {seasonsLoading
                  ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  : <Tv className="w-4 h-4 text-muted-foreground -translate-y-0.5" />
                }
                <span className="leading-none font-normal">{t.episodeRatings}</span>
              </div>
              {!seasonsLoading && (episodeOpen
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            <AccordionContent open={episodeOpen}>
                {seasonsData && seasonsData.seasons.length > 0 && (
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
                        <AccordionContent open={expandedSeason === season.seasonNumber}>
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
                        </AccordionContent>
                      </div>
                    ))}
                  </div>
                )}
            </AccordionContent>
          </div>
        </div>
      )}

      {/* ── Details — single collapsible (characters, cast, directors, collection, spinoffs) ── */}
      {((charsData?.results ?? []).length > 0 || (creditsData?.cast ?? []).length > 0 || (creditsData?.directors ?? []).length > 0 || ((collectionData?.movies ?? []).length > 0)) && (
        <div className="px-5 pt-4">
          <button
            className="w-full flex items-center gap-2 text-left"
            onClick={(e) => { const b = e.currentTarget; setShowDetails(v => { const next = !v; if (next) { setShowCollection(true); setShowSpinoffs(true); } setTimeout(() => { const c = scrollRef.current; if (c) { const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect(); c.scrollTo({ top: Math.max(0, c.scrollTop + r.top - cr.top - 8), behavior: "smooth" }); } }, 360); return next; }); }}
          >
            <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <h3 className="text-xs font-bold text-foreground flex-1">{lang === "th" ? "รายละเอียด" : "Details"}</h3>
            {showDetails
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          </button>
          <AccordionContent open={showDetails}>

              {/* Characters section hidden — feature not yet live on web */}

              {/* Collection & Spinoffs */}
              {collectionData && collectionData.movies.length > 0 && (() => {
                const mainMovies = collectionData.movies.filter(m => !m.isSpinoff);
                const spinoffMovies = collectionData.movies.filter(m => m.isSpinoff);
                const sorted = [...mainMovies].sort((a, b) => {
                  if (!a.releaseDate && !b.releaseDate) return 0;
                  if (!a.releaseDate) return 1;
                  if (!b.releaseDate) return -1;
                  return a.releaseDate.localeCompare(b.releaseDate);
                });
                const goToMovie = (targetImdbId: string) => {
                  // Save the current movie's full state before navigating away —
                  // same pattern as person-link onClick handlers so Back correctly
                  // restores scroll position, Details open/closed state, and all
                  // carousel horizontal scroll positions.
                  scrollStore.set(`movie-${movieId}-details`, showDetailsRef.current ? 1 : 0);
                  if (scrollRef.current) scrollStore.set(`movie-${movieId}`, scrollRef.current.scrollTop);
                  if (directorScrollRef.current) scrollStore.set(`movie-${movieId}-director-x`, directorScrollRef.current.scrollLeft);
                  if (castScrollRef.current) scrollStore.set(`movie-${movieId}-cast-x`, castScrollRef.current.scrollLeft);
                  if (charScrollRef.current) scrollStore.set(`movie-${movieId}-char-x`, charScrollRef.current.scrollLeft);
                  if (collectionScrollRef.current) scrollStore.set(`movie-${movieId}-collection-x`, collectionScrollRef.current.scrollLeft);
                  if (spinoffsScrollRef.current) scrollStore.set(`movie-${movieId}-spinoffs-x`, spinoffsScrollRef.current.scrollLeft);
                  // Do NOT delete the target movie's saved state — the useLayoutEffect
                  // already handles "forward vs back" distinction via getMovieRestoreVersion:
                  // back-navigation restores, forward-navigation clears and resets.
                  // Deleting here was premature and would wipe legitimate saved state
                  // (e.g. if the user had previously visited Movie B and is navigating
                  // back to it — that case is also desirable to restore).
                  // Do NOT call clearMovieRestore(targetImdbId) — navBack() hasn't been
                  // called yet (that happens later when the user presses Back), so there
                  // is nothing to clear and calling it here would erase a restore mark
                  // that navBack might have already set for a prior back-navigation to
                  // this same movie.
                };
                return (
                  <>
                    {mainMovies.length > 0 && (
                      <div className="mt-3">
                        <div className="w-full flex items-center gap-2 py-1">
                          <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <p className="text-xs font-bold text-foreground flex-1">
                            {collectionData.collectionName ?? (lang === "th" ? "ภาคทั้งหมด" : "All Parts")}
                          </p>
                        </div>
                        <div ref={collectionScrollRef} className="flex overflow-x-auto gap-2.5 pb-3 mt-2 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                          {sorted.map(m => (
                            <Link
                              key={m.imdbId}
                              href={`/movie/${encodeURIComponent(m.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                              onClick={() => goToMovie(m.imdbId)}
                            >
                              <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                                <div className="relative" style={{ aspectRatio: "2/3" }}>
                                  <PosterImage src={m.posterUrl} alt={m.title} fallbackIcon={<Film className="w-4 h-4 text-muted-foreground" />} />
                                  {m.isCurrent && (
                                    <div className="absolute inset-x-0 bottom-0 bg-foreground/90 py-0.5 text-center">
                                      <span className="text-[9px] text-background font-bold">{lang === "th" ? "กำลังดู" : "NOW"}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="p-1.5 pb-2 min-h-[44px] flex flex-col">
                                  <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                                  {m.year && <p className="text-[8px] text-muted-foreground mt-auto pt-0.5">{displayYear(m.year, lang)}</p>}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {spinoffMovies.length > 0 && (
                      <div className="mt-3">
                        <div className="w-full flex items-center gap-2 py-1">
                          <GitBranch className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <p className="text-xs font-bold text-foreground flex-1">
                            {mainMovies.length > 0
                              ? (lang === "th" ? "ภาคเสริม" : "Spinoffs")
                              : (lang === "th" ? "ภาคเสริม / ที่เกี่ยวข้อง" : "Spinoffs/Related")}
                          </p>
                        </div>
                        <div ref={spinoffsScrollRef} className="flex overflow-x-auto gap-2.5 pb-3 mt-2 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                          {spinoffMovies.map(m => (
                            <Link
                              key={m.imdbId}
                              href={`/movie/${encodeURIComponent(m.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                              onClick={() => goToMovie(m.imdbId)}
                            >
                              <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                                <div className="relative" style={{ aspectRatio: "2/3" }}>
                                  <PosterImage src={m.posterUrl} alt={m.title} fallbackIcon={<Film className="w-4 h-4 text-muted-foreground" />} />
                                </div>
                                <div className="p-1.5 pb-2 min-h-[44px] flex flex-col">
                                  <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                                  {m.year && <p className="text-[8px] text-muted-foreground mt-auto pt-0.5">{displayYear(m.year, lang)}</p>}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Directors */}
              {(creditsData?.directors ?? []).length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <p className="text-xs font-bold text-foreground flex-1">{t.directorLabel}</p>
                  </div>
                  <div ref={directorScrollRef} className="flex overflow-x-auto gap-2.5 pb-3 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                    {(creditsData?.directors ?? []).map(p => (
                      <Link key={p.id} href={`/person/${p.id}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`} onClick={() => {
                        scrollStore.delete(`person-${p.id}`);
                        scrollStore.set(`movie-${movieId}-details`, showDetailsRef.current ? 1 : 0);
                        if (directorScrollRef.current) scrollStore.set(`movie-${movieId}-director-x`, directorScrollRef.current.scrollLeft);
                        if (scrollRef.current) scrollStore.set(`movie-${movieId}`, scrollRef.current.scrollTop);
                      }}>
                        <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                          <div className="relative" style={{ aspectRatio: "2/3" }}>
                            <PosterImage src={p.profileUrl} alt={p.name} objectPosition="center top" fallbackIcon={<User className="w-4 h-4 text-muted-foreground" />} />
                          </div>
                          <div className="p-1.5 pb-2 min-h-[44px] flex flex-col justify-end">
                            <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Cast */}
              {(creditsData?.cast ?? []).length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <p className="text-xs font-bold text-foreground flex-1">{creditsData?.isVoiceCast ? t.voiceActorLabel : t.castLabel}</p>
                  </div>
                  <div ref={castScrollRef} className="flex overflow-x-auto gap-2.5 pb-3 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                    {(creditsData?.cast ?? []).map(p => (
                      <Link
                        key={p.id}
                        href={`/person/${p.id}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                        onClick={() => {
                          scrollStore.delete(`person-${p.id}`);
                          scrollStore.set(`movie-${movieId}-details`, showDetailsRef.current ? 1 : 0);
                          if (castScrollRef.current) scrollStore.set(`movie-${movieId}-cast-x`, castScrollRef.current.scrollLeft);
                          if (scrollRef.current) scrollStore.set(`movie-${movieId}`, scrollRef.current.scrollTop);
                        }}
                      >
                        <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                          <div className="relative" style={{ aspectRatio: "2/3" }}>
                            <PosterImage src={p.profileUrl} alt={p.name} objectPosition="center top" fallbackIcon={<User className="w-4 h-4 text-muted-foreground" />} />
                          </div>
                          <div className="p-1.5 pb-2 min-h-[52px] flex flex-col justify-between">
                            <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                            {p.character && <p className="text-[8px] text-muted-foreground truncate mt-0.5">{p.character}</p>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

          </AccordionContent>
        </div>
      )}


      {/* ── Ticker Community section ── */}
      {true && (
      <>
      <div className="mx-5 my-4 border-t border-border" />

      <div className="px-5">
        <h3 className="font-display font-bold text-base text-foreground mb-4">{t.tickerCommunity}</h3>

        {/* Ratings summary — shown as soon as there's at least one rating; avg under 100 raters, total sum at 100+ */}
        {ratingsData && (ratingsData.total ?? 0) > 0 && (
          <div className="flex flex-col items-center gap-2 mb-6">
            {(() => {
              const total = ratingsData.total ?? 0;
              const totalStars = ratingsData.totalStars ?? 0;
              const isNeg = totalStars < 0;
              let fmt: string;
              if (total >= 100) {
                fmt = fmtCount(Math.abs(totalStars));
              } else {
                fmt = Math.abs(totalStars / total).toFixed(1);
              }
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

      {/* ── Posted cards — shown as soon as there's at least one ── */}
      {community.length > 0 && (
      <>
          <div className="mx-5 mb-4 border-t border-border" />
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-display font-bold text-sm text-foreground">{t.postedCards}</h4>
              <span className="text-xs text-muted-foreground ml-auto">{community.length} {t.cardsUnit}</span>
            </div>
            {/* Bounded scroll container — fixed height ~3 posts + peek of 4th.
                Touch handler: at top/bottom boundary → outer page scrolls instead.
                Gradient fade at bottom hints that more posts exist. */}
            <div className="relative">
              <div
                ref={communityScrollRef}
                className="flex flex-col gap-4 overflow-y-auto"
                style={{
                  maxHeight: "26rem",
                  scrollbarWidth: "none",   /* Firefox */
                }}
              >
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
                        {ticket.createdAt && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(ticket.createdAt).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
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

                    {/* Stars — only when not hidden AND rating has a value */}
                    {!ticket.hideRating && ticket.rating !== null && ticket.rating !== undefined && (
                      <StarRow value={ticket.rating} type={ticket.ratingType} />
                    )}

                    {!!((ticket as Record<string, unknown>)["episodeLabel"]) && (
                      <p className="text-xs font-semibold text-primary/80 tracking-wide">
                        {String((ticket as Record<string, unknown>)["episodeLabel"])}
                      </p>
                    )}

                    {/* Memory note — shown when present and not private */}
                    {!!ticket.memoryNote && (
                      <p className="text-xs text-muted-foreground italic leading-relaxed">
                        {ticket.memoryNote}
                      </p>
                    )}


                    {/* ── Cycling comment preview — same style as feed's CommentBubble ── */}
                    {!ticket.hideComments && !ticket.isSpoiler && (ticket.commentCount ?? 0) > 0 && (
                      <CommunityCyclingComment ticketId={ticket.id} commentCount={ticket.commentCount ?? 0} />
                    )}

                    {/* ── Engagement row (likes · comments) — icons match feed layout ── */}
                    {(!ticket.hideLikes || !ticket.hideComments) && (
                      <div className="flex items-center gap-3 pt-0.5">
                        {!ticket.hideLikes && (
                          <div className="flex items-center gap-1">
                            <Heart className="w-3.5 h-3.5 text-muted-foreground/60" />
                            {(ticket.likeCount ?? 0) > 0 && (
                              <span className="text-xs font-bold tabular-nums leading-5 text-muted-foreground/60">
                                {fmtCount(ticket.likeCount ?? 0)}
                              </span>
                            )}
                          </div>
                        )}
                        {!ticket.hideComments && (
                          <div className="flex items-center gap-1">
                            <MessagesSquare className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2} />
                            {(ticket.commentCount ?? 0) > 0 && (
                              <span className="text-xs font-bold tabular-nums leading-5 text-muted-foreground/60">
                                {fmtCount(ticket.commentCount ?? 0)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </Link>
                );
              })}
              </div>
              {/* Gradient fade — hints that more posts exist below the visible area */}
              {community.length > 3 && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none rounded-b-2xl"
                  style={{ background: "linear-gradient(to bottom, transparent, var(--background))" }}
                />
              )}
            </div>{/* /relative wrapper */}
          </div>
        </>
      )}
      </>
      )}
      {/* Bottom spacer — small breathing room above the nav bar.
          The nav bar itself is outside this scroll container (it's a flex
          sibling in Layout.tsx), so we only need a visual gap here. */}
      <div className="shrink-0" style={{ height: "0.75rem" }} aria-hidden />

      {/* ── Reminder modal ── */}
      {showReminderModal && createPortal(
        <div
          className="fixed inset-x-0 bottom-0 z-[9999] flex items-end justify-center"
          style={{ top: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowReminderModal(false)}
        >
          <div
            className="w-full max-w-md bg-background rounded-t-3xl px-5 pt-5 flex flex-col gap-5 animate-in slide-in-from-bottom-4 duration-300"
            style={{ paddingBottom: "max(2rem, var(--sai-bottom))" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close button only — no title */}
            <div className="flex items-center justify-end -mb-2">
              <button
                onClick={() => setShowReminderModal(false)}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center active:opacity-60"
              >
                <XIcon className="w-3.5 h-3.5 text-foreground" />
              </button>
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3" />
                {lang === "th" ? "วันที่" : "Date"}
              </label>
              <input
                type="date"
                value={reminderDate}
                min={todayStr}
                onChange={e => setReminderDate(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground outline-none focus:border-foreground/40 transition-colors"
              />
            </div>

            {/* Time — numeric drum picker */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                {lang === "th" ? "เวลา" : "Time"}
              </label>
              <div className="flex items-center justify-center gap-3">
                {/* Hours */}
                <div className="flex flex-col items-center gap-1">
                  <button type="button" onClick={() => setReminderHours(reminderH + 1)}
                    className="w-10 h-8 rounded-xl bg-secondary flex items-center justify-center active:opacity-60 transition-opacity">
                    <ChevronUp className="w-4 h-4 text-foreground" />
                  </button>
                  <div className="w-16 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center">
                    <span className="text-xl font-black text-foreground tabular-nums">{String(reminderH).padStart(2, "0")}</span>
                  </div>
                  <button type="button" onClick={() => setReminderHours(reminderH - 1)}
                    className="w-10 h-8 rounded-xl bg-secondary flex items-center justify-center active:opacity-60 transition-opacity">
                    <ChevronDown className="w-4 h-4 text-foreground" />
                  </button>
                </div>
                <span className="text-2xl font-black text-foreground pb-1">:</span>
                {/* Minutes */}
                <div className="flex flex-col items-center gap-1">
                  <button type="button" onClick={() => setReminderMinutes(reminderM + 1)}
                    className="w-10 h-8 rounded-xl bg-secondary flex items-center justify-center active:opacity-60 transition-opacity">
                    <ChevronUp className="w-4 h-4 text-foreground" />
                  </button>
                  <div className="w-16 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center">
                    <span className="text-xl font-black text-foreground tabular-nums">{String(reminderM).padStart(2, "0")}</span>
                  </div>
                  <button type="button" onClick={() => setReminderMinutes(reminderM - 1)}
                    className="w-10 h-8 rounded-xl bg-secondary flex items-center justify-center active:opacity-60 transition-opacity">
                    <ChevronDown className="w-4 h-4 text-foreground" />
                  </button>
                </div>
              </div>
            </div>

            {/* Note (optional) — appears in the push notification body */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                {lang === "th" ? "โน้ต (ไม่บังคับ)" : "Note (optional)"}
              </label>
              <input
                type="text"
                value={reminderNote}
                maxLength={80}
                placeholder={lang === "th" ? "เช่น ดูกับเพื่อน" : "e.g. Watch with friends"}
                onChange={e => setReminderNote(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/40 transition-colors"
              />
              <p className="text-[11px] text-muted-foreground/60 -mt-0.5 text-right">{reminderNote.length}/80</p>
            </div>

            {/* Confirm */}
            <button
              onClick={async () => {
                if (!reminderDate || !reminderTime) return;
                const datetimeStr = `${reminderDate}T${reminderTime}:00`;
                const r = {
                  movieId: movieIdForReminder,
                  title: movie?.title ?? movieIdForReminder,
                  datetime: datetimeStr,
                  createdAt: new Date().toISOString(),
                  note: reminderNote.trim() || undefined,
                };
                setReminder(r);
                setReminderSet(true);
                setShowReminderModal(false);
                // Request notification permission then schedule
                const granted = await requestNotifPermission();
                if (granted) scheduleNotification(movieIdForReminder, r.title, datetimeStr, r.note);
                toast({
                  title: lang === "th" ? "ตั้งการแจ้งเตือนแล้ว ✓" : "Reminder set ✓",
                  description: reminderNote.trim()
                    ? `${new Date(datetimeStr).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { day: "numeric", month: "short", year: "numeric" })} ${reminderTime} · ${reminderNote.trim()}`
                    : `${new Date(datetimeStr).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { day: "numeric", month: "short", year: "numeric" })} ${reminderTime}`,
                });
              }}
              className="w-full bg-foreground text-background font-bold text-sm rounded-2xl py-3 active:opacity-80 transition-opacity"
            >
              {lang === "th" ? "ยืนยัน" : "Confirm"}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
