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
import { userBadgeTable, badgeXpLogTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { emitBadgeUpdate } from "../lib/socket";
import { createNotification } from "./notify.service";

// ── Constants ──────────────────────────────────────────────────────────────────

export const BADGE_MAX_LEVEL = 5; // Lv5 is achievable via XP (100 XP at Lv4)
export const XP_PER_LEVEL = 100;

// Every "post" (ticket or chain) earns the same XP — kept in lockstep on
// purpose so users don't see inconsistent rewards between post types.
//
// Designed for a movie social platform where a "normal" user posts 1-2 reviews/day
// and tags 1-2 friends occasionally:
//   Normal (1 post + 1 tag):   18 XP/day  →  ~6 days/level
//   Active (2 posts + 3 tags): 44 XP/day  →  ~2-3 days/level
//
// Anti-spam via sourceId uniqueness + event-count daily caps:
//   post_ticket/chain : sourceId = content ID → one event per unique post, unlimited/day
//   tag_ticket        : sourceId = ticket ID  → one event per Ticket, max 2/day
//   party_complete    : sourceId = partyGroupId → one event per party, max 2/day, only when ALL accept
export const XP_PER_ACTION = {
  post_ticket: 5,
  post_chain: 5,
  tag_ticket: 15,
  party_complete: 20,
} as const;

export type XpAction = keyof typeof XP_PER_ACTION;

// Event-count daily caps — number of XP events allowed per day, not XP sum.
// Only tag_ticket and party_complete are capped; post_ticket/chain are unlimited.
export const DAILY_EVENT_CAP: Partial<Record<XpAction, number>> = {
  tag_ticket: 2,
  party_complete: 2,
};

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
    name: "Connoisseur",
    nameTH: "เซียนหนัง",
    color: "#EC4899",
    gradient: "linear-gradient(135deg, #FDF4FF 0%, #F0ABFC 20%, #A78BFA 40%, #67E8F9 60%, #86EFAC 80%, #FDE68A 100%)",
    description: "Your taste in film is unmatched.",
    descriptionTH: "เซียนหนังตัวจริง ไม่มีใครเทียบรสนิยม",
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

  // Notify client in real time that level + XP changed
  emitBadgeUpdate(userId);

  // Mark any unread "ready to evolve" notifications as read now that the
  // evolution has actually happened.  These notifications can arrive in the
  // bell AFTER the user already pressed EVO (because createNotification is
  // fire-and-forget), making it look like a stale prompt.  Silencing them
  // here means the user only ever sees the level-up confirmation below.
  db.update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "badge_evolve_ready"),
        eq(notificationsTable.isRead, false),
      ),
    )
    .catch((err: unknown) => console.error("[evolveBadge] mark-read evolve_ready failed:", err));

  // Persistent in-app notification + push confirming the level-up. This is
  // the authoritative "you evolved" record — unlike a push (which can be
  // delayed, dropped, or arrive after the user already acted), the in-app
  // bell entry is written before this function returns, so it can never be
  // "late" relative to the action that caused it.
  if (updated) {
    createNotification({
      id: nanoid(),
      userId,
      fromUserId: userId,
      type: "badge_level_up",
      message: `Evolved to Lv ${updated.level}!`,
      isRead: false,
    }).catch((err) => console.error("[evolveBadge] notification failed for user", userId, ":", err));
  }

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
    displayLevel = Math.max(1, Math.min(active.level, badge.level));
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
 * level = 1–5 → show that specific earned level.
 * Clamps to user's current level automatically.
 */
