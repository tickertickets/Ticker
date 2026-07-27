import { db } from "@workspace/db";
import { notificationsTable, usersTable, followsTable, notifSubscriptionsTable, type InsertNotification } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { emitNotificationNew } from "../lib/socket";
import { sendPushToUser, sendPushToUsers, type PushPayload } from "./push.service";
import { getUserLang, getUserLangs, pushTitleFor, pushBodyFor, newPostPushFor } from "../lib/notif-i18n";

const APP_BASE_URL = process.env["APP_BASE_URL"] ?? "/";

// ── Push burst throttle ──────────────────────────────────────────────────
// Chrome/Safe-Browsing flags sites that send a high volume of push
// notifications as "abusive notifications", which is what triggers the
// browser's "dangerous/spam site" warning banners. A single popular ticket
// getting liked by many people within a few seconds used to fire one push
// per like. We still record every notification in-app (bell/DB row is never
// skipped), but we now collapse repeated pushes of the same kind to the same
// user within a short window into a single push — the in-app list still
// shows everything when they open the app.
const PUSH_COOLDOWN_MS = 20_000;
const lastPushSentAt = new Map<string, number>();

function pushCooldownKey(userId: string, tag: string): string {
  return `${userId}::${tag}`;
}

function isPushOnCooldown(userId: string, tag: string): boolean {
  const key = pushCooldownKey(userId, tag);
  const now = Date.now();
  const last = lastPushSentAt.get(key);
  if (last && now - last < PUSH_COOLDOWN_MS) return true;
  lastPushSentAt.set(key, now);
  // Opportunistic cleanup so the map doesn't grow unbounded over a long
  // process lifetime.
  if (lastPushSentAt.size > 5000) {
    for (const [k, t] of lastPushSentAt) {
      if (now - t > PUSH_COOLDOWN_MS) lastPushSentAt.delete(k);
    }
  }
  return false;
}

function buildPushUrl(payload: InsertNotification): string {
  if (payload.ticketId) return `${APP_BASE_URL}ticket/${payload.ticketId}`;
  if (payload.chainId) return `${APP_BASE_URL}chain/${payload.chainId}`;
  if (payload.type === "follow" || payload.type === "follow_request") return `${APP_BASE_URL}notifications`;
  return `${APP_BASE_URL}notifications`;
}

/**
 * Insert a notification row, emit a socket event, and send a web-push.
 * All steps are best-effort and won't throw to callers.
 */
export async function createNotification(payload: InsertNotification): Promise<void> {
  // The DB insert MUST be committed before any subsequent push/socket work so
  // that a push failure (or any error below this line) can NEVER cause the
  // in-app notification row to be missing.  It is wrapped in its own try/catch
  // so that: (a) the caller's per-invitee loop never has to deal with a throw
  // from here, and (b) push/socket steps are attempted even when the insert
  // itself fails (best-effort logging only in that case).
  try {
    await db.insert(notificationsTable).values(payload);
  } catch (err) {
    console.error(`[notify] notification insert failed for user ${payload.userId} (type ${payload.type}):`, err);
    // Do NOT proceed to push if the DB row was never committed — the caller
    // already has its own per-invitee catch block for broader failures.
    return;
  }

  try { emitNotificationNew(payload.userId); } catch { /* ignore */ }

  // Look up sender name + avatar for push title/icon
  let displayName: string | null = null;
  let username: string | null = null;
  let avatarUrl: string | null = null;
  if (payload.fromUserId) {
    try {
      const [from] = await db.select({
        displayName: usersTable.displayName,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      }).from(usersTable).where(eq(usersTable.id, payload.fromUserId)).limit(1);
      displayName = from?.displayName ?? null;
      username = from?.username ?? null;
      avatarUrl = from?.avatarUrl ?? null;
    } catch { /* ignore */ }
  }

  const recipientLang = await getUserLang(payload.userId);
  const senderName = displayName || (username ? `@${username}` : "Someone");
  const translatedBody = pushBodyFor({ lang: recipientLang, type: payload.type });

  const tag = `${payload.type}:${payload.fromUserId ?? payload.userId}:${payload.ticketId ?? payload.chainId ?? ""}`;
  const push: PushPayload = {
    title: pushTitleFor({ lang: recipientLang, type: payload.type, senderName }),
    // For known types use the translated body; for admin_message etc. keep DB prose.
    body: translatedBody ?? payload.message,
    url: buildPushUrl(payload),
    tag,
    icon: payload.type === "admin_message" ? undefined : (avatarUrl ?? undefined),
  };
  // admin_message is a deliberate 1:1 broadcast from staff — never throttle it.
  if (payload.type !== "admin_message" && isPushOnCooldown(payload.userId, tag)) {
    return;
  }
  try { await sendPushToUser(payload.userId, push); } catch (err) {
    console.error(`[notify] push send failed for user ${payload.userId} (type ${payload.type}):`, err);
  }
}

/**
 * Push-only notification to users who explicitly subscribed (bell) to `authorId`
 * when they create a new non-private post.
 * Does NOT insert in-app notification rows (would spam the bell).
 * Uses tag `new_post:<authorId>` so the latest one collapses earlier ones.
 */
export async function notifyFollowersNewPost(opts: {
  authorId: string;
  kind: "ticket" | "chain";
  postId: string;
  movieTitle?: string | null;
  chainTitle?: string | null;
  posterUrl?: string | null;
}): Promise<void> {
  try {
    const { authorId, kind, postId, movieTitle, chainTitle } = opts;

    const [author] = await db.select({
      displayName: usersTable.displayName,
      username: usersTable.username,
    }).from(usersTable).where(eq(usersTable.id, authorId)).limit(1);
    if (!author) return;

    // Only send to users who explicitly subscribed (pressed bell), not all followers
    const subscribers = await db
      .select({ subscriberId: notifSubscriptionsTable.subscriberId })
      .from(notifSubscriptionsTable)
      .where(eq(notifSubscriptionsTable.targetUserId, authorId));
    const subscriberIds = subscribers.map((s) => s.subscriberId).filter((id): id is string => Boolean(id));
    if (subscriberIds.length === 0) return;

    const name = author.displayName || (author.username ? `@${author.username}` : "Someone");
    const url = kind === "ticket" ? `${APP_BASE_URL}ticket/${postId}` : `${APP_BASE_URL}chain/${postId}`;
    const icon = opts.posterUrl ?? undefined;

    const langMap = await getUserLangs(subscriberIds);
    const buckets = new Map<"th" | "en", string[]>();
    for (const sid of subscriberIds) {
      const lang = langMap.get(sid) ?? "en";
      const arr = buckets.get(lang) ?? [];
      arr.push(sid);
      buckets.set(lang, arr);
    }

    for (const [lang, ids] of buckets) {
      const { title, body } = newPostPushFor({ lang, kind, senderName: name, movieTitle, chainTitle });
      await sendPushToUsers(ids, { title, body, url, icon, tag: `new_post:${authorId}` });
    }
  } catch { /* best-effort */ }
}
