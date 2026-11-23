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
  ticketReactionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, count, countDistinct, max, inArray, ne, or, sql, lt, gte } from "drizzle-orm";
import {
  hotScore,
  makeFreshBoost,
  applyDiversitySpread,
  applyContentTypeInterleave,
  paginateRanked,
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
 * mode=discover  All public content, pure hotScore ranking (default, logged-out)
 * mode=home      "สำหรับคุณ / For You" — DEFAULT home-icon feed. Unified feed of
 *                ALL users (public content), hotScore + freshBoost + genre-affinity
 *                ranked with hotScore + freshBoost + genre-affinity. Democratic:
 *                AFFINITY_FOLLOWED = 1.0 (no boost) so everyone's great content
 *                competes on equal footing. Use the /following tab to see only
 *                followed users' content.
 * mode=following "กำลังติดตาม / Following" — toggle option under the "Ticker" title.
 *                Unified feed of ONLY people the user follows + own posts, still
 *                ranked with the same hotScore + freshBoost algorithm (NOT plain
 *                chronological) so quality/freshness balance is preserved even in
 *                this narrower pool.
 *
 * ── Ranking formula (industry-standard) ─────────────────────────────────────
 *   engagement = log(1+likes)×1 + log(1+saves)×1.5 + log(1+comments)×2 + log(1+runs)×3
 *   score      = (engagement + 1) / (hours_since_last_activity + 2) ^ 1.8
 *
 * ── Pagination ───────────────────────────────────────────────────────────────
 * All modes → offset-based cursor ("cursor" query param, encoded integer).
 *   The full pool is scored, diversity-spread, and content-type-interleaved
 *   ONCE per request; the cursor slices into that stable ordered list.
 *   Using a timestamp cursor on a score-ranked feed is fundamentally wrong:
 *   new posts created after the cursor date would be silently skipped on page 2+.
 *   The candidate pool size scales with the requested offset (POOL below) so
 *   deep pages are never starved of rows to rank — see /api/tickets and
 *   /api/chains for the identical fix. A pool that is never sized for the
 *   offset would only ever contain the first `limit*6` rows by recency, so
 *   any item beyond that boundary could never be reached no matter how far
 *   the user scrolls — it isn't a fixed "total feed length", it's a silently
 *   truncated candidate set. There is no client-supplied "exclude" (already-
 *   shown IDs) param — offset pagination and pool-exclusion are mutually
 *   exclusive (removing seen items shifts every remaining item's index
 *   backward, so the next page's fixed offset silently skips unseen content).
 *
 * ── Diversity controls ───────────────────────────────────────────────────────
 * Author diversity  — applyDiversitySpread: cooldown-based, prevents the same
 *   author from occupying consecutive slots. Hard cap = DIVERSITY_CAP per
 *   page-equivalent window (Twitter/Instagram standard). Applies identically to
 *   the unified feed (home), the following feed, and the discovery/Tickets/Chains
 *   tabs — no single author can dominate any of them.
 * Content-type diversity — applyContentTypeInterleave: prevents > 2 consecutive
 *   items of the same type (Ticket or Chain) when both types exist (Instagram,
 *   TikTok standard).
 *
 * ── Pool time window ─────────────────────────────────────────────────────────
 * home / discover fetch public content from the last POOL_DAYS days only.
 * This keeps the ranking pool at a manageable size as the platform grows;
 * content older than this has decayed to near-zero hotScore anyway. The
 * followed-authors slice inside "home" and all of "following" have NO time
 * window — users always see recent posts from people they follow regardless
 * of age (matches Instagram/Twitter following behaviour).
 *
 * Returns: { items: FeedItem[], hasMore: boolean, nextCursor: string | null }
 * FeedItem = { type: "ticket", ticket: ... } | { type: "chain", chain: ... }
 */

const POOL_DAYS = 60; // ranked feeds only consider posts from the last N days

router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const mode = (req.query["mode"] as string) || "discover";

  // ── Cursor parsing ───────────────────────────────────────────────────────────
  // All modes are ranked (hotScore), so all use an integer offset into the
  // stable ordered list (position in the ranked list).
  const cursorParam = req.query["cursor"] as string | undefined;

  // Legacy "before" param kept for backwards compat (old clients may still send it)
  const legacyBefore = req.query["before"] as string | undefined;
  const rawCursor = cursorParam ?? legacyBefore;

  let rankedOffset = 0;

  if (rawCursor) {
    const n = parseInt(rawCursor, 10);
    if (!isNaN(n) && n > 0) rankedOffset = n;
  }

  // Raw DB fetch size: must cover every page up to and including the requested
  // offset, or deep pages silently run dry even though more content exists —
  // the pool would only ever contain the first `limit*6` rows by recency, so
  // any item ranked beyond that boundary could never be fetched at all,
  // regardless of how far the user scrolls. Same fix as /api/tickets and
  // /api/chains (see their rankedOffset comments) — keep all three in sync.
  const POOL = Math.max(limit * 6, (rankedOffset + limit) * 3);

  // NOTE: there used to be a client-supplied "exclude" (already-shown IDs) param
  // here. It has been removed: offset pagination and pool-exclusion are
  // mutually exclusive (removing seen items from the pool shifts every
  // remaining item's index backward, so the next page's offset silently skips
  // a block of content the user never actually saw — see the "following"
  // pool-fetch comments below, which used to apply it and hit exactly this
  // bug). Client-side de-dup (seenIds) is the correct place to guard against
  // any residual re-surfacing caused by score drift between requests.

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
        .innerJoin(ticketReactionsTable, eq(ticketReactionsTable.ticketId, ticketsTable.id))
        .where(and(eq(ticketReactionsTable.userId, currentUserId), isNull(ticketsTable.deletedAt)))
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

  // ── Pool time window ─────────────────────────────────────────────────────────
  // discover / home (For You): bounded window keeps the general public pool
  //   manageable as the platform grows. The followed-authors slice of "home"
  //   is fetched separately below with NO window.
  // following: NO window — users expect to see ALL recent content from people
  //   they follow regardless of age (Twitter/Instagram behaviour).
  const poolWindowStart = (mode === "discover" || mode === "home")
    ? new Date(Date.now() - POOL_DAYS * 24 * 60 * 60 * 1000)
    : null;

  // ── Fetch ticket pool ────────────────────────────────────────────────────────
  let ticketPool: (typeof ticketsTable.$inferSelect)[] = [];

  if (mode === "following" && currentUserId) {
    // Following toggle: ONLY own posts + followed users' posts, no time window,
    // still ranked by hotScore (not chronological).
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
          ),
        )
        .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
        .limit(POOL);
      ticketPool = raw.filter(
        (t) => t.userId === currentUserId || (!t.isPrivate && (!privateUserIds.has(t.userId) || followedSet.has(t.userId))),
      );
      // Only permanent "hidden" signals are applied here — NOT client-supplied
      // "exclude" (already-shown) IDs. This pool is sliced by a numeric offset
      // further down; removing already-shown items before slicing would shift
      // every remaining item's index backward, so the same offset used for the
      // next page would skip a block of content the user has never actually
      // seen (see the POOL/offset comment at the top of this route).
      if (hiddenTicketIds.size > 0)
        ticketPool = ticketPool.filter((t) => !hiddenTicketIds.has(t.id));
    }
  } else if (mode === "home" && currentUserId) {
    // For You (home icon default): unified feed from ALL users, personalised
    // with AFFINITY_FOLLOWED scoring boost for people the user follows.
    // Two slices merged: (a) public pool within the time window (like discover),
    // (b) followed-authors pool with NO time window so their posts always show.
    const publicUserRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds = publicUserRows.map((r) => r.id);

    const [publicRaw, followedRaw] = await Promise.all([
      publicUserIds.length > 0
        ? db.select().from(ticketsTable).where(
            and(
              isNull(ticketsTable.deletedAt),
              isNull(ticketsTable.archivedAt),
              or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
              eq(ticketsTable.isPrivate, false),
              inArray(ticketsTable.userId, publicUserIds),
              poolWindowStart ? gte(ticketsTable.createdAt, poolWindowStart) : undefined,
            ),
          ).orderBy(desc(sql`${ticketsTable.lastActivityAt}`)).limit(POOL)
        : Promise.resolve([]),
      followedIds.length > 0 || currentUserId
        ? db.select().from(ticketsTable).where(
            and(
              isNull(ticketsTable.deletedAt),
              isNull(ticketsTable.archivedAt),
              or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
              or(eq(ticketsTable.isPrivate, false), eq(ticketsTable.userId, currentUserId)),
              inArray(ticketsTable.userId, [...new Set([...followedIds, currentUserId])]),
            ),
          ).orderBy(desc(sql`${ticketsTable.lastActivityAt}`)).limit(POOL)
        : Promise.resolve([]),
    ]);

    const mergedMap = new Map<string, typeof ticketsTable.$inferSelect>();
    for (const t of [...publicRaw, ...followedRaw]) mergedMap.set(t.id, t);
    const raw = [...mergedMap.values()];
    ticketPool = raw.filter(
      (t) => t.userId === currentUserId || (!t.isPrivate && !privateUserIds.has(t.userId)),
    );
    // NOTE: client-supplied "exclude" (already-shown) IDs are deliberately NOT
    // applied here. This pool is sliced by a numeric offset further down —
    // removing already-shown items from the pool before slicing would shift
    // every remaining item's index backward, so the same offset used for the
    // next page would skip a block of content the user has never actually
    // seen. Offset pagination and pool exclusion are mutually exclusive; only
    // hidden ("not interested") signals, which permanently remove content,
    // are applied here.
    if (hiddenTicketIds.size > 0)
      ticketPool = ticketPool.filter((t) => !hiddenTicketIds.has(t.id));
  } else {
    // discover: all public non-private non-reel tickets within the time window
    const publicUserRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds = publicUserRows.map((r) => r.id);

    if (publicUserIds.length > 0) {
      const raw = await db
        .select()
        .from(ticketsTable)
        .where(
          and(
            isNull(ticketsTable.deletedAt),
            isNull(ticketsTable.archivedAt),
            or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel")),
            eq(ticketsTable.isPrivate, false),
            inArray(ticketsTable.userId, publicUserIds),
            // Time window keeps pool size bounded — NOT a pagination cursor
            poolWindowStart ? gte(ticketsTable.createdAt, poolWindowStart) : undefined,
          ),
        )
        .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
        .limit(POOL);
      ticketPool = raw;
      // See note above — exclude list intentionally skipped for offset-paginated pools.
      if (hiddenTicketIds.size > 0)
        ticketPool = ticketPool.filter((t) => !hiddenTicketIds.has(t.id));
    }
  }

  // ── Fetch chain pool ─────────────────────────────────────────────────────────
  let chainPool: (typeof chainsTable.$inferSelect)[] = [];

  if (mode === "following" && currentUserId) {
    // Following toggle: ONLY own chains + followed users' chains, ranked (not chronological)
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
        .orderBy(desc(sql`${chainsTable.lastActivityAt}`))
        .limit(POOL);
      chainPool = raw.filter(
        (c) => c.userId === currentUserId || (!c.isPrivate && (!privateUserIds.has(c.userId) || followedSet.has(c.userId))),
      );
      // Same note as the ticket-pool "following" branch above — only permanent
      // "hidden" signals are applied; client-supplied "exclude" IDs are not,
      // to avoid corrupting offset-based pagination.
      if (hiddenChainIds.size > 0)
        chainPool = chainPool.filter((c) => !hiddenChainIds.has(c.id));
    }
  } else if (mode === "home" && currentUserId) {
    // For You: unified pool from ALL users, merged with followed-authors slice
    // (no time window) so followed content always appears; AFFINITY_FOLLOWED
    // boost applied at scoring time below.
    const publicUserRows2 = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds2 = publicUserRows2.map((r) => r.id);

    const [publicRaw, followedRaw] = await Promise.all([
      publicUserIds2.length > 0
        ? db.select().from(chainsTable).where(and(
            isNull(chainsTable.deletedAt),
            eq(chainsTable.isPrivate, false),
            inArray(chainsTable.userId, publicUserIds2),
            poolWindowStart ? gte(chainsTable.createdAt, poolWindowStart) : undefined,
          )).orderBy(desc(sql`${chainsTable.lastActivityAt}`)).limit(POOL)
        : Promise.resolve([]),
      db.select().from(chainsTable).where(and(
          isNull(chainsTable.deletedAt),
          or(eq(chainsTable.isPrivate, false), eq(chainsTable.userId, currentUserId)),
          inArray(chainsTable.userId, [...new Set([...followedIds, currentUserId])]),
        )).orderBy(desc(sql`${chainsTable.lastActivityAt}`)).limit(POOL),
    ]);

    const mergedMap2 = new Map<string, typeof chainsTable.$inferSelect>();
    for (const c of [...publicRaw, ...followedRaw]) mergedMap2.set(c.id, c);
    const raw = [...mergedMap2.values()];
    chainPool = raw.filter(
      (c) => c.userId === currentUserId || (!c.isPrivate && !privateUserIds.has(c.userId)),
    );
    // See ticket-pool note above — exclude list intentionally skipped for
    // offset-paginated pools; only permanent "hidden" signals are applied.
    if (hiddenChainIds.size > 0)
      chainPool = chainPool.filter((c) => !hiddenChainIds.has(c.id));
  } else {
    // discover: all public chains within the time window
    const publicUserRows2 = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isPrivate, false));
    const publicUserIds2 = publicUserRows2.map((r) => r.id);

    if (publicUserIds2.length > 0) {
      const raw = await db
        .select()
        .from(chainsTable)
        .where(and(
          isNull(chainsTable.deletedAt),
          eq(chainsTable.isPrivate, false),
          inArray(chainsTable.userId, publicUserIds2),
          poolWindowStart ? gte(chainsTable.createdAt, poolWindowStart) : undefined,
        ))
        .orderBy(desc(sql`${chainsTable.lastActivityAt}`))
        .limit(POOL);
      chainPool = raw;
      // See note above — exclude list intentionally skipped for offset-paginated pools.
      if (hiddenChainIds.size > 0)
        chainPool = chainPool.filter((c) => !hiddenChainIds.has(c.id));
    }
  }

  // ── Score tickets ────────────────────────────────────────────────────────────
  type ScoredTicket = { type: "ticket"; data: typeof ticketsTable.$inferSelect; score: number };
  type ScoredChain  = { type: "chain";  data: typeof chainsTable.$inferSelect;  score: number };
  type ScoredItem   = ScoredTicket | ScoredChain;

  const scoredItems: ScoredItem[] = [];

  if (ticketPool.length > 0) {
    const ids = ticketPool.map((t) => t.id);
    // Use ticketReactionsTable (weighted reactions) instead of legacy likesTable.
    // Reaction weights: heart=1, fire=2, lightning=3, sparkle=4, popcorn=5 — matching
    // the community endpoint and ensuring feed ranking reflects actual engagement value.
    const TICKET_REACTION_POINTS: Record<string, number> = { heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5 };
    const [reactionRows, commentRows, saveRows] = await Promise.all([
      db
        .select({
          ticketId:     ticketReactionsTable.ticketId,
          reactionType: ticketReactionsTable.reactionType,
          count:        ticketReactionsTable.count,
          updatedAt:    ticketReactionsTable.updatedAt,
        })
        .from(ticketReactionsTable)
        .where(inArray(ticketReactionsTable.ticketId, ids)),
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
    // Aggregate weighted reaction score and last-reaction timestamp per ticket
    const likeMap    = new Map<string, number>();
    const likeLastAt = new Map<string, Date | null>();
    for (const row of reactionRows) {
      const pts = (TICKET_REACTION_POINTS[row.reactionType] ?? 1) * row.count;
      likeMap.set(row.ticketId, (likeMap.get(row.ticketId) ?? 0) + pts);
      const updatedAt = row.updatedAt ? new Date(row.updatedAt) : null;
      const prev = likeLastAt.get(row.ticketId) ?? null;
      if (!prev || (updatedAt && updatedAt > prev)) likeLastAt.set(row.ticketId, updatedAt);
    }
    const commentMap = new Map(commentRows.map((r) => [r.ticketId, Number(r.n)]));
    const saveMap    = new Map(saveRows.map((r) => [r.ticketId, Number(r.n)]));
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
      // For You (home): followed authors get a permanent affinity multiplier so
      // their content surfaces more, but strangers' great content can still win.
      const affinity = (mode === "home" && followedSet.has(t.userId)) ? AFFINITY_FOLLOWED : 1.0;
      scoredItems.push({ type: "ticket", data: t, score: base * freshBoost(t.userId, t.createdAt) * genreBoostFn(t.genre) * affinity });
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
      const affinityC = (mode === "home" && followedSet.has(c.userId)) ? AFFINITY_FOLLOWED : 1.0;
      scoredItems.push({ type: "chain", data: c, score: base * freshBoost(c.userId, c.createdAt) * affinityC });
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

  // Diversity key is scoped per (content-type, author) pair so that a user's
  // Tickets and Chains are capped independently.  Counting them together was
  // too aggressive: a prolific creator with 2 great Tickets + 2 great Chains
  // would be capped at 2 total — starving half their content.  With separate
  // caps they can hold up to DIVERSITY_CAP slots per type, matching how
  // Instagram/TikTok count Reels vs Carousels independently.
  const diversityKey = (i: ScoredItem) => `${i.type}:${i.data.userId}`;

  if (mode === "following") {
    // Following: pool is intentionally thin — the user chose who to follow, so
    // we should surface their content without over-suppression. A modest
    // per-author cap still prevents a single prolific poster from dominating.
    const effectiveCap = scoredItems.length <= limit ? scoredItems.length : DIVERSITY_CAP;
    diversified = applyDiversitySpread(scoredItems, diversityKey, effectiveCap, limit + 1);
  } else {
    // home (For You) / discover: spread across the full pool with a proportional
    // cap so that in any 20-item slice the effective per-author density ≈ DIVERSITY_CAP.
    // No single author — followed or not — can dominate the unified feed.
    const pagesInPool = Math.max(1, Math.ceil(scoredItems.length / limit));
    const poolCapPerUser = pagesInPool * DIVERSITY_CAP;
    const effectiveCap = scoredItems.length <= limit ? scoredItems.length : poolCapPerUser;
    diversified = applyDiversitySpread(scoredItems, diversityKey, effectiveCap, POOL);
  }

  // ── Apply content-type interleaving ──────────────────────────────────────────
  // Strictly alternates Ticket / Chain (maxRun = 1) so that both content types
  // get equal screen time when both exist. Without this, a large Ticket pool
  // would allow many consecutive Tickets before the first Chain appears, making
  // Chains almost invisible despite having good scores.
  // Graceful degradation: if one type is exhausted the other fills the rest
  // (behaviour inherited from applyContentTypeInterleave's pass-2 logic).
  const interleaved = applyContentTypeInterleave(diversified, (i) => i.type, 1);

  // ── Paginate ──────────────────────────────────────────────────────────────────
  // All modes are ranked; the cursor is a stable offset into the pre-ranked list.
  //
  // "home"/"discover" draw from everyone (or everyone + follows) — like a
  // TikTok/Instagram Explore feed, they should never hard-stop once genuinely
  // new candidates run out; they recycle the same ranked list (re-scored fresh
  // on every request) instead. "following" is scoped to who the user follows —
  // running out there is a real, expected end (same as X's Following tab), so
  // it does not recycle.
  let page: ScoredItem[];
  let hasMore: boolean;
  let nextCursor: string | null;
  let recycled = false;

  if (mode === "following") {
    // Thin pool: diversity spread already returned a page-sized slice (limit+1 requested).
    hasMore = interleaved.length > limit;
    page = interleaved.slice(0, limit);
    nextCursor = hasMore ? String(rankedOffset + limit) : null;
  } else {
    const paginated = paginateRanked(interleaved, rankedOffset, limit, true);
    page = paginated.page;
    hasMore = paginated.hasMore;
    nextCursor = paginated.nextCursor;
    recycled = paginated.recycled;
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

  res.json({ items, hasMore, nextCursor, recycled });
});

// ── POST /api/feed/signal — "Not interested / hide" signal ───────────────────
//
// The dismissed item is persisted in feed_signals and excluded from all future
// feed requests for that user.  Frontend calls this on every dismissal and
// also removes the item from the in-memory feed list optimistically.

// ── GET /api/feed/hidden-items — list items hidden by this user (Activity recovery) ──
router.get("/hidden-items", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const signals = await db
    .select({ itemId: feedSignalsTable.itemId, itemType: feedSignalsTable.itemType, hiddenAt: feedSignalsTable.createdAt })
    .from(feedSignalsTable)
    .where(and(eq(feedSignalsTable.userId, userId), eq(feedSignalsTable.signalType, "hide")))
    .orderBy(desc(feedSignalsTable.createdAt));

  if (signals.length === 0) { res.json({ items: [] }); return; }

  const ticketSigs = signals.filter(s => s.itemType === "ticket");
  const chainSigs  = signals.filter(s => s.itemType === "chain");

  const [tickets, chains] = await Promise.all([
    ticketSigs.length > 0
      ? db.select({ id: ticketsTable.id, movieTitle: ticketsTable.movieTitle, posterUrl: ticketsTable.posterUrl, rankTier: ticketsTable.rankTier })
          .from(ticketsTable)
          // @ts-ignore — Drizzle inArray requires tuple but runtime accepts number[]
          .where(and(inArray(ticketsTable.id, ticketSigs.map(s => Number(s.itemId))), isNull(ticketsTable.deletedAt)))
      : Promise.resolve([]),
    chainSigs.length > 0
      ? db.select({ id: chainsTable.id, title: chainsTable.title })
          .from(chainsTable)
          .where(and(inArray(chainsTable.id, chainSigs.map(s => s.itemId)), isNull(chainsTable.deletedAt)))
      : Promise.resolve([]),
  ]);

  const ticketMap = new Map((tickets as any[]).map(t => [String(t.id), t]));
  const chainMap  = new Map((chains as any[]).map(c => [c.id, c]));

  const items = signals
    .map(s => {
      const meta = s.itemType === "ticket" ? ticketMap.get(s.itemId) : chainMap.get(s.itemId);
      if (!meta) return null;
      return { itemId: s.itemId, itemType: s.itemType, hiddenAt: s.hiddenAt, ...meta };
    })
    .filter(Boolean);

  res.json({ items });
});

// ── DELETE /api/feed/signal/:itemId — restore (remove hide signal) ────────────
router.delete("/signal/:itemId", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { itemId } = req.params;
  await db.delete(feedSignalsTable).where(and(eq(feedSignalsTable.userId, userId), eq(feedSignalsTable.itemId, itemId!)));
  res.json({ ok: true });
});

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
