import { useRoute, Link, useLocation } from "wouter";
import { navBack, getMovieRestoreVersion, clearMovieRestore } from "@/lib/nav-back";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { MovieBadges, BADGE_DESC_TH, BADGE_DESC_EN } from "@/components/MovieBadges";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Film, Star, Users, Bookmark, ChevronDown, ChevronUp, Tv, Flag, Loader2, EyeOff, Lock, User, Link2, Heart, MessageCircle, Send, Search, Bell, BellOff, Info, Layers, GitBranch, Images } from "lucide-react";
import { ChainCard, PosterCollage, ChainCommentSheet, ChainShareModal, type ChainItem } from "@/components/ChainsSection";
import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { cn, fmtCount, IS_PWA } from "@/lib/utils";
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
function BackdropCarousel({ backdrops, title }: { backdrops: string[]; title: string }) {
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
          <img src={src} alt={title} className="w-full h-full object-cover" draggable={false} />
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

  // Horizontal scroll refs for position save/restore
  const directorScrollRef  = useRef<HTMLDivElement>(null);
  const castScrollRef      = useRef<HTMLDivElement>(null);
  const charScrollRef      = useRef<HTMLDivElement>(null);
  const collectionScrollRef = useRef<HTMLDivElement>(null);
  const spinoffsScrollRef  = useRef<HTMLDivElement>(null);

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

  // SCROLL GUARD: while the outer container is actively scrolling, lock the
  // inner community scroll (overflow: hidden) so an ongoing outer-scroll gesture
  // cannot accidentally scroll the captions. 300 ms after the outer scroll event
  // stops firing (momentum ends), the inner is unlocked and the user can
  // deliberately scroll it with a fresh touch.
  useEffect(() => {
    const inner = communityScrollRef.current;
    const outer = scrollRef.current;
    if (!inner || !outer) return;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;
    const onOuterScroll = () => {
      inner.style.overflowY = "hidden";
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = setTimeout(() => { inner.style.overflowY = ""; }, 300);
    };
    outer.addEventListener("scroll", onOuterScroll, { passive: true });
    return () => {
      outer.removeEventListener("scroll", onOuterScroll);
      if (lockTimer) clearTimeout(lockTimer);
      inner.style.overflowY = "";
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
  useEffect(() => {
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
      // Save the PREVIOUS movie's showDetails state (ref holds the real current value)
      scrollStore.set(`movie-${prev}-details`, showDetailsRef.current ? 1 : 0);
      // Use the saved scroll position directly:
      //   • Forward navigation (goToMovie / PersonMovieCard): caller deletes the entry
      //     → savedPos = 0 → reset to top (correct fresh start).
      //   • Back navigation (navBack / browser back): entry is preserved
      //     → savedPos > 0 → restore immediately, no flicker, RESTORE effect retries
      //     if content isn't loaded yet.
      const _savedPos = scrollStore.get(`movie-${movieId}`) ?? 0;
      if (scrollRef.current) scrollRef.current.scrollTop = _savedPos;
      setShowDetails((scrollStore.get(`movie-${movieId}-details`) ?? 0) === 1);
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

  // ── Movie follow state ────────────────────────────────────────────────────
  const { data: followData } = useQuery<{ following: boolean }>({
    queryKey: ["/api/movies", movieId, "follow"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/follow`);
      if (!res.ok) return { following: false };
      return res.json();
    },
    enabled: !!movieId && !!user,
  });
  const isFollowingMovie = followData?.following ?? false;
  const followMutation = useMutation({
    mutationFn: async (follow: boolean) => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/follow`, {
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

  const { data: movieChainsData } = useQuery<{ chains: ChainItem[] }>({
    queryKey: ["/api/movies", movieId, "chains"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/chains`);
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/videos`);
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/credits?lang=${apiLang}`);
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
        `/api/character/by-movie/${encodeURIComponent(movieId)}`,
      );
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
      const res = await fetch(`/api/movies/${encodeURIComponent(movieId)}/backdrops`);
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
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none" style={{ overflowAnchor: "none" }}>

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
        {/* ── Nav buttons — inside hero so they scroll away naturally ── */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between pointer-events-none z-10"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top, 0px))" }}>
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
              {user && (
                <button
                  type="button"
                  onClick={() => { if (!followMutation.isPending) followMutation.mutate(!isFollowingMovie); }}
                  aria-label={isFollowingMovie ? "Unfollow movie" : "Follow movie"}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-95",
                    isFollowingMovie
                      ? "bg-foreground text-background border border-foreground/20"
                      : "bg-secondary text-foreground border border-border",
                  )}
                  style={{ width: 64, justifyContent: "center" }}
                >
                  {isFollowingMovie
                    ? <><BellOff className="w-3 h-3 shrink-0" /><span>{lang === "th" ? "แจ้งเตือน" : "Not"}</span></>
                    : <><Bell className="w-3 h-3 shrink-0" /><span>{lang === "th" ? "ติดตาม" : "Follow"}</span></>
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
      <div className="px-5 pt-4 space-y-4">
        {(genres.length > 0 || (movie as any)?.certification) && (
          <div className="flex flex-wrap gap-2">
            {(movie as any)?.certification && (
              <span className="text-xs font-bold bg-secondary text-foreground px-3 py-1.5 rounded-full border border-border">
                {(movie as any).certification}
              </span>
            )}
            {genres.map(g => (
              <span key={g} className="text-xs font-medium bg-secondary text-muted-foreground px-3 py-1.5 rounded-full border border-border">
                {g}
              </span>
            ))}
          </div>
        )}

        {displayPlot && <p className="text-sm text-foreground leading-relaxed" translate={IS_PWA ? "no" : "yes"}>{displayPlot}</p>}

        {/* ── Trailer embed ── */}
        {videosData?.trailerKey && (
          <div>
            <p className="text-xs font-bold text-foreground mb-2">{t.trailerLabel}</p>
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
              <BackdropCarousel backdrops={backdropsData?.backdrops ?? []} title={movie?.title ?? ""} />
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
      {isTvShow && seasonsData && seasonsData.seasons.length > 0 && (
        <div ref={episodeRatingsRef} className="px-5 pt-4">
          <div className="rounded-2xl border border-border overflow-hidden">
            <button
              onClick={(e) => {
                const btn = e.currentTarget;
                setExpandedSeason(v => {
                  const next = v === null ? (seasonsData.seasons[0]?.seasonNumber ?? null) : null;
                  // Scroll button into view on BOTH open and close, after animation completes
                  setTimeout(() => {
                    const c = scrollRef.current;
                    if (c) {
                      const r = btn.getBoundingClientRect();
                      const cr = c.getBoundingClientRect();
                      c.scrollTo({ top: Math.max(0, c.scrollTop + r.top - cr.top - 8), behavior: "smooth" });
                    }
                  }, 360);
                  return next;
                });
              }}
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
            <AccordionContent open={expandedSeason !== null}>
                {seasonsData.seasons.length > 0 && (
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

              {/* ── Characters: show section whenever cast has named characters ── */}
              {creditsData && (creditsData.cast ?? []).some(p => p.character && p.character.trim()) && (
                <>
                  <div className="border-t border-border mt-3 mb-2" />
                  <div className="flex items-center gap-2 mb-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <p className="text-xs font-bold text-foreground flex-1">
                      {lang === "th" ? "ตัวละคร" : "Characters"}
                    </p>
                  </div>

                  {/* Loading skeletons */}
                  {!charsData && (
                    <div
                      ref={charScrollRef}
                      className="flex overflow-x-auto gap-2.5 pb-1 scrollbar-hide"
                      style={{ WebkitOverflowScrolling: "touch", marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}
                    >
                      {(creditsData.cast ?? [])
                        .filter(p => p.character && p.character.trim())
                        .slice(0, 8)
                        .map((_p, i) => (
                          <div key={i} className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border">
                            <div className="relative flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "2/3" }}>
                              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                            </div>
                            <div className="p-1.5 pb-2 min-h-[44px]">
                              <div className="h-2 rounded bg-muted/50 animate-pulse mb-1.5" />
                              <div className="h-2 rounded bg-muted/30 animate-pulse w-2/3" />
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Loaded — results found */}
                  {charsData && (charsData.results ?? []).length > 0 && (
                    <div
                      ref={charScrollRef}
                      className="flex overflow-x-auto gap-2.5 pb-1 scrollbar-hide"
                      style={{ WebkitOverflowScrolling: "touch", marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}
                    >
                      {(charsData.results ?? []).map((char) => (
                        <Link
                          key={char.wikidataId}
                          href={`/character/${encodeURIComponent(char.wikidataId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                          onClick={() => scrollStore.delete(`character-${char.wikidataId}`)}
                        >
                          <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                            <div className="relative" style={{ aspectRatio: "2/3" }}>
                              {char.imageUrl && char.source !== "cast" ? (
                                <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover object-top" loading="eager" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                                  <User className="w-4 h-4 text-muted-foreground opacity-30" />
                                </div>
                              )}
                            </div>
                            <div className="p-1.5 pb-2 min-h-[44px] overflow-hidden">
                              <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{char.name}</p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* No AniList/CV data — render nothing; actor photos must not appear as character images */}
                </>
              )}

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
                  // Save current movie's scroll position before navigating away
                  if (scrollRef.current) {
                    scrollStore.set(`movie-${movieId}`, scrollRef.current.scrollTop);
                    scrollStore.set(`movie-${movieId}-details`, showDetails ? 1 : 0);
                  }
                  // Target movie should always start fresh at top
                  scrollStore.delete(`movie-${targetImdbId}`);
                  scrollStore.delete(`movie-${targetImdbId}-details`);
                  // Clear any pending back-nav restore so forward nav is never
                  // mistakenly treated as back navigation in the target movie.
                  clearMovieRestore(targetImdbId);
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
                        <div ref={collectionScrollRef} className="flex overflow-x-auto gap-2.5 pb-1 mt-2 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
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
                                <div className="p-1.5 pb-2 min-h-[44px] overflow-hidden">
                                  <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                                  {m.year && <p className="text-[8px] text-muted-foreground mt-0.5">{displayYear(m.year, lang)}</p>}
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
                        <div ref={spinoffsScrollRef} className="flex overflow-x-auto gap-2.5 pb-1 mt-2 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
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
                                <div className="p-1.5 pb-2 min-h-[44px] overflow-hidden">
                                  <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                                  {m.year && <p className="text-[8px] text-muted-foreground mt-0.5">{displayYear(m.year, lang)}</p>}
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
                  <div ref={directorScrollRef} className="flex overflow-x-auto gap-2.5 pb-1 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                    {(creditsData?.directors ?? []).map(p => (
                      <Link key={p.id} href={`/person/${p.id}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`} onClick={() => scrollStore.delete(`person-${p.id}`)}>
                        <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                          <div className="relative" style={{ aspectRatio: "2/3" }}>
                            {p.profileUrl
                              ? <img src={p.profileUrl} alt={p.name} className="w-full h-full object-cover" style={{ objectPosition: "center top" }} loading="lazy" />
                              : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><User className="w-4 h-4 text-muted-foreground" /></div>
                            }
                          </div>
                          <div className="p-1.5 pb-2 min-h-[44px] overflow-hidden">
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
                  <div ref={castScrollRef} className="flex overflow-x-auto gap-2.5 pb-1 scrollbar-hide -mx-5 px-5" style={{ WebkitOverflowScrolling: "touch" }}>
                    {(creditsData?.cast ?? []).map(p => (
                      <Link
                        key={p.id}
                        href={`/person/${p.id}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}
                        onClick={() => scrollStore.delete(`person-${p.id}`)}
                      >
                        <div className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70">
                          <div className="relative" style={{ aspectRatio: "2/3" }}>
                            {p.profileUrl
                              ? <img src={p.profileUrl} alt={p.name} className="w-full h-full object-cover" style={{ objectPosition: "center top" }} loading="lazy" />
                              : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><User className="w-4 h-4 text-muted-foreground" /></div>
                            }
                          </div>
                          <div className="p-1.5 pb-2 min-h-[44px] overflow-hidden">
                            <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                            {p.character && <p className="text-[8px] text-muted-foreground mt-0.5 truncate">{p.character}</p>}
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
      {((ratingsData?.total ?? 0) >= 5 || community.length >= 5) && (
      <>
      <div className="mx-5 my-4 border-t border-border" />

      <div className="px-5">
        <h3 className="font-display font-bold text-base text-foreground mb-4">{t.tickerCommunity}</h3>

        {/* Ratings summary — shown from 5 raters; avg for 5-99, total for 100+ */}
        {ratingsData && (ratingsData.total ?? 0) >= 5 && (
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

      {/* ── Posted cards — only shown when ≥5 tickets ── */}
      {community.length >= 5 && (
      <>
          <div className="mx-5 mb-4 border-t border-border" />
          <div className="px-5 pb-4">
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
      <div className="shrink-0" style={{ height: "0.75rem" }} aria-hidden />
    </div>
  );
}
