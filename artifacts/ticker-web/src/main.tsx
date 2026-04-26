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
