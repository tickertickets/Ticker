import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { useLocation } from "wouter";
import { Volume2, VolumeX, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

// ── Tab-active context ────────────────────────────────────────────────────────
// Persistent tabs (Feed at "/" and Home/Following at "/following") stay mounted
// and translate off-screen via CSS. Pages that contain video carousels must wrap
// their content with <TabActiveCtx.Provider value={isActive}> so every player
// inside knows whether the tab is actually visible to the user.
export const TabActiveCtx = createContext<boolean>(true);

// ── YouTube IFrame API loader — singleton ─────────────────────────────────────
// Only one <script> tag is ever inserted; subsequent calls resolve against the
// same promise. Safe to call from multiple components concurrently.
let _ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT);
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    const prev = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve((window as any).YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return _ytApiPromise;
}

// Walk up the DOM tree to find the nearest scrollable ancestor.
function findScrollParent(el: Element): Element | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY, overflow } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflow === "auto" || overflow === "scroll")
      return node;
    node = node.parentElement;
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type UpcomingMovie = {
  imdbId: string;
  tmdbId: number;
  title: string;
  overview: string | null;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  backdrops: string[];
  trailerKey: string | null;
  popularity: number;
};

export type UpcomingMediaMode = "images-first" | "video-first" | "images-only";

function formatRelease(d: string | null, locale: string) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — CAROUSEL TRAILER PLAYER
// Used only inside MovieCarousel (UpcomingCard / NewsFeed in the Upcomings tab).
// Completely isolated from FeedTrailerPlayer — no shared globals whatsoever.
// ═══════════════════════════════════════════════════════════════════════════════

// Per-instance mute state for carousel trailers (no cross-instance sync needed;
// carousels show one film at a time, never in parallel).
let _carouselMuted = true; // default: muted until user taps unmute

