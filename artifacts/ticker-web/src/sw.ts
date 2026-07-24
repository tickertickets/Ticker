/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope;

// ── Install: skip waiting immediately ────────────────────────────────────────
// skipWaiting() activates the new SW as soon as it finishes installing,
// without waiting for existing tabs to close. This is safe here because
// activate no longer force-reloads open tabs (which was the behavior that
// made unconditional skipWaiting risky for active sessions). For brand-new
// users there is no competing SW, so skipWaiting is always a no-op; for
// returning users it means they pick up cache/strategy updates sooner.
self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── Activate: purge ALL legacy TMDB SW caches + claim ────────────────────────
//
// History of the TMDB cache-poisoning bug (why we no longer cache TMDB images
// in the SW at all — and why we still need to clean up the old caches here):
//
//   v0–v2  CacheFirst + statuses:[0, 200]  → stored opaque (status:0) fetch
//          failures as valid images (cache poisoning). Broken black rectangles.
//
//   v3     NetworkFirst but still [0, 200] → same poisoning risk, just rarer.
//
//   v4     NetworkFirst + [200] only       → correct config, but an emergency
//          fix briefly deployed v4 with the old [0, 200] plugin first, leaving
//          some devices with poisoned entries under the v4 name.
//
//   v5     NetworkFirst + [200] only       → still broke images for users who
//          had cleared their cache: cross-origin <img> requests arrive at the
//          SW as no-cors mode → opaque response (status 0) → CacheableResponse
//          plugin rejects caching (0 ∉ [200]) → in some paths Workbox fails to
//          return the opaque response cleanly → broken images.
//
//   Final decision: stop intercepting TMDB image requests in the SW entirely.
//          TMDB's CDN sends Cache-Control: max-age=604800 (7 days), so the
//          browser's native HTTP cache handles images perfectly without any SW
//          involvement. This eliminates all opaque-response edge-cases.
//
//   This activate handler's only remaining job for TMDB: purge every old
//   tmdb-images-cache-* entry so poisoned SW caches from v0–v5 can't linger.
//   New TMDB requests bypass the SW entirely (no matching route registered).
//
// clients.claim() — adopt all open tabs immediately. We no longer call
// WindowClient.navigate() here because that reload interrupted push-
// subscription setup for users who cleared their cache.
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil((async () => {
    // Delete ALL tmdb-images-cache-* entries unconditionally.
    // No version is kept — the SW no longer caches TMDB images at all.
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(n => n.startsWith("tmdb-images-cache"))
        .map(n => {
          console.log("[sw] purging legacy TMDB SW cache:", n);
          return caches.delete(n);
        }),
    );

    // Adopt all open tabs without reloading them.
    await self.clients.claim();
  })());
});

// SPA navigation fallback to index.html — except API routes.
const navHandler = createHandlerBoundToURL("index.html");
registerRoute(
  new NavigationRoute(navHandler, {
    denylist: [/^\/api\//, /^\/sitemap\.xml$/, /^\/robots\.txt$/],
  }),
);

// Runtime caches
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new CacheFirst({
    cacheName: "google-fonts-cache",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "gstatic-fonts-cache",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);
// NOTE: TMDB image requests (https://image.tmdb.org) are intentionally NOT
// intercepted by this SW. The browser's native HTTP cache handles them using
// TMDB CDN's own Cache-Control: max-age=604800 headers (7-day TTL).
//
// We previously tried SW-level caching (CacheFirst → NetworkFirst, v0–v5) but
// every approach hit the same wall: cross-origin <img> requests arrive at the
// SW as no-cors mode, producing opaque responses (status: 0). CacheableResponse
// with statuses:[200] correctly rejects caching them, but some Workbox code
// paths then fail to pass the opaque response back to the browser cleanly,
// showing broken images for users with an empty SW cache (e.g. after clearing
// site data). Removing the route entirely is the simplest and most reliable fix.

// ── Push notifications ────────────────────────────────────────────────

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

// Browsers (Chrome especially on Android) periodically rotate the FCM
// endpoint behind a PushSubscription — after long sleep, storage cleanup,
// or when the user clears site data. When that happens the OLD endpoint
// stored on our server starts returning 410 Gone and notifications stop
// arriving until the user opens the app and the foreground re-sync runs.
//
// This handler catches the rotation as it happens (no app open required),
// re-subscribes with the same VAPID key, and tells the server to swap the
// row over to the fresh endpoint. The result: notifications keep flowing
// even when the device hasn't seen the app for days.
self.addEventListener("pushsubscriptionchange", ((event: Event) => {
  const e = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };
  e.waitUntil((async () => {
    try {
      const oldEndpoint = e.oldSubscription?.endpoint ?? null;

      let newSub = e.newSubscription ?? null;
      if (!newSub) {
        const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
        if (!keyRes.ok) return;
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;
        newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = newSub.toJSON();
      await fetch("/api/push/refresh", { credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldEndpoint,
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });
      console.log("[sw] pushsubscriptionchange resynced");
    } catch (err) {
      console.log("[sw] pushsubscriptionchange failed", err);
    }
  })());
}) as EventListener);

type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
};

self.addEventListener("push", (event: PushEvent) => {
  let data: PushPayload = {};
  let raw = "";
  try {
    raw = event.data ? event.data.text() : "";
    data = raw ? (JSON.parse(raw) as PushPayload) : {};
  } catch {
    data = { title: "Ticker", body: raw };
  }
  const title = data.title || "Ticker";
  const body  = data.body  || "";
  const url   = data.url   || "/";
  const tag   = data.tag   || "ticker";
  // Android OS (when Chrome is closed) cannot render SVG notification icons —
  // always use PNG so the system notification appears even in the background.
  const icon  = data.icon  || "/icon-192.png";

  // Visible diagnostic in DevTools → Application → Service Workers → console
  console.log("[sw push]", { title, body, tag, url, icon, raw });

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/notification-badge.svg",
      tag,
      data: { url },
      requireInteraction: true,
      renotify: true,
      vibrate: [200, 100, 200],
    } as NotificationOptions),
  );
});

// Unified message handler — handles all messages from the main thread.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; tag?: string } | null;
  if (!data) return;

  // vite-plugin-pwa autoUpdate sends this when a new SW version is waiting.
  // We respond here (on request) instead of calling self.skipWaiting() at the
  // top level unconditionally, which would activate mid-session and cause
  // Chrome Android to flash the address bar in standalone PWA mode.
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  // Allow the page to dismiss notifications it has handled (e.g. when the
  // user opens a chat thread, the corresponding push should disappear).
  if (data.type === "clear-notifications" && data.tag) {
    event.waitUntil(
      self.registration.getNotifications({ tag: data.tag }).then((list) => {
        list.forEach((n) => n.close());
      }),
    );
  }
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          const client = c as WindowClient;
          // Only call navigate() if the app isn't already at the target URL.
          // Calling navigate() unconditionally — even to the same URL — can
          // trigger a brief address bar flash in Chrome Android PWA standalone
          // mode because the browser treats it as a navigation event.
          try {
            const targetPath = new URL(targetUrl, self.location.origin).pathname;
            const clientPath = new URL(client.url).pathname;
            if (clientPath !== targetPath) {
              client.navigate(targetUrl);
            }
          } catch { /* ignore */ }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
