import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  chainsTable,
  chainRunsTable,
  chainLikesTable,
  chainCommentsTable,
  chainBookmarksTable,
  followsTable,
  likesTable,
  commentsTable,
  bookmarksTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, count, countDistinct, max, inArray, ne, or, sql, lt } from "drizzle-orm";
import { hotScore, makeFreshBoost, applyDiversityCap, DIVERSITY_CAP, AFFINITY_FOLLOWED } from "../lib/hot-score";
import { buildChain } from "./chains";
import { buildTicketBatch } from "../services/tickets.service";

const router: IRouter = Router();

/**
 * GET /api/feed
 *
 * Unified ranked feed mixing Tickets and Chains via a shared hotScore.
 *
 * mode=discover  All public content, scored by hotScore (default)
 * mode=home      Followed users get AFFINITY_FOLLOWED (2×) permanent score boost
 *                on top of freshBoost — ensures their content surfaces even after
 *                the 60-min fresh window (Instagram-style persistent affinity)
 * mode=following Only posts from followed users + own posts, hotScore ranked
 *
 * Ranking formula (industry-standard):
 *   engagement = log(1+likes)×1 + log(1+saves)×1.5 + log(1+comments)×2 + log(1+runs)×3
 *   score      = (engagement + 1) / (hours_since_last_activity + 2) ^ 1.8
 *
 * Diversity cap: max DIVERSITY_CAP posts per user per page — prevents any
 * single viral user from monopolising the feed (Twitter/Instagram standard).
 *
 * Returns: { items: FeedItem[], hasMore: boolean }
 * FeedItem = { type: "ticket", ticket: ... } | { type: "chain", chain: ... }
 */
