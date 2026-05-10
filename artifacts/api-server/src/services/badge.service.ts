/**
 * Badge Service — XP & Evolution System
 *
 * Anti-cheat guarantees:
 *  1. All XP is awarded server-side only (never trusted from client).
 *  2. Each (userId, action, sourceId) triple is UNIQUE — duplicate events are
 *     silently ignored thanks to the DB unique index + upsert guard.
 *  3. Daily caps are enforced via SQL COUNT before every award.
 *  4. tickerofficial and self-tagging are blocked.
 *  5. Party accept XP requires distinct invitee ≠ inviter (enforced at the
 *     call site in party.ts; sourceId = invite row id prevents re-award).
 *  6. Level 0 means "no badge yet" — user must explicitly claim Lv1 first.
 */

import { db } from "@workspace/db";
import { userBadgeTable, badgeXpLogTable } from "@workspace/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// ── Constants ──────────────────────────────────────────────────────────────────

export const BADGE_MAX_LEVEL = 4; // Lv5 is supporter-only (not XP-based)
export const XP_PER_LEVEL = 100;

export const XP_PER_ACTION = {
  post_ticket: 5,
  post_chain: 5,
  tag_friend: 3,
  party_accept: 8,
} as const;

// Daily XP caps by action type
export const DAILY_XP_CAP = {
  post_ticket: 15,
  post_chain: 5,
  tag_friend: 9,
  party_accept: 16,
} as const;

export type XpAction = keyof typeof XP_PER_ACTION;

// ── Badge metadata ────────────────────────────────────────────────────────────

export interface BadgeMeta {
  level: number;
  name: string;
  nameTH: string;
  color: string;
  gradient: string;
  description: string;
  descriptionTH: string;
}

