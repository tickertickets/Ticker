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

// Disable browser's native scroll restoration so our SPA scroll logic is in full control
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

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

// ── Service Worker update → auto-reload ─────────────────────────────────────
// When a SW update replaces the old active controller, every open tab receives
// a "controllerchange" event. We reload so users transparently pick up the new
// SW and its updated caches without having to close and reopen the app.
//
// IMPORTANT: controllerchange fires in TWO distinct situations:
//
//   A) First-time control — the SW activates and calls clients.claim() on a
//      page that had no previous controller (navigator.serviceWorker.controller
//      was null at page load). This happens for new users and users who cleared
//      their browser cache.
//
//   B) SW update — a new SW version replaces the previous one. The controller
//      changes from SW_v1 to SW_v2 while the page is open.
//
// We must NOT reload in case A. Reloading there creates a race condition that
// interrupts push-notification setup: enablePushNotifications() awaits
// navigator.serviceWorker.ready (which resolves as soon as the SW enters
// "activating"), then calls pushManager.subscribe(). If clients.claim() fires
// controllerchange and we reload during subscribe(), the subscription is lost
// and the user sees "Service Worker not ready" on their next attempt because
// the 8-second timeout fires before the reloaded page's SW re-stabilises.
//
// Capturing `hadController` at module parse time (before any async activity)
// correctly distinguishes A from B: if the page loaded without a controller,
// the upcoming controllerchange is first-time control (skip reload); if a
// controller already existed, it is an update (do reload).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;

  // Register the SW manually.  vite-plugin-pwa is set to injectRegister:null so
  // it does NOT generate any inline registration code — that code unconditionally
  // called window.location.reload() on every controllerchange event (including
  // first-time control for new users), which interrupted push-subscription setup
  // mid-flight and caused the "Service Worker not ready" error.  By registering
  // here we keep the hadController guard as the single source of truth.
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    console.warn("[app] SW registration failed — push notifications unavailable");
  });

  let swUpdateReloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Skip reload for first-time SW control (case A above).
    if (!hadController) return;
    if (swUpdateReloading) return;
    swUpdateReloading = true;
    console.log("[app] SW controller changed — reloading to apply update");
    window.location.reload();
  });

  // Force the browser to check for a new SW version immediately on page load.
  // Without this, the browser may wait up to 24 hours before checking.
  // navigator.serviceWorker.ready resolves to the currently-active SW
  // registration; calling update() on it triggers a background fetch of the
  // SW script and, if it changed, begins the install→wait→activate cycle.
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => { /* ignore — best-effort */ });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
