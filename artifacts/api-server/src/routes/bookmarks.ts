import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ticketsTable, bookmarksTable, usersTable, followsTable } from "@workspace/db/schema";
import { eq, desc, isNull, and, inArray } from "drizzle-orm";
import { buildTicket } from "./tickets";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);

  // Fetch bookmarked tickets — exclude deleted tickets
  const bookmarked = await db.select({ ticket: ticketsTable })
    .from(bookmarksTable)
    .innerJoin(ticketsTable, eq(bookmarksTable.ticketId, ticketsTable.id))
    .where(and(
      eq(bookmarksTable.userId, currentUserId),
      isNull(ticketsTable.deletedAt),
    ))
    .orderBy(desc(bookmarksTable.createdAt))
    .limit(limit + 1);

  const hasMore = bookmarked.length > limit;
  const items = bookmarked.slice(0, limit);

  // Filter out tickets from private accounts (unless viewer follows them)
  const ownerIds = [...new Set(items.map(b => b.ticket.userId))];
  let blockedOwnerIds = new Set<string>();
  if (ownerIds.length > 0) {
    const [privateOwners, followRows] = await Promise.all([
      db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.isPrivate, true), inArray(usersTable.id, ownerIds))),
      db.select({ followingId: followsTable.followingId }).from(followsTable)
        .where(and(
          eq(followsTable.followerId, currentUserId),
          inArray(followsTable.followingId, ownerIds),
        )),
    ]);
    const followedOwners = new Set(followRows.map(r => r.followingId));
    for (const row of privateOwners) {
      if (row.id !== currentUserId && !followedOwners.has(row.id)) {
        blockedOwnerIds.add(row.id);
      }
    }
  }

  const visibleItems = items.filter(b => !blockedOwnerIds.has(b.ticket.userId));
  const result = await Promise.all(visibleItems.map(b => buildTicket(b.ticket, currentUserId)));
  res.json({
    tickets: result,
    hasMore,
    nextCursor: hasMore ? visibleItems[visibleItems.length - 1]?.ticket.id : null,
  });
});

export default router;