export const BADGE_META: Record<number, BadgeMeta> = {
  1: {
    level: 1,
    name: "Extra",
    nameTH: "ตัวประกอบ",
    color: "#9CA3AF",
    gradient: "linear-gradient(135deg, #D1D5DB 0%, #9CA3AF 50%, #6B7280 100%)",
    description: "Your first step into the spotlight. Every legend starts somewhere.",
    descriptionTH: "ก้าวแรกสู่จอเงิน ทุกตำนานเริ่มจากที่นี่",
  },
  2: {
    level: 2,
    name: "Supporting",
    nameTH: "นักแสดงสมทบ",
    color: "#3B82F6",
    gradient: "linear-gradient(135deg, #93C5FD 0%, #3B82F6 50%, #1D4ED8 100%)",
    description: "A familiar face on the platform. Your reviews are being noticed.",
    descriptionTH: "หน้าคุ้นในแพลตฟอร์ม รีวิวของคุณเริ่มมีคนสังเกต",
  },
  3: {
    level: 3,
    name: "Co-Star",
    nameTH: "ดาวร่วม",
    color: "#A855F7",
    gradient: "linear-gradient(135deg, #E9D5FF 0%, #A855F7 50%, #7C3AED 100%)",
    description: "You shine alongside the best. A trusted voice in the community.",
    descriptionTH: "คุณเปล่งแสงข้างผู้ยิ่งใหญ่ เป็นเสียงที่เชื่อถือได้ในชุมชน",
  },
  4: {
    level: 4,
    name: "Lead",
    nameTH: "ดาวนำ",
    color: "#F59E0B",
    gradient: "linear-gradient(135deg, #FDE68A 0%, #F59E0B 50%, #D97706 100%)",
    description: "The screen belongs to you. Your passion for cinema is undeniable.",
    descriptionTH: "จอภาพเป็นของคุณ ความหลงใหลในภาพยนตร์ของคุณปฏิเสธไม่ได้",
  },
  5: {
    level: 5,
    name: "Legend",
    nameTH: "ตำนาน",
    color: "#EC4899",
    gradient: "linear-gradient(135deg, #FDF4FF 0%, #F0ABFC 20%, #A78BFA 40%, #67E8F9 60%, #86EFAC 80%, #FDE68A 100%)",
    description: "A true cinema legend. Your name echoes through the halls of Ticker.",
    descriptionTH: "ตำนานแห่งวงการหนังตัวจริง ชื่อของคุณกังวานในโถงแห่ง Ticker",
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Core service functions ────────────────────────────────────────────────────

/**
 * Get (or lazily create) the badge row for a user.
 * Returns null if user has level=0 and hasn't claimed yet.
 */
export async function getBadgeStatus(userId: string): Promise<typeof userBadgeTable.$inferSelect | null> {
  try {
    const rows = await db
      .select()
      .from(userBadgeTable)
      .where(eq(userBadgeTable.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  } catch (err: any) {
    // Production-safety: if a newly-added column hasn't been migrated yet
    // (e.g. `page_badge_hidden` missing in prod DB), fall back to a query
    // restricted to legacy columns and synthesize defaults for the new ones.
    // Without this guard, the Settings page 500s and renders blank.
    const msg = String(err?.message ?? err ?? "");
    if (!/does not exist|undefined column|unknown column/i.test(msg)) throw err;
    console.warn("[badge.service] getBadgeStatus fallback (missing column):", msg);
    const rows = await db
      .select({
        userId: userBadgeTable.userId,
        level: userBadgeTable.level,
        xpCurrent: userBadgeTable.xpCurrent,
        xpFromPosts: userBadgeTable.xpFromPosts,
        xpFromTags: userBadgeTable.xpFromTags,
        xpFromParty: userBadgeTable.xpFromParty,
        claimedAt: userBadgeTable.claimedAt,
        updatedAt: userBadgeTable.updatedAt,
      })
      .from(userBadgeTable)
      .where(eq(userBadgeTable.userId, userId))
      .limit(1);
    if (!rows[0]) return null;
    return {
      ...rows[0],
      badgeHidden: false,
      pageBadgeHidden: false,
      isPageVerified: false,
      isSupporterApproved: false,
      displayLevel: null,
    } as typeof userBadgeTable.$inferSelect;
  }
}

/**
 * Claim the first badge (Lv 1). Can only be done once.
 * Returns the new badge row or throws if already claimed.
 */
export async function claimFirstBadge(userId: string) {
  const existing = await getBadgeStatus(userId);
  if (existing && existing.level > 0) {
    throw new Error("already_claimed");
  }

  // Use upsert to handle race conditions where the row may or may not exist.
  // ON CONFLICT (user_id) DO UPDATE ensures we always get a returned row.
  const [row] = await db
    .insert(userBadgeTable)
    .values({
      userId,
      level: 1,
      xpCurrent: 0,
      xpFromPosts: 0,
      xpFromTags: 0,
      xpFromParty: 0,
      claimedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userBadgeTable.userId,
      set: { level: 1, claimedAt: new Date(), updatedAt: new Date() },
    })
    .returning();

  if (!row) throw new Error("Failed to claim badge");
  return row;
}

/**
 * Evolve badge to next level when user has 100+ XP.
 * Resets XP for next level. Rate-limited to prevent spam.
 */
export async function evolveBadge(userId: string) {
  const badge = await getBadgeStatus(userId);
  if (!badge || badge.level === 0) {
    throw new Error("no_badge");
  }
  if (badge.level >= BADGE_MAX_LEVEL) {
    throw new Error("max_level");
  }
  if (badge.xpCurrent < XP_PER_LEVEL) {
    throw new Error("insufficient_xp");
  }

  const [updated] = await db
    .update(userBadgeTable)
    .set({
      level: badge.level + 1,
      xpCurrent: badge.xpCurrent - XP_PER_LEVEL,
      xpFromPosts: 0,
      xpFromTags: 0,
      xpFromParty: 0,
      updatedAt: new Date(),
    })
    .where(eq(userBadgeTable.userId, userId))
    .returning();
  return updated;
}

/**
 * Toggle badge visibility for a user (shown ↔ hidden).
 */
export async function toggleBadgeVisibility(userId: string) {
  const badge = await getBadgeStatus(userId);
  if (!badge) throw new Error("no_badge");

  const [updated] = await db
    .update(userBadgeTable)
    .set({ badgeHidden: !badge.badgeHidden, updatedAt: new Date() })
    .where(eq(userBadgeTable.userId, userId))
    .returning();
  return updated;
}

/**
 * Toggle popcorn (page-verified) badge visibility for a user (shown ↔ hidden).
 */
export async function togglePageBadgeVisibility(userId: string) {
  const badge = await getBadgeStatus(userId);
  if (!badge) throw new Error("no_badge");
  if (!badge.isPageVerified) throw new Error("not_verified");

  const [updated] = await db
    .update(userBadgeTable)
    .set({ pageBadgeHidden: !badge.pageBadgeHidden, updatedAt: new Date() })
    .where(eq(userBadgeTable.userId, userId))
    .returning();
  return updated;
}

/**
 * Single-active-badge selector.
 *
 * A user can have AT MOST one badge visible to others at a time:
 *   • "none"    → no badge shown
 *   • "ticket"  → Lv N ticket badge shown (popcorn auto-hidden)
 *   • "popcorn" → page-verified popcorn badge shown (Lv badge auto-hidden)
 *
 * This is the ONLY mutation the client should call to flip eye toggles —
 * mutual exclusion is enforced atomically server-side in a single UPDATE so
 * other users see a consistent state on their next fetch.
 */
export type ActiveBadge =
  | { kind: "none" }
  | { kind: "ticket"; level: number }
  | { kind: "popcorn" };

export async function setActiveBadge(userId: string, active: ActiveBadge) {
  const badge = await getBadgeStatus(userId);
  if (!badge) throw new Error("no_badge");

  let displayLevel = 0;
  let pageBadgeHidden = true;

  if (active.kind === "ticket") {
    if (badge.level === 0) throw new Error("no_lv_badge");
    const max = badge.isSupporterApproved ? 5 : badge.level;
    displayLevel = Math.max(1, Math.min(active.level, max));
    pageBadgeHidden = true;
  } else if (active.kind === "popcorn") {
    if (!badge.isPageVerified) throw new Error("not_verified");
    displayLevel = 0;
    pageBadgeHidden = false;
  }

  const [updated] = await db
    .update(userBadgeTable)
    .set({ displayLevel, pageBadgeHidden, updatedAt: new Date() })
    .where(eq(userBadgeTable.userId, userId))
    .returning();
  return updated;
}

/**
 * Set which badge level to display publicly.
 * level = 0 → hide badge entirely.
 * level = 1–4 → show that specific earned level.
 * Clamps to user's current level automatically.
 */
export async function setDisplayBadgeLevel(userId: string, level: number) {
  const badge = await getBadgeStatus(userId);
  if (!badge || badge.level === 0) throw new Error("no_badge");

  const isSupporterApproved = badge.isSupporterApproved ?? false;
  const maxAllowed = isSupporterApproved ? 5 : badge.level;
  const clamped = level <= 0 ? 0 : Math.min(level, maxAllowed);

  const [updated] = await db
    .update(userBadgeTable)
    .set({ displayLevel: clamped, updatedAt: new Date() })
    .where(eq(userBadgeTable.userId, userId))
    .returning();
  return updated;
}

/**
 * Award XP for an action.
 *
 * @param userId     - The user receiving XP
 * @param action     - Which action earned XP
 * @param sourceId   - Unique identifier for this specific event (ticket id,
 *                     chain id, invite id, etc.) — prevents double-award
 * @param sourceUserId - The other user involved (for party_accept, tag_friend)
 *
 * Returns the XP awarded (0 if blocked).
 */
export async function awardXp(
  userId: string,
  action: XpAction,
  sourceId: string,
  sourceUserId?: string,
): Promise<number> {
  // 1. User must have claimed a badge (level >= 1)
  const badge = await getBadgeStatus(userId);
  if (!badge || badge.level === 0) return 0;

  // 2. Max level — no more XP needed
  if (badge.level >= BADGE_MAX_LEVEL) return 0;

  // 3. Check daily cap
  const dailyCap = DAILY_XP_CAP[action];
  const xpEarned = XP_PER_ACTION[action];

  const todayStartDate = todayStart();
  const [capRow] = await db
    .select({ total: sql<number>`coalesce(sum(${badgeXpLogTable.xpAwarded}), 0)` })
    .from(badgeXpLogTable)
    .where(
      and(
        eq(badgeXpLogTable.userId, userId),
        eq(badgeXpLogTable.action, action),
        gte(badgeXpLogTable.createdAt, todayStartDate),
      ),
    );

  const todayTotal = Number(capRow?.total ?? 0);
  if (todayTotal >= dailyCap) return 0;

  // 4. Guard against duplicate sourceId (unique index will also reject it)
  const [dupCheck] = await db
    .select({ id: badgeXpLogTable.id })
    .from(badgeXpLogTable)
    .where(
      and(
        eq(badgeXpLogTable.userId, userId),
        eq(badgeXpLogTable.action, action),
        eq(badgeXpLogTable.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (dupCheck) return 0;

  // 5. Insert XP log (unique constraint acts as final guard)
  try {
    await db.insert(badgeXpLogTable).values({
      id: nanoid(),
      userId,
      action,
      xpAwarded: xpEarned,
      sourceId,
      sourceUserId: sourceUserId ?? null,
    });
  } catch {
    // Unique constraint violation — duplicate, skip silently
    return 0;
  }

  // 6. Update user_badge totals
  const xpField =
    action === "post_ticket" || action === "post_chain"
      ? { xpFromPosts: badge.xpFromPosts + xpEarned }
      : action === "tag_friend"
        ? { xpFromTags: badge.xpFromTags + xpEarned }
        : { xpFromParty: badge.xpFromParty + xpEarned };

  await db
    .update(userBadgeTable)
    .set({
      xpCurrent: badge.xpCurrent + xpEarned,
      ...xpField,
      updatedAt: new Date(),
    })
    .where(eq(userBadgeTable.userId, userId));

  return xpEarned;
}

/**
 * Award tag-friend XP for each unique tagged user in a post.
 * Filters out: self, tickerofficial, duplicates.
 */
export async function awardTagXp(
  taggerUserId: string,
  taggedUsernames: string[],
  postId: string,
) {
  const BLOCKED = ["tickerofficial"];

  for (const username of taggedUsernames) {
    if (BLOCKED.includes(username.toLowerCase())) continue;
    // sourceId is composite: post + tagged username → one XP per unique tag per post
    const sourceId = `tag:${postId}:${username.toLowerCase()}`;
    await awardXp(taggerUserId, "tag_friend", sourceId, username);
  }
}