router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const mode = (req.query["mode"] as string) || "discover";
  // Larger pool ensures diversity cap has enough candidates to fill the page
  const POOL = limit * 6;
  // Cursor for pagination: ISO timestamp of the oldest createdAt from the previous page
  const beforeParam = req.query["before"] as string | undefined;
  const beforeDate = beforeParam ? new Date(beforeParam) : null;

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

  // freshBoost:
  //   • discover mode → only own posts get the fresh window boost (fair ranking)
  //   • home / following mode → followed users also get a boost (personal feed)
  const freshBoostFollowedSet = (mode === "home" || mode === "following") ? followedSet : null;
  const freshBoost = makeFreshBoost(freshBoostFollowedSet, currentUserId);

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
            beforeDate ? lt(ticketsTable.createdAt, beforeDate) : undefined,
          ),
        )
        .orderBy(desc(sql`GREATEST(
          ${ticketsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
        )`))
        .limit(POOL);
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
            beforeDate ? lt(ticketsTable.createdAt, beforeDate) : undefined,
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
            beforeDate ? lt(chainsTable.createdAt, beforeDate) : undefined,
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
      .where(and(
        isNull(chainsTable.deletedAt),
        eq(chainsTable.isPrivate, false),
        beforeDate ? lt(chainsTable.createdAt, beforeDate) : undefined,
      ))
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
    const [likeRows, commentRows, saveRows] = await Promise.all([
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
      db
        .select({
          ticketId: bookmarksTable.ticketId,
          n: count(),
        })
        .from(bookmarksTable)
        .where(inArray(bookmarksTable.ticketId, ids))
        .groupBy(bookmarksTable.ticketId),
    ]);
    const likeMap    = new Map(likeRows.map((r) => [r.ticketId, Number(r.n)]));
    const commentMap = new Map(commentRows.map((r) => [r.ticketId, Number(r.n)]));
    const saveMap    = new Map(saveRows.map((r) => [r.ticketId, Number(r.n)]));
    const likeLastAt = new Map(likeRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));
    const cmtLastAt  = new Map(commentRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));
    for (const t of ticketPool) {
      const la = likeLastAt.get(t.id);
      const ca = cmtLastAt.get(t.id);
      const lastActivityAt = [t.createdAt, la, ca]
        .filter((d): d is Date => d instanceof Date)
        .reduce((a, b) => (a > b ? a : b), t.createdAt);
      const base = hotScore({
        likes:    likeMap.get(t.id) ?? 0,
        comments: commentMap.get(t.id) ?? 0,
        saves:    saveMap.get(t.id) ?? 0,
        lastActivityAt,
      });
      // home mode: permanently boost followed users' content so it surfaces beyond the 60-min fresh window
      const affinity = (mode === "home" && followedIds.length > 0 && followedSet.has(t.userId) && t.userId !== currentUserId)
        ? AFFINITY_FOLLOWED
        : 1.0;
      scoredItems.push({ type: "ticket", data: t, score: base * affinity * freshBoost(t.userId, t.createdAt) });
    }
  }

  // ── Bulk score chains ────────────────────────────────────────────────────────
  if (chainPool.length > 0) {
    const ids = chainPool.map((c) => c.id);
    const [likeRows, commentRows, runRows, saveRows] = await Promise.all([
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
          n: countDistinct(chainRunsTable.userId), // unique participants, not total runs
          lastAt: max(chainRunsTable.startedAt),
        })
        .from(chainRunsTable)
        .where(inArray(chainRunsTable.chainId, ids))
        .groupBy(chainRunsTable.chainId),
      db
        .select({
          chainId: chainBookmarksTable.chainId,
          n: count(),
        })
        .from(chainBookmarksTable)
        .where(inArray(chainBookmarksTable.chainId, ids))
        .groupBy(chainBookmarksTable.chainId),
    ]);
    const likeMap    = new Map(likeRows.map((r) => [r.chainId, Number(r.n)]));
    const commentMap = new Map(commentRows.map((r) => [r.chainId, Number(r.n)]));
    const runMap     = new Map(runRows.map((r) => [r.chainId, Number(r.n)]));
    const saveMap    = new Map(saveRows.map((r) => [r.chainId, Number(r.n)]));
    const likeLastAt = new Map(likeRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
    const cmtLastAt  = new Map(commentRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
    const runLastAt  = new Map(runRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
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
        likes:    likeMap.get(c.id) ?? 0,
        comments: commentMap.get(c.id) ?? 0,
        bonus:    runMap.get(c.id) ?? 0,
        saves:    saveMap.get(c.id) ?? 0,
        lastActivityAt,
      });
      const chainAffinity = (mode === "home" && followedIds.length > 0 && followedSet.has(c.userId) && c.userId !== currentUserId)
        ? AFFINITY_FOLLOWED
        : 1.0;
      scoredItems.push({ type: "chain", data: c, score: base * chainAffinity * freshBoost(c.userId, c.createdAt) });
    }
  }

  // ── Merge, sort, apply diversity cap ─────────────────────────────────────────
  // 1. Sort by hotScore descending; tiebreak by newest content first.
  scoredItems.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-10) return diff;
    return b.data.createdAt.getTime() - a.data.createdAt.getTime();
  });

  // 2. Diversity cap applied SEPARATELY per content type so that a user's
  //    chains cannot crowd out their own tickets (and vice-versa).
  //    Each type gets up to effectiveCap posts per user, then both lists are
  //    merged and re-sorted by hotScore before the final page slice.
  //
  //    Small-pool relaxation: when the pool is smaller than one full page
  //    (i.e. total content < limit), all posts fit on a single page anyway,
  //    so the diversity cap would only hide content — defeat its purpose.
  //    In that case, lift the cap to show everything. The hard cap only
  //    kicks in for large feeds where a single viral user could monopolise.
  const ticketItems = scoredItems.filter((i): i is ScoredTicket => i.type === "ticket");
  const chainItems  = scoredItems.filter((i): i is ScoredChain  => i.type === "chain");

  const effectiveTicketCap = ticketItems.length <= limit ? ticketItems.length : DIVERSITY_CAP;
  const effectiveChainCap  = chainItems.length  <= limit ? chainItems.length  : DIVERSITY_CAP;

  const cappedTickets = applyDiversityCap(ticketItems, (i) => i.data.userId, effectiveTicketCap, ticketItems.length);
  const cappedChains  = applyDiversityCap(chainItems,  (i) => i.data.userId, effectiveChainCap,  chainItems.length);

  // Re-merge and sort by hotScore descending; request limit+1 to detect hasMore
  const merged = [...cappedTickets, ...cappedChains].sort((a, b) => b.score - a.score);
  const diversified = merged.slice(0, limit + 1);

  const hasMore = diversified.length > limit;
  const page = diversified.slice(0, limit);

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
  const chainMap  = new Map(builtChains.map((c) => [c.id, c]));

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

  // nextCursor = ISO timestamp of the oldest createdAt on this page (used as `before` param for next page)
  const nextCursor = page.length > 0
    ? page.reduce((oldest, item) =>
        item.data.createdAt < oldest.data.createdAt ? item : oldest
      ).data.createdAt.toISOString()
    : null;

  res.json({ items, hasMore, nextCursor });
});

export default router;
