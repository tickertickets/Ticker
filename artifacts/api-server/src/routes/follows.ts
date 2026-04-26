import { createNotification } from "../services/notify.service";
import { emitFollowChanged } from "../lib/socket";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { usersTable, followsTable, notificationsTable, followRequestsTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import { nanoid } from "nanoid";

const router: IRouter = Router();

const followRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many follow actions. Please wait before trying again." },
  skip: (req) => !req.session?.userId,
});

router.post("/:username/follow", followRateLimit, async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { username } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!target) { res.status(404).json({ error: "not_found" }); return; }
  if (target.id === currentUserId) { res.status(400).json({ error: "bad_request", message: "Cannot follow yourself" }); return; }

  const existing = await db.select().from(followsTable).where(
    and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, target.id))
  ).limit(1);
  if (existing.length > 0) {
    const [fc] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followingId, target.id));
    res.json({ following: true, followerCount: Number(fc?.count ?? 0), requestStatus: null });
    return;
  }

  if (target.isPrivate) {
    const existingReq = await db.select().from(followRequestsTable).where(
      and(eq(followRequestsTable.fromUserId, currentUserId), eq(followRequestsTable.toUserId, target.id))
    ).limit(1);
    if (existingReq.length === 0) {
      const newRequestId = nanoid();
      await db.insert(followRequestsTable).values({ id: newRequestId, fromUserId: currentUserId, toUserId: target.id, status: "pending" });
      await db.delete(notificationsTable).where(
        and(
          eq(notificationsTable.userId, target.id),
          eq(notificationsTable.fromUserId, currentUserId),
          eq(notificationsTable.type, "follow_request")
        )
      );
      await createNotification({
        id: nanoid(), userId: target.id, fromUserId: currentUserId,
        type: "follow_request", message: "ส่งคำขอติดตามคุณ", isRead: false,
      });
    }
    const [fc] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followingId, target.id));
    res.json({ following: false, followerCount: Number(fc?.count ?? 0), requestStatus: "pending" });
    return;
  }

  await db.insert(followsTable).values({ followerId: currentUserId, followingId: target.id });
  await createNotification({
    id: nanoid(), userId: target.id, fromUserId: currentUserId,
    type: "follow", message: "started following you", isRead: false,
  });
  emitFollowChanged({ followerId: currentUserId, followingId: target.id });
  const [fc] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followingId, target.id));
  res.json({ following: true, followerCount: Number(fc?.count ?? 0), requestStatus: null });
});

router.delete("/:username/follow", followRateLimit, async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { username } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!target) { res.status(404).json({ error: "not_found" }); return; }
  await db.delete(followsTable).where(and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, target.id)));
  await db.delete(followRequestsTable).where(and(eq(followRequestsTable.fromUserId, currentUserId), eq(followRequestsTable.toUserId, target.id)));
  emitFollowChanged({ followerId: currentUserId, followingId: target.id });
  const [fc] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followingId, target.id));
  res.json({ following: false, followerCount: Number(fc?.count ?? 0), requestStatus: null });
});

router.get("/:username/follow-requests/:requestId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { requestId } = req.params;
  const [req_] = await db.select().from(followRequestsTable).where(eq(followRequestsTable.id, requestId)).limit(1);
  if (!req_ || req_.toUserId !== currentUserId) {
    res.json({ status: "not_found" });
    return;
  }
  res.json({ status: req_.status });
});

router.post("/:username/follow-requests/:requestId/approve", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { requestId } = req.params;

  const [req_] = await db.select().from(followRequestsTable).where(eq(followRequestsTable.id, requestId)).limit(1);
  if (!req_ || req_.toUserId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await db.update(followRequestsTable).set({ status: "approved" }).where(eq(followRequestsTable.id, requestId));
  const existing = await db.select().from(followsTable).where(and(eq(followsTable.followerId, req_.fromUserId), eq(followsTable.followingId, currentUserId))).limit(1);
  if (existing.length === 0) {
    await db.insert(followsTable).values({ followerId: req_.fromUserId, followingId: currentUserId });
    await createNotification({
      id: nanoid(), userId: req_.fromUserId, fromUserId: currentUserId,
      type: "follow", message: "อนุมัติคำขอติดตามของคุณแล้ว", isRead: false,
    });
    emitFollowChanged({ followerId: req_.fromUserId, followingId: currentUserId });
  }
  res.json({ success: true });
});

router.post("/:username/follow-requests/:requestId/reject", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { requestId } = req.params;
  const [req_] = await db.select().from(followRequestsTable).where(eq(followRequestsTable.id, requestId)).limit(1);
  if (!req_ || req_.toUserId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.delete(followRequestsTable).where(eq(followRequestsTable.id, requestId));
  res.json({ success: true });
});

export default router;
