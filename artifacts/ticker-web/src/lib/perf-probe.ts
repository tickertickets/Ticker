/**
 * perf-probe — ตรวจว่าเครื่องของผู้ใช้ "อ่อนแรง" ไหม
 * ถ้าใช่ → ติด class "low-perf" บน <html>  เพื่อให้ CSS ปิด shimmer/sparkle
 *
 * เกณฑ์ตรวจ (ฮิตข้อใดข้อหนึ่งก็พอ):
 *   1) `prefers-reduced-motion: reduce`
 *   2) `navigator.hardwareConcurrency` <= 4 cores
 *   3) `navigator.deviceMemory` <= 2 GB
 *   4) FPS probe: 30 frames แรกได้เฉลี่ย < 45 fps
 *
 * ผู้ใช้ override ผ่าน localStorage["ticker:perf"] = "low" | "high" ได้
 */

const LOW_PERF_CLASS = "low-perf";
const STORAGE_KEY = "ticker:perf";

function setLowPerf(reason: string) {
  document.documentElement.classList.add(LOW_PERF_CLASS);
  if (import.meta.env.DEV) {
    console.info(`[perf-probe] low-perf mode → ${reason}`);
  }
}

export function initPerfProbe() {
  if (typeof window === "undefined") return;

  const override = (() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  })();

  if (override === "low")  { setLowPerf("user override"); return; }
  if (override === "high") { return; }

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    setLowPerf("prefers-reduced-motion"); return;
  }

  // cores <= 2 เท่านั้น — iOS Safari รายงาน 4 แม้บน A17 Pro
  // ถ้าใช้ <= 4 จะ false-positive ทุก iPhone → shimmer/sparkle หายหมด
  const cores = navigator.hardwareConcurrency ?? 8;
  if (cores > 0 && cores <= 2) { setLowPerf(`hardwareConcurrency=${cores}`); return; }

  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (mem > 0 && mem <= 2) { setLowPerf(`deviceMemory=${mem}`); return; }

  // FPS probe — วัดเวลา 30 frames แล้วคำนวณ fps เฉลี่ย
  let last = performance.now();
  let acc = 0;
  let n = 0;
  const target = 30;
  const probe = (now: number) => {
    const dt = now - last; last = now;
    if (dt > 0 && dt < 200) { acc += dt; n++; }
    if (n < target) {
      requestAnimationFrame(probe);
    } else {
      const avgFps = 1000 / (acc / n);
      if (avgFps < 45) setLowPerf(`fps=${avgFps.toFixed(1)}`);
    }
  };
  requestAnimationFrame(probe);
}
