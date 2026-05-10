import { useEffect, useRef } from "react";
import { scrollStore, scrollNoSave } from "@/lib/scroll-store";

/**
 * usePageScroll — เก็บและกู้คืน scroll position ระดับหน้า
 *
 * หลักการ:
 * - ใช้ key คงที่ต่อ element (key ห้ามเปลี่ยนระหว่างที่ component mounted)
 * - สำหรับ tabs ภายในหน้า ให้ใช้ CSS display toggle แทน (ดู home.tsx, search.tsx)
 * - restore ด้วย single RAF (content มาก่อน scroll event)
 * - save ทุกครั้งที่ scroll + cleanup unmount
 *
 * FIX: ใช้ lastScrollTop variable แทนการอ่าน el.scrollTop ตอน cleanup
 * เพราะ element อาจถูก detach ออกจาก DOM ก่อน cleanup จะรัน
 * ทำให้ el.scrollTop = 0 และ overwrite ค่าที่ถูกต้อง
 */
export function usePageScroll(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const k = keyRef.current;
    const saved = scrollStore.get(k) ?? 0;

    // Cache last known scrollTop in a closure variable — reading el.scrollTop
    // after the element is detached from the DOM returns 0 in many browsers,
    // which would overwrite a correctly-saved position in the cleanup function.
    let lastScrollTop = saved;

    let rafId = requestAnimationFrame(() => {
      if (el.isConnected && saved > 0) {
        el.scrollTop = saved;
        // Only update if the browser honored it — if clamped to 0,
        // keep lastScrollTop as `saved` so cleanup preserves the correct target.
        if (el.scrollTop > 0) lastScrollTop = el.scrollTop;
      }
    });

    const onScroll = () => {
      lastScrollTop = el.scrollTop;
      scrollStore.set(keyRef.current, lastScrollTop);
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
      const k = keyRef.current;
      if (scrollNoSave.has(k)) {
        // User explicitly navigated away — delete saved position so next entry starts at top.
        scrollStore.delete(k);
        scrollNoSave.delete(k);
      } else {
        // Use cached lastScrollTop — NOT el.scrollTop — because the element
        // may already be detached from the DOM when cleanup runs.
        scrollStore.set(k, lastScrollTop);
      }
    };
  }, []); // mount/unmount เท่านั้น — key คงที่ต่อ element

  return ref;
}
