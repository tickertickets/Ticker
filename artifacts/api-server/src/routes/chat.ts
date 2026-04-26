import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  conversationParticipantsTable,
  chatMessagesTable,
  usersTable,
  ticketsTable,
  chainsTable,
  chainMoviesTable,
  followsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, gt, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sendPushToUsers } from "../services/push.service";
import { emitChatChanged } from "../lib/socket";

const APP_BASE_URL_CHAT = process.env["APP_BASE_URL"] ?? "/";

const router: IRouter = Router();

type MessageUser = { id: string; username: string; displayName: string | null; avatarUrl: string | null };

async function buildMessage(msg: typeof chatMessagesTable.$inferSelect, sender: typeof usersTable.$inferSelect) {
  let sharedTicket = null;
  let sharedChain = null;

  if (msg.sharedTicketId) {
    const [t] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, msg.sharedTicketId)).limit(1);
    if (t) {
      sharedTicket = {
        id: t.id,
        movieTitle: t.movieTitle,
        movieYear: t.movieYear,
        posterUrl: t.posterUrl,
        cardTheme: t.cardTheme,
        cardBackdropUrl: t.cardBackdropUrl,
        rating: t.rating ? Number(t.rating) : null,
        ratingType: t.ratingType,
        rankTier: t.rankTier,
        currentRankTier: t.currentRankTier,
      };
    }
  }

  if (msg.sharedChainId) {
    const [c] = await db.select().from(chainsTable).where(eq(chainsTable.id, msg.sharedChainId)).limit(1);
    if (c) {
      const [firstMovie] = await db
        .select({ posterUrl: chainMoviesTable.posterUrl })
        .from(chainMoviesTable)
        .where(eq(chainMoviesTable.chainId, c.id))
        .limit(1);
      sharedChain = {
        id: c.id,
        title: c.title,
        description: c.description,
        movieCount: c.movieCount,
        chainCount: c.chainCount,
        posterUrl: firstMovie?.posterUrl ?? null,
      };
    }
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: {
      id: sender.id,
      username: sender.username!,
      displayName: sender.displayName,
      avatarUrl: sender.avatarUrl,
    } as MessageUser,
    content: msg.content,
    imageUrl: msg.imageUrl,
    sharedTicketId: msg.sharedTicketId,
    sharedTicket,
    sharedChainId: msg.sharedChainId,
    sharedChain,
    createdAt: msg.createdAt,
  };
}

async function buildConversation(conv: typeof conversationsTable.$inferSelect, currentUserId: string) {
  const participants = await db.select({ user: usersTable, part: conversationParticipantsTable })
    .from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
    .where(eq(conversationParticipantsTable.conversationId, conv.id));

  const myPart = participants.find(p => p.part.userId === currentUserId);
  const joinedAt = myPart?.part.joinedAt ?? null;

  // Only consider messages received after this user (re)joined the conversation,
  // so a "leave" effectively hides historical messages until the other party
  // sends something new.
  const lastMsgWhere = joinedAt
    ? and(eq(chatMessagesTable.conversationId, conv.id), gte(chatMessagesTable.createdAt, joinedAt))
    : eq(chatMessagesTable.conversationId, conv.id);
  const lastMessages = await db.select({ msg: chatMessagesTable, sender: usersTable })
    .from(chatMessagesTable)
    .innerJoin(usersTable, eq(chatMessagesTable.senderId, usersTable.id))
    .where(lastMsgWhere)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(1);

  const lastMsg = lastMessages[0] ? await buildMessage(lastMessages[0].msg, lastMessages[0].sender) : null;

  return {
    id: conv.id,
    isRequest: conv.isRequest,
    participants: participants.map(p => ({
      id: p.user.id,
      username: p.user.username!,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
    })),
    lastMessage: lastMsg,
    unreadCount: myPart?.part.unreadCount ?? 0,
    updatedAt: conv.updatedAt,
    createdAt: conv.createdAt,
  };
}

// ── GET /chat/conversations ───────────────────────────────────────
router.get("/conversations", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }

  const myConvs = await db.select({ convId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, currentUserId));

  if (myConvs.length === 0) { res.json({ conversations: [] }); return; }

  const convIds = myConvs.map(c => c.convId);
  const conversations = await db.select().from(conversationsTable)
    .where(inArray(conversationsTable.id, convIds))
    .orderBy(desc(conversationsTable.updatedAt));

  const built = await Promise.all(conversations.map(c => buildConversation(c, currentUserId)));
  // Hide conversations the user has soft-left (no visible messages and the
  // thread already had history) — they reappear once the other party sends
  // something new (which lifts updatedAt past joinedAt).
  const visible = built.filter((c) => {
    if (c.lastMessage) return true;
    // No visible messages: only show if the thread is brand new (updatedAt close to createdAt).
    return c.updatedAt && c.createdAt && Math.abs(new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) < 2000;
  });
  res.json({ conversations: visible });
});