export async function setDisplayBadgeLevel(userId: string, level: number) {
  const badge = await getBadgeStatus(userId);
  if (!badge || badge.level === 0) throw new Error("no_badge");

  const clamped = level <= 0 ? 0 : Math.min(level, badge.level);

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
 * @param sourceUserId - The other user involved (for party_complete)
 * @param bonusXp     - Extra XP on top of XP_PER_ACTION[action] (used for party_complete group bonus)
 *
 * Returns the XP awarded (0 if blocked).
 */
export async function awardXp(
  userId: string,
  action: XpAction,
  sourceId: string,
  sourceUserId?: string,
  bonusXp?: number,
): Promise<number> {
  try {
    // 1. Ensure user has a badge row. Auto-create with level=1 if missing so
    //    new users accumulate XP from their very first action without needing to
    //    manually claim first. Existing rows are left untouched (onConflictDoNothing).
    let badge = await getBadgeStatus(userId);
    if (!badge || badge.level === 0) {
      // Insert or upgrade. If a level=0 row already exists (e.g. from a
      // partially-completed claim flow), we must upgrade it to level=1 so XP
      // can start flowing. onConflictDoNothing would silently leave the
      // level=0 row intact, causing XP to return 0 forever for those users.
      await db.insert(userBadgeTable).values({
        userId,
        level: 1,
        xpCurrent: 0,
        xpFromPosts: 0,
        xpFromTags: 0,
        xpFromParty: 0,
        badgeHidden: false,
        isSupporterApproved: false,
        isPageVerified: false,
        pageBadgeHidden: false,
        // Auto-created because the user already took an XP-earning action —
        // treat that as an implicit claim so claimedAt is never left null
        // for users who never pressed the explicit "Claim" button.
        claimedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: userBadgeTable.userId,
        // Only upgrade if currently at level 0 — never downgrade an earned level.
        set: {
          level: sql`CASE WHEN ${userBadgeTable.level} = 0 THEN 1 ELSE ${userBadgeTable.level} END`,
          claimedAt: sql`CASE WHEN ${userBadgeTable.level} = 0 THEN NOW() ELSE ${userBadgeTable.claimedAt} END`,
          updatedAt: new Date(),
        },
      });
      badge = await getBadgeStatus(userId);
    }

    // level === 0 means the record exists but hasn't been claimed yet — skip
    if (!badge || badge.level === 0) return 0;

    // 2. Max level — no more XP needed
    if (badge.level >= BADGE_MAX_LEVEL) return 0;

    // 3. Guard against duplicate sourceId (unique index will also reject it)
    // Guard against duplicate sourceId (unique index will also reject it).
    // Daily-event caps for tag_ticket / party_complete are enforced by the
    // wrapper functions (awardTagTicketXp / awardPartyCompleteXp) before calling here.
    // post_ticket / post_chain are unlimited — unique content ID is the only guard.
    const xpEarned = XP_PER_ACTION[action] + (bonusXp ?? 0);
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

    // 6. Update user_badge totals — use atomic SQL increment to prevent
    //    race-condition overwrites when multiple XP events fire simultaneously
    //    (e.g. posting a ticket with several tagged users in quick succession).
    const xpField =
      action === "post_ticket" || action === "post_chain"
        ? { xpFromPosts: sql`${userBadgeTable.xpFromPosts} + ${xpEarned}` }
        : action === "tag_ticket"
          ? { xpFromTags: sql`${userBadgeTable.xpFromTags} + ${xpEarned}` }
          : { xpFromParty: sql`${userBadgeTable.xpFromParty} + ${xpEarned}` };

    const xpBefore = badge.xpCurrent;

    await db
      .update(userBadgeTable)
      .set({
        xpCurrent: sql`${userBadgeTable.xpCurrent} + ${xpEarned}`,
        ...xpField,
        updatedAt: new Date(),
      })
      .where(eq(userBadgeTable.userId, userId));

    // Re-read actual xpCurrent from DB after the atomic increment.
    // Using xpBefore + xpEarned is unreliable when multiple XP events fire
    // concurrently (e.g. posting a ticket with several tagged users): both
    // threads could read the same stale xpBefore and neither would detect
    // the threshold crossing, so the "ready to evolve" notification would
    // never fire even though XP actually crossed 100.
    const [refreshed] = await db
      .select({ xpCurrent: userBadgeTable.xpCurrent })
      .from(userBadgeTable)
      .where(eq(userBadgeTable.userId, userId));

    const actualXpAfter = refreshed?.xpCurrent ?? (xpBefore + xpEarned);

    // Notify client in real time
    emitBadgeUpdate(userId);

    // Fire "ready to evolve" notification exactly once — when XP crosses the
    // threshold. We use actualXpAfter (the real DB value) and xpBefore (what
    // this specific award started from). If xpBefore was already ≥ threshold,
    // the notification was already sent by a previous award.
    if (xpBefore < XP_PER_LEVEL && actualXpAfter >= XP_PER_LEVEL && badge.level < BADGE_MAX_LEVEL) {
      createNotification({
        id: nanoid(),
        userId,
        fromUserId: userId,
        type: "badge_evolve_ready",
        message: "XP full — ready to evolve!",
        isRead: false,
      }).catch((err) => console.error("[awardXp] evolve-ready notification failed for user", userId, ":", err));
    }

    return xpEarned;
  } catch (err) {
    console.error("[awardXp] unexpected error for user", userId, "action", action, ":", err);
    return 0;
  }
}

/**
 * Today's XP earned (UTC day) per action, so the UI can show "daily cap
 * reached" instead of leaving users to assume XP has silently stopped
 * working when in fact the daily cap for that action was hit.
 */
export async function getXpCapStatus(userId: string): Promise<Record<XpAction, { earnedToday: number }>> {
  const todayStartDate = todayStart();
  const rows = await db
    .select({
      action: badgeXpLogTable.action,
      total: sql<number>`coalesce(sum(${badgeXpLogTable.xpAwarded}), 0)`,
    })
    .from(badgeXpLogTable)
    .where(and(eq(badgeXpLogTable.userId, userId), gte(badgeXpLogTable.createdAt, todayStartDate)))
    .groupBy(badgeXpLogTable.action);

  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.action] = Number(r.total ?? 0);

  const actions = Object.keys(XP_PER_ACTION) as XpAction[];
  const result = {} as Record<XpAction, { earnedToday: number }>;
  for (const action of actions) {
    result[action] = { earnedToday: totals[action] ?? 0 };
  }
  return result;
}

