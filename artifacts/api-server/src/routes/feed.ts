import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  chainsTable,
  chainRunsTable,
  chainLikesTable,
  chainCommentsTable,
  followsTable,
  likesTable,
  commentsTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, count, max, inArray, ne, or, sql } from "drizzle-orm";
import { hotScore } from "../lib/hot-score";
import { buildChain } from "./chains";
import { buildTicketBatch } from "../services/tickets.service";

const router: IRouter = Router();

/**
 * GET /api/feed
 *
 * Unified ranked feed mixing Tickets and Chains via a shared hotScore.
 *
 * mode=discover  All public content, scored by hotScore (default)
 * mode=home      Two-tier: followed users get 2× affinity boost (Tier A)
 *                + public discovery (Tier B) — Instagram-style
 * mode=following Only posts from followed users + own posts, hotScore ranked
 *
 * Returns: { items: FeedItem[], hasMore: boolean }
 * FeedItem = { type: "ticket", ticket: ... } | { type: "chain", chain: ... }
 */
router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const mode = (req.query["mode"] as string) || "discover";
  const POOL = limit * 5;

  // ── Get followed user IDs ────────────────────────────────────────────────────
  let followedIds: string[] = [];
  if ((mode === "home" || mode === "following") && currentUserId) {
    const rows = await db
      .select({ followingId: followsTable.followingId })
      .from(followsTable)
      .where(eq(followsTable.followerId, currentUserId));
    followedIds = rows.map((r) => r.followingId);
  }
  const followedSet = new Set([
    ...followedIds,
    ...(currentUserId ? [currentUserId] : []),
  ]);

  // ── Identify private users so their content is excluded from ALL feeds ───────
  let privateUserIds: Set<string> = new Set();
  if (followedIds.length > 0 || (mode !== "following" && mode !== "home")) {
    const privateRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, true));
    for (const r of privateRows) privateUserIds.add(r.id);
  }

  // No permanent affinity multiplier — every post competes equally on hotScore
  // once outside the fresh window. Followed users only get a head start via the
  // fresh-post boost below.
  const affinity = (_uid: string) => 1.0;

  // Fresh-post boost: posts ≤ 60 min old from people you follow (or yourself)
  // get a temporary multiplier that decays linearly from 15× → 1× over the
  // window. After expiry they compete purely on hotScore — if they became
  // popular during that window they stay up naturally.
  //
  // In ALL modes (including discover), own posts always receive the boost so
  // a user sees their own freshly-created post at the top of every feed.
  const FRESH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
  const freshBoost = (userId: string, createdAt: Date): number => {
    const isOwnPost = currentUserId && userId === currentUserId;
    const isFollowedPost = mode === "home" || mode === "following" ? followedSet.has(userId) : false;
    if (!isOwnPost && !isFollowedPost) return 1.0;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs >= FRESH_WINDOW_MS) return 1.0;
    const t = ageMs / FRESH_WINDOW_MS; // 0 = just posted, 1 = expired
    return 1.0 + 14.0 * (1 - t);      // 15× at t=0, 1× at t=1
  };

  // ── Fetch ticket pool ────────────────────────────────────────────────────────
  let ticketPool: (typeof ticketsTable.$inferSelect)[] = [];

  if (mode === "following" && currentUserId) {
    const feedUserIds = [...followedSet];
    if (feedUserIds.length > 0) {
      const raw = await db
        .select()
        .from(ticketsTable)
        .where(
          and(
            isNull(ticketsTable.deletedAt),
            or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
            inArray(ticketsTable.userId, feedUserIds),
          ),
        )
        .orderBy(desc(sql`GREATEST(
          ${ticketsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
        )`))
        .limit(POOL);
      // Keep own posts; exclude private posts and posts from private accounts
      ticketPool = raw.filter(
        (t) => t.userId === currentUserId || (!t.isPrivate && !privateUserIds.has(t.userId)),
      );
    }
  } else {
    // discover / home: all public users' non-private, non-reel tickets
    const publicUserRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds = publicUserRows.map((r) => r.id);
    if (publicUserIds.length > 0) {
      ticketPool = await db
        .select()
        .from(ticketsTable)
        .where(
          and(
            isNull(ticketsTable.deletedAt),
            or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
            eq(ticketsTable.isPrivate, false),
            inArray(ticketsTable.userId, publicUserIds),
          ),
        )
        .orderBy(desc(sql`GREATEST(
          ${ticketsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
        )`))
        .limit(POOL);
    }
  }

  // ── Fetch chain pool ─────────────────────────────────────────────────────────
  let chainPool: (typeof chainsTable.$inferSelect)[] = [];

  if (mode === "following" && currentUserId) {
    const feedUserIds = [...followedSet];
    if (feedUserIds.length > 0) {
      const raw = await db
        .select()
        .from(chainsTable)
        .where(
          and(
            isNull(chainsTable.deletedAt),
            inArray(chainsTable.userId, feedUserIds),
          ),
        )
        .orderBy(desc(sql`GREATEST(
          ${chainsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
          COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt})
        )`))
        .limit(POOL);
      chainPool = raw.filter(
        (c) => c.userId === currentUserId || (!c.isPrivate && !privateUserIds.has(c.userId)),
      );
    }
  } else {
    // discover / home: all public chains from public users
    chainPool = await db
      .select({ chain: chainsTable })
      .from(chainsTable)
      .innerJoin(usersTable, and(eq(usersTable.id, chainsTable.userId), eq(usersTable.isPrivate, false)))
      .where(and(isNull(chainsTable.deletedAt), eq(chainsTable.isPrivate, false)))
      .orderBy(desc(sql`GREATEST(
        ${chainsTable.createdAt},
        COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
        COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
        COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt})
      )`))
      .limit(POOL)
      .then(rows => rows.map(r => r.chain));
  }

  // ── Bulk score tickets ───────────────────────────────────────────────────────
  type ScoredTicket = {
    type: "ticket";
    data: typeof ticketsTable.$inferSelect;
    score: number;
  };
  type ScoredChain = {
    type: "chain";
    data: typeof chainsTable.$inferSelect;
    score: number;
  };
  type ScoredItem = ScoredTicket | ScoredChain;

  const scoredItems: ScoredItem[] = [];

  if (ticketPool.length > 0) {
    const ids = ticketPool.map((t) => t.id);
    const [likeRows, commentRows] = await Promise.all([
      db
        .select({
          ticketId: likesTable.ticketId,
          n: count(),
          lastAt: max(likesTable.createdAt),
        })
        .from(likesTable)
        .where(inArray(likesTable.ticketId, ids))
        .groupBy(likesTable.ticketId),
      db
        .select({
          ticketId: commentsTable.ticketId,
          n: count(),
          lastAt: max(commentsTable.createdAt),
        })
        .from(commentsTable)
        .where(inArray(commentsTable.ticketId, ids))
        .groupBy(commentsTable.ticketId),
    ]);
    const likeMap = new Map(likeRows.map((r) => [r.ticketId, Number(r.n)]));
    const commentMap = new Map(
      commentRows.map((r) => [r.ticketId, Number(r.n)]),
    );
    const likeLastAt = new Map(
      likeRows.map((r) => [
        r.ticketId,
        r.lastAt ? new Date(r.lastAt) : null,
      ]),
    );
    const cmtLastAt = new Map(
      commentRows.map((r) => [
        r.ticketId,
        r.lastAt ? new Date(r.lastAt) : null,
      ]),
    );
    for (const t of ticketPool) {
      const la = likeLastAt.get(t.id);
      const ca = cmtLastAt.get(t.id);
      const lastActivityAt = [t.createdAt, la, ca]
        .filter((d): d is Date => d instanceof Date)
        .reduce((a, b) => (a > b ? a : b), t.createdAt);
      const base = hotScore({
        likes: likeMap.get(t.id) ?? 0,
        comments: commentMap.get(t.id) ?? 0,
        lastActivityAt,
      });
      scoredItems.push({ type: "ticket", data: t, score: base * affinity(t.userId) * freshBoost(t.userId, t.createdAt) });
    }
  }

  // ── Bulk score chains ────────────────────────────────────────────────────────
  if (chainPool.length > 0) {
    const ids = chainPool.map((c) => c.id);
    const [likeRows, commentRows, runRows] = await Promise.all([
      db
        .select({
          chainId: chainLikesTable.chainId,
          n: count(),
          lastAt: max(chainLikesTable.createdAt),
        })
        .from(chainLikesTable)
        .where(inArray(chainLikesTable.chainId, ids))
        .groupBy(chainLikesTable.chainId),
      db
        .select({
          chainId: chainCommentsTable.chainId,
          n: count(),
          lastAt: max(chainCommentsTable.createdAt),
        })
        .from(chainCommentsTable)
        .where(inArray(chainCommentsTable.chainId, ids))
        .groupBy(chainCommentsTable.chainId),
      db
        .select({
          chainId: chainRunsTable.chainId,
          n: count(),
          lastAt: max(chainRunsTable.startedAt),
        })
        .from(chainRunsTable)
        .where(inArray(chainRunsTable.chainId, ids))
        .groupBy(chainRunsTable.chainId),
    ]);
    const likeMap = new Map(likeRows.map((r) => [r.chainId, Number(r.n)]));
    const commentMap = new Map(
      commentRows.map((r) => [r.chainId, Number(r.n)]),
    );
    const runMap = new Map(runRows.map((r) => [r.chainId, Number(r.n)]));
    const likeLastAt = new Map(
      likeRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]),
    );
    const cmtLastAt = new Map(
      commentRows.map((r) => [
        r.chainId,
        r.lastAt ? new Date(r.lastAt) : null,
      ]),
    );
    const runLastAt = new Map(
      runRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]),
    );
    for (const c of chainPool) {
      const lastActivityAt = [
        c.createdAt,
        likeLastAt.get(c.id),
        cmtLastAt.get(c.id),
        runLastAt.get(c.id),
      ]
        .filter((d): d is Date => d instanceof Date)
        .reduce((a, b) => (a > b ? a : b), c.createdAt);
      const base = hotScore({
        likes: likeMap.get(c.id) ?? 0,
        comments: commentMap.get(c.id) ?? 0,
        bonus: runMap.get(c.id) ?? c.chainCount,
        lastActivityAt,
      });
      scoredItems.push({ type: "chain", data: c, score: base * affinity(c.userId) * freshBoost(c.userId, c.createdAt) });
    }
  }

  // ── Merge and sort ───────────────────────────────────────────────────────────
  scoredItems.sort((a, b) => b.score - a.score);
  const hasMore = scoredItems.length > limit;
  const page = scoredItems.slice(0, limit);

  // ── Build full objects ───────────────────────────────────────────────────────
  const rawTickets = page
    .filter((i): i is ScoredTicket => i.type === "ticket")
    .map((i) => i.data);
  const rawChains = page
    .filter((i): i is ScoredChain => i.type === "chain")
    .map((i) => i.data);

  const [builtTickets, builtChains] = await Promise.all([
    rawTickets.length > 0 ? buildTicketBatch(rawTickets, currentUserId) : [],
    Promise.all(rawChains.map((c) => buildChain(c, currentUserId))),
  ]);

  const ticketMap = new Map(builtTickets.map((t) => [t.id, t]));
  const chainMap = new Map(builtChains.map((c) => [c.id, c]));

  const items = page
    .map((scored) => {
      if (scored.type === "ticket") {
        const ticket = ticketMap.get(scored.data.id);
        return ticket ? { type: "ticket" as const, ticket } : null;
      } else {
        const chain = chainMap.get(scored.data.id);
        return chain ? { type: "chain" as const, chain } : null;
      }
    })
    .filter(Boolean);

  res.json({ items, hasMore });
});

export default router;
