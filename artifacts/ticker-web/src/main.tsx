import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource-variable/dm-sans/wght-italic.css";
import "@fontsource-variable/space-grotesk/wght.css";
import { applyTheme, getTheme } from "@/lib/theme";
import { initPerfProbe } from "@/lib/perf-probe";

applyTheme(getTheme());
initPerfProbe();

// ── Safe-area-inset-bottom fix ──────────────────────────────────────────────
// On Android Chrome and PWA, env(safe-area-inset-bottom) can return 0 on the
// first paint after a hard redirect (e.g. after login). Reading the value via
// a measured element and storing it as --sab forces a reliable pixel value
// that survives hard navigations.
(function initSafeArea() {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;z-index:-1";
  document.documentElement.appendChild(el);
  function update() {
    const h = el.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--sab", `${h}px`);
  }
  update();
  requestAnimationFrame(update);
  setTimeout(update, 150);
  setTimeout(update, 600);
  window.addEventListener("resize", update, { passive: true });
})();

// Suppress browser-extension errors from Vite's error overlay.
// Extensions like Firefox Reader, MetaMask, DarkReader inject their own globals
// and throw errors that have nothing to do with this app.
if (import.meta.env.DEV) {
  const EXTENSION_PATTERNS = [
    "__firefox__",
    "window.ethereum",
    "DarkReader",
    "chrome-extension://",
    "moz-extension://",
    "safari-extension://",
    "playlistLongPressed",
  ];
  const isExtensionError = (msg: string | null | undefined) =>
    EXTENSION_PATTERNS.some((p) => msg?.includes(p));

  window.addEventListener(
    "error",
    (e) => {
      if (isExtensionError(e.message) || isExtensionError(e.filename)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (e) => {
      const msg = String(e.reason?.message ?? e.reason ?? "");
      if (isExtensionError(msg)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

// Block ALL browser native context menus site-wide (long-press on links, images, text)
document.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { capture: true });

createRoot(document.getElementById("root")!).render(<App />);