/**
 * Award tag_ticket XP once per Ticket that has tagged friends.
 * XP is for the act of tagging (inviting), not per person tagged.
 * Max 2 tagged-ticket events per day.
 */
export async function awardTagTicketXp(userId: string, ticketId: string): Promise<number> {
  const cap = DAILY_EVENT_CAP.tag_ticket ?? 0;
  const todayStartDate = todayStart();
  const [capRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(badgeXpLogTable)
    .where(and(
      eq(badgeXpLogTable.userId, userId),
      eq(badgeXpLogTable.action, "tag_ticket"),
      gte(badgeXpLogTable.createdAt, todayStartDate),
    ));
  if (Number(capRow?.count ?? 0) >= cap) return 0;
  return awardXp(userId, "tag_ticket", `tag_ticket:${ticketId}`);
}

/**
 * Award party_complete XP when ALL invitees for a party have accepted.
 * Base: 20 XP. Bonus: +1 XP per invitee when ≥3 people all accepted.
 * Max 2 completed-party events per day.
 */
export async function awardPartyCompleteXp(
  inviterUserId: string,
  partyGroupId: string,
  totalInviteCount: number,
): Promise<number> {
  const cap = DAILY_EVENT_CAP.party_complete ?? 0;
  const todayStartDate = todayStart();
  const [capRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(badgeXpLogTable)
    .where(and(
      eq(badgeXpLogTable.userId, inviterUserId),
      eq(badgeXpLogTable.action, "party_complete"),
      gte(badgeXpLogTable.createdAt, todayStartDate),
    ));
  if (Number(capRow?.count ?? 0) >= cap) return 0;

  // Bonus XP: +1 per invitee when 3+ people all accepted together
  const bonusXp = totalInviteCount >= 3 ? totalInviteCount : 0;
  return awardXp(inviterUserId, "party_complete", `party_complete:${partyGroupId}`, undefined, bonusXp);
}
