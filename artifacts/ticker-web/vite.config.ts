import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Injects a tiny inline script at the very top of <head> — before any other
 * script — so that errors thrown by browser extensions (Firefox Reader,
 * MetaMask, DarkReader, …) are swallowed before Vite's runtime-error overlay
 * ever sees them.
 *
 * Heuristics used (both must match for suppression):
 *   1. error.stack is empty / null  — real app errors always have a stack.
 *   2. One of the known extension keywords appears in the message or filename.
 *
 * Rule 1 alone would be too aggressive; rule 2 alone misses "(unknown runtime
 * error)" messages.  Together they are precise.
 */
function sitemapNoindex(): Plugin {
  return {
    name: "sitemap-noindex",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/sitemap.xml" || req.url?.startsWith("/sitemap.xml?")) {
          res.setHeader("X-Robots-Tag", "noindex");
        }
        next();
      });
    },
  };
}

function suppressExtensionErrors(): Plugin {
  const script = /* js */ `(function () {
  var P = ['__firefox__','ethereum','DarkReader','chrome-extension','moz-extension','safari-extension','playlistLongPressed'];
  function ext(s) { return P.some(function(p){ return s && s.indexOf(p) !== -1; }); }
  function drop(e) {
    var msg = e.message || '';
    var file = e.filename || '';
    var stack = (e.error && e.error.stack) || '';
    if (ext(msg) || ext(file) || (!stack && (ext(msg) || !msg || msg === '(unknown runtime error)'))) {
      e.stopImmediatePropagation(); e.preventDefault();
    }
  }
  function dropRej(e) {
    var msg = String((e.reason && e.reason.message) || e.reason || '');
    if (ext(msg)) { e.stopImmediatePropagation(); e.preventDefault(); }
  }
  window.addEventListener('error', drop, true);
  window.addEventListener('unhandledrejection', dropRej, true);
})();`;

  return {
    name: "suppress-extension-errors",
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: script,
        },
      ],
    },
  };
}

const rawPort = process.env.PORT || "5173";
const port = Number(rawPort);

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  publicDir: path.resolve(import.meta.dirname, "static"),
  plugins: [
    sitemapNoindex(),
    suppressExtensionErrors(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      includeAssets: [
        "favicon.svg",
        "icon.svg",
        "notification-badge.svg",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
      ],
      manifest: {
        name: "Ticker — Movie Social Platform",
        short_name: "Ticker",
        description: "Log the films you love as Tickets, build Chains with friends, and discover what's worth watching next. Your movie world on Ticker.",
        theme_color: "#000000",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        prefer_related_applications: false,
        // Raster PNGs are required for cross-platform install: iOS uses
        // apple-touch-icon (linked in index.html) but Android Chrome needs
        // these PNG sizes in the manifest before "Add to Home Screen" will
        // create a true standalone PWA shortcut. The SVG entry stays as a
        // fallback for browsers that prefer scalable icons.
        icons: [
          { src: "icon-192.png",  sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png",  sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png",  sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg",      sizes: "any",     type: "image/svg+xml", purpose: "any" },
        ],
        categories: ["entertainment", "social"],
      },
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "public"),
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "SOURCEMAP_ERROR" ||
          (warning.message && warning.message.includes("Can't resolve original location of error"))
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        // Explicit chunk splitting so the browser can cache vendor code
        // independently from application code.
        manualChunks(id) {
          // TanStack Query — infrequent updates, large
          if (id.includes("node_modules/@tanstack")) {
            return "tanstack";
          }
          // Framer Motion — animation library, large
          if (id.includes("node_modules/framer-motion")) {
            return "framer-motion";
          }
          // Radix UI primitives (Shadcn base)
          if (id.includes("node_modules/@radix-ui")) {
            return "radix";
          }
          // Lucide icons
          if (id.includes("node_modules/lucide-react")) {
            return "lucide";
          }
          // Routing
          if (id.includes("node_modules/wouter")) {
            return "router";
          }
          // Zod
          if (id.includes("node_modules/zod")) {
            return "zod";
          }
          // Everything else in node_modules → shared vendor chunk (includes React)
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target:
          process.env.API_PROXY_TARGET ||
          "http://localhost:8080",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target:
          process.env.API_PROXY_TARGET ||
          "http://localhost:8080",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
