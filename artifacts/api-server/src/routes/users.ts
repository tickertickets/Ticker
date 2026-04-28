import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, followsTable, ticketsTable, followRequestsTable, chainsTable, chainRunsTable, likesTable, commentsTable, chainLikesTable, chainCommentsTable, bookmarksTable, usernameChangesTable, USERNAME_CHANGE_COOLDOWN_DAYS } from "@workspace/db/schema";
import { eq, and, count, desc, asc, lt, or, ilike, isNull, inArray, sql } from "drizzle-orm";
import { sanitize } from "../lib/sanitize";
import { nanoid } from "nanoid";
import { buildTicket } from "./tickets";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

const RESERVED_USERNAMES = new Set([
  "tickerofficial", "ticker", "admin", "administrator", "support", "help",
  "system", "root", "moderator", "mod", "staff", "official", "verified",
]);

router.get("/check-username", async (req, res) => {
  const { username } = req.query;
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "bad_request", message: "username is required" });
    return;
  }
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    res.json({ available: false, username });
    return;
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    res.json({ available: false, username });
    return;
  }
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(ilike(usersTable.username, username)).limit(1);
  res.json({ available: existing.length === 0, username });
});

router.get("/search", async (req, res) => {
  const { q, limit: limitParam, followingOnly } = req.query;
  if (!q || typeof q !== "string" || q.trim().length < 1) {
    res.json({ users: [] });
    return;
  }
  const term = q.trim();
  const limit = Math.min(Number(limitParam) || 10, 20);
  const currentUserId = req.session?.userId;

  if (followingOnly === "true" && currentUserId) {
    const users = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    }).from(usersTable)
      .innerJoin(followsTable, and(
        eq(followsTable.followingId, usersTable.id),
        eq(followsTable.followerId, currentUserId),
      ))
      .where(or(
        ilike(usersTable.username, `%${term}%`),
        ilike(usersTable.displayName, `%${term}%`),
      ))
      .limit(limit);
    res.json({ users });
    return;
  }

  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
  }).from(usersTable)
    .where(or(
      ilike(usersTable.username, `%${term}%`),
      ilike(usersTable.displayName, `%${term}%`),
    ))
    .limit(limit);

  res.json({ users });
});

router.patch("/me/timezone", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const tz = String(req.body?.timezone ?? "").trim();
  // Validate via Intl: throws RangeError for invalid IANA names.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    res.status(400).json({ error: "invalid_timezone" });
    return;
  }
  if (tz.length === 0 || tz.length > 64) {
    res.status(400).json({ error: "invalid_timezone" });
    return;
  }
  await db.update(usersTable)
    .set({ timezone: tz, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  res.json({ ok: true, timezone: tz });
});

// ── PATCH /me/pinned ──────────────────────────────────────────────────────────
// Replace the user's pinned-ticket list (used as the profile cover mosaic).
//
// Body: { ticketIds: string[] } — order matters, max 6 entries, must be
// tickets owned by the current user (no leaking other people's ticket IDs).
// Empty array clears all pins (cover falls back to recent/popular tickets).
router.patch("/me/pinned", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const raw = (req.body?.ticketIds ?? []) as unknown;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "bad_request", message: "ticketIds must be an array" });
    return;
  }
  // Normalise: drop blanks/dupes, keep first 6, ensure all strings.
  const seen = new Set<string>();
  const requested: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    requested.push(id);
    if (requested.length >= 6) break;
  }

  // Validate: every ID must be a non-deleted ticket owned by the current user.
  // Anything else is silently dropped (don't 400 on a stale ID — UI may still
  // be holding a deleted ticket reference).
  let validated: string[] = [];
  if (requested.length > 0) {
    const owned = await db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(and(
        eq(ticketsTable.userId, userId),
        isNull(ticketsTable.deletedAt),
        inArray(ticketsTable.id, requested),
      ));
    const ownedSet = new Set(owned.map((r) => r.id));
    validated = requested.filter((id) => ownedSet.has(id));
  }

  await db.update(usersTable)
    .set({ pinnedTicketIds: validated, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  res.json({ ok: true, pinnedTicketIds: validated });
});