function CarouselTrailerPlayer({
  videoKey,
  active,
  shouldMount,
  onEnded,
  title,
}: {
  videoKey: string;
  active: boolean;
  shouldMount: boolean;
  onEnded: () => void;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef    = useRef<any>(null);
  const activeRef    = useRef(active);
  activeRef.current  = active;
  const onEndedRef   = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [ready,   setReady]   = useState(false);
  const [muted,   setMuted]   = useState(_carouselMuted);
  const [gestureUnlocked, setGestureUnlocked] = useState(false);

  // Track user gesture so unmuted autoplay is honoured after first tap
  useEffect(() => {
    const unlock = () => setGestureUnlocked(true);
    document.addEventListener("pointerdown", unlock, { once: true, capture: true });
    document.addEventListener("keydown",     unlock, { once: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown",     unlock, { capture: true });
    };
  }, []);

  // Create the YT player once the card has been seen (shouldMount=true)
  useEffect(() => {
    if (!shouldMount || playerRef.current || !containerRef.current) return;
    let cancelled = false;
    loadYouTubeApi().then((YT: any) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId: videoKey,
        playerVars: {
          autoplay: 0, mute: 1, controls: 0, modestbranding: 1,
          playsinline: 1, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3,
          enablejsapi: 1, origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            // Only play if the card is still in-view when the player becomes ready
            if (activeRef.current) {
              playerRef.current?.playVideo?.();
            }
          },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.PLAYING) {
              // Enforce mute preference on every PLAYING event.
              // gestureUnlocked state may lag behind the ref value; read the
              // current DOM flag instead via the flag we track in the closure.
              const wantMuted = _carouselMuted;
              const p = playerRef.current;
              if (wantMuted) {
                p?.mute?.();
              } else {
                p?.unMute?.(); p?.setVolume?.(100);
              }
              setMuted(wantMuted);
            } else if (e.data === YT.PlayerState.ENDED) {
              onEndedRef.current();
            }
          },
        },
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldMount, videoKey]);

  // Play / pause based on active flag
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    if (active) {
      p.playVideo?.();
    } else {
      p.pauseVideo?.();
      try { p.seekTo?.(0, true); } catch { /* not ready */ }
    }
  }, [active, ready]);

  // Destroy on unmount
  useEffect(() => () => {
    try { playerRef.current?.destroy?.(); } catch { /* noop */ }
    playerRef.current = null;
  }, []);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !muted;
    _carouselMuted = next;
    setMuted(next);
    const p = playerRef.current;
    if (!p) return;
    if (next) { p.mute?.(); } else { p.unMute?.(); p.setVolume?.(100); }
  };

  return (
    <div className="absolute inset-0 bg-black" aria-label={title}>
      <div
        ref={containerRef}
        className="w-full h-full pointer-events-none [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:w-full [&>iframe]:h-full"
      />
      {/* Black cover while not actively playing — hides YouTube's own pause overlay */}
      {(!ready || !active) && (
        <div className="absolute inset-0 bg-black z-[5] pointer-events-none" />
      )}
      <button
        onClick={toggleMute}
        className="absolute bottom-2.5 right-2.5 z-10 w-7 h-7 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white active:scale-90 transition-transform"
        aria-label={muted ? "Unmute trailer" : "Mute trailer"}
      >
        {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — MOVIE CAROUSEL
// Handles backdrop image slideshow + optional trailer for Upcomings cards.
// ═══════════════════════════════════════════════════════════════════════════════

export function MovieCarousel({
  movie,
  mode = "images-first",
  isFirst = false,
}: {
  movie: UpcomingMovie;
  mode?: UpcomingMediaMode;
  isFirst?: boolean;
}) {
  const { t, lang } = useLang();

  const pool = movie.backdrops.length > 0
    ? movie.backdrops.slice(0, 5)
    : movie.backdropUrl ? [movie.backdropUrl]
    : movie.posterUrl   ? [movie.posterUrl]
    : [];

  const hasImages = pool.length > 0;
  const hasVideo  = !!movie.trailerKey && mode !== "images-only";
  const totalPages = pool.length;

  // Build playback sequence
  const sequence: Array<"images" | "video"> =
    mode === "images-only"   ? (hasImages ? ["images"] : []) :
    mode === "video-first"   ? [...(hasVideo ? ["video"] as const : []), ...(hasImages ? ["images"] as const : [])] :
    /* images-first */         [...(hasImages ? ["images"] as const : []), ...(hasVideo ? ["video"] as const : [])];

  const isTabActive    = useContext(TabActiveCtx);
  const isTabActiveRef = useRef(isTabActive);
  isTabActiveRef.current = isTabActive;

  const idRef   = useRef(`upc-${movie.imdbId}-${Math.random().toString(36).slice(2)}`);
  const rootRef = useRef<Element | null>(null);

  const [page,      setPage]      = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [inView,    setInView]    = useState(false);
  const [evicted,   setEvicted]   = useState(false);
  const [enterCount, setEnterCount] = useState(0);

  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const userSwipedRef  = useRef(false);
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const releaseLabel   = formatRelease(movie.releaseDate, t.dateLocale);
  const currentStep    = sequence[stepIndex];

  // ── Auto-slide (images step) ──────────────────────────────────────────────
  const stopAutoSlide = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const stopEverything = useCallback(() => {
    stopAutoSlide();
    setEvicted(true);
  }, [stopAutoSlide]);

  const startAutoSlide = useCallback(() => {
    stopAutoSlide();
    if (sequence[stepIndex] !== "images" || totalPages === 0) return;
    const isLastStep = stepIndex >= sequence.length - 1;
    if (totalPages <= 1 && isLastStep) return;
    intervalRef.current = setInterval(() => {
      setPage(p => {
        if (p >= totalPages - 1) {
          stopAutoSlide();
          if (!isLastStep) setStepIndex(i => i + 1);
          return p;
        }
        return p + 1;
      });
    }, 4000);
  }, [totalPages, stopAutoSlide, stepIndex, sequence]);

  const handleVideoEnded = useCallback(() => {
    setStepIndex(i => (i < sequence.length - 1 ? i + 1 : i));
  }, [sequence.length]);

  // ── Tab inactive → stop everything immediately ────────────────────────────
  useEffect(() => {
    if (!isTabActive) {
      stopAutoSlide();
      setPage(0);
      setStepIndex(0);
      setInView(false);
      setEvicted(false);
      userSwipedRef.current = false;
    }
  }, [isTabActive, stopAutoSlide]);

  // ── Start auto-slide when images step becomes active ──────────────────────
  useEffect(() => {
    if (inView && currentStep === "images" && !evicted) {
      startAutoSlide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, currentStep, evicted]);

  // ── IntersectionObserver — scoped to scroll parent ────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || sequence.length === 0) return;

    let rafId = 0;
    let observer: IntersectionObserver | null = null;

    rafId = requestAnimationFrame(() => {
      if (!el) return;
      const root = findScrollParent(el);
      rootRef.current = root;
      observer = new IntersectionObserver(
        ([entry]) => {
          // Guard: ignore IO callbacks while the persistent tab is off-screen.
          // IO calculates intersection against the pre-transform layout so
          // cards in a hidden tab appear "in view" — the isTabActiveRef check
          // is the only reliable gate.
          if (!isTabActiveRef.current) {
            // Ensure state stays cleared while tab is inactive
            setInView(false);
            return;
          }
          if (entry.isIntersecting) {
            setPage(0);
            setStepIndex(0);
            setEvicted(false);
            userSwipedRef.current = false;
            setInView(true);
            setEnterCount(c => c + 1);
          } else {
            stopAutoSlide();
            setPage(0);
            setStepIndex(0);
            userSwipedRef.current = false;
            setInView(false);
          }
        },
        {
          root,
          rootMargin: isFirst ? "0px 0px -38% 0px" : "-38% 0px -38% 0px",
          threshold: 0.6,
        },
      );
      observer.observe(el);
    });

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      stopAutoSlide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence.length, stopAutoSlide]);

  // ── Prevent parent tab-swipe from intercepting backdrop carousel swipes ───
  // home.tsx attaches a native touchstart listener to the outer container to
  // implement left/right tab-switching. Because native listeners on an ancestor
  // fire before React synthetic handlers on a descendant, we must add our own
  // native listener directly on the carousel div and call stopPropagation()
  // there — only when there are multiple images to swipe through.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || totalPages <= 1) return;
    const stopProp = (e: TouchEvent) => { e.stopPropagation(); };
    el.addEventListener("touchstart", stopProp);
    return () => { el.removeEventListener("touchstart", stopProp); };
  }, [totalPages]);

  // ── Touch swipe (images step only) ───────────────────────────────────────
  const txRef = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { txRef.current = e.touches[0].clientX; };
  const onTouchEnd   = (e: React.TouchEvent) => {
    if (currentStep !== "images") return;
    const dx = e.changedTouches[0].clientX - txRef.current;
    if (Math.abs(dx) < 40) return;
    userSwipedRef.current = true;
    stopAutoSlide();
    setPage(p => dx < 0 ? Math.min(p + 1, totalPages - 1) : Math.max(p - 1, 0));
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (sequence.length === 0) {
    return (
      <div className="relative w-full bg-zinc-900" style={{ aspectRatio: "16/9" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white/30 text-xs">{movie.title}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-black"
      style={{ aspectRatio: "16/9" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Backdrop images */}
      {pool.map((src, i) => (
        <div
          key={`${src}-${i}`}
          className="absolute inset-0 transition-transform duration-500 ease-out"
          style={{ transform: `translateX(${(i - page) * 100}%)` }}
        >
          <img src={src} alt={movie.title} className="w-full h-full object-cover" draggable={false} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10 pointer-events-none" />
        </div>
      ))}

      {/* Trailer (only rendered when mode allows video) */}
      {hasVideo && movie.trailerKey && (
        <div className={cn(
          "absolute inset-0 transition-opacity duration-300",
          currentStep === "video" ? "z-20 opacity-100" : "-z-10 opacity-0 pointer-events-none",
        )}>
          <CarouselTrailerPlayer
            videoKey={movie.trailerKey}
            active={inView && currentStep === "video" && !evicted}
            shouldMount={enterCount > 0 || currentStep === "video"}
            onEnded={handleVideoEnded}
            title={movie.title}
          />
        </div>
      )}

      {/* COMING SOON badge + animated release date */}
      <div className="absolute top-2 left-3 z-10 pointer-events-none flex items-center gap-1 h-5">
        <span className={cn(
          "relative z-20 inline-flex items-center h-5 rounded-full bg-black/70 border border-white/15 text-white font-bold uppercase leading-none",
          lang === "th"
            ? "pl-2 pr-2 text-[9px] tracking-normal"
            : "pl-[7px] pr-[6px] text-[9px] tracking-[0.12em]",
        )}>
          {t.comingSoon}
        </span>
        {releaseLabel && inView && (
          <div className="overflow-hidden flex items-center h-5">
            <span
              key={enterCount}
              className={cn(
                "upcoming-date-slide-once inline-flex items-center h-5 text-white/85 text-[10px] font-semibold whitespace-nowrap will-change-transform leading-none",
                lang === "th" ? "translate-y-0" : "translate-y-px",
              )}
            >
              {releaseLabel}
            </span>
          </div>
        )}
      </div>

      {/* Page dots */}
      {totalPages > 1 && (
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex gap-1 pointer-events-none">
          {Array.from({ length: totalPages }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "rounded-full transition-all duration-200",
                i === page ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/45",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — FEED TRAILER PLAYER
// Used ONLY inside FeedUpcomingCard (injected into the home feed at "/").
// Completely isolated — shares no globals with CarouselTrailerPlayer above.
//
// Behaviour:
//   • Scroll into view  → play (sound on after first user gesture, otherwise muted)
//   • Scroll away       → pause (resumes on scroll back, no seek reset)
//   • Video ends        → loop (seek to 0, replay immediately)
//   • Tab hidden        → pause immediately (no 300 ms debounce)
//   • Tab shown + in view → resume
//   • YouTube native mute polled every 500 ms → broadcast to other feed cards
// ═══════════════════════════════════════════════════════════════════════════════

// Feed-specific isolated state
let _feedSoundMuted = false;
const _feedMuteListeners = new Set<(m: boolean) => void>();
function _broadcastFeedMute(muted: boolean) {
  _feedSoundMuted = muted;
  _feedMuteListeners.forEach(fn => fn(muted));
}
// Gesture lock: browsers block unmuted autoplay until the user taps anything.
let _feedGestureUnlocked = false;
if (typeof document !== "undefined") {
  const unlock = () => { _feedGestureUnlocked = true; };
  document.addEventListener("pointerdown", unlock, { once: true, capture: true });
  document.addEventListener("keydown",     unlock, { once: true, capture: true });
}

function FeedTrailerPlayer({
  videoKey,
  inView,
  onError,
  title,
}: {
  videoKey: string;
  inView: boolean;
  onError: () => void;
  title: string;
}) {
  const { lang } = useLang();
  const langRef  = useRef(lang);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef    = useRef<any>(null);
  const inViewRef    = useRef(inView);
  inViewRef.current  = inView;
  const onErrorRef   = useRef(onError);
  onErrorRef.current = onError;

  const [ready,     setReady]     = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ended,     setEnded]     = useState(false);
  const everPlayedRef   = useRef(false);
  const pauseTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desiredMutedRef = useRef(!_feedGestureUnlocked ? true : _feedSoundMuted);

  // Tab-active context
  const isTabActive    = useContext(TabActiveCtx);
  const isTabActiveRef = useRef(isTabActive);
  isTabActiveRef.current = isTabActive;

  const clearPauseTimer = () => {
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
  };

  const applyMute = (p: any, wantMuted: boolean) => {
    try {
      if (wantMuted) { p?.mute?.(); } else { p?.unMute?.(); p?.setVolume?.(100); }
    } catch { /* noop */ }
  };

  // ── Init YT player ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || playerRef.current) return;
    let cancelled = false;
    loadYouTubeApi().then((YT: any) => {
      if (cancelled || !containerRef.current) return;
      const ccLang = langRef.current === "th" ? "th" : "en";
      playerRef.current = new YT.Player(containerRef.current, {
        videoId: videoKey,
        playerVars: {
          autoplay: 0, mute: 1, controls: 1, modestbranding: 1,
          playsinline: 1, rel: 0, iv_load_policy: 3, enablejsapi: 1,
          origin: window.location.origin, cc_lang_pref: ccLang, cc_load_policy: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            const wantMuted = !_feedGestureUnlocked ? true : _feedSoundMuted;
            desiredMutedRef.current = wantMuted;
            applyMute(playerRef.current, wantMuted);
            if (inViewRef.current && isTabActiveRef.current) {
              playerRef.current?.playVideo?.();
            }
          },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.PLAYING) {
              everPlayedRef.current = true;
              setIsPlaying(true);
              setEnded(false);
              const wantMuted = !_feedGestureUnlocked ? true : _feedSoundMuted;
              desiredMutedRef.current = wantMuted;
              applyMute(playerRef.current, wantMuted);
            } else if (e.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            } else if (e.data === YT.PlayerState.ENDED) {
              // Show replay button; do NOT auto-loop
              setIsPlaying(false);
              setEnded(true);
            }
          },
          onError: () => { if (!everPlayedRef.current) onErrorRef.current(); },
        },
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey]);

  // ── Subscribe to feed-level mute broadcasts ───────────────────────────────
  useEffect(() => {
    const listener = (m: boolean) => {
      desiredMutedRef.current = m;
      applyMute(playerRef.current, m);
    };
    _feedMuteListeners.add(listener);
    return () => { _feedMuteListeners.delete(listener); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll for YouTube native mute button changes ───────────────────────────
  useEffect(() => {
    if (!ready || !isPlaying || !inView) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const nowMuted = p.isMuted?.() as boolean | undefined;
        if (typeof nowMuted === "boolean" && nowMuted !== desiredMutedRef.current) {
          _broadcastFeedMute(nowMuted);
        }
      } catch { /* noop */ }
    }, 500);
    return () => clearInterval(id);
  }, [ready, isPlaying, inView]);

  // ── Effect 1: play/pause when scroll visibility changes ──────────────────
  // Pause is debounced 300 ms to absorb scroll-threshold noise.
  // Play is immediate. "ended" videos never auto-play (user must tap replay).
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || ended) return;
    if (inView && isTabActiveRef.current) {
      clearPauseTimer();
      applyMute(p, desiredMutedRef.current);
      p.playVideo?.();
      return;
    }
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null;
      p.pauseVideo?.();
      setIsPlaying(false);
    }, 300);
    return clearPauseTimer;
  }, [inView, ready, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: tab becomes INACTIVE → immediate pause ─────────────────────
  useEffect(() => {
    if (isTabActive) return;
    clearPauseTimer();
    try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ }
    setIsPlaying(false);
  }, [isTabActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: tab becomes ACTIVE → resume if in view and not ended ────────
  useEffect(() => {
    if (!isTabActive || !ready || ended) return;
    if (inViewRef.current) {
      clearPauseTimer();
      applyMute(playerRef.current, desiredMutedRef.current);
      playerRef.current?.playVideo?.();
    }
  }, [isTabActive, ready, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OS background tab ─────────────────────────────────────────────────────
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ }
      } else if (inViewRef.current && isTabActiveRef.current && !ended) {
        try { playerRef.current?.playVideo?.(); } catch { /* noop */ }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [ended]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    clearPauseTimer();
    try { playerRef.current?.pauseVideo?.(); playerRef.current?.destroy?.(); } catch { /* noop */ }
    playerRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReplay = () => {
    setEnded(false);
    try {
      playerRef.current?.seekTo?.(0, true);
      applyMute(playerRef.current, desiredMutedRef.current);
      playerRef.current?.playVideo?.();
    } catch { /* noop */ }
  };

  return (
    <div className="absolute inset-0 bg-black" aria-label={title}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:w-full [&>iframe]:h-full"
        />
      </div>

      {/* Black overlay while scrolled away (hides frozen last frame) */}
      {!inView && !ended && (
        <div className="absolute inset-0 bg-black z-[5] pointer-events-none" />
      )}

      {/* Replay button after video ends */}
      {ended && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
          <button
            onClick={handleReplay}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/15 border border-white/25 text-white text-sm font-semibold active:scale-95 transition-transform backdrop-blur-sm"
            aria-label="Replay trailer"
          >
            <RotateCcw className="w-4 h-4" />
            {lang === "th" ? "เล่นซ้ำ" : "Replay"}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — FEED UPCOMING CARD
// Injected into the home feed (house icon / "/"). Shows ONE trailer; falls back
// to backdrops when no trailer or on player error.
//
// This component is completely independent from UpcomingCard / MovieCarousel /
// CarouselTrailerPlayer. Navigating to the Upcomings tab in the compass page
// has zero effect on any FeedUpcomingCard in the home feed.
// ═══════════════════════════════════════════════════════════════════════════════

export function FeedUpcomingCard({ movie }: { movie: UpcomingMovie }) {
  const { t } = useLang();
  const [, navigate] = useLocation();
  const [videoError, setVideoError] = useState(false);
  const [inView,     setInView]     = useState(false);
  const wrapRef    = useRef<HTMLDivElement | null>(null);
  const scrollRoot = useRef<Element | null>(null);

  const isTabActive    = useContext(TabActiveCtx);
  const isTabActiveRef = useRef(isTabActive);
  isTabActiveRef.current = isTabActive;

  const goToMovie = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/movie/${encodeURIComponent(movie.imdbId)}`);
  };

  // Pre-load the YouTube IFrame API as soon as this card mounts
  useEffect(() => { loadYouTubeApi(); }, []);

  // ── IntersectionObserver — scoped to scroll parent ────────────────────────
  // When the tab is inactive the IO still fires (it uses pre-transform layout
  // coordinates), so we guard against phantom "intersecting" events with the
  // isTabActiveRef flag. We do NOT force inView=false on tab deactivation here
  // — FeedTrailerPlayer handles pausing via its own isTabActive effect.
  // On scroll-away we DO set inView=false so the black overlay shows correctly.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let rafId = 0;
    let observer: IntersectionObserver | null = null;

    rafId = requestAnimationFrame(() => {
      if (!el) return;
      const root = findScrollParent(el);
      scrollRoot.current = root;
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!isTabActiveRef.current) return; // ignore while tab is off-screen
          setInView(entry!.isIntersecting);
        },
        { root, threshold: 0.5 },
      );
      observer.observe(el);
    });

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      setInView(false);
    };
  }, []);

  // ── Re-evaluate intersection when tab becomes active again ────────────────
  // The IO won't re-fire if the element's viewport position hasn't changed
  // while the tab was hidden. We manually check getBoundingClientRect so that
  // inView is restored correctly the moment the user switches back.
  useEffect(() => {
    if (!isTabActive) return;
    const el = wrapRef.current;
    if (!el) return;
    const root = scrollRoot.current;
    const elRect   = el.getBoundingClientRect();
    const rootRect = root
      ? root.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
    const visibleTop    = Math.max(elRect.top,    rootRect.top);
    const visibleBottom = Math.min(elRect.bottom, rootRect.bottom);
    const visibleH      = Math.max(0, visibleBottom - visibleTop);
    setInView(visibleH / elRect.height >= 0.5);
  }, [isTabActive]);

  const showTrailer = !!movie.trailerKey && !videoError;

  return (
    <div className="mx-4 rounded-2xl overflow-hidden border border-border bg-background select-none">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden bg-black"
        style={{ aspectRatio: "16/9" }}
      >
        {showTrailer ? (
          <FeedTrailerPlayer
            videoKey={movie.trailerKey!}
            inView={inView}
            onError={() => setVideoError(true)}
            title={movie.title}
          />
        ) : (
          <MovieCarousel movie={movie} mode="images-only" />
        )}
      </div>
      <div className="px-4 pt-4 pb-4">
        <p className="font-display font-bold text-[17px] leading-snug text-foreground mb-1">
          {movie.title}
        </p>
        {movie.overview && (
          <div className="text-sm text-muted-foreground leading-relaxed">
            <span className="line-clamp-2 inline">{movie.overview}</span>
            <button
              onClick={goToMovie}
              className="inline-block ml-1 font-semibold text-muted-foreground active:opacity-60 transition-opacity"
            >
              {t.seeMore}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — UPCOMING CARD (Compass / Upcomings tab)
// Used in NewsFeed inside the Home page (/following) Upcomings tab.
// Wraps MovieCarousel — no video in images-only mode (default for NewsFeed).
// ═══════════════════════════════════════════════════════════════════════════════

export function UpcomingCard({
  movie,
  mode = "images-first",
  isFirst = false,
}: {
  movie: UpcomingMovie;
  mode?: UpcomingMediaMode;
  isFirst?: boolean;
}) {
  const { t } = useLang();
  const [, navigate] = useLocation();

  const goToMovie = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/movie/${encodeURIComponent(movie.imdbId)}`);
  };

  return (
    <div className="mx-4 rounded-2xl overflow-hidden border border-border bg-background select-none">
      <MovieCarousel movie={movie} mode={mode} isFirst={isFirst} />
      <div className="px-4 pt-4 pb-4">
        <p className="font-display font-bold text-[17px] leading-snug text-foreground mb-1">
          {movie.title}
        </p>
        {movie.overview && (
          <div className="text-sm text-muted-foreground leading-relaxed">
            <span className="line-clamp-2 inline">{movie.overview}</span>
            <button
              onClick={goToMovie}
              className="inline-block ml-1 font-semibold text-muted-foreground active:opacity-60 transition-opacity"
            >
              {t.seeMore}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
