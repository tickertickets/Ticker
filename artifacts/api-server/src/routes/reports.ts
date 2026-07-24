import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  commentsTable,
  reportsTable,
} from "@workspace/db/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { asyncHandler } from "../middlewares/error-handler";
import {
  UnauthorizedError,
  ValidationError,
  ConflictError,
} from "../lib/errors";
import { notifyReport, sendDiscordWebhook } from "../lib/discord";

const router: IRouter = Router();

// POST /api/reports/user/:username  — report a user
router.post(
  "/user/:username",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const username = String(req.params["username"]);
    const { reason, details } = req.body;

    if (!reason) throw new ValidationError("reason is required");

    const [reporter] = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);

    const [target] = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (target.id === currentUserId) throw new ValidationError("Cannot report yourself");

    // Dedup per 24h window — just one report per user pair
    const [already] = await db
      .select()
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.reporterId, currentUserId),
          eq(reportsTable.reportedUserId, target.id),
        ),
      )
      .limit(1);
    if (already) throw new ConflictError("already_reported", "Already reported this user");

    const validReasons = ["spam", "inappropriate", "harassment", "other"] as const;
    const safeReason: (typeof validReasons)[number] = (validReasons as readonly string[]).includes(reason)
      ? (reason as (typeof validReasons)[number])
      : "other";

    await db.insert(reportsTable).values({
      id: nanoid(),
      reporterId: currentUserId,
      reportedUserId: target.id,
      reason: safeReason,
      details: details ? sanitize(details) : null,
    });

    await notifyReport({
      type: "user",
      reason: safeReason,
      details,
      reporterUsername: reporter?.username ?? undefined,
      targetUsername: target.username ?? undefined,
      targetId: target.id,
    });

    res.json({ success: true });
  }),
);

// POST /api/reports/comment/:commentId  — report a comment
router.post(
  "/comment/:commentId",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const commentId = String(req.params["commentId"]);
    const { reason, details } = req.body;
    if (!reason) throw new ValidationError("reason is required");

    const [reporter] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);

    const [comment] = await db
      .select({ id: commentsTable.id, userId: commentsTable.userId, content: commentsTable.content })
      .from(commentsTable)
      .where(eq(commentsTable.id, commentId))
      .limit(1);

    if (!comment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (comment.userId === currentUserId) throw new ValidationError("Cannot report your own comment");

    const [targetUser] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, comment.userId))
      .limit(1);

    const validReasons = ["spam", "inappropriate", "harassment", "other"] as const;
    const safeReason = (validReasons as readonly string[]).includes(reason)
      ? (reason as (typeof validReasons)[number])
      : "other";

    await db.insert(reportsTable).values({
      id: nanoid(),
      reporterId: currentUserId,
      reportedUserId: comment.userId,
      reason: safeReason,
      details: details ? sanitize(details) : null,
    });

    await notifyReport({
      type: "comment",
      reason: safeReason,
      details,
      reporterUsername: reporter?.username ?? undefined,
      targetUsername: targetUser?.username ?? undefined,
      targetId: commentId,
      extraLabel: comment.content ? `"${comment.content.slice(0, 100)}"` : undefined,
    });

    res.json({ success: true });
  }),
);

// POST /api/reports/chain/:chainId  — report a chain
router.post(
  "/chain/:chainId",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const chainId = String(req.params["chainId"]);
    const { reason, details } = req.body;
    if (!reason) throw new ValidationError("reason is required");

    const [reporter] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);

    const validReasons = ["spam", "inappropriate", "harassment", "other"] as const;
    const safeReason = (validReasons as readonly string[]).includes(reason)
      ? (reason as (typeof validReasons)[number])
      : "other";

    await notifyReport({
      type: "ticket",
      reason: safeReason,
      details,
      reporterUsername: reporter?.username ?? undefined,
      targetId: chainId,
      extraLabel: `Chain ID: ${chainId}`,
    });

    res.json({ success: true });
  }),
);