// ── GET /chat/conversations/:id ──────────────────────────────────
router.get("/conversations/:conversationId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
  if (!conv) { res.status(404).json({ error: "not found" }); return; }

  const isParticipant = await db.select({ id: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, currentUserId),
    )).limit(1);
  if (!isParticipant.length) { res.status(403).json({ error: "forbidden" }); return; }

  const built = await buildConversation(conv, currentUserId);
  res.json(built);
});

// ── GET /chat/unread-count ────────────────────────────────────────
router.get("/unread-count", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.json({ count: 0 }); return; }

  const [result] = await db
    .select({ total: sql<number>`COALESCE(SUM(${conversationParticipantsTable.unreadCount}), 0)` })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, currentUserId));

  res.json({ count: Number(result?.total ?? 0) });
});

// ── GET /chat/conversations/:id/messages ─────────────────────────
router.get("/conversations/:conversationId/messages", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;
  const limit = Math.min(Number(req.query["limit"]) || 30, 100);
  const after = req.query["after"] as string | undefined;

  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)))
    .limit(1);
  if (!participant) { res.status(403).json({ error: "forbidden" }); return; }

  // Only show messages that arrived after this user's joinedAt — this lets a
  // "leave" effectively start a fresh chat once the other party messages again.
  const joinedAt = participant.joinedAt;

  let query = db.select({ msg: chatMessagesTable, sender: usersTable })
    .from(chatMessagesTable)
    .innerJoin(usersTable, eq(chatMessagesTable.senderId, usersTable.id))
    .where(and(
      eq(chatMessagesTable.conversationId, conversationId),
      gte(chatMessagesTable.createdAt, joinedAt),
    ))
    .$dynamic();

  if (after) {
    // Polling mode: only return messages newer than the given message ID's timestamp
    const [lastMsg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, after)).limit(1);
    if (lastMsg) {
      query = db.select({ msg: chatMessagesTable, sender: usersTable })
        .from(chatMessagesTable)
        .innerJoin(usersTable, eq(chatMessagesTable.senderId, usersTable.id))
        .where(and(
          eq(chatMessagesTable.conversationId, conversationId),
          gte(chatMessagesTable.createdAt, joinedAt),
          gt(chatMessagesTable.createdAt, lastMsg.createdAt),
        ))
        .$dynamic();
    }
    const pollMessages = await query.orderBy(chatMessagesTable.createdAt).limit(50);
    const result = await Promise.all(pollMessages.map(m => buildMessage(m.msg, m.sender)));
    res.json({ messages: result, hasMore: false, nextCursor: null });
    return;
  }

  // Mark as read
  const [before] = await db.select({ u: conversationParticipantsTable.unreadCount })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)))
    .limit(1);
  await db.update(conversationParticipantsTable).set({ unreadCount: 0 })
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)));
  if ((before?.u ?? 0) > 0) {
    // Tell every device this user is on to refresh the chat badge.
    emitChatChanged([currentUserId]);
  }

  const messages = await query
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  const items = messages.slice(0, limit);
  const result = await Promise.all(items.map(m => buildMessage(m.msg, m.sender)));

  res.json({
    messages: result,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.msg.id : null,
  });
});

// ── POST /chat/conversations/:id/messages ─────────────────────────
router.post("/conversations/:conversationId/messages", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;
  const { content, imageUrl, sharedTicketId, sharedChainId } = req.body;

  if (!content && !imageUrl && !sharedTicketId && !sharedChainId) {
    res.status(400).json({ error: "bad_request", message: "content, imageUrl, sharedTicketId, or sharedChainId is required" });
    return;
  }

  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)))
    .limit(1);
  if (!participant) { res.status(403).json({ error: "forbidden" }); return; }

  const id = nanoid();
  await db.insert(chatMessagesTable).values({
    id,
    conversationId,
    senderId: currentUserId,
    content: content ?? null,
    imageUrl: imageUrl ?? null,
    sharedTicketId: sharedTicketId ?? null,
    sharedChainId: sharedChainId ?? null,
  });

  await db.update(conversationsTable).set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, conversationId));

  // Increment unread for other participants
  const allParticipants = await db.select().from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));
  for (const p of allParticipants) {
    if (p.userId === currentUserId) continue;
    await db.update(conversationParticipantsTable)
      .set({ unreadCount: p.unreadCount + 1 })
      .where(and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, p.userId),
      ));
  }

  const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, id)).limit(1);
  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
  const result = await buildMessage(msg!, sender!);

  // Realtime: refresh conversation list + unread badge for everyone in the
  // thread (recipients see the new message, sender sees updated lastMessage).
  emitChatChanged(allParticipants.map((p) => p.userId));

  // Push notify other participants (best-effort)
  (async () => {
    try {
      const recipientIds = allParticipants
        .filter((p) => p.userId !== currentUserId)
        .map((p) => p.userId);
      if (recipientIds.length === 0) return;
      const name = sender?.displayName || (sender?.username ? `@${sender.username}` : "Someone");
      let body: string;
      if (content && typeof content === "string" && content.trim()) {
        const text = content.trim();
        body = text.length > 120 ? text.slice(0, 117) + "…" : text;
      } else if (imageUrl) {
        body = "📷 ส่งรูปมาให้คุณ";
      } else if (sharedTicketId) {
        body = "🎟 แชร์ตั๋วมาให้คุณ";
      } else if (sharedChainId) {
        body = "🔗 แชร์ Chain มาให้คุณ";
      } else {
        body = "ส่งข้อความมาให้คุณ";
      }
      await sendPushToUsers(recipientIds, {
        title: name,
        body,
        url: `${APP_BASE_URL_CHAT}chat/${conversationId}`,
        tag: `chat:${conversationId}`,
        icon: sender?.avatarUrl ?? undefined,
      });
    } catch { /* ignore */ }
  })();

  res.status(201).json(result);
});

