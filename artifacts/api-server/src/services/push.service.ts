import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"];
const PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"];
const SUBJECT = process.env["VAPID_SUBJECT"] ?? "mailto:admin@ticker.app";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return PUBLIC_KEY ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
};

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  return sendPushToUsers([userId], payload);
}

// High urgency + a 24h TTL so mobile push services (FCM/APNs) wake the
// device immediately instead of batching the notification until the
// next time the app is foregrounded. Without this, notifications often
// only appear when the user opens the app — exactly the bug we hit.
const SEND_OPTS = { TTL: 60 * 60 * 24, urgency: "high" as const };

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.log("[push] skipped: VAPID not configured");
    return;
  }
  if (userIds.length === 0) return;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(and(inArray(pushSubscriptionsTable.userId, userIds), eq(pushSubscriptionsTable.enabled, true)));
  console.log(`[push] sending to ${subs.length} subs for ${userIds.length} users (tag=${payload.tag ?? "none"})`);
  if (subs.length === 0) return;
  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      const result = await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
        SEND_OPTS,
      );
      console.log(`[push] OK sub=${s.id.slice(0, 8)} status=${result.statusCode} endpoint=${s.endpoint.slice(0, 60)}`);
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      const body = (err as { body?: string })?.body;
      console.log(`[push] FAIL sub=${s.id.slice(0, 8)} status=${code} body=${body?.slice(0, 200)} endpoint=${s.endpoint.slice(0, 60)}`);
      if (code === 404 || code === 410) {
        try {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id));
        } catch { /* ignore */ }
      }
    }
  }));
}

export async function sendPushToAll(payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.enabled, true));
  if (subs.length === 0) return 0;
  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
        SEND_OPTS,
      );
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        try {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id));
        } catch { /* ignore */ }
      }
    }
  }));
  return subs.length;
}
