/**
 * Keeps the denormalized `lastActivityAt` column on tickets/chains in sync.
 *
 * Feed ranking sorts by "most recent activity" (post created, or liked/
 * commented/run since). Computing that with a correlated subquery
 * (`GREATEST(createdAt, (SELECT MAX(...) ...))`) on every feed request
 * cannot use an index and gets prohibitively slow as the tables grow past a
 * small dataset. Instead, `lastActivityAt` is written once at the moment of
 * the triggering event (like/comment/run) and read back with a plain,
 * indexed `ORDER BY`.
 *
 * Call `bumpTicketActivity` / `bumpChainActivity` right after inserting a
 * like/comment/run. Call `recomputeTicketActivity` / `recomputeChainActivity`
 * after a delete, since removing the most recent like/comment can mean the
 * correct value reverts to an earlier timestamp (or back to `createdAt` if
 * no engagement remains).
 */

import { eq, sql } from "drizzle-orm";
import type { db as Db } from "./index";
import { ticketsTable, chainsTable } from "./schema";

type DbClient = typeof Db;

/** Bump a ticket's lastActivityAt to "now" (call right after a new like/comment). */
export async function bumpTicketActivity(db: DbClient, ticketId: string): Promise<void> {
  await db
    .update(ticketsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(ticketsTable.id, ticketId));
}

/** Bump a chain's lastActivityAt to "now" (call right after a new like/comment/run). */
export async function bumpChainActivity(db: DbClient, chainId: string): Promise<void> {
  await db
    .update(chainsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(chainsTable.id, chainId));
}

/**
 * Recompute a ticket's lastActivityAt from scratch (call after a delete —
 * un-react/uncomment — since the most recent engagement may no longer exist).
 *
 * NOTE: real likes/reactions are stored in `ticket_reactions` (updated_at),
 * NOT the legacy `likes` table — that table has no write path anywhere in
 * the app and is effectively dead. Reaction removals delete the row rather
 * than zeroing it in place, so MAX(updated_at) over remaining rows is correct.
 */
export async function recomputeTicketActivity(db: DbClient, ticketId: string): Promise<void> {
  await db.execute(sql`
    UPDATE tickets
    SET last_activity_at = GREATEST(
      created_at,
      COALESCE((SELECT MAX(updated_at) FROM ticket_reactions WHERE ticket_id = ${ticketId}), created_at),
      COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketId}), created_at)
    )
    WHERE id = ${ticketId}
  `);
}

/**
 * Recompute a chain's lastActivityAt from scratch (call after a delete —
 * unlike/uncomment/delete-run).
 */
export async function recomputeChainActivity(db: DbClient, chainId: string): Promise<void> {
  await db.execute(sql`
    UPDATE chains
    SET last_activity_at = GREATEST(
      created_at,
      COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainId}), created_at),
      COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainId}), created_at),
      COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainId}), created_at)
    )
    WHERE id = ${chainId}
  `);
}
