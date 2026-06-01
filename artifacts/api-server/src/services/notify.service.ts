import { db } from "@workspace/db";
import { notificationsTable, usersTable, followsTable, notifSubscriptionsTable, type InsertNotification } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { emitNotificationNew } from "../lib/socket";
import { sendPushToUser, sendPushToUsers, type PushPayload } from "./push.service";
import { getUserLang, getUserLangs, pushTitleFor, pushBodyFor, newPostPushFor } from "../lib/notif-i18n";

const APP_BASE_URL = process.env["APP_BASE_URL"] ?? "/";

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
  await db.insert(notificationsTable).values(payload);

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

  const push: PushPayload = {
    title: pushTitleFor({ lang: recipientLang, type: payload.type, senderName }),
    // For known types use the translated body; for admin_message etc. keep DB prose.
    body: translatedBody ?? payload.message,
    url: buildPushUrl(payload),
    tag: `${payload.type}:${payload.fromUserId ?? payload.userId}`,
    icon: payload.type === "admin_message" ? undefined : (avatarUrl ?? undefined),
  };
  try { await sendPushToUser(payload.userId, push); } catch { /* ignore */ }
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