// POST /api/reports/contact  — ติดต่อ Ticker (ไม่ต้อง login)
router.post(
  "/contact",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const { reason, details, email } = req.body;

    if (!reason) throw new ValidationError("reason is required");
    if (!details?.trim()) throw new ValidationError("details is required");

    let username: string | undefined;
    if (currentUserId) {
      const [u] = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, currentUserId))
        .limit(1);
      username = u?.username ?? undefined;
    }

    await notifyReport({
      type: "contact",
      reason,
      details: sanitize(details),
      reporterUsername: username,
      extraLabel: email ? `อีเมล: ${email}` : undefined,
    });

    res.json({ success: true });
  }),
);

// GET /api/reports/admin  — รายงานล่าสุด 50 รายการ (admin panel)
router.get(
  "/admin",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const reports = await db
      .select({
        id: reportsTable.id,
        reason: reportsTable.reason,
        details: reportsTable.details,
        createdAt: reportsTable.createdAt,
        ticketId: reportsTable.ticketId,
        chainId: reportsTable.chainId,
        reportedUserId: reportsTable.reportedUserId,
        reporterUsername: usersTable.username,
      })
      .from(reportsTable)
      .leftJoin(usersTable, eq(reportsTable.reporterId, usersTable.id))
      .orderBy(desc(reportsTable.createdAt))
      .limit(50);

    res.json({ reports });
  }),
);

// POST /api/reports/character/:charId  — report character data issue (no auth required)
router.post(
  "/character/:charId",
  asyncHandler(async (req, res) => {
    const charId = String(req.params["charId"] ?? "");
    const { reason, details, characterName } = req.body ?? {};

    if (!reason || !charId) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const validReasons = ["wrong_info", "wrong_image", "not_this_character", "offensive", "other"] as const;
    const safeReason = (validReasons as readonly string[]).includes(reason) ? reason : "other";

    const reasonLabels: Record<string, string> = {
      wrong_info: "ข้อมูลผิด / Wrong Info",
      wrong_image: "รูปผิด / Wrong Image",
      not_this_character: "ตัวละครไม่ตรง / Wrong Character",
      offensive: "เนื้อหาไม่เหมาะสม / Offensive",
      other: "อื่นๆ / Other",
    };

    await sendDiscordWebhook("", [
      {
        title: "🎭 รายงานข้อมูลตัวละคร / Character Data Report",
        color: 0xFF6B35,
        fields: [
          { name: "Character Name", value: characterName ?? charId, inline: true },
          { name: "Character ID", value: charId, inline: true },
          { name: "เหตุผล / Reason", value: reasonLabels[safeReason] ?? safeReason, inline: false },
          ...(details ? [{ name: "รายละเอียด / Details", value: String(details).slice(0, 400), inline: false }] : []),
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Ticker Character Report" },
      },
    ]);

    res.json({ success: true });
  }),
);

// GET /api/reports/stats  — ส่ง daily stats ไปยัง Discord (admin only หรือ cron)
router.post(
  "/stats/send",
  asyncHandler(async (req, res) => {
    const { notifyStats } = await import("../lib/discord");
    const { gt } = await import("drizzle-orm");

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalUsersRow] = await db.select({ c: count() }).from(usersTable);
    const [totalTicketsRow] = await db.select({ c: count() }).from(ticketsTable);
    const [newUsersRow] = await db.select({ c: count() }).from(usersTable).where(
      gt(usersTable.createdAt, todayStart),
    );
    const [newTicketsRow] = await db.select({ c: count() }).from(ticketsTable).where(
      gt(ticketsTable.createdAt, todayStart),
    );

    await notifyStats({
      totalUsers: Number(totalUsersRow?.c ?? 0),
      totalTickets: Number(totalTicketsRow?.c ?? 0),
      newUsersToday: Number(newUsersRow?.c ?? 0),
      newTicketsToday: Number(newTicketsRow?.c ?? 0),
      activeUsersToday: 0,
    });

    res.json({ success: true });
  }),
);

export default router;
