import { useEffect, useLayoutEffect, useRef } from "react";
import { scrollStore, scrollNoSave } from "@/lib/scroll-store";

/**
 * usePageScroll — เก็บและกู้คืน scroll position ระดับหน้า
 *
 * ใช้ ResizeObserver-based retry เพื่อรองรับกรณีที่ content โหลดหลัง mount
 * (เช่น PersonDetail / CharacterDetail ที่ staleTime: 0)
 * และรองรับการกู้คืน scroll position ที่ถูกต้องแม้ content ยังไม่ full height
 *
 * Post-animation re-verify (at 400 ms) catches the case where an iOS device
 * externally resets overflow-scroll positions while a CSS transform animation
 * (slide-in-from-right) plays on an ancestor — the 400 ms window covers the
 * 300 ms entrance animation plus a small safety margin.
 *
 * hideUntilRestored: when true and there is a saved position to restore (target > 0),
 * the element is hidden (visibility: hidden) until the scroll position is applied.
 * This prevents the user from seeing the jerk where the page starts at top then
 * jumps to the saved position as content loads.  The element is always shown after
 * 1000 ms at the latest (safety fallback).
 */
export function usePageScroll(key: string, options?: { hideUntilRestored?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  // useLayoutEffect: set the initial scroll position BEFORE the browser paints,
  // eliminating the visible flash where the page renders at scrollTop=0 then
  // jumps to the restored position after a regular useEffect fires.
  // This is the primary fix for the "starts at top, snaps to position" jitter.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = scrollStore.get(keyRef.current) ?? 0;
    if (options?.hideUntilRestored && target > 0) {
      el.style.visibility = "hidden";
    }
    el.scrollTop = target;
  }, []); // mount-only — one shot before first visible frame

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const k = keyRef.current;
    const target = scrollStore.get(k) ?? 0;
    let lastScrollTop = target;
    let restorationDone = target <= 0;
    let lastProgrammatic = 0;
    let visibilityCleared = target <= 0;

    const clearVisibility = () => {
      if (!visibilityCleared) {
        visibilityCleared = true;
        el.style.visibility = "";
      }
    };

    // Ensure scrollTop is at the right position even if useLayoutEffect's
    // synchronous set didn't stick (e.g. content not yet tall enough).
    if (target <= 0) {
      el.scrollTop = 0;
    }

    // Track whether the user has actually touched/scrolled this element with
    // a real input device. Content loading in below the fold (async data,
    // images) can shift layout and fire native "scroll" events (e.g. browser
    // scroll-anchoring) even though the user never touched anything — those
    // synthetic events must NOT be treated as "user scrolled, abort
    // restoration", or restoration silently and unpredictably gives up
    // (observed as: sometimes it self-corrects, sometimes it doesn't).
    let userInteracted = false;
    const markUserInteracted = () => { userInteracted = true; };
    el.addEventListener("wheel", markUserInteracted, { passive: true });
    el.addEventListener("touchmove", markUserInteracted, { passive: true });
    el.addEventListener("pointerdown", markUserInteracted, { passive: true });

    // ResizeObserver-based retry: re-attempt scroll whenever scrollHeight grows
    // (images, data, etc. arriving after first render)
    const attempt = () => {
      if (restorationDone) return;
      if (!el.isConnected) return;
      if (el.scrollHeight < target + el.clientHeight * 0.5) return;
      lastProgrammatic = Date.now();
      el.scrollTop = target;
      if (el.scrollTop >= target - 5) {
        restorationDone = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
        clearVisibility();
      }
    };

    // If the user genuinely scrolls (real wheel/touch/pointer input) before
    // restoration finishes, abort — respect their manual scroll. Layout-shift
    // driven scroll events (no real input recorded) are ignored so a slow
    // list loading in doesn't accidentally cancel restoration.
    const onUserScroll = () => {
      if (userInteracted && Date.now() - lastProgrammatic > 50 && !restorationDone) {
        restorationDone = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
        clearVisibility();
      }
    };

    const ro = new ResizeObserver(attempt);

    if (!restorationDone) {
      // Observe the CONTENT child (not the container) so ResizeObserver fires
      // when inner data loads and the content grows taller.  The scroll container
      // itself has a fixed height from CSS layout and its size never changes, so
      // observing it directly means ResizeObserver never fires on content load —
      // leaving scroll restoration to rely only on the coarse timed retries.
      const contentChild = el.firstElementChild;
      ro.observe(contentChild ?? el);
      el.addEventListener("scroll", onUserScroll, { passive: true });
      // Try immediately, then at increasing intervals to cover slower network
      // responses (e.g. sequential/dependent queries) without giving up early.
      requestAnimationFrame(attempt);
      const t1 = setTimeout(attempt, 100);
      const t2 = setTimeout(attempt, 500);
      const t3 = setTimeout(attempt, 1500);
      const t5 = setTimeout(attempt, 3000);
      const t6 = setTimeout(() => {
        attempt();
        restorationDone = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
        clearVisibility();
      }, 4500);

      // Post-animation re-verify: iOS may externally reset the scroll position
      // while a CSS transform animation plays on an ancestor (300 ms slide-in).
      // At 400 ms the animation is complete — if our position was reset, restore
      // it one more time (restorationDone is cleared so attempt() can re-run).
      const t4 = setTimeout(() => {
        if (target > 0 && Math.abs(el.scrollTop - target) > 10) {
          // Position was reset externally — un-flag and retry
          restorationDone = false;
          lastProgrammatic = Date.now();
          el.scrollTop = target;
          if (el.scrollTop >= target - 5) {
            restorationDone = true;
            ro.disconnect();
            el.removeEventListener("scroll", onUserScroll);
            clearVisibility();
          }
        }
      }, 400);

      // Safety fallback: always make the element visible eventually regardless
      // of whether restoration succeeded, so it never gets stuck invisible if
      // data never loads or the target can't be reached. Long enough to cover
      // slow/sequential data fetches; attempt() keeps retrying up to t6 above
      // so the position is very likely already correct by the time this fires.
      const tShow = setTimeout(clearVisibility, 4500);

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      t1; t2; t3; t4; t5; t6; tShow;
    }

    const onScroll = () => {
      lastScrollTop = el.scrollTop;
      scrollStore.set(keyRef.current, lastScrollTop);
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      restorationDone = true;
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scroll", onUserScroll);
      el.removeEventListener("wheel", markUserInteracted);
      el.removeEventListener("touchmove", markUserInteracted);
      el.removeEventListener("pointerdown", markUserInteracted);
      clearVisibility(); // ensure visible on unmount
      const k = keyRef.current;
      if (scrollNoSave.has(k)) {
        scrollStore.delete(k);
        scrollNoSave.delete(k);
      } else {
        scrollStore.set(k, lastScrollTop);
      }
    };
  }, []); // mount/unmount only — key is stable per element

  return ref;
}
