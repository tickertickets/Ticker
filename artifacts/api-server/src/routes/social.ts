import { createNotification } from "../services/notify.service";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable, likesTable, commentsTable, bookmarksTable, followsTable,
  reportsTable, ticketsTable, notificationsTable, ticketReactionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { sanitize } from "../lib/sanitize";
import { nanoid } from "nanoid";
import { buildTicket } from "./tickets";
import { emitTicketLiked, emitCommentNew, emitCommentDeleted } from "../lib/socket";

const router: IRouter = Router();

const REACTION_TYPES_VALID = ["heart", "fire", "lightning", "sparkle", "popcorn"] as const;
type ReactType = (typeof REACTION_TYPES_VALID)[number];
const REACTION_POINTS: Record<ReactType, number> = {
  heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5,
};

function emptyBreakdown(): Record<ReactType, number> {
  return { heart: 0, fire: 0, lightning: 0, sparkle: 0, popcorn: 0 };
}

async function computeReactionStats(ticketId: string, currentUserId?: string) {
  const allRows = await db
    .select()
    .from(ticketReactionsTable)
    .where(eq(ticketReactionsTable.ticketId, ticketId));

  const totalScore = allRows.reduce(
    (s, r) => s + r.count * (REACTION_POINTS[r.reactionType as ReactType] ?? 1),
    0,
  );

  const reactionBreakdown = emptyBreakdown();
  for (const r of allRows) {
    if (r.reactionType in reactionBreakdown)
      (reactionBreakdown as Record<string, number>)[r.reactionType] += r.count;
  }

  const myReactions = emptyBreakdown();
  let hasReacted = false;
  if (currentUserId) {
    for (const r of allRows.filter((r) => r.userId === currentUserId)) {
      if (r.reactionType in myReactions)
        (myReactions as Record<string, number>)[r.reactionType] = r.count;
    }
    hasReacted = Object.values(myReactions).some((v) => v > 0);
  }

  return { totalScore, reactionBreakdown, myReactions, hasReacted };
}

// ── POST /:ticketId/react — set/update reactions ───────────────────────────
router.post("/:ticketId/react", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;

  const reactionsInput = req.body?.reactions as Record<string, unknown> | undefined;
  if (!reactionsInput || typeof reactionsInput !== "object") {
    res.status(400).json({ error: "bad_request", message: "reactions object required" });
    return;
  }

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  if (!ticket) { res.status(404).json({ error: "not_found" }); return; }

  const prevRows = await db
    .select()
    .from(ticketReactionsTable)
    .where(and(eq(ticketReactionsTable.userId, currentUserId), eq(ticketReactionsTable.ticketId, ticketId)));
  const wasReacted = prevRows.some((r) => r.count > 0);

  for (const type of REACTION_TYPES_VALID) {
    const raw = reactionsInput[type];
    const ct = Math.max(0, Math.min(10, Number(raw ?? 0)));
    if (ct === 0) {
      await db.delete(ticketReactionsTable).where(
        and(
          eq(ticketReactionsTable.userId, currentUserId),
          eq(ticketReactionsTable.ticketId, ticketId),
          eq(ticketReactionsTable.reactionType, type),
        ),
      );
    } else {
      await db
        .insert(ticketReactionsTable)
        .values({ userId: currentUserId, ticketId, reactionType: type, count: ct, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [ticketReactionsTable.userId, ticketReactionsTable.ticketId, ticketReactionsTable.reactionType],
          set: { count: ct, updatedAt: new Date() },
        });
    }
  }

  const stats = await computeReactionStats(ticketId, currentUserId);

  if (!wasReacted && stats.hasReacted && ticket.userId !== currentUserId) {
    await createNotification({
      id: nanoid(),
      userId: ticket.userId,
      fromUserId: currentUserId,
      type: "like",
      ticketId,
      message: "reacted to your ticket",
      isRead: false,
    });
  }

  emitTicketLiked(ticketId, stats.totalScore);
  res.json({ ...stats, liked: stats.hasReacted, likeCount: stats.totalScore });
});

// ── DELETE /:ticketId/react — cancel all user reactions ────────────────────
router.delete("/:ticketId/react", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;

  await db.delete(ticketReactionsTable).where(
    and(eq(ticketReactionsTable.userId, currentUserId), eq(ticketReactionsTable.ticketId, ticketId)),
  );

  const stats = await computeReactionStats(ticketId);
  emitTicketLiked(ticketId, stats.totalScore);
  res.json({ ...stats, liked: false, likeCount: stats.totalScore });
});

// ── Legacy /like routes (compat) — delegates to /react ────────────────────
router.post("/:ticketId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  const rawType = req.body?.reactionType as string | undefined;
  const type: ReactType = (REACTION_TYPES_VALID as readonly string[]).includes(rawType ?? "")
    ? (rawType as ReactType)
    : "heart";

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  if (!ticket) { res.status(404).json({ error: "not_found" }); return; }

  const prevRows = await db
    .select()
    .from(ticketReactionsTable)
    .where(and(eq(ticketReactionsTable.userId, currentUserId), eq(ticketReactionsTable.ticketId, ticketId)));
  const wasReacted = prevRows.some((r) => r.count > 0);

  await db
    .insert(ticketReactionsTable)
    .values({ userId: currentUserId, ticketId, reactionType: type, count: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [ticketReactionsTable.userId, ticketReactionsTable.ticketId, ticketReactionsTable.reactionType],
      set: { count: 1, updatedAt: new Date() },
    });

  const stats = await computeReactionStats(ticketId, currentUserId);

  if (!wasReacted && ticket.userId !== currentUserId) {
    await createNotification({
      id: nanoid(),
      userId: ticket.userId,
      fromUserId: currentUserId,
      type: "like",
      ticketId,
      message: "reacted to your ticket",
      isRead: false,
    });
  }

  emitTicketLiked(ticketId, stats.totalScore);
  res.json({ ...stats, liked: stats.hasReacted, likeCount: stats.totalScore, reactionType: type });
});

