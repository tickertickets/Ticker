import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { createNotification } from "../services/notify.service";
import { sendPushToUser } from "../services/push.service";

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

  const all = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
  }).from(usersTable);

  const matches = all.filter(u => (u.username ?? "").toLowerCase().includes(q)).slice(0, 20);
  res.json({ users: matches });
});

export default router;
