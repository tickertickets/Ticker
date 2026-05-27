import { useEffect, useRef } from "react";
import { scrollStore, scrollNoSave } from "@/lib/scroll-store";

/**
 * usePageScroll — เก็บและกู้คืน scroll position ระดับหน้า
 *
 * ใช้ ResizeObserver-based retry เพื่อรองรับกรณีที่ content โหลดหลัง mount
 * (เช่น PersonDetail / CharacterDetail ที่ staleTime: 0)
 * และรองรับการกู้คืน scroll position ที่ถูกต้องแม้ content ยังไม่ full height
 */
export function usePageScroll(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const k = keyRef.current;
    const target = scrollStore.get(k) ?? 0;
    let lastScrollTop = target;
    let restorationDone = target <= 0;
    let lastProgrammatic = 0;

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
      }
    };

    // If the user scrolls manually before restoration finishes, abort
    const onUserScroll = () => {
      if (Date.now() - lastProgrammatic > 50 && !restorationDone) {
        restorationDone = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
      }
    };

    const ro = new ResizeObserver(attempt);

    if (!restorationDone) {
      ro.observe(el);
      el.addEventListener("scroll", onUserScroll, { passive: true });
      // Try immediately, then after content has had time to render
      requestAnimationFrame(attempt);
      const t1 = setTimeout(attempt, 100);
      const t2 = setTimeout(() => {
        attempt();
        restorationDone = true;
        ro.disconnect();
        el.removeEventListener("scroll", onUserScroll);
      }, 800);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      t1; t2; // keep references alive
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
