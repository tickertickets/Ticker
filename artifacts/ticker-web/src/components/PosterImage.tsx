/**
 * PosterImage — shared, perf-conscious poster/backdrop image renderer.
 *
 * Fixes two recurring bugs in the app:
 *   1. Posters used to pop in as a bare <img> with nothing behind them —
 *      a black/blank box was visible until the network finished loading.
 *      This renders a skeleton placeholder and cross-fades the image in
 *      only once it has actually finished loading (or decoding).
 *   2. Feed / grid lists that render many posters at once (chain collages,
 *      movie shelves, mood-category grids) used to fetch + decode every
 *      offscreen image eagerly, which is a major cause of scroll jank.
 *      This defaults to `loading="lazy"` + `decoding="async"` so the
 *      browser only does that work as an image nears the viewport, and
 *      offers an `eager` escape hatch for the first above-the-fold items.
 *
 * A tiny module-level cache remembers which URLs have already finished
 * loading once, so images that unmount/remount while scrolling (e.g. a
 * CSS `display: none` toggle, or list virtualization) reappear instantly
 * instead of re-running the fade-in and flashing blank again.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";

const loadedUrls = new Set<string>();

/** Has this URL already finished loading (successfully or not) once before? */
export function isPosterLoaded(src: string | null | undefined): boolean {
  return !!src && loadedUrls.has(src);
}

/** Record that a URL has finished loading, so other call sites sharing the cache skip the flash. */
export function markPosterLoaded(src: string | null | undefined): void {
  if (src) loadedUrls.add(src);
}

/**
 * Tracks "has this URL actually finished loading" for call sites that render
 * their own real `<img>` element (rather than using `<PosterImage>` directly)
 * — e.g. card faces that must stay html2canvas-capturable for share-image
 * export, where we only want to add a skeleton/fade without swapping the
 * underlying `<img>`/`background-image` rendering strategy. Pass the same
 * `onLoad`/`onError` handlers back onto your `<img>` to keep native
 * lazy-loading behavior (this hook does NOT eagerly preload).
 */
export function useTrackImageLoad(src: string | null | undefined) {
  const [loaded, setLoaded] = useState(() => isPosterLoaded(src));

  useEffect(() => {
    setLoaded(isPosterLoaded(src));
  }, [src]);

  return {
    loaded,
    onLoad: () => {
      markPosterLoaded(src);
      setLoaded(true);
    },
    onError: () => setLoaded(true),
  };
}

/**
 * Self-contained "has this image finished loading" tracker for call sites that
 * render their own <img> or CSS `background-image` (so they can't just wire an
 * `onLoad` handler onto a `<PosterImage>`-rendered element). Preloads the URL
 * via a plain `Image()` and shares the same `loadedUrls` cache as `PosterImage`
 * / `useTrackImageLoad`, so a poster already seen elsewhere in the feed shows
 * instantly instead of flashing its skeleton again.
 */
export function useImageLoaded(src: string | null | undefined): boolean {
  const [loaded, setLoaded] = useState(() => isPosterLoaded(src));

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      return;
    }
    if (loadedUrls.has(src)) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      loadedUrls.add(src);
      setLoaded(true);
    };
    img.onerror = () => {
      if (!cancelled) setLoaded(true);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return loaded;
}

export function PosterImage({
  src,
  alt = "",
  className,
  imgClassName,
  style,
  eager = false,
  objectPosition,
  fallbackIcon,
}: {
  src: string | null | undefined;
  alt?: string;
  /** Classes for the outer (positioned) wrapper — expected to be `relative`/`absolute` sized by the caller. */
  className?: string;
  /** Extra classes applied to the <img> itself, appended after the default sizing classes. */
  imgClassName?: string;
  style?: CSSProperties;
  /** Skip lazy-loading for above-the-fold images (e.g. the first row of a grid). */
  eager?: boolean;
  objectPosition?: string;
  fallbackIcon?: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(() => !!src && loadedUrls.has(src));
  const imgRef = useRef<HTMLImageElement>(null);

  // If the src changes (e.g. card recycled in a virtualized list) re-check the cache.
  useEffect(() => {
    if (src && loadedUrls.has(src)) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    // Handles the case where the browser served the image from its own cache
    // faster than React could attach the onLoad handler.
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      if (src) loadedUrls.add(src);
      setLoaded(true);
    }
  }, [src]);

  if (!src) {
    return (
      <div className={cn("absolute inset-0 flex items-center justify-center bg-secondary", className)} style={style}>
        {fallbackIcon ?? <Film className="w-5 h-5 text-muted-foreground/40" />}
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-secondary", className)} style={style}>
      {/* Skeleton placeholder — visible until the real image finishes loading. */}
      <div
        className={cn("absolute inset-0 bg-secondary animate-pulse transition-opacity duration-300", loaded && "opacity-0 pointer-events-none")}
      />
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => { loadedUrls.add(src); setLoaded(true); }}
        onError={() => setLoaded(true)}
        className={cn(
          "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
        style={objectPosition ? { objectPosition } : undefined}
      />
    </div>
  );
}
