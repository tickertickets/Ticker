import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { db } from "@workspace/db";
import { usersTable, ticketsTable, chainsTable } from "@workspace/db/schema";
import { inArray, eq, ilike, or } from "drizzle-orm";
import { createNotification } from "../services/notify.service";
import { sendPushToUser } from "../services/push.service";
import { sendDiscordWebhook } from "../lib/discord";

const router: IRouter = Router();

function isAdmin(userId: string | undefined): boolean {
  const adminId = process.env["ADMIN_USER_ID"];
  return !!userId && !!adminId && adminId === userId;
}

router.get("/whoami", (req, res) => {
  const userId = req.session?.userId;
  res.json({ isAdmin: isAdmin(userId) });
});

/**
 * POST /api/admin/broadcast
 * Body: { title: string, body: string, url?: string,
 *         target: "all" | "usernames", usernames?: string[] }
 * Creates a notification (type "admin_message") for each target and pushes it.
 * Accepts legacy `message` field as fallback for `body`.
 */
router.post("/broadcast", async (req, res) => {
  const userId = req.session?.userId;
  if (!isAdmin(userId)) { res.status(403).json({ error: "forbidden" }); return; }

  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? req.body?.message ?? "").trim();
  const link = typeof req.body?.url === "string" ? req.body.url.trim() : "";

  if (!title || title.length > 100) {
    res.status(400).json({ error: "invalid_title" });
    return;
  }
  if (!body || body.length > 500) {
    res.status(400).json({ error: "invalid_message" });
    return;
  }

  const target = String(req.body?.target ?? "usernames");

  let userIds: string[] = [];
  if (target === "all") {
    const rows = await db.select({ id: usersTable.id }).from(usersTable);
    userIds = rows.map(r => r.id);
  } else {
    const rawList: string[] = Array.isArray(req.body?.usernames)
      ? req.body.usernames
      : (req.body?.username ? [req.body.username] : []);
    // Strip leading @, lowercase, dedupe, drop empties
    const cleaned = Array.from(new Set(
      rawList
        .map(s => String(s ?? "").trim().replace(/^@+/, "").toLowerCase())
        .filter(Boolean),
    ));
    if (cleaned.length === 0) { res.status(400).json({ error: "no_target" }); return; }
    const rows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(inArray(usersTable.username, cleaned));
    userIds = rows.map(r => r.id);
  }

  if (userIds.length === 0) { res.status(404).json({ error: "no_users_found" }); return; }

  const fromUserId = userId!;
  let recipients = 0;

  for (const uid of userIds) {
    if (uid === fromUserId) continue;
    try {
      await createNotification({
        id: nanoid(),
        userId: uid,
        fromUserId,
        type: "admin_message",
        message: `${title}\n${body}`,
        isRead: false,
      });
      recipients += 1;

      // Fire-and-forget push (createNotification stores the in-app entry; this
      // delivers the OS-level notification to every subscribed device).
      sendPushToUser(uid, {
        title: `Ticker · ${title}`,
        body,
        url: link || "/notifications",
        tag: `admin:${nanoid(6)}`,
      }).catch((err) => req.log.warn({ err, uid }, "[admin/broadcast] push failed"));
    } catch (err) {
      req.log.warn({ err, uid }, "[admin/broadcast] failed for user");
    }
  }

  // `pushed` mirrors recipients since push is fire-and-forget per user.
  res.json({ ok: true, recipients, pushed: recipients });
});

/**
 * GET /api/admin/users/search?q=...
 * Returns up to 20 users matching username prefix. Admin only.
 */
router.get("/users/search", async (req, res) => {
  const userId = req.session?.userId;
  if (!isAdmin(userId)) { res.status(403).json({ error: "forbidden" }); return; }
  const q = String(req.query["q"] ?? "").trim().toLowerCase();
  if (q.length < 2) { res.json({ users: [] }); return; }

  const matches = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
    email: usersTable.email,
    createdAt: usersTable.createdAt,
  }).from(usersTable)
    .where(or(
      ilike(usersTable.username, `%${q}%`),
      ilike(usersTable.displayName, `%${q}%`),
    ))
    .limit(20);

  res.json({ users: matches });
});

/**
 * GET /api/admin/users/:id
 * Returns detailed info for a single user. Admin only.
 */
router.get("/users/:id", async (req, res) => {
  const userId = req.session?.userId;
  if (!isAdmin(userId)) { res.status(403).json({ error: "forbidden" }); return; }
  const { id } = req.params;
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ user: rows[0] });
});

/**
 * DELETE /api/admin/tickets/:id
 * Soft-deletes a ticket (sets deletedAt). Admin only. Sends Discord notification.
 */
