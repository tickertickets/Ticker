import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

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

function formatRelease(d: string | null, locale: string) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Walk up the DOM tree to find the nearest scrollable ancestor. */
function findScrollParent(el: Element): Element | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    const o  = style.overflow;
    if (oy === "auto" || oy === "scroll" || o === "auto" || o === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function MovieCarousel({ movie }: { movie: UpcomingMovie }) {
  const { t, lang } = useLang();
  const pool: string[] = movie.backdrops.length > 0
    ? movie.backdrops.slice(0, 5)
    : movie.backdropUrl
    ? [movie.backdropUrl]
    : movie.posterUrl
    ? [movie.posterUrl]
    : [];

  const totalPages = pool.length;
  const [page, setPage]       = useState(0);
  const [inView, setInView]   = useState(false);
  const [enterCount, setEnterCount] = useState(0);
  const intervalRef            = useRef<ReturnType<typeof setInterval> | null>(null);
  const userSwipedRef          = useRef(false);
  const containerRef           = useRef<HTMLDivElement | null>(null);
  const releaseLabel           = formatRelease(movie.releaseDate, t.dateLocale);

  // ─── Auto-slide controls ────────────────────────────────────────────────
  const stopAutoSlide = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAutoSlide = useCallback(() => {
    stopAutoSlide();
    if (totalPages <= 1) return;
    intervalRef.current = setInterval(() => {
      setPage(p => (p + 1) % totalPages);
    }, 4000);
  }, [totalPages, stopAutoSlide]);

  // ─── Intersection observer scoped to the scroll parent ─────────────────
  // Using the actual scroll container as root ensures only the card that is
  // truly scrolled into view triggers — not all cards at once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || pool.length === 0) return;

    // Give the DOM a tick to settle (tab switching / display:none changes)
    const setup = () => {
      const root = findScrollParent(el);

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            // Card entered view → reset to first image and start sliding
            setPage(0);
            userSwipedRef.current = false;
            setInView(true);
            setEnterCount(c => c + 1);
            startAutoSlide();
          } else {
            // Card left view → stop and reset (also hides the date)
            stopAutoSlide();
            setPage(0);
            userSwipedRef.current = false;
            setInView(false);
          }
        },
        {
          root,          // scope to scroll container, not the viewport
          threshold: 0.55,
        },
      );

      observer.observe(el);
      return observer;
    };

    const id = setTimeout(() => {
      const obs = setup();
      // store cleanup ref
      (containerRef as any)._obs = obs;
    }, 60);

    return () => {
      clearTimeout(id);
      const obs = (containerRef as any)._obs as IntersectionObserver | undefined;
      obs?.disconnect();
      stopAutoSlide();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, startAutoSlide, stopAutoSlide]);

  // ─── Touch swipe ────────────────────────────────────────────────────────
  const txRef = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { txRef.current = e.touches[0].clientX; };
  const onTouchEnd   = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - txRef.current;
    if (Math.abs(dx) < 40) return;
    userSwipedRef.current = true;
    stopAutoSlide();
    setPage(p => dx < 0 ? Math.min(p + 1, totalPages - 1) : Math.max(p - 1, 0));
  };

  // ─── Empty state ────────────────────────────────────────────────────────
  if (pool.length === 0) {
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
      {pool.map((src, i) => (
        <div
          key={`${src}-${i}`}
          className="absolute inset-0 transition-transform duration-500 ease-out"
          style={{ transform: `translateX(${(i - page) * 100}%)` }}
        >
          <img
            src={src}
            alt={movie.title}
            className="w-full h-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10 pointer-events-none" />
        </div>
      ))}

      {/* Coming Soon badge — date slides out once when card enters view, then stays */}
      <div className="absolute top-2 left-3 z-10 pointer-events-none flex items-center gap-1 h-5">
        <span className={cn(
          "relative z-20 inline-flex items-center h-5 rounded-full bg-black/70 border border-white/15 text-white font-bold uppercase leading-none",
          lang === "th"
            ? "pl-2 pr-2 text-[9px] tracking-normal"
            : "pl-[7px] pr-[6px] text-[9px] tracking-[0.12em]"
        )}>
          {t.comingSoon}
        </span>
        {releaseLabel && inView && (
          <div className="overflow-hidden flex items-center h-5">
            <span
              key={enterCount}
              className={cn(
                "upcoming-date-slide-once inline-flex items-center h-5 text-white/85 text-[10px] font-semibold whitespace-nowrap will-change-transform leading-none",
                lang === "th" ? "translate-y-0" : "translate-y-px"
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

export function UpcomingCard({ movie }: { movie: UpcomingMovie }) {
  const { t } = useLang();
  const [, navigate] = useLocation();

  const goToMovie = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/movie/${encodeURIComponent(movie.imdbId)}`);
  };

  return (
    <div className="block bg-background select-none">
      <MovieCarousel movie={movie} />
      <div className="px-4 pt-4 pb-6">
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