router.patch("/me/lang", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const lang = String(req.body?.lang ?? "").toLowerCase();
  if (lang !== "th" && lang !== "en") {
    res.status(400).json({ error: "invalid_lang" });
    return;
  }
  await db.update(usersTable)
    .set({ preferredLang: lang, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  res.json({ ok: true, lang });
});

router.get("/me/profile", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const profile = await buildUserProfile(user, userId);
  res.json(profile);
});

router.delete("/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const [deletedUser] = await db
      .select({ username: usersTable.username, displayName: usersTable.displayName })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    const [{ total }] = await db.select({ total: count() }).from(usersTable);
    const { sendDiscordWebhook } = await import("../lib/discord");
    await sendDiscordWebhook("", [{
      title: "🗑️ บัญชีถูกลบ",
      color: 0xff4444,
      fields: [
        { name: "ชื่อ", value: deletedUser?.displayName || "-", inline: true },
        { name: "Username", value: `@${deletedUser?.username || "-"}`, inline: true },
        { name: "ผู้ใช้ทั้งหมด", value: `${total} บัญชี`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }]);
    req.session.destroy(() => {});
    res.json({ success: true });
  } catch (e) {
    console.error("Delete account failed:", e);
    res.status(500).json({ error: "internal_error", message: "ลบบัญชีไม่สำเร็จ" });
  }
});

router.put("/me/profile", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { displayName, bio, avatarUrl, isPrivate } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName !== undefined) updates["displayName"] = sanitize(displayName?.trim() ?? "");
  if (bio !== undefined) updates["bio"] = sanitize(bio?.trim() ?? "");
  if (isPrivate !== undefined) updates["isPrivate"] = isPrivate;

  if (avatarUrl !== undefined) {
    // Delete old avatar from object storage if it's an internal upload
    const [current] = await db.select({ avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const oldUrl = current?.avatarUrl ?? null;
    if (oldUrl && oldUrl !== avatarUrl && oldUrl.includes("/objects/uploads/")) {
      try {
        const svc = new ObjectStorageService();
        // strip any leading /api prefix the frontend might have added
        const storagePath = oldUrl.replace(/^.*?(\/objects\/uploads\/)/, "/objects/uploads/");
        await svc.deleteObject(storagePath);
      } catch (e) {
        // non-fatal — proceed with update even if delete fails
        console.warn("Failed to delete old avatar:", e);
      }
    }
    updates["avatarUrl"] = avatarUrl;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  const profile = await buildUserProfile(updated, userId);
  res.json(profile);
});

router.patch("/me/username", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { username: newUsername } = req.body;
  if (!newUsername || typeof newUsername !== "string") {
    res.status(400).json({ error: "bad_request", message: "username is required" });
    return;
  }
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(newUsername)) {
    res.status(400).json({ error: "invalid_username", message: "username ต้องเป็นตัวอักษร a-z, 0-9, _ ความยาว 3-30 ตัว" });
    return;
  }

  const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!currentUser) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (currentUser.username?.toLowerCase() === newUsername.toLowerCase()) {
    res.status(400).json({ error: "same_username", message: "username เดิม" });
    return;
  }

  // Check cooldown — find most recent change
  const [lastChange] = await db
    .select({ changedAt: usernameChangesTable.changedAt })
    .from(usernameChangesTable)
    .where(eq(usernameChangesTable.userId, userId))
    .orderBy(desc(usernameChangesTable.changedAt))
    .limit(1);

  if (lastChange) {
    const daysSince = (Date.now() - new Date(lastChange.changedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < USERNAME_CHANGE_COOLDOWN_DAYS) {
      const daysLeft = Math.ceil(USERNAME_CHANGE_COOLDOWN_DAYS - daysSince);
      res.status(429).json({
        error: "cooldown",
        message: `เปลี่ยน username ได้อีกครั้งใน ${daysLeft} วัน`,
        daysLeft,
      });
      return;
    }
  }

  // Check availability
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, newUsername)).limit(1);
  if (existing) {
    res.status(409).json({ error: "username_taken", message: "username นี้ถูกใช้งานแล้ว" });
    return;
  }

  const oldUsername = currentUser.username ?? "";

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ username: newUsername, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    await tx.insert(usernameChangesTable).values({
      id: nanoid(),
      userId,
      oldUsername,
      newUsername,
      changedAt: new Date(),
    });
  });

  res.json({ success: true, username: newUsername });
});

