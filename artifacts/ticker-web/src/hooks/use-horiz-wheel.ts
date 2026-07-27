import { useEffect } from "react";

/**
 * Translates vertical mouse-wheel events into horizontal scrolling for desktop
 * users who only have a scroll wheel (no trackpad horizontal swipe).
 *
 * Pass any `useRef` pointing at a horizontally-scrollable container.
 * The listener uses `{ passive: false }` so `preventDefault()` can block
 * the page from scrolling vertically while the user wheels over a shelf.
 *
 * Works correctly for CONDITIONALLY RENDERED containers (search overlay,
 * profile tab panels, etc.): if the element isn't mounted yet when this
 * hook runs, it polls via requestAnimationFrame until it appears, then
 * binds once and stays bound until unmount — no per-render rebinding.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useHorizWheel(ref);
 *   return <div ref={ref} className="overflow-x-auto scrollbar-hide">…</div>
 *
 * Or pass an existing ref:
 *   useHorizWheel(pillContainerRef);
 */
export function useHorizWheel(ref: React.RefObject<HTMLElement | null>) {
  // Runs exactly once per mount (empty deps) instead of re-binding on every
  // render. The previous implementation had no dependency array, so React
  // tore down and re-added the "wheel" listener on *every* render of every
  // component using this hook — with several shelves mounted at once (mood
  // categories, pill rows, etc.) that constant add/remove churn was a real
  // contributor to scroll jank. Late-mounted elements (behind conditional
  // rendering) are handled by polling for `ref.current` via rAF for a short
  // window after mount, then binding once and staying bound until unmount.
  useEffect(() => {
    let el: HTMLElement | null = null;
    let rafId: number | null = null;

    function onWheel(e: WheelEvent) {
      if (e.deltaX !== 0) return;               // trackpad already scrolling horizontally
      if (el!.scrollWidth <= el!.clientWidth) return; // container fits — nothing to do
      e.preventDefault();
      el!.scrollLeft += e.deltaY * 0.85;
    }

    function tryBind() {
      if (ref.current) {
        el = ref.current;
        el.addEventListener("wheel", onWheel, { passive: false });
        return;
      }
      rafId = requestAnimationFrame(tryBind);
    }
    tryBind();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (el) el.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
}