router.delete("/:ticketId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  await db.delete(ticketReactionsTable).where(
    and(eq(ticketReactionsTable.userId, currentUserId), eq(ticketReactionsTable.ticketId, ticketId)),
  );
  const stats = await computeReactionStats(ticketId);
  emitTicketLiked(ticketId, stats.totalScore);
  res.json({ ...stats, liked: false, likeCount: stats.totalScore });
});

// ── Comments ───────────────────────────────────────────────────────────────

router.get("/:ticketId/comments", async (req, res) => {
  const { ticketId } = req.params;
  const limit = Math.min(Number(req.query["limit"]) || 100, 200);

  const comments = await db.select({ comment: commentsTable, user: usersTable })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .where(eq(commentsTable.ticketId, ticketId))
    .orderBy(desc(commentsTable.createdAt))
    .limit(limit + 1);

  const hasMore = comments.length > limit;
  const items = comments.slice(0, limit);
  res.json({
    comments: items.map((c) => ({
      id: c.comment.id,
      ticketId: c.comment.ticketId,
      userId: c.comment.userId,
      replyToId: c.comment.replyToId ?? null,
      user: { id: c.user.id, username: c.user.username!, displayName: c.user.displayName, avatarUrl: c.user.avatarUrl },
      content: c.comment.content,
      createdAt: c.comment.createdAt,
    })),
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.comment.id : null,
  });
});

router.post("/:ticketId/comments", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  const { content, replyToId } = req.body;
  if (!content?.trim()) {
    res.status(400).json({ error: "bad_request", message: "Comment content is required" });
    return;
  }
  const clean = sanitize(content.trim());
  const id = nanoid();
  const validReplyToId = replyToId && typeof replyToId === "string" ? replyToId : null;
  await db.insert(commentsTable).values({ id, ticketId, userId: currentUserId, content: clean, replyToId: validReplyToId });

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  if (ticket && ticket.userId !== currentUserId) {
    await createNotification({
      id: nanoid(),
      userId: ticket.userId,
      fromUserId: currentUserId,
      type: "comment",
      ticketId,
      message: "commented on your ticket",
      isRead: false,
    });
  }

  // Notify parent comment author when this is a reply (skip if they're the ticket owner, already notified)
  if (validReplyToId) {
    try {
      const [parentComment] = await db.select({ userId: commentsTable.userId }).from(commentsTable)
        .where(eq(commentsTable.id, validReplyToId)).limit(1);
      const parentAuthorId = parentComment?.userId;
      if (parentAuthorId && parentAuthorId !== currentUserId && parentAuthorId !== ticket?.userId) {
        await createNotification({
          id: nanoid(),
          userId: parentAuthorId,
          fromUserId: currentUserId,
          type: "comment_reply",
          ticketId,
          message: "replied to your comment",
          isRead: false,
        });
      }
    } catch { /* best-effort */ }
  }

  const [comment] = await db.select().from(commentsTable).where(eq(commentsTable.id, id)).limit(1);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
  emitCommentNew(ticketId);
  res.status(201).json({
    id: comment!.id,
    ticketId: comment!.ticketId,
    userId: comment!.userId,
    replyToId: comment!.replyToId ?? null,
    user: { id: user!.id, username: user!.username!, displayName: user!.displayName, avatarUrl: user!.avatarUrl },
    content: comment!.content,
    createdAt: comment!.createdAt,
  });
});

router.delete("/:ticketId/comments/:commentId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { commentId } = req.params;
  const { ticketId } = req.params;
  const [comment] = await db.select().from(commentsTable).where(eq(commentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "not_found" }); return; }
  // comment author OR ticket owner can delete
  if (comment.userId !== currentUserId) {
    const [ticket] = await db.select({ userId: ticketsTable.userId }).from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
    if (!ticket || ticket.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  }
  await db.delete(commentsTable).where(eq(commentsTable.id, commentId));
  emitCommentDeleted(ticketId);
  res.json({ success: true });
});

router.post("/:ticketId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  const existing = await db.select().from(bookmarksTable).where(
    and(eq(bookmarksTable.userId, currentUserId), eq(bookmarksTable.ticketId, ticketId)),
  ).limit(1);
  if (existing.length === 0) {
    await db.insert(bookmarksTable).values({ userId: currentUserId, ticketId });
  }
  res.json({ success: true, message: "Bookmarked" });
});

router.delete("/:ticketId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  await db.delete(bookmarksTable).where(
    and(eq(bookmarksTable.userId, currentUserId), eq(bookmarksTable.ticketId, ticketId)),
  );
  res.json({ success: true, message: "Bookmark removed" });
});

router.post("/:ticketId/report", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { ticketId } = req.params;
  const { reason, details } = req.body;
  if (!reason) { res.status(400).json({ error: "bad_request", message: "reason is required" }); return; }
  await db.insert(reportsTable).values({
    id: nanoid(),
    reporterId: currentUserId,
    ticketId,
    reason,
    details: details ? sanitize(details) : null,
  });
  res.json({ success: true, message: "Report submitted" });
});

export default router;
