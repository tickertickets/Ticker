import { db } from "@workspace/db";
import { notificationsTable, usersTable, followsTable, type InsertNotification } from "@workspace/db/schema";
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
 * Push-only notification to all followers of `authorId` when they create a new
 * post. Does NOT insert in-app notification rows (would spam the bell).
 * Uses tag `new_post:<authorId>` so the latest one collapses earlier ones on
 * the device.
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

    const followers = await db
      .select({ followerId: followsTable.followerId })
      .from(followsTable)
      .where(eq(followsTable.followingId, authorId));
    const followerIds = followers.map((f) => f.followerId).filter((id): id is string => Boolean(id));
    if (followerIds.length === 0) return;

    const name = author.displayName || (author.username ? `@${author.username}` : "Someone");
    const url = kind === "ticket" ? `${APP_BASE_URL}ticket/${postId}` : `${APP_BASE_URL}chain/${postId}`;
    const icon = opts.posterUrl ?? undefined;

    // Group followers by their preferred language so each gets a localized push.
    const langMap = await getUserLangs(followerIds);
    const buckets = new Map<"th" | "en", string[]>();
    for (const fid of followerIds) {
      const lang = langMap.get(fid) ?? "en";
      const arr = buckets.get(lang) ?? [];
      arr.push(fid);
      buckets.set(lang, arr);
    }

    for (const [lang, ids] of buckets) {
      const { title, body } = newPostPushFor({ lang, kind, senderName: name, movieTitle, chainTitle });
      await sendPushToUsers(ids, { title, body, url, icon, tag: `new_post:${authorId}` });
    }
  } catch { /* best-effort */ }
}
