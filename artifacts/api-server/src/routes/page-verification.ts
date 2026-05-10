import { createNotification } from "../services/notify.service";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  pageVerificationRequestsTable,
  userBadgeTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendDiscordWebhook } from "../lib/discord";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function notifyDiscord(
  username: string,
  displayName: string,
  pageName: string,
  pageUrl: string | null,
  proofImagePath: string | null,
) {
  const proofNote = proofImagePath ? "✅ มีหลักฐานแนบมา" : "⚠️ ไม่มีหลักฐาน";
  await sendDiscordWebhook("", [
    {
      title: "🍿 มีคำขอ Popcorn Bucket (Page Verify) ใหม่!",
      color: 0xfacc15,
      fields: [
        { name: "ผู้ใช้", value: `${displayName || username} (@${username})`, inline: true },
        { name: "ชื่อเพจ", value: pageName, inline: true },
        { name: "ลิงก์", value: pageUrl || "-", inline: false },
        { name: "หลักฐาน", value: proofNote, inline: true },
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

// ── GET /api/page-verify/my-request — user's own request status ─────────────
router.get("/my-request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const rows = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(eq(pageVerificationRequestsTable.userId, currentUserId))
    .orderBy(desc(pageVerificationRequestsTable.createdAt))
    .limit(1);

  res.json({ request: rows[0] ?? null });
});

// ── POST /api/page-verify/request — submit proof ────────────────────────────
router.post("/request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { proofImagePath, pageName, pageUrl } = req.body as {
    proofImagePath?: string;
    pageName?: string;
    pageUrl?: string;
  };

  const trimmedName = (pageName ?? "").trim();
  if (!trimmedName) {
    res.status(400).json({ error: "page_name_required", message: "ต้องระบุชื่อเพจ" });
    return;
  }

  const existing = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(
      and(
        eq(pageVerificationRequestsTable.userId, currentUserId),
        eq(pageVerificationRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "already_pending", message: "มีคำขอที่รอการตรวจสอบอยู่แล้ว" });
    return;
  }

  const badge = await db
    .select()
    .from(userBadgeTable)
    .where(eq(userBadgeTable.userId, currentUserId))
    .limit(1);

  if (badge[0]?.isPageVerified) {
    res.status(409).json({ error: "already_verified", message: "เพจของคุณยืนยันแล้ว" });
    return;
  }

  const id = nanoid();
  const [created] = await db
    .insert(pageVerificationRequestsTable)
    .values({
      id,
      userId: currentUserId,
      proofImagePath: proofImagePath ?? null,
      pageName: trimmedName,
      pageUrl: pageUrl?.trim() || null,
      status: "pending",
    })
    .returning();

  const userRow = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, currentUserId))
    .limit(1);
  const u = userRow[0];
  notifyDiscord(
    u?.username ?? "unknown",
    u?.displayName ?? "",
    trimmedName,
    pageUrl?.trim() || null,
    proofImagePath ?? null,
  );

  res.json({ request: created });
});

// ── GET /api/page-verify/admin/requests — list (admin only) ─────────────────
router.get("/admin/requests", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const status = (req.query["status"] as string) || "pending";

  const rows = await db
    .select({
      request: pageVerificationRequestsTable,
      user: {
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      },
    })
    .from(pageVerificationRequestsTable)
    .innerJoin(usersTable, eq(pageVerificationRequestsTable.userId, usersTable.id))
    .where(
      status === "all"
        ? undefined
        : eq(pageVerificationRequestsTable.status, status as "pending" | "approved" | "rejected"),
    )
    .orderBy(desc(pageVerificationRequestsTable.createdAt));

  res.json({ requests: rows });
});

// ── POST /api/page-verify/admin/requests/:id/approve ────────────────────────
router.post("/admin/requests/:id/approve", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(eq(pageVerificationRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const request = rows[0];

  await db
    .update(pageVerificationRequestsTable)
    .set({ status: "approved", reviewedAt: new Date() })
    .where(eq(pageVerificationRequestsTable.id, id));

  const existingBadge = await db
    .select()
    .from(userBadgeTable)
    .where(eq(userBadgeTable.userId, request.userId))
    .limit(1);

  if (existingBadge[0]) {
    await db
      .update(userBadgeTable)
      .set({ isPageVerified: true, updatedAt: new Date() })
      .where(eq(userBadgeTable.userId, request.userId));
  } else {
    await db.insert(userBadgeTable).values({
      userId: request.userId,
      level: 0,
      isPageVerified: true,
      xpCurrent: 0,
      xpFromPosts: 0,
      xpFromTags: 0,
      xpFromParty: 0,
    });
  }

  await createNotification({
    id: nanoid(),
    userId: request.userId,
    fromUserId: currentUserId,
    type: "page_verified_approved",
    message: "คำขอ Popcorn Bucket (ยืนยันเพจ) ของคุณได้รับการอนุมัติแล้ว!",
    isRead: false,
  });

  res.json({ ok: true });
});

// ── POST /api/page-verify/admin/requests/:id/reject ─────────────────────────
router.post("/admin/requests/:id/reject", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(eq(pageVerificationRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await db
    .update(pageVerificationRequestsTable)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(pageVerificationRequestsTable.id, id));

  res.json({ ok: true });
});

// ── POST /api/page-verify/admin/users/:userId/revoke — remove badge ─────────
router.post("/admin/users/:userId/revoke", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const { userId } = req.params as { userId: string };
  await db
    .update(userBadgeTable)
    .set({ isPageVerified: false, updatedAt: new Date() })
    .where(eq(userBadgeTable.userId, userId));
  res.json({ ok: true });
});

// ── DELETE /api/page-verify/admin/requests/:id/proof — free space ───────────
router.delete("/admin/requests/:id/proof", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(eq(pageVerificationRequestsTable.id, id))
    .limit(1);

  if (!rows[0] || !rows[0].proofImagePath) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  try {
    await storage.deleteObject(rows[0].proofImagePath);
  } catch {
    // best-effort
  }

  await db
    .update(pageVerificationRequestsTable)
    .set({ proofImagePath: null })
    .where(eq(pageVerificationRequestsTable.id, id));

  res.json({ ok: true });
});

// ── DELETE /api/page-verify/admin/requests/:id — delete entire request row ──────
router.delete("/admin/requests/:id", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId || !isAdmin(currentUserId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { id } = req.params as { id: string };

  const rows = await db
    .select()
    .from(pageVerificationRequestsTable)
    .where(eq(pageVerificationRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (rows[0].proofImagePath) {
    try { await storage.deleteObject(rows[0].proofImagePath); } catch { /* best-effort */ }
  }

  await db.delete(pageVerificationRequestsTable).where(eq(pageVerificationRequestsTable.id, id));
  res.json({ ok: true });
});

export default router;
