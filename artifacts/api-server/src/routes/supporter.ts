import { createNotification } from "../services/notify.service";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  supporterRequestsTable,
  userBadgeTable,
  notificationsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendDiscordWebhook } from "../lib/discord";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function notifyDiscord(username: string, displayName: string, slipImagePath: string | null) {
  const slipNote = slipImagePath ? "✅ มีสลิปแนบมา" : "⚠️ ไม่มีสลิป";
  await sendDiscordWebhook("", [
    {
      title: "🎟️ มีคำขอ Supporter Badge ใหม่!",
      color: 0xf0abfc,
      fields: [
        { name: "ผู้ใช้", value: `${displayName || username} (@${username})`, inline: true },
        { name: "สลิป", value: slipNote, inline: true },
      ],
      footer: { text: "Ticker — เข้า /admin เพื่อตรวจสอบ" },
      timestamp: new Date().toISOString(),
    },
  ]);
}

function getAdminUserId(): string | undefined {
  return process.env["ADMIN_USER_ID"];
}

function isAdmin(userId: string): boolean {
  const adminId = getAdminUserId();
  return !!adminId && adminId === userId;
}

// ── GET /api/supporter/my-request — user's own request status ────────────────
router.get("/my-request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const rows = await db
    .select()
    .from(supporterRequestsTable)
    .where(eq(supporterRequestsTable.userId, currentUserId))
    .orderBy(desc(supporterRequestsTable.createdAt))
    .limit(1);

  res.json({ request: rows[0] ?? null });
});

// ── POST /api/supporter/request — submit slip ─────────────────────────────────
router.post("/request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { slipImagePath } = req.body as { slipImagePath?: string };

  // Check for existing pending request
  const existing = await db
    .select()
    .from(supporterRequestsTable)
    .where(
      and(
        eq(supporterRequestsTable.userId, currentUserId),
        eq(supporterRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "already_pending", message: "มีคำขอที่รอการตรวจสอบอยู่แล้ว" });
    return;
  }

  // Check if already a supporter
  const badge = await db
    .select()
    .from(userBadgeTable)
    .where(eq(userBadgeTable.userId, currentUserId))
    .limit(1);

  if (badge[0] && badge[0].level >= 5) {
    res.status(409).json({ error: "already_supporter", message: "คุณเป็น Supporter อยู่แล้ว" });
    return;
  }

  const id = nanoid();
  const [created] = await db
    .insert(supporterRequestsTable)
    .values({
      id,
      userId: currentUserId,
      slipImagePath: slipImagePath ?? null,
      status: "pending",
    })
    .returning();

  // Discord notification (fire-and-forget)
  const userRow = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, currentUserId))
    .limit(1);
  const u = userRow[0];
  notifyDiscord(u?.username ?? "unknown", u?.displayName ?? "", slipImagePath ?? null);

  res.json({ request: created });
});

// ── GET /api/supporter/admin/requests — list all (admin only) ────────────────
router.get("/admin/requests", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const status = (req.query["status"] as string) || "pending";

  const rows = await db
    .select({
      request: supporterRequestsTable,
      user: {
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      },
    })
    .from(supporterRequestsTable)
    .innerJoin(usersTable, eq(supporterRequestsTable.userId, usersTable.id))
    .where(
      status === "all"
        ? undefined
        : eq(supporterRequestsTable.status, status as "pending" | "approved" | "rejected"),
    )
    .orderBy(desc(supporterRequestsTable.createdAt));

  res.json({ requests: rows });
});

// ── POST /api/supporter/admin/requests/:id/approve — grant Lv5 + notify ──────
router.post("/admin/requests/:id/approve", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(supporterRequestsTable)
    .where(eq(supporterRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const request = rows[0];

  // Mark as approved
  await db
    .update(supporterRequestsTable)
    .set({ status: "approved", reviewedAt: new Date() })
    .where(eq(supporterRequestsTable.id, id));

  // Grant Lv5 supporter badge — mark isSupporterApproved, do NOT override XP level
  const existingBadge = await db
    .select()
    .from(userBadgeTable)
    .where(eq(userBadgeTable.userId, request.userId))
    .limit(1);

  if (existingBadge[0]) {
    await db
      .update(userBadgeTable)
      .set({ isSupporterApproved: true, updatedAt: new Date() })
      .where(eq(userBadgeTable.userId, request.userId));
  } else {
    // New user with no badge — auto-claim Lv1 and grant supporter
    await db.insert(userBadgeTable).values({
      userId: request.userId,
      level: 1,
      isSupporterApproved: true,
      xpCurrent: 0,
      xpFromPosts: 0,
      xpFromTags: 0,
      xpFromParty: 0,
      claimedAt: new Date(),
    });
  }

  // Send in-app notification to user
  await createNotification({
    id: nanoid(),
    userId: request.userId,
    fromUserId: currentUserId,
    type: "supporter_approved",
    message: "คำขอ Supporter Badge ของคุณได้รับการอนุมัติแล้ว! ขอบคุณที่สนับสนุน Ticker",
    isRead: false,
  });

  res.json({ ok: true });
});

// ── POST /api/supporter/admin/requests/:id/reject — reject request ────────────
router.post("/admin/requests/:id/reject", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(supporterRequestsTable)
    .where(eq(supporterRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await db
    .update(supporterRequestsTable)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(supporterRequestsTable.id, id));

  res.json({ ok: true });
});

// ── DELETE /api/supporter/admin/requests/:id/slip — delete slip image ─────────
router.delete("/admin/requests/:id/slip", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(supporterRequestsTable)
    .where(eq(supporterRequestsTable.id, id))
    .limit(1);

  if (!rows[0] || !rows[0].slipImagePath) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  try {
    await storage.deleteObject(rows[0].slipImagePath);
  } catch {
    // Best-effort deletion
  }

  await db
    .update(supporterRequestsTable)
    .set({ slipImagePath: null })
    .where(eq(supporterRequestsTable.id, id));

  res.json({ ok: true });
});

// ── DELETE /api/supporter/admin/requests/:id — delete entire request row ───────
router.delete("/admin/requests/:id", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(supporterRequestsTable)
    .where(eq(supporterRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (rows[0].slipImagePath) {
    try { await storage.deleteObject(rows[0].slipImagePath); } catch { /* best-effort */ }
  }

  await db.delete(supporterRequestsTable).where(eq(supporterRequestsTable.id, id));
  res.json({ ok: true });
});

export default router;
