import { RefObject, useEffect, useRef, useState } from "react";

/** Maximum visual pull distance in px (damped/rubber-band) */
const MAX_PULL = 72;
/** Damped pull distance that triggers a refresh in px */
const TRIGGER  = 48;

/**
 * usePullToRefresh
 *
 * Attaches a drag-down-to-refresh gesture to a scroll container ref.
 * The scroll container must have `overscroll-y-none` to suppress the
 * browser's native pull-to-refresh before ours fires.
 *
 * Visual feedback (pull distance) is applied via CSS custom properties
 * directly on the scroll element — no React re-render on every touchmove.
 * This keeps the drag buttery-smooth at 60 fps even on mid-range Android.
 *
 *   --ptr-y        current pull offset in px (0 … MAX_PULL)
 *   --ptr-progress current progress 0 … 1 (relative to TRIGGER threshold)
 *
 * Returns:
 *   isPulling  — true while the finger is actively dragging downward.
 *                Use to suppress "snap back" CSS transitions while pulling.
 *   pullY      — only ever 0 or TRIGGER (locked while refreshing).
 *                Drives the settled spinner height after release.
 *   progress   — same: 0 or 1. Useful for spinner rotation after snap.
 *
 * onRefresh must return a Promise that resolves when the refresh is done.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
  { disabled = false }: { disabled?: boolean } = {},
): { pullY: number; isPulling: boolean; progress: number } {
  // React state only flips at phase transitions (start / trigger / done),
  // never on individual touchmove pixels — those use direct CSS var writes.
  const [pullY, setPullY]         = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [progress, setProgress]   = useState(0);

  const startYRef      = useRef(0);
  const currentPullRef = useRef(0);
  const isPullingRef   = useRef(false);
  const refreshingRef  = useRef(false);

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; });

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    /** Write CSS vars on :root — zero React overhead, paints next frame.
     *  Set on documentElement (not the scroll element) so siblings like the
     *  spinner overlay, which live outside the scroll container in the DOM,
     *  can read the value via var(--ptr-y) / var(--ptr-progress). */
    const setCSSVars = (py: number) => {
      document.documentElement.style.setProperty("--ptr-y",        `${py}px`);
      document.documentElement.style.setProperty("--ptr-progress", String(Math.min(py / TRIGGER, 1)));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 2)      return;
      if (refreshingRef.current) return;
      startYRef.current      = e.touches[0].clientY;
      currentPullRef.current = 0;
      isPullingRef.current   = true;
      setIsPulling(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      // No e.preventDefault() needed: overscroll-y-none on the container already
      // prevents Chrome's native pull-to-refresh and scroll chaining, so we
      // don't need to block the event. Using a passive listener keeps every
      // touchmove frame off the critical input-handling path, eliminating the
      // frame-latency jank that made dragging feel stiff on mid-range Android.
      if (dy <= 0) {
        currentPullRef.current = 0;
        setCSSVars(0);   // direct DOM write — no React state
        return;
      }
      const base   = Math.sqrt(dy) * 4.2;
      const damped = base <= MAX_PULL ? base : MAX_PULL + (base - MAX_PULL) * 0.15;
      currentPullRef.current = damped;
      setCSSVars(damped);  // direct DOM write — no React state
    };

    const onTouchEnd = () => {
      if (!isPullingRef.current) return;
      isPullingRef.current = false;
      setIsPulling(false);
      const y = currentPullRef.current;
      currentPullRef.current = 0;

      if (y >= TRIGGER) {
        refreshingRef.current = true;
        setCSSVars(TRIGGER);
        setPullY(TRIGGER);
        setProgress(1);
        onRefreshRef.current().finally(() => {
          refreshingRef.current = false;
          setCSSVars(0);
          setPullY(0);
          setProgress(0);
        });
      } else {
        setCSSVars(0);
        // pullY is already 0 — no state update needed
      }
    };

    el.addEventListener("touchstart",  onTouchStart, { passive: true });
    el.addEventListener("touchmove",   onTouchMove,  { passive: true });
    el.addEventListener("touchend",    onTouchEnd,   { passive: true });
    el.addEventListener("touchcancel", onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ref, disabled]);

  return { pullY, isPulling, progress };
}
