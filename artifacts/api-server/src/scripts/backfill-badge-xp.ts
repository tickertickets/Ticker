/**
 * Backfill Badge XP Script
 *
 * Audits badge_xp_log vs user_badge state and detects discrepancies where
 * a user's log-sum total XP exceeds what their current level+xpCurrent implies.
 *
 * Usage:
 *   # Dry run (default):
 *   npx tsx src/scripts/backfill-badge-xp.ts
 *
 *   # Apply corrections:
 *   APPLY=1 npx tsx src/scripts/backfill-badge-xp.ts
 *
 * Idempotent: running APPLY=1 twice produces the same result.
 */

import { db } from "@workspace/db";
import { userBadgeTable, badgeXpLogTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const BADGE_MAX_LEVEL = 5;
const XP_PER_LEVEL = 100;
const DRY_RUN = !process.env["APPLY"];
const IMPLAUSIBLE_DISCREPANCY = 500; // Flag users gaining more than 5 levels of unexpected XP

async function main() {
  console.log(`\n=== Badge XP Backfill Audit (${DRY_RUN ? "DRY RUN" : "APPLYING"}) ===\n`);

  // Fetch all badge rows with level >= 1 (claimed badges)
  const badges = await db
    .select()
    .from(userBadgeTable)
    .where(sql`${userBadgeTable.level} >= 1`);

  console.log(`Found ${badges.length} users with claimed badges.\n`);

  type DiscrepancyReport = {
    userId: string;
    currentLevel: number;
    currentXp: number;
    logTotal: number;
    impliedTotal: number;
    discrepancy: number;
    newLevel: number;
    newXpCurrent: number;
    logFromPosts: number;
    logFromTags: number;
    logFromParty: number;
    flagged: boolean;
  };

  const reports: DiscrepancyReport[] = [];
  let checked = 0;

  for (const badge of badges) {
    checked++;

    // Sum all XP log entries per action type for this user
    const logRows = await db
      .select({
        action: badgeXpLogTable.action,
        total: sql<number>`coalesce(sum(${badgeXpLogTable.xpAwarded}), 0)`,
      })
      .from(badgeXpLogTable)
      .where(eq(badgeXpLogTable.userId, badge.userId))
      .groupBy(badgeXpLogTable.action);

    let logTotal = 0;
    let logFromPosts = 0;
    let logFromTags = 0;
    let logFromParty = 0;

    for (const row of logRows) {
      const amt = Number(row.total);
      logTotal += amt;
      if (row.action === "post_ticket" || row.action === "post_chain") logFromPosts += amt;
      else if (row.action === "tag_friend") logFromTags += amt;
      else if (row.action === "party_accept") logFromParty += amt;
    }

    // The total XP the current badge state implies:
    //   (level - 1) * 100 + xpCurrent
    const impliedTotal = (badge.level - 1) * XP_PER_LEVEL + badge.xpCurrent;

    const discrepancy = logTotal - impliedTotal;

    // Only report users where log shows MORE XP than state implies (shortchanged)
    if (discrepancy <= 0) continue;

    // Compute corrected level and xpCurrent from logTotal
    let newLevel = 1;
    let remaining = logTotal;
    // Consume full levels
    while (remaining >= XP_PER_LEVEL && newLevel < BADGE_MAX_LEVEL) {
      remaining -= XP_PER_LEVEL;
      newLevel++;
    }
    // At max level, cap xpCurrent at 99 (no further evolution)
    if (newLevel >= BADGE_MAX_LEVEL) {
      newLevel = BADGE_MAX_LEVEL;
      remaining = Math.min(remaining, XP_PER_LEVEL - 1);
    }

    const flagged = discrepancy >= IMPLAUSIBLE_DISCREPANCY;

    reports.push({
      userId: badge.userId,
      currentLevel: badge.level,
      currentXp: badge.xpCurrent,
      logTotal,
      impliedTotal,
      discrepancy,
      newLevel,
      newXpCurrent: remaining,
      logFromPosts,
      logFromTags,
      logFromParty,
      flagged,
    });
  }

  console.log(`Checked ${checked} users. Found ${reports.length} discrepancies.\n`);

  const flagged = reports.filter((r) => r.flagged);
  const safe = reports.filter((r) => !r.flagged);

  if (flagged.length > 0) {
    console.log(`\n⚠️  FLAGGED (implausible discrepancy >= ${IMPLAUSIBLE_DISCREPANCY} XP) — NOT applied automatically:`);
    for (const r of flagged) {
      console.log(
        `  userId=${r.userId}  currentLv=${r.currentLevel} xp=${r.currentXp}  logTotal=${r.logTotal}  discrepancy=+${r.discrepancy}  wouldBe→ Lv${r.newLevel} xp=${r.newXpCurrent}`,
      );
    }
  }

  if (safe.length === 0) {
    console.log("\n✅ No safe corrections to apply.");
    return;
  }

  console.log(`\nSafe corrections (${safe.length}):`);
  for (const r of safe) {
    console.log(
      `  userId=${r.userId}  Lv${r.currentLevel}(xp=${r.currentXp}) → Lv${r.newLevel}(xp=${r.newXpCurrent})  discrepancy=+${r.discrepancy} XP`,
    );
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes written. Set APPLY=1 to apply.\n");
    return;
  }

  // Apply corrections in individual transactions per user
  let applied = 0;
  for (const r of safe) {
    try {
      await db
        .update(userBadgeTable)
        .set({
          level: r.newLevel,
          xpCurrent: r.newXpCurrent,
          xpFromPosts: r.logFromPosts,
          xpFromTags: r.logFromTags,
          xpFromParty: r.logFromParty,
          updatedAt: new Date(),
        })
        .where(eq(userBadgeTable.userId, r.userId));
      applied++;
      console.log(`  ✅ Applied: userId=${r.userId} → Lv${r.newLevel} xp=${r.newXpCurrent}`);
    } catch (err) {
      console.error(`  ❌ Failed for userId=${r.userId}:`, err);
    }
  }

  console.log(`\nDone. Applied ${applied}/${safe.length} corrections.\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