router.get("/:username/tickets", async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 100);
  const cursor = req.query["cursor"] as string | undefined;
  const sortBy = req.query["sortBy"] as string | undefined;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }

  if (user.isPrivate && user.id !== currentUserId) {
    const isFollower = currentUserId ? (await db.select().from(followsTable).where(
      and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, user.id))
    ).limit(1)).length > 0 : false;
    if (!isFollower) {
      res.json({ tickets: [], hasMore: false, nextCursor: null });
      return;
    }
  }

  const conditions: Parameters<typeof and>[0][] = [
    eq(ticketsTable.userId, user.id),
    isNull(ticketsTable.deletedAt),
  ];
  if (user.id !== currentUserId) {
    conditions.push(eq(ticketsTable.isPrivate, false));
  }
  if (cursor) {
    conditions.push(lt(ticketsTable.createdAt, new Date(cursor)));
  }

  const base = db.select().from(ticketsTable).where(and(...conditions));
  const rows = await (
    sortBy === "popular"
      ? base.orderBy(
          desc(sql`(SELECT COUNT(*) FROM bookmarks WHERE ticket_id = ${ticketsTable.id})`),
          desc(ticketsTable.createdAt),
        )
      : base.orderBy(
          sql`${ticketsTable.displayOrder} ASC NULLS LAST`,
          desc(ticketsTable.createdAt),
        )
  ).limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const tickets = await Promise.all(items.map(t => buildTicket(t, currentUserId)));

  res.json({
    tickets,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null,
  });
});

router.get("/:username", async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.session?.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }
  const profile = await buildUserProfile(user, currentUserId);
  res.json(profile);
});

router.get("/:username/followers", async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const cursor = req.query["cursor"] as string | undefined;

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const followers = await db.select({ follower: usersTable }).from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followerId, usersTable.id))
    .where(eq(followsTable.followingId, user.id))
    .limit(limit + 1);

  const hasMore = followers.length > limit;
  const items = followers.slice(0, limit);
  const profiles = await Promise.all(items.map(f => buildUserProfile(f.follower, currentUserId)));

  res.json({ users: profiles, hasMore, nextCursor: hasMore ? items[items.length - 1]?.follower.id : null });
});

router.get("/:username/following", async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const following = await db.select({ following: usersTable }).from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followingId, usersTable.id))
    .where(eq(followsTable.followerId, user.id))
    .limit(limit + 1);

  const hasMore = following.length > limit;
  const items = following.slice(0, limit);
  const profiles = await Promise.all(items.map(f => buildUserProfile(f.following, currentUserId)));

  res.json({ users: profiles, hasMore, nextCursor: hasMore ? items[items.length - 1]?.following.id : null });
});

