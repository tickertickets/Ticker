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
  feedSignalsTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, count, countDistinct, max, inArray, ne, or, sql, lt, gte } from "drizzle-orm";
import {
  hotScore,
  makeFreshBoost,
  applyDiversitySpread,
  applyContentTypeInterleave,
  DIVERSITY_CAP,
  AFFINITY_FOLLOWED,
  computeGenreAffinity,
  makeGenreBoost,
} from "../lib/hot-score";
import { buildChain } from "./chains";
import { buildTicketBatch } from "../services/tickets.service";

const router: IRouter = Router();

/**
 * GET /api/feed
 *
 * Unified ranked feed mixing Tickets and Chains via a shared hotScore.
 *
 * ── Modes ────────────────────────────────────────────────────────────────────
 * mode=discover  All public content, pure hotScore ranking (default)
 * mode=home      Followed users get AFFINITY_FOLLOWED (2×) + freshBoost on top
 *                of hotScore — ensures their content surfaces even after the
 *                60-min fresh window (Instagram-style persistent affinity)
 * mode=following Only posts from followed users + own posts, hotScore ranked
 *
 * ── Ranking formula (industry-standard) ─────────────────────────────────────
 *   engagement = log(1+likes)×1 + log(1+saves)×1.5 + log(1+comments)×2 + log(1+runs)×3
 *   score      = (engagement + 1) / (hours_since_last_activity + 2) ^ 1.8
 *
 * ── Pagination ───────────────────────────────────────────────────────────────
 * home / discover  → offset-based cursor ("cursor" query param, encoded integer).
 *   The full pool is scored, diversity-spread, and content-type-interleaved
 *   ONCE per request; the cursor slices into that stable ordered list.
 *   Using a timestamp cursor on a score-ranked feed is fundamentally wrong:
 *   new posts created after the cursor date would be silently skipped on page 2+.
 *
 * following        → timestamp cursor ("cursor" query param, ISO date string).
 *   Chronological feeds are sorted by time, so a time cursor is correct here.
 *
 * ── Diversity controls ───────────────────────────────────────────────────────
 * Author diversity  — applyDiversitySpread: cooldown-based, prevents the same
 *   author from occupying consecutive slots. Hard cap = DIVERSITY_CAP per
 *   page-equivalent window (Twitter/Instagram standard).
 * Content-type diversity — applyContentTypeInterleave: prevents > 2 consecutive
 *   items of the same type (Ticket or Chain) when both types exist (Instagram,
 *   TikTok standard).
 *
 * ── Pool time window ─────────────────────────────────────────────────────────
 * home / discover fetch content from the last POOL_DAYS days only.
 * This keeps the ranking pool at a manageable size as the platform grows;
 * content older than this has decayed to near-zero hotScore anyway.
 * "following" has no time window — users expect to see all recent posts from
 * people they follow regardless of age.
 *
 * Returns: { items: FeedItem[], hasMore: boolean, nextCursor: string | null }
 * FeedItem = { type: "ticket", ticket: ... } | { type: "chain", chain: ... }
 */

const POOL_DAYS = 60; // ranked feeds only consider posts from the last N days

