/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope;

// Do NOT call self.skipWaiting() unconditionally here.
// Calling it at the top-level (during install) causes the new SW to activate
// mid-session and clients.claim() to take over all open tabs immediately —
// Chrome Android interprets this as an uncontrolled navigation and briefly
// shows the address bar in standalone PWA mode.
//
// Instead, only skip waiting when explicitly requested by the main thread
// (vite-plugin-pwa autoUpdate sends { type: "SKIP_WAITING" } when it detects
// a new version waiting). This defers activation until the next controlled
// page load, eliminating the mid-session address bar flash.
//
// clients.claim() is intentionally NOT called in the activate event.
// Even with on-demand skipWaiting(), calling clients.claim() on activate
// still causes Chrome Android to flash the address bar in standalone PWA mode
// because it signals a controller change on the live page. The new SW will
// naturally control all future page opens without needing to claim mid-session.

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

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
registerRoute(
  ({ url }) => url.origin === "https://image.tmdb.org",
  new CacheFirst({
    cacheName: "tmdb-images-cache",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

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
        const keyRes = await fetch("/api/push/vapid-public-key");
        if (!keyRes.ok) return;
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;
        newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = newSub.toJSON();
      await fetch("/api/push/refresh", {
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