async function buildUserProfile(user: typeof usersTable.$inferSelect, currentUserId?: string) {
  // Resolve the user's pinned ticket IDs into actual ticket records (in
  // pinned order, dropping any IDs that point to private/deleted tickets the
  // viewer can't see). This drives the profile-cover mosaic; when empty, the
  // frontend falls back to recent tickets.
  const isOwner = currentUserId === user.id;
  const pinnedIdsRaw = (user.pinnedTicketIds as string[] | null) ?? [];
  const pinnedIds = pinnedIdsRaw.slice(0, 6);
  let pinnedTickets: Awaited<ReturnType<typeof buildTicket>>[] = [];
  if (pinnedIds.length > 0) {
    const rows = await db
      .select()
      .from(ticketsTable)
      .where(and(
        eq(ticketsTable.userId, user.id),
        isNull(ticketsTable.deletedAt),
        // Hide private tickets from non-owners (don't expose the existence
        // of pinned-but-private tickets either — drop them silently).
        isOwner ? sql`true` : eq(ticketsTable.isPrivate, false),
        inArray(ticketsTable.id, pinnedIds),
      ));
    const byId = new Map(rows.map((t) => [t.id, t]));
    // Preserve user-defined pin order (DB rows come back unordered).
    const ordered = pinnedIds.map((id) => byId.get(id)).filter((t): t is typeof rows[0] => !!t);
    pinnedTickets = await Promise.all(ordered.map((t) => buildTicket(t, currentUserId)));
  }

  const [ticketCountResult] = await db.select({ count: count() }).from(ticketsTable).where(
    and(eq(ticketsTable.userId, user.id), eq(ticketsTable.isPrivate, false), isNull(ticketsTable.deletedAt))
  );
  const chainCountRows = await db.execute(sql`
    SELECT COUNT(DISTINCT chain_id)::int AS count FROM (
      SELECT id AS chain_id FROM chains WHERE user_id = ${user.id} AND deleted_at IS NULL
      UNION
      SELECT chain_id FROM chain_runs WHERE user_id = ${user.id}
    ) sub
  `);
  const chainCount = Number((chainCountRows.rows?.[0] as any)?.count ?? 0);

  const [ticketLikesResult] = await db.select({ count: count() }).from(likesTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, likesTable.ticketId))
    .where(eq(ticketsTable.userId, user.id));
  const [chainLikesResult] = await db.select({ count: count() }).from(chainLikesTable)
    .innerJoin(chainsTable, eq(chainsTable.id, chainLikesTable.chainId))
    .where(and(eq(chainsTable.userId, user.id), isNull(chainsTable.deletedAt)));

  const [ticketCommentsResult] = await db.select({ count: count() }).from(commentsTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, commentsTable.ticketId))
    .where(eq(ticketsTable.userId, user.id));
  const [chainCommentsResult] = await db.select({ count: count() }).from(chainCommentsTable)
    .innerJoin(chainsTable, eq(chainsTable.id, chainCommentsTable.chainId))
    .where(and(eq(chainsTable.userId, user.id), isNull(chainsTable.deletedAt)));

  const [followerCountResult] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followingId, user.id));
  const [followingCountResult] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followerId, user.id));

  let isFollowing = false;
  let isFollowedBy = false;
  let followRequestPending = false;
  if (currentUserId && currentUserId !== user.id) {
    const [fwd] = await db.select().from(followsTable).where(
      and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, user.id))
    ).limit(1);
    const [bwd] = await db.select().from(followsTable).where(
      and(eq(followsTable.followerId, user.id), eq(followsTable.followingId, currentUserId))
    ).limit(1);
    isFollowing = !!fwd;
    isFollowedBy = !!bwd;

    if (!isFollowing && user.isPrivate) {
      const [req] = await db.select().from(followRequestsTable).where(
        and(eq(followRequestsTable.fromUserId, currentUserId), eq(followRequestsTable.toUserId, user.id), eq(followRequestsTable.status, "pending"))
      ).limit(1);
      followRequestPending = !!req;
    }
  }

  return {
    id: user.id,
    username: user.username!,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    isPrivate: user.isPrivate,
    ticketCount: Number(ticketCountResult?.count ?? 0),
    chainCount,
    totalLikesReceived: Number(ticketLikesResult?.count ?? 0) + Number(chainLikesResult?.count ?? 0),
    totalCommentsReceived: Number(ticketCommentsResult?.count ?? 0) + Number(chainCommentsResult?.count ?? 0),
    followerCount: Number(followerCountResult?.count ?? 0),
    followingCount: Number(followingCountResult?.count ?? 0),
    isFollowing,
    isFollowedBy,
    followRequestPending,
    // Only expose profileOrder to the profile owner (prevents leaking private/album IDs to others)
    profileOrder: currentUserId === user.id ? (user.profileOrder ?? null) : null,
    // Pinned ticket IDs in user-defined order (only the owner sees the raw list,
    // viewers always get the resolved `pinnedTickets` array below — which is
    // already filtered to public tickets only).
    pinnedTicketIds: isOwner ? pinnedIds : null,
    pinnedTickets,
    createdAt: user.createdAt,
  };
}

export { buildUserProfile };
export default router;
