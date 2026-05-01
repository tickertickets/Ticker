// Client helper for Web Push subscriptions.

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getSwRegistration();
  if (!reg) return null;
  return await reg.pushManager.getSubscription();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  // Permission
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = await withTimeout(getSwRegistration(), 8000, "sw_ready");
  } catch {
    return { ok: false, reason: "no_sw" };
  }
  if (!reg) return { ok: false, reason: "no_sw" };

  // Get VAPID public key
  let publicKey: string;
  try {
    const keyRes = await withTimeout(
      fetch("/api/push/vapid-public-key", { credentials: "include" }),
      8000,
      "vapid_fetch",
    );
    if (!keyRes.ok) return { ok: false, reason: "no_vapid" };
    const data = await keyRes.json();
    publicKey = data.publicKey;
    if (!publicKey) return { ok: false, reason: "no_vapid" };
  } catch {
    return { ok: false, reason: "no_vapid" };
  }

  // If an existing subscription was made with a *different* VAPID key
  // (e.g. dev vs prod), re-subscribing with a new key throws
  // InvalidStateError and the call can hang in some browsers. Force a
  // clean re-subscribe so prod always works after a key change.
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const existingKey = sub.options?.applicationServerKey;
    const targetBytes = urlBase64ToUint8Array(publicKey);
    const sameKey =
      existingKey instanceof ArrayBuffer &&
      new Uint8Array(existingKey).length === targetBytes.length &&
      new Uint8Array(existingKey).every((b, i) => b === targetBytes[i]);
    if (!sameKey) {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      sub = null;
    }
  }
  if (!sub) {
    try {
      sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        15000,
        "subscribe",
      );
    } catch {
      return { ok: false, reason: "subscribe_failed" };
    }
  }

  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  if (!res.ok) return { ok: false, reason: "server_error" };
  return { ok: true };
}

// Human-readable description of an enable failure for both languages.
export function describePushError(reason: string | undefined, lang: "th" | "en"): string {
  const th: Record<string, string> = {
    unsupported: "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน",
    denied: "เบราว์เซอร์บล็อกการแจ้งเตือน — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์",
    no_sw: "ยังโหลด Service Worker ไม่เสร็จ ลองรีเฟรชหน้าแล้วลองใหม่",
    no_vapid: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า VAPID — กรุณาแจ้งผู้ดูแลระบบ",
    subscribe_failed: "ลงทะเบียนแจ้งเตือนกับเบราว์เซอร์ไม่สำเร็จ",
    server_error: "บันทึกการแจ้งเตือนกับเซิร์ฟเวอร์ไม่สำเร็จ",
  };
  const en: Record<string, string> = {
    unsupported: "This browser does not support push notifications",
    denied: "Notifications are blocked — please allow them in browser settings",
    no_sw: "Service Worker is not ready — please refresh and try again",
    no_vapid: "Server is not configured for push (missing VAPID keys)",
    subscribe_failed: "Failed to register with the browser push service",
    server_error: "Failed to save subscription on the server",
  };
  const dict = lang === "th" ? th : en;
  return dict[reason ?? ""] ?? (lang === "th" ? "เปิดการแจ้งเตือนไม่สำเร็จ" : "Failed to enable notifications");
}

/**
 * Disable Ticker push for the *current* device on the server only.
 *
 * IMPORTANT: We deliberately do NOT call `subscription.unsubscribe()` here.
 * On Android Chrome an installed PWA shares its Service Worker registration
 * with the browser tab, so a single PushSubscription endpoint covers BOTH
 * surfaces. Calling `unsubscribe()` from the browser tab would silently kill
 * the PWA's notifications too, which is exactly the regression users have
 * reported. Removing the row server-side is enough to stop Ticker from
 * sending — the OS-level subscription stays intact and can be cleanly
 * re-bound the next time the user enables notifications.
 */
export async function disablePushNotifications(): Promise<void> {
  const reg = await getSwRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const endpoint = sub?.endpoint;
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch { /* ignore */ }
}

/**
 * Called right after a successful login. If this browser already has an
 * active PushSubscription (kept from a previous session — the OS-level
 * subscription persists across logout / account switches as long as the
 * Service Worker stays registered), re-binds it to the currently logged-in
 * user on the server.
 *
 * This both:
 *   1. Transfers ownership away from any previous account that was logged
 *      in on this device (the server's `subscribe` endpoint upserts by
 *      endpoint, so the existing row's userId gets overwritten), and
 *   2. Ensures the newly-logged-in user starts receiving notifications
 *      immediately, without having to manually toggle "Enable notifications"
 *      again in Settings — which is what users naturally expect.
 *
 * Silent and best-effort: never prompts for permission, never throws.
 */
export async function rebindPushSubscriptionToCurrentUser(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;
  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth },
      }),
    });
  } catch {
    /* ignore — best-effort */
  }
}

export async function getPushStatus(): Promise<{ enabled: boolean }> {
  if (!isPushSupported()) return { enabled: false };
  if (Notification.permission !== "granted") return { enabled: false };
  const sub = await getCurrentSubscription();
  if (!sub) return { enabled: false };
  try {
    const r = await fetch("/api/push/status", { credentials: "include" });
    if (!r.ok) return { enabled: false };
    const data = await r.json();
    return { enabled: !!data.enabled };
  } catch {
    return { enabled: false };
  }
}

// Synchronous local check — returns true if a browser-side subscription exists
// AND notification permission is granted. Used for optimistic UI before the
// server round-trip completes.
export async function hasLocalSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== "granted") return false;
  const sub = await getCurrentSubscription();
  return !!sub;
}