router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const mode = (req.query["mode"] as string) || "discover";

  // Raw DB fetch size: large enough that after diversity filtering we still
  // have at least `limit` items even in a thin-pool scenario.
  const POOL = limit * 6;

  // ── Cursor parsing ───────────────────────────────────────────────────────────
  // home / discover: integer offset (position in the ranked list)
  // following:       ISO timestamp (posts created before this time)
  const cursorParam = req.query["cursor"] as string | undefined;

  // Legacy "before" param kept for backwards compat (old clients may still send it)
  const legacyBefore = req.query["before"] as string | undefined;
  const rawCursor = cursorParam ?? legacyBefore;

  let rankedOffset = 0;        // for home / discover
  let followingBefore: Date | null = null; // for following

  if (rawCursor) {
    if (mode === "following") {
      const d = new Date(rawCursor);
      if (!isNaN(d.getTime())) followingBefore = d;
    } else {
      const n = parseInt(rawCursor, 10);
      if (!isNaN(n) && n > 0) rankedOffset = n;
    }
  }

  // ── Client-side seen-ID exclusion ────────────────────────────────────────────
  // Frontend passes IDs already shown to prevent ranked duplicates on load-more.
  const excludeParam = req.query["exclude"] as string | undefined;
  const clientExcludeIds = excludeParam
    ? new Set(excludeParam.split(",").map((s) => s.trim()).filter(Boolean))
    : new Set<string>();

  // ── User "Not interested" / hide signals ─────────────────────────────────────
  // Items the user has dismissed are permanently excluded from their feed.
  const hiddenTicketIds = new Set<string>();
  const hiddenChainIds  = new Set<string>();
  if (currentUserId) {
    const signals = await db
      .select({ itemId: feedSignalsTable.itemId, itemType: feedSignalsTable.itemType })
      .from(feedSignalsTable)
      .where(eq(feedSignalsTable.userId, currentUserId));
    for (const s of signals) {
      if (s.itemType === "ticket") hiddenTicketIds.add(s.itemId);
      else if (s.itemType === "chain") hiddenChainIds.add(s.itemId);
    }
  }

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

  // ── Identify private users so their content is excluded from public feeds ────
  let privateUserIds: Set<string> = new Set();
  {
    const privateRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, true));
    for (const r of privateRows) privateUserIds.add(r.id);
    if (currentUserId) privateUserIds.delete(currentUserId);
  }

  // freshBoost:
  //   • discover → only own posts get the fresh window (fair public ranking)
  //   • home / following → followed users also get the boost
  const freshBoostFollowedSet = (mode === "home" || mode === "following") ? followedSet : null;
  const freshBoost = makeFreshBoost(freshBoostFollowedSet, currentUserId);

  // ── Genre affinity (home mode — personalised ranking) ────────────────────────
  // Computes a genre interest profile from the user's own tickets, liked tickets,
  // and bookmarked tickets.  Applied as a 1.0–1.4× multiplier during ticket
  // scoring.  Chains don't carry a genre field, so only tickets are boosted.
  let genreBoostFn: (genre: string | null | undefined) => number = () => 1.0;
  if (mode === "home" && currentUserId) {
    const [ownGenreRows, likedGenreRows, savedGenreRows] = await Promise.all([
      db.select({ genre: ticketsTable.genre }).from(ticketsTable)
        .where(and(eq(ticketsTable.userId, currentUserId), isNull(ticketsTable.deletedAt)))
        .limit(300),
      db.select({ genre: ticketsTable.genre }).from(ticketsTable)
        .innerJoin(likesTable, eq(likesTable.ticketId, ticketsTable.id))
        .where(and(eq(likesTable.userId, currentUserId), isNull(ticketsTable.deletedAt)))
        .limit(300),
      db.select({ genre: ticketsTable.genre }).from(ticketsTable)
        .innerJoin(bookmarksTable, eq(bookmarksTable.ticketId, ticketsTable.id))
        .where(and(eq(bookmarksTable.userId, currentUserId), isNull(ticketsTable.deletedAt)))
        .limit(150),
    ]);
    const allGenres = [
      ...ownGenreRows.map((r) => r.genre),
      ...likedGenreRows.map((r) => r.genre),
      ...savedGenreRows.map((r) => r.genre),
      ...savedGenreRows.map((r) => r.genre), // bookmarks double-weighted (strong intent signal)
    ].filter((g): g is string => Boolean(g));
    genreBoostFn = makeGenreBoost(computeGenreAffinity(allGenres));
  }

  // ── Pool time window (ranked modes only) ─────────────────────────────────────
  const poolWindowStart = (mode !== "following")
    ? new Date(Date.now() - POOL_DAYS * 24 * 60 * 60 * 1000)
    : null;

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
            isNull(ticketsTable.archivedAt),
            or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
            inArray(ticketsTable.userId, feedUserIds),
            // Chronological feed: time cursor is correct here
            followingBefore ? lt(ticketsTable.createdAt, followingBefore) : undefined,
          ),
        )
        .orderBy(desc(ticketsTable.createdAt))
        .limit(POOL);
      ticketPool = raw.filter(
        (t) => t.userId === currentUserId || (!t.isPrivate && (!privateUserIds.has(t.userId) || followedSet.has(t.userId))),
      );
      if (hiddenTicketIds.size > 0 || clientExcludeIds.size > 0)
        ticketPool = ticketPool.filter((t) => !hiddenTicketIds.has(t.id) && !clientExcludeIds.has(t.id));
    }
  } else {
    // discover / home: all public non-private non-reel tickets within the time window
    const publicUserRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds = publicUserRows.map((r) => r.id);

    const includedUserIds = (mode === "home" && currentUserId)
      ? [...new Set([...publicUserIds, ...followedIds, currentUserId])]
      : publicUserIds;

    if (includedUserIds.length > 0) {
      const raw = await db
        .select()
        .from(ticketsTable)
        .where(
          and(
            isNull(ticketsTable.deletedAt),
            isNull(ticketsTable.archivedAt),
            or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
            or(
              eq(ticketsTable.isPrivate, false),
              currentUserId ? eq(ticketsTable.userId, currentUserId) : undefined,
            ),
            inArray(ticketsTable.userId, includedUserIds),
            // Ranked feed: time window keeps the pool size bounded, NOT a pagination cursor
            poolWindowStart ? gte(ticketsTable.createdAt, poolWindowStart) : undefined,
          ),
        )
        .orderBy(desc(sql`GREATEST(
          ${ticketsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
        )`))
        .limit(POOL);
      ticketPool = (mode === "home" && currentUserId)
        ? raw.filter(t => t.userId === currentUserId || !privateUserIds.has(t.userId) || followedSet.has(t.userId))
        : raw;
      if (hiddenTicketIds.size > 0 || clientExcludeIds.size > 0)
        ticketPool = ticketPool.filter((t) => !hiddenTicketIds.has(t.id) && !clientExcludeIds.has(t.id));
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
            followingBefore ? lt(chainsTable.createdAt, followingBefore) : undefined,
          ),
        )
        .orderBy(desc(chainsTable.createdAt))
        .limit(POOL);
      chainPool = raw.filter(
        (c) => c.userId === currentUserId || (!c.isPrivate && (!privateUserIds.has(c.userId) || followedSet.has(c.userId))),
      );
      if (hiddenChainIds.size > 0 || clientExcludeIds.size > 0)
        chainPool = chainPool.filter((c) => !hiddenChainIds.has(c.id) && !clientExcludeIds.has(c.id));
    }
  } else {
    const publicUserRows2 = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds2 = publicUserRows2.map((r) => r.id);

    const includedChainUserIds = (mode === "home" && currentUserId)
      ? [...new Set([...publicUserIds2, ...followedIds, currentUserId])]
      : publicUserIds2;

    if (includedChainUserIds.length > 0) {
      const raw = await db
        .select()
        .from(chainsTable)
        .where(and(
          isNull(chainsTable.deletedAt),
          or(
            eq(chainsTable.isPrivate, false),
            currentUserId ? eq(chainsTable.userId, currentUserId) : undefined,
          ),
          inArray(chainsTable.userId, includedChainUserIds),
          poolWindowStart ? gte(chainsTable.createdAt, poolWindowStart) : undefined,
        ))
        .orderBy(desc(sql`GREATEST(
          ${chainsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
          COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt})
        )`))
        .limit(POOL);
      chainPool = (mode === "home" && currentUserId)
        ? raw.filter(c => c.userId === currentUserId || !privateUserIds.has(c.userId) || followedSet.has(c.userId))
        : raw;
      if (hiddenChainIds.size > 0 || clientExcludeIds.size > 0)
        chainPool = chainPool.filter((c) => !hiddenChainIds.has(c.id) && !clientExcludeIds.has(c.id));
    }
  }

  // ── Score tickets ────────────────────────────────────────────────────────────
  type ScoredTicket = { type: "ticket"; data: typeof ticketsTable.$inferSelect; score: number };
  type ScoredChain  = { type: "chain";  data: typeof chainsTable.$inferSelect;  score: number };
  type ScoredItem   = ScoredTicket | ScoredChain;

  const scoredItems: ScoredItem[] = [];

  if (ticketPool.length > 0) {
    const ids = ticketPool.map((t) => t.id);
    const [likeRows, commentRows, saveRows] = await Promise.all([
      db
        .select({ ticketId: likesTable.ticketId, n: count(), lastAt: max(likesTable.createdAt) })
        .from(likesTable)
        .where(inArray(likesTable.ticketId, ids))
        .groupBy(likesTable.ticketId),
      db
        .select({ ticketId: commentsTable.ticketId, n: count(), lastAt: max(commentsTable.createdAt) })
        .from(commentsTable)
        .where(inArray(commentsTable.ticketId, ids))
        .groupBy(commentsTable.ticketId),
      db
        .select({ ticketId: bookmarksTable.ticketId, n: count() })
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
      const affinity = (mode === "home" && followedIds.length > 0 && followedSet.has(t.userId) && t.userId !== currentUserId)
        ? AFFINITY_FOLLOWED
        : 1.0;
      scoredItems.push({ type: "ticket", data: t, score: base * affinity * freshBoost(t.userId, t.createdAt) * genreBoostFn(t.genre) });
    }
  }

  // ── Score chains ─────────────────────────────────────────────────────────────
  if (chainPool.length > 0) {
    const ids = chainPool.map((c) => c.id);
    const [likeRows, commentRows, runRows, saveRows] = await Promise.all([
      db
        .select({ chainId: chainLikesTable.chainId, n: count(), lastAt: max(chainLikesTable.createdAt) })
        .from(chainLikesTable)
        .where(inArray(chainLikesTable.chainId, ids))
        .groupBy(chainLikesTable.chainId),
      db
        .select({ chainId: chainCommentsTable.chainId, n: count(), lastAt: max(chainCommentsTable.createdAt) })
        .from(chainCommentsTable)
        .where(inArray(chainCommentsTable.chainId, ids))
        .groupBy(chainCommentsTable.chainId),
      db
        .select({ chainId: chainRunsTable.chainId, n: countDistinct(chainRunsTable.userId), lastAt: max(chainRunsTable.startedAt) })
        .from(chainRunsTable)
        .where(inArray(chainRunsTable.chainId, ids))
        .groupBy(chainRunsTable.chainId),
      db
        .select({ chainId: chainBookmarksTable.chainId, n: count() })
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
      const lastActivityAt = [c.createdAt, likeLastAt.get(c.id), cmtLastAt.get(c.id), runLastAt.get(c.id)]
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

  // ── Sort by score desc; tiebreak by newest content first ─────────────────────
  scoredItems.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-10) return diff;
    return b.data.createdAt.getTime() - a.data.createdAt.getTime();
  });

  // ── Apply author diversity spread ─────────────────────────────────────────────
  // For ranked (home/discover): spread across the FULL pool so that pagination
  // is consistent — the same author distribution holds regardless of which page
  // the user is on.  We use a proportional per-user cap so that on any 20-item
  // window the author cap still approximates DIVERSITY_CAP.
  //
  // For following (chronological): spread across a single page-worth of items.

  let diversified: ScoredItem[];

  if (mode === "following") {
    // Thin pool: lift the per-user cap so we never hide content from someone
    // the user deliberately chose to follow.
    const effectiveCap = scoredItems.length <= limit ? scoredItems.length : DIVERSITY_CAP;
    diversified = applyDiversitySpread(scoredItems, (i) => i.data.userId, effectiveCap, limit + 1);
  } else {
    // Ranked modes: spread across the full pool with a proportional cap so that
    // in any 20-item slice the effective per-author density ≈ DIVERSITY_CAP.
    const pagesInPool = Math.max(1, Math.ceil(scoredItems.length / limit));
    const poolCapPerUser = pagesInPool * DIVERSITY_CAP;
    const effectiveCap = scoredItems.length <= limit ? scoredItems.length : poolCapPerUser;
    diversified = applyDiversitySpread(scoredItems, (i) => i.data.userId, effectiveCap, POOL);
  }

  // ── Apply content-type interleaving ──────────────────────────────────────────
  // Ensures no more than 2 consecutive Tickets or Chains in the final feed.
  // Applied after author diversity so score ordering is disturbed as little as
  // possible. Both constraints together mirror Instagram/TikTok's feed behaviour.
  const interleaved = applyContentTypeInterleave(diversified, (i) => i.type, 2);

  // ── Paginate ──────────────────────────────────────────────────────────────────
  // Ranked modes: stable offset into the pre-ranked list.
  // Following mode: the diversity spread already returned a page-sized slice; no offset.
  let page: ScoredItem[];
  let hasMore: boolean;
  let nextCursor: string | null;

  if (mode === "following") {
    // interleaved is already page-sized (limit+1 requested from spread)
    hasMore = interleaved.length > limit;
    page = interleaved.slice(0, limit);
    // Time cursor: ISO date of the oldest createdAt on this page
    nextCursor = (hasMore && page.length > 0)
      ? page.reduce((oldest, item) =>
          item.data.createdAt < oldest.data.createdAt ? item : oldest
        ).data.createdAt.toISOString()
      : null;
  } else {
    // Offset-based: slice into the stable ranked list
    hasMore = rankedOffset + limit < interleaved.length;
    page = interleaved.slice(rankedOffset, rankedOffset + limit);
    nextCursor = hasMore ? String(rankedOffset + limit) : null;
  }

  // ── Build full response objects ───────────────────────────────────────────────
  const rawTickets = page.filter((i): i is ScoredTicket => i.type === "ticket").map((i) => i.data);
  const rawChains  = page.filter((i): i is ScoredChain  => i.type === "chain").map((i) => i.data);

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

  res.json({ items, hasMore, nextCursor });
});

// ── POST /api/feed/signal — "Not interested / hide" signal ───────────────────
//
// The dismissed item is persisted in feed_signals and excluded from all future
// feed requests for that user.  Frontend calls this on every dismissal and
// also removes the item from the in-memory feed list optimistically.

router.post("/signal", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const { itemId, itemType, signalType = "hide" } =
    req.body as { itemId?: string; itemType?: string; signalType?: string };

  if (!itemId || !itemType) { res.status(400).json({ error: "missing fields" }); return; }
  if (!["ticket", "chain"].includes(itemType)) {
    res.status(400).json({ error: "invalid itemType" }); return;
  }

  await db
    .insert(feedSignalsTable)
    .values({ userId, itemId, itemType, signalType, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [feedSignalsTable.userId, feedSignalsTable.itemId, feedSignalsTable.itemType],
      set: { signalType, createdAt: new Date() },
    });

  res.json({ ok: true });
});

export default router;