// ── POST /chat/start — start or get DM with a user ───────────────
router.post("/start", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { targetUserId } = req.body;
  if (!targetUserId) { res.status(400).json({ error: "bad_request", message: "targetUserId is required" }); return; }
  if (targetUserId === currentUserId) { res.status(400).json({ error: "bad_request", message: "Cannot chat with yourself" }); return; }

  // Check target user
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
  if (!target) { res.status(404).json({ error: "not_found", message: "ไม่พบผู้ใช้" }); return; }

  // Check if sender follows target — determines isRequest for private accounts
  let isRequest = false;
  if (target.isPrivate) {
    const [followEntry] = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, target.id)))
      .limit(1);
    if (!followEntry) isRequest = true;
  }

  // Find existing DM
  const myConvs = await db.select({ convId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, currentUserId));
  const myConvIds = myConvs.map(c => c.convId);

  if (myConvIds.length > 0) {
    const theirConvs = await db.select({ convId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.userId, targetUserId), inArray(conversationParticipantsTable.conversationId, myConvIds)));
    if (theirConvs.length > 0) {
      const [existing] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, theirConvs[0]!.convId)).limit(1);
      const result = await buildConversation(existing!, currentUserId);
      res.json(result);
      return;
    }
  }

  const id = nanoid();
  await db.insert(conversationsTable).values({ id, isRequest });
  await db.insert(conversationParticipantsTable).values([
    { conversationId: id, userId: currentUserId },
    { conversationId: id, userId: targetUserId },
  ]);

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id)).limit(1);
  const result = await buildConversation(conv!, currentUserId);
  res.json(result);
});

// ── DELETE /chat/messages/:messageId — delete own message ────────
router.delete("/messages/:messageId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { messageId } = req.params;

  const [msg] = await db.select().from(chatMessagesTable)
    .where(eq(chatMessagesTable.id, messageId)).limit(1);
  if (!msg) { res.status(404).json({ error: "not_found" }); return; }
  if (msg.senderId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, messageId));
  res.json({ success: true });
});

// ── DELETE /chat/conversations/:conversationId — leave conversation ─
router.delete("/conversations/:conversationId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;

  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, currentUserId),
    )).limit(1);
  if (!participant) { res.status(403).json({ error: "forbidden" }); return; }

  // Soft-leave: keep the participant row but bump joinedAt to "now" so the
  // user no longer sees old messages. The conversation hides from their list
  // until the other party sends a new message (which will exceed joinedAt).
  await db.update(conversationParticipantsTable)
    .set({ joinedAt: new Date(), unreadCount: 0 })
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, currentUserId),
    ));
  emitChatChanged([currentUserId]);
  res.json({ success: true });
});

// ── POST /chat/conversations/:id/accept-request — accept a message request ─
router.post("/conversations/:conversationId/accept-request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
  if (!conv) { res.status(404).json({ error: "not_found" }); return; }
  if (!conv.isRequest) { res.json({ success: true }); return; }

  // Verify current user is a participant and is the RECEIVER (not the requester).
  // The requester is the one who sent the first message — we find them by checking who sent the first message.
  const firstMsg = await db.select().from(chatMessagesTable)
    .where(eq(chatMessagesTable.conversationId, conversationId))
    .orderBy(chatMessagesTable.createdAt)
    .limit(1);
  const requesterId = firstMsg[0]?.senderId;
  if (!requesterId || requesterId === currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)))
    .limit(1);
  if (!participant) { res.status(403).json({ error: "forbidden" }); return; }

  await db.update(conversationsTable).set({ isRequest: false }).where(eq(conversationsTable.id, conversationId));
  res.json({ success: true });
});

// ── DELETE /chat/conversations/:id/decline-request — decline a message request ─
router.delete("/conversations/:conversationId/decline-request", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { conversationId } = req.params;

  const [participant] = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, currentUserId)))
    .limit(1);
  if (!participant) { res.status(403).json({ error: "forbidden" }); return; }

  // Delete the entire conversation (cascade removes participants + messages)
  await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  res.json({ success: true });
});

export default router;
