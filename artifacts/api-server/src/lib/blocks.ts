import { db } from "@workspace/db";
import { userBlocksTable } from "@workspace/db/schema";
import { eq, or, and } from "drizzle-orm";

/**
 * Returns the set of user IDs that have a block relationship with
 * `userId` in *either* direction (userId blocked them, or they blocked
 * userId). Standard blocking semantics are bidirectional-hide, so feed /
 * list endpoints should exclude content from every ID in this set.
 *
 * Returns an empty set for anonymous/missing userId — callers should still
 * apply any other privacy filtering independently.
 */
export async function getBlockedUserIds(userId: string | undefined | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await db
    .select({ blockerId: userBlocksTable.blockerId, blockedId: userBlocksTable.blockedId })
    .from(userBlocksTable)
    .where(or(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, userId)));
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  }
  return ids;
}

/** True if either user has blocked the other. */
export async function isBlockedEitherWay(userIdA: string, userIdB: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(userBlocksTable)
    .where(
      or(
        and(eq(userBlocksTable.blockerId, userIdA), eq(userBlocksTable.blockedId, userIdB)),
        and(eq(userBlocksTable.blockerId, userIdB), eq(userBlocksTable.blockedId, userIdA)),
      )
    )
    .limit(1);
  return !!row;
}