router.delete("/tickets/:id", async (req, res) => {
  const adminId = req.session?.userId;
  if (!isAdmin(adminId)) { res.status(403).json({ error: "forbidden" }); return; }
  const { id } = req.params;

  const rows = await db.select({
    id: ticketsTable.id,
    userId: ticketsTable.userId,
    movieTitle: ticketsTable.movieTitle,
  }).from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1);

  if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }

  await db.update(ticketsTable)
    .set({ deletedAt: new Date() })
    .where(eq(ticketsTable.id, id));

  await sendDiscordWebhook("", [{
    title: "🗑️ Admin ลบ Ticket",
    color: 0xED4245,
    fields: [
      { name: "Ticket ID", value: id, inline: true },
      { name: "หนัง", value: rows[0].movieTitle ?? "?", inline: true },
      { name: "User ID", value: rows[0].userId, inline: false },
      { name: "ลบโดย Admin", value: adminId!, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Ticker Admin Moderation" },
  }]).catch(() => {});

  res.json({ ok: true });
});

/**
 * DELETE /api/admin/chains/:id
 * Soft-deletes a chain (sets deletedAt). Admin only. Sends Discord notification.
 */
router.delete("/chains/:id", async (req, res) => {
  const adminId = req.session?.userId;
  if (!isAdmin(adminId)) { res.status(403).json({ error: "forbidden" }); return; }
  const { id } = req.params;

  const rows = await db.select({
    id: chainsTable.id,
    userId: chainsTable.userId,
    title: chainsTable.title,
  }).from(chainsTable).where(eq(chainsTable.id, id)).limit(1);

  if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }

  await db.update(chainsTable)
    .set({ deletedAt: new Date() })
    .where(eq(chainsTable.id, id));

  await sendDiscordWebhook("", [{
    title: "🗑️ Admin ลบ Chain",
    color: 0xED4245,
    fields: [
      { name: "Chain ID", value: id, inline: true },
      { name: "ชื่อ Chain", value: rows[0].title ?? "?", inline: true },
      { name: "User ID", value: rows[0].userId, inline: false },
      { name: "ลบโดย Admin", value: adminId!, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Ticker Admin Moderation" },
  }]).catch(() => {});

  res.json({ ok: true });
});

/**
 * POST /api/admin/users/:id/delete-content
 * Soft-deletes all tickets and chains for a user. Admin only. Sends Discord notification.
 */
router.post("/users/:id/delete-content", async (req, res) => {
  const adminId = req.session?.userId;
  if (!isAdmin(adminId)) { res.status(403).json({ error: "forbidden" }); return; }
  const { id } = req.params;

  const userRows = await db.select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!userRows[0]) { res.status(404).json({ error: "user_not_found" }); return; }

  const now = new Date();
  const [deletedTickets, deletedChains] = await Promise.all([
    db.update(ticketsTable).set({ deletedAt: now }).where(eq(ticketsTable.userId, id)),
    db.update(chainsTable).set({ deletedAt: now }).where(eq(chainsTable.userId, id)),
  ]);

  await sendDiscordWebhook("", [{
    title: "🚨 Admin ลบเนื้อหาทั้งหมดของ User",
    color: 0xFEE75C,
    fields: [
      { name: "User ID", value: id, inline: true },
      { name: "Username", value: `@${userRows[0].username ?? "?"}`, inline: true },
      { name: "Tickets ที่ลบ", value: String((deletedTickets as unknown as { rowCount?: number })?.rowCount ?? 0), inline: true },
      { name: "Chains ที่ลบ", value: String((deletedChains as unknown as { rowCount?: number })?.rowCount ?? 0), inline: true },
      { name: "ดำเนินการโดย", value: adminId!, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Ticker Admin Moderation" },
  }]).catch(() => {});

  res.json({ ok: true, userId: id });
});

/**
 * POST /api/admin/tickets/:id/clear-image
 * Clears the backdrop/poster image from a Ticket post (reverts to classic theme).
 * Used to process DMCA / copyright takedown requests. Admin only.
 */
router.post("/tickets/:id/clear-image", async (req, res) => {
  const adminId = req.session?.userId;
  if (!isAdmin(adminId)) { res.status(403).json({ error: "forbidden" }); return; }
  const { id } = req.params;
  const rows = await db.select({ id: ticketsTable.id, movieTitle: ticketsTable.movieTitle, userId: ticketsTable.userId })
    .from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }
  await db.update(ticketsTable)
    .set({ cardTheme: "classic", cardBackdropUrl: null, cardBackdropOffsetX: 50 })
    .where(eq(ticketsTable.id, id));
  await sendDiscordWebhook("", [{
    title: "🖼️ Admin ลบภาพประกอบ (DMCA Takedown)",
    color: 0xFFA500,
    fields: [
      { name: "Ticket ID", value: id, inline: true },
      { name: "หนัง", value: rows[0].movieTitle ?? "?", inline: true },
      { name: "ดำเนินการโดย", value: adminId!, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Ticker DMCA Takedown" },
  }]).catch(() => {});
  res.json({ ok: true });
});

export default router;
