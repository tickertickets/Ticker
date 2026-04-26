import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, usersTable, followRequestsTable, ticketsTable, partyInvitesTable } from "@workspace/db/schema";
import { eq, desc, count, and, inArray } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);

  const notifications = await db.select({
      notif: notificationsTable,
      fromUser: usersTable,
      ticketPosterUrl: ticketsTable.posterUrl,
      partyInviteStatus: partyInvitesTable.status,
    })
    .from(notificationsTable)
    .innerJoin(usersTable, eq(notificationsTable.fromUserId, usersTable.id))
    .leftJoin(ticketsTable, eq(notificationsTable.ticketId, ticketsTable.id))
    .leftJoin(partyInvitesTable, eq(notificationsTable.partyInviteId, partyInvitesTable.id))
    .where(eq(notificationsTable.userId, currentUserId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit + 1);

  const [unreadResult] = await db.select({ count: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, currentUserId), eq(notificationsTable.isRead, false)));

  const hasMore = notifications.length > limit;
  const items = notifications.slice(0, limit);

  const followReqNotifs = items.filter(n => n.notif.type === "follow_request");
  const followRequestMap: Record<string, string> = {};
  const latestFollowReqNotifByUser: Record<string, string> = {};
  if (followReqNotifs.length > 0) {
    for (const n of followReqNotifs) {
      if (!latestFollowReqNotifByUser[n.notif.fromUserId]) {
        latestFollowReqNotifByUser[n.notif.fromUserId] = n.notif.id;
      }
    }
    const fromUserIds = followReqNotifs.map(n => n.notif.fromUserId);
    const requests = await db.select().from(followRequestsTable).where(
      and(
        inArray(followRequestsTable.fromUserId, fromUserIds),
        eq(followRequestsTable.toUserId, currentUserId),
        eq(followRequestsTable.status, "pending"),
      )
    );
    for (const r of requests) {
      followRequestMap[r.fromUserId] = r.id;
    }
  }

  res.json({
    notifications: items.map(n => ({
      id: n.notif.id,
      type: n.notif.type,
      fromUser: {
        id: n.fromUser.id,
        username: n.fromUser.username!,
        displayName: n.fromUser.displayName,
        avatarUrl: n.fromUser.avatarUrl,
      },
      ticketId: n.notif.ticketId,
      ticketPosterUrl: n.ticketPosterUrl ?? null,
      chainId: n.notif.chainId ?? null,
      partyInviteId: n.notif.partyInviteId,
      partyInviteStatus: n.partyInviteStatus ?? null,
      partyGroupId: n.notif.partyGroupId,
      followRequestId: (n.notif.type === "follow_request" && latestFollowReqNotifByUser[n.notif.fromUserId] === n.notif.id)
        ? (followRequestMap[n.notif.fromUserId] ?? null)
        : null,
      message: n.notif.message,
      isRead: n.notif.isRead,
      createdAt: n.notif.createdAt,
    })),
    unreadCount: Number(unreadResult?.count ?? 0),
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.notif.id : null,
  });
});

router.get("/unread-count", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [result] = await db.select({ count: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, currentUserId), eq(notificationsTable.isRead, false)));
  res.json({ unreadCount: Number(result?.count ?? 0) });
});

router.post("/read-all", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, currentUserId));
  res.json({ success: true, message: "All notifications marked as read" });
});

router.patch("/:id/read", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { id } = req.params;
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id as string), eq(notificationsTable.userId, currentUserId)));
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { id } = req.params;
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id as string), eq(notificationsTable.userId, currentUserId)));
  res.json({ success: true });
});

export default router;
