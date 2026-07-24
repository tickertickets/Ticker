/**
 * Tickets Router — HTTP interface only.
 *
 * Each handler is deliberately short:
 *   1. Parse & validate request
 *   2. Call a service function
 *   3. Return the result
 *
 * All business logic lives in src/services/tickets.service.ts and
 * src/services/rank.service.ts — not here.
 */

import { createNotification, notifyFollowersNewPost } from "../services/notify.service";
import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { emitFeedNew, emitNotificationNew } from "../lib/socket";
import { getBlockedUserIds } from "../lib/blocks";
import {
  usersTable,
  ticketsTable,
  ticketTagsTable,
  ticketTagRatingsTable,
  notificationsTable,
  partyInvitesTable,
  memoryAccessRequestsTable,
  reportsTable,
  followsTable,
  likesTable,
  commentsTable,
  bookmarksTable,
  feedSignalsTable,
  ticketReactionsTable,
} from "@workspace/db/schema";
import {
  eq,
  and,
  desc,
  count,
  max,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  ne,
  or,
  sql,
  ilike,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { hotScore, makeFreshBoost, applyDiversitySpread, paginateRanked, DIVERSITY_CAP, AFFINITY_FOLLOWED, computeGenreAffinity, makeGenreBoost } from "../lib/hot-score";
import { asyncHandler } from "../middlewares/error-handler";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../lib/errors";
import {
  buildTicket,
  buildTicketBatch,
  calculateRankTier,
  updatePartySpecialColor,
  checkAndUpdatePartyColor,
} from "../services/tickets.service";
import { isValidCustomTier } from "../services/rank.service";
import { awardXp, awardTagTicketXp } from "../services/badge.service";

const router: IRouter = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// ── Ticket creation rate limiters (applied together, all three must pass) ──────
//
// Industry-standard layered approach (same philosophy as Instagram/Letterboxd):
//   Burst  — prevents rapid-fire spam; independent of daily budget
//   Hourly — sustained-pace guard
//   Daily  — absolute cap matching realistic movie-watching behaviour
//
// Limits chosen for a movie-review platform:
//   3 per 5 min  — enough for back-to-back reviews; blocks bots
//   30 per hour  — matches ~1 review per 2 min sustained rate
//   50 per day   — generous for binge-watchers; unreachable in normal use

const createTicketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // 15 posts/hour — standard for content-rich social platforms
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Too many tickets created. Please wait before posting again." },
});

const ticketDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 30, // 30 posts/day — realistic upper bound for movie-logging
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Daily post limit reached (30/day). Come back tomorrow!" },
});

const ticketBurstLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 posts per 5 min — prevents rapid-fire flooding
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Posting too fast. Please wait a few minutes between posts." },
});

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Too many requests. Please slow down." },
});

// ── GET /tickets/search — keyword search ─────────────────────────────────────
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const { q, limit: limitParam } = req.query;
    if (!q || typeof q !== "string" || q.trim().length < 1) {
      res.json({ tickets: [] });
      return;
    }
    const term = q.trim();
    const limit = Math.min(Number(limitParam) || 20, 50);

    const tickets = await db
      .select({
        id: ticketsTable.id,
        movieTitle: ticketsTable.movieTitle,
        imdbId: ticketsTable.imdbId,
        posterUrl: ticketsTable.posterUrl,
        rating: ticketsTable.rating,
        ratingType: ticketsTable.ratingType,
        caption: ticketsTable.caption,
        rankTier: ticketsTable.rankTier,
        cardTheme: ticketsTable.cardTheme,
        hideLikes: ticketsTable.hideLikes,
        hideComments: ticketsTable.hideComments,
        createdAt: ticketsTable.createdAt,
        userId: ticketsTable.userId,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(ticketsTable)
      .innerJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
      .where(
        and(
          isNull(ticketsTable.deletedAt),
          eq(ticketsTable.isPrivate, false),
          eq(usersTable.isPrivate, false),
          or(
            ilike(ticketsTable.movieTitle, `%${term}%`),
            ilike(ticketsTable.caption, `%${term}%`),
          ),
        ),
      )
      .orderBy(desc(ticketsTable.createdAt))
      .limit(limit);

    if (tickets.length === 0) {
      res.json({ tickets: [] });
      return;
    }

    const ticketIds = tickets.map(t => t.id);

    const [likeRows, commentRows, userLikes, userBookmarks] = await Promise.all([
      db
        .select({ ticketId: likesTable.ticketId, n: count() })
        .from(likesTable)
        .where(inArray(likesTable.ticketId, ticketIds))
        .groupBy(likesTable.ticketId),
      db
        .select({ ticketId: commentsTable.ticketId, n: count() })
        .from(commentsTable)
        .where(inArray(commentsTable.ticketId, ticketIds))
        .groupBy(commentsTable.ticketId),
      currentUserId
        ? db
            .select({ ticketId: likesTable.ticketId })
            .from(likesTable)
            .where(and(eq(likesTable.userId, currentUserId), inArray(likesTable.ticketId, ticketIds)))
        : Promise.resolve([] as { ticketId: string }[]),
      currentUserId
        ? db
            .select({ ticketId: bookmarksTable.ticketId })
            .from(bookmarksTable)
            .where(and(eq(bookmarksTable.userId, currentUserId), inArray(bookmarksTable.ticketId, ticketIds)))
        : Promise.resolve([] as { ticketId: string }[]),
    ]);

    const likeCountMap = new Map(likeRows.map(r => [r.ticketId, Number(r.n)]));
    const commentCountMap = new Map(commentRows.map(r => [r.ticketId, Number(r.n)]));
    const likedSet = new Set(userLikes.map(r => r.ticketId));
    const bookmarkedSet = new Set(userBookmarks.map(r => r.ticketId));

    res.json({
      tickets: tickets.map(t => ({
        ...t,
        likeCount: likeCountMap.get(t.id) ?? 0,
        commentCount: commentCountMap.get(t.id) ?? 0,
        isLiked: likedSet.has(t.id),
        isBookmarked: bookmarkedSet.has(t.id),
      })),
    });
  }),
);

// ── GET /tickets — feed ───────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const limit = Math.min(Number(req.query["limit"]) || 20, 50);
    const feed = (req.query["feed"] as string) || "discovery";
    const typeParam = (req.query["type"] as string) || "all";
    const notDeleted = isNull(ticketsTable.deletedAt);
    // Offset-based pagination: these feeds (discovery/home/following) are all
    // ranked by a computed "hot score" (see bulkScore below), not chronological
    // order. A timestamp cursor (e.g. "createdAt < X") only works when the
    // cursor field matches the ORDER BY field exactly — but these feeds sort by
    // GREATEST(createdAt, last-like, last-comment), so a post that gets a fresh
    // like can rank #1 while still being the chronologically oldest item on the
    // page. That previously made its (very old) createdAt become the cursor,
    // which then excluded almost every newer, unseen post from the next page —
    // the feed appeared to abruptly run out of content. Offset-into-a-freshly-
    // ranked-list avoids that mismatch and matches the same approach already
    // used by /api/feed and the chains discovery route.
    const cursorParam = (req.query["cursor"] as string | undefined) ?? (req.query["before"] as string | undefined);
    let rankedOffset = 0;
    if (cursorParam) {
      const n = parseInt(cursorParam, 10);
      if (!isNaN(n) && n > 0) rankedOffset = n;
    }
    // Users who blocked, or were blocked by, the current viewer — excluded
    // from every feed pool below (bidirectional hide).
    const blockedIds = currentUserId ? await getBlockedUserIds(currentUserId) : new Set<string>();

    // ── Content-type filter ────────────────────────────────────────────────────
    // type=ticket → regular tickets only (cardTheme ≠ reel)
    // type=reel   → reels only (cardTheme = reel)
    // type=all    → no filter (default)
    const typeFilter =
      typeParam === "ticket"
        ? or(isNull(ticketsTable.cardTheme), ne(ticketsTable.cardTheme, "reel"))
        : typeParam === "reel"
          ? eq(ticketsTable.cardTheme, "reel")
          : undefined;

    type RawTicket = typeof ticketsTable.$inferSelect;

    // freshBoost and affinity are imported from hot-score.ts

    // ── Shared helper: bulk-score a list of tickets ────────────────────────────
    // Uses ticketReactionsTable (weighted reactions) — consistent with
    // the unified feed and community endpoints.
    const bulkScore = async (
      rows: RawTicket[],
      affinityFn?: (userId: string) => number,
      freshBoostFn?: (userId: string, createdAt: Date) => number,
    ): Promise<Array<{ t: RawTicket; score: number }>> => {
      if (rows.length === 0) return [];
      const ids = rows.map((t) => t.id);
      // Use ticketReactionsTable (weighted reactions) — same source as the community
      // and unified feed endpoints. heart=1, fire=2, lightning=3, sparkle=4, popcorn=5.
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
      const cmtLastAt  = new Map(commentRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));
      const saveMap    = new Map(saveRows.map((r) => [r.ticketId, Number(r.n)]));

      return rows.map((t) => {
        const la = likeLastAt.get(t.id) ?? null;
        const ca = cmtLastAt.get(t.id) ?? null;
        const lastActivityAt = [t.createdAt, la, ca]
          .filter((d): d is Date => d instanceof Date)
          .reduce((a, b) => (a > b ? a : b), t.createdAt);
        const base = hotScore({
          likes:    likeMap.get(t.id) ?? 0,
          comments: commentMap.get(t.id) ?? 0,
          saves:    saveMap.get(t.id) ?? 0,
          lastActivityAt,
        });
        const affinity = affinityFn ? affinityFn(t.userId) : 1.0;
        const boost    = freshBoostFn ? freshBoostFn(t.userId, t.createdAt) : 1.0;
        return { t, score: base * affinity * boost };
      });
    };

    let tickets: RawTicket[];

    if (feed === "home" && currentUserId) {
      // ── Home Feed — Instagram-style algorithmic ranking ─────────────────────
      //
      // Two-tier candidate pool:
      //   Tier A: Own posts (all visibility) + followed users' public posts
      //   Tier B: Discovery pool from public accounts
      //
      // Final ranking: hotScore × AFFINITY_FOLLOWED(2×) × freshBoost, merged and sorted.
      // Followed users receive a permanent 2× affinity boost so their content stays
      // prominent even after the 60-min fresh window expires.

      // Pool must cover every page up to and including the requested offset
      // (same approach as the chains discovery route).
      const POOL = Math.max(limit * 6, (rankedOffset + limit) * 3);
      const AFFINITY_DISCOVERY = 1.0; // AFFINITY_FOLLOWED (2×) is imported from hot-score

      // 1. Get followed user IDs
      const followRows = await db
        .select({ followingId: followsTable.followingId })
        .from(followsTable)
        .where(eq(followsTable.followerId, currentUserId));
      const followedIds = followRows.map((f) => f.followingId);
      const followedSet = new Set([...followedIds, currentUserId]);

      // Load hidden ticket IDs so they're excluded from both tiers
      const hiddenSignalRows = await db
        .select({ itemId: feedSignalsTable.itemId })
        .from(feedSignalsTable)
        .where(and(
          eq(feedSignalsTable.userId, currentUserId),
          eq(feedSignalsTable.itemType, "ticket"),
          eq(feedSignalsTable.signalType, "hide"),
        ));
      const hiddenTicketIds = new Set(hiddenSignalRows.map(s => s.itemId));

      // Load genre affinity for the current user (own + liked + bookmarked tickets)
      const [ownGenreRows, likedGenreRows, savedGenreRows] = await Promise.all([
        db.select({ genre: ticketsTable.genre }).from(ticketsTable)
          .where(and(eq(ticketsTable.userId, currentUserId), isNull(ticketsTable.deletedAt))),
        db.select({ genre: ticketsTable.genre }).from(ticketsTable)
          .innerJoin(ticketReactionsTable, eq(ticketReactionsTable.ticketId, ticketsTable.id))
          .where(and(eq(ticketReactionsTable.userId, currentUserId), isNull(ticketsTable.deletedAt))),
        db.select({ genre: ticketsTable.genre }).from(ticketsTable)
          .innerJoin(bookmarksTable, eq(bookmarksTable.ticketId, ticketsTable.id))
          .where(and(eq(bookmarksTable.userId, currentUserId), isNull(ticketsTable.deletedAt))),
      ]);
      const allGenres = [
        ...ownGenreRows.map(r => r.genre ?? ""),
        ...likedGenreRows.map(r => r.genre ?? ""),
        ...savedGenreRows.map(r => r.genre ?? ""),
        ...savedGenreRows.map(r => r.genre ?? ""), // double-weight bookmarks as intent signal
      ].filter(Boolean);
      const genreBoostFn = makeGenreBoost(computeGenreAffinity(allGenres));

      // 2a. Tier A: own posts (any privacy) + followed users' non-private posts
      const tierAWhere = and(
        notDeleted,
        typeFilter,
        followedIds.length > 0
          ? inArray(ticketsTable.userId, [...followedIds, currentUserId])
          : eq(ticketsTable.userId, currentUserId),
      );
      const tierARaw = await db
        .select()
        .from(ticketsTable)
        .where(tierAWhere)
        .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
        .limit(POOL);

      // exclude other users' private tickets (keep own private tickets) + hidden items + blocked
      const tierA = tierARaw
        .filter((t) => t.userId === currentUserId || !t.isPrivate)
        .filter((t) => !hiddenTicketIds.has(String(t.id)))
        .filter((t) => !blockedIds.has(t.userId));

      // 2b. Tier B: public discovery pool (public accounts, non-private tickets)
      const publicUserRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isPrivate, false));
      const publicUserIds = publicUserRows.map((r) => r.id);

      const tierBRaw = publicUserIds.length > 0
        ? await db
            .select()
            .from(ticketsTable)
            .where(and(
              eq(ticketsTable.isPrivate, false),
              notDeleted,
              typeFilter,
              inArray(ticketsTable.userId, publicUserIds),
              blockedIds.size > 0 ? notInArray(ticketsTable.userId, [...blockedIds]) : undefined,
              tierA.length > 0 ? notInArray(ticketsTable.id, tierA.map((t) => t.id)) : undefined,
            ))
            .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
            .limit(POOL)
        : [];

      // Filter hidden items from tier B as well
      const tierB = tierBRaw.filter((t) => !hiddenTicketIds.has(String(t.id)));

      // 3. Score both tiers and merge with genre affinity
      const affinityFn = (uid: string) => (followedSet.has(uid) && uid !== currentUserId) ? AFFINITY_FOLLOWED : AFFINITY_DISCOVERY;
      const freshBoostFn = makeFreshBoost(followedSet, currentUserId);
      const [scoredA, scoredB] = await Promise.all([
        bulkScore(tierA, affinityFn, freshBoostFn),
        bulkScore(tierB, affinityFn, freshBoostFn),
      ]);

      // Apply genre affinity boost on top of hotScore × affinity × freshBoost
      const merged = [...scoredA, ...scoredB].map(s => ({
        ...s,
        score: s.score * genreBoostFn(s.t.genre ?? ""),
      }));
      merged.sort((a, b) => b.score - a.score);
      // Diversity spread runs across the FULL pool (not just one page) so the
      // per-author distribution — and therefore pagination — is stable no
      // matter which offset page is being requested.
      const pagesInPoolHome = Math.max(1, Math.ceil(merged.length / limit));
      const poolCapPerUserHome = pagesInPoolHome * DIVERSITY_CAP;
      const effectiveCapHome = merged.length <= limit ? merged.length : poolCapPerUserHome;
      const spread = applyDiversitySpread(merged, (s) => s.t.userId, effectiveCapHome, POOL);
      tickets = spread.map((s) => s.t);

    } else if (feed === "following" && currentUserId) {
      // ── Following Feed — Only posts from followed users + own posts ─────────
      //
      // Same hot-score ranking as home, but restricted to the social graph.
      // No affinity distinction needed — every post in this feed is from someone
      // the user chose to follow, so they are equally "trusted".

      const followRows = await db
        .select({ followingId: followsTable.followingId })
        .from(followsTable)
        .where(eq(followsTable.followerId, currentUserId));
      const followedIds = followRows.map((f) => f.followingId);
      const feedUserIds = [...new Set([...followedIds, currentUserId])];

      if (feedUserIds.length === 0) {
        tickets = [];
      } else {
        const POOL = Math.max(limit * 6, (rankedOffset + limit) * 3);
        const raw = await db
          .select()
          .from(ticketsTable)
          .where(and(
            inArray(ticketsTable.userId, feedUserIds),
            notDeleted,
            typeFilter,
            blockedIds.size > 0 ? notInArray(ticketsTable.userId, [...blockedIds]) : undefined,
          ))
          .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
          .limit(POOL);

        // filter: keep own private posts, exclude others' private tickets
        const filtered = raw.filter((t) => t.userId === currentUserId || !t.isPrivate);
        const followedSet = new Set(feedUserIds);
        const freshBoostFn = makeFreshBoost(followedSet, currentUserId);
        const scored = await bulkScore(filtered, undefined, freshBoostFn);
        scored.sort((a, b) => b.score - a.score);
        const pagesInPoolFollowing = Math.max(1, Math.ceil(scored.length / limit));
        const poolCapPerUserFollowing = pagesInPoolFollowing * DIVERSITY_CAP;
        const effectiveCapFollowing = scored.length <= limit ? scored.length : poolCapPerUserFollowing;
        const spread = applyDiversitySpread(scored, (s) => s.t.userId, effectiveCapFollowing, POOL);
        tickets = spread.map((s) => s.t);
      }

    } else {
      // ── Discovery / Explore Feed ────────────────────────────────────────────
      //
      // Global hot-score ranking — no affinity boost.
      // Used for dedicated type tabs (Tickets / Reels) and unauthenticated users.
      // Visibility: public accounts + non-private posts only.

      const DISC_POOL = Math.max(limit * 6, (rankedOffset + limit) * 3);

      const publicUserRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isPrivate, false));
      const publicUserIds = publicUserRows.map((u) => u.id);

      const discRaw = publicUserIds.length > 0
        ? await db
            .select()
            .from(ticketsTable)
            .where(and(
              eq(ticketsTable.isPrivate, false),
              notDeleted,
              typeFilter,
              inArray(ticketsTable.userId, publicUserIds),
              blockedIds.size > 0 ? notInArray(ticketsTable.userId, [...blockedIds]) : undefined,
            ))
            .orderBy(desc(sql`${ticketsTable.lastActivityAt}`))
            .limit(DISC_POOL)
        : [];

      // In discovery mode only own posts get freshBoost (no social graph context)
      const freshBoostFn = makeFreshBoost(null, currentUserId);
      const scored = await bulkScore(discRaw, undefined, freshBoostFn);
      scored.sort((a, b) => b.score - a.score);
      const pagesInPoolDisc = Math.max(1, Math.ceil(scored.length / limit));
      const poolCapPerUserDisc = pagesInPoolDisc * DIVERSITY_CAP;
      const effectiveCapDisc = scored.length <= limit ? scored.length : poolCapPerUserDisc;
      const spread = applyDiversitySpread(scored, (s) => s.t.userId, effectiveCapDisc, DISC_POOL);
      tickets = spread.map((s) => s.t);
    }

    // Offset-based pagination — see rankedOffset comment above for why this
    // replaced the old createdAt-cursor approach.
    //
    // "home"/"discovery" draw from everyone (or everyone + follows) — like a
    // TikTok/Instagram Explore feed they recycle the ranked list (re-scored
    // fresh every request) instead of hard-stopping once genuinely new
    // candidates run out. "following" is scoped to the social graph — running
    // out there is a real, expected end (same as X's Following tab).
    const { page: items, hasMore, nextCursor, recycled } = paginateRanked(
      tickets,
      rankedOffset,
      limit,
      feed !== "following",
    );
    const result = await buildTicketBatch(items, currentUserId);
    res.json({
      tickets: result,
      hasMore,
      nextCursor,
      recycled,
    });
  }),
);

// ── POST /tickets — create ────────────────────────────────────────────────────
router.post(
  "/",
  ticketBurstLimiter,
  ticketDailyLimiter,
  createTicketLimiter,
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const {
      imdbId,
      movieTitle,
      movieYear,
      posterUrl,
      genre,
      template,
      memoryNote,
      caption,
      captionAlign,
      watchedAt,
      location,
      isPrivate,
      hideWatchedAt,
      hideLocation,
      hideLikes,
      hideComments,
      rating,
      ratingType,
      isPrivateMemory,
      isSpoiler,
      taggedUserIds,
      partyMode,
      partySize,
      partySeatNumber,
      partyInviteeIds,
      customRankTier,
      rankLocked,
      cardTheme,
      cardBackdropUrl,
      cardBackdropOffsetX,
      cardRuntime,
      cardDirector,
      cardProducer,
      cardActors,
      clipUrl,
      episodeLabel,
      cardData,
      hideRating,
    } = req.body;

    const isReel = cardTheme === "reel";

    if (!isReel && (!imdbId || !movieTitle)) {
      throw new ValidationError("imdbId and movieTitle are required");
    }
    if (isReel && !clipUrl) {
      throw new ValidationError("clipUrl is required for reel posts");
    }
    if (!isReel && rating !== undefined && rating !== null && rating !== "" && (Number(rating) < 1 || Number(rating) > 5)) {
      throw new ValidationError("rating ต้องอยู่ระหว่าง 1–5");
    }

    // cardData size guard — prevent unbounded JSONB growth
    if (cardData !== undefined && cardData !== null) {
      const size = JSON.stringify(cardData).length;
      if (size > 10_000) {
        throw new ValidationError("cardData must be less than 10KB");
      }
    }

    // Duplicate guard — TV shows (tmdb_tv:*) or episodes allow re-posting per unique episodeLabel;
    // movies block any re-post
    if (!isReel) {
      const normalizedEpisodeLabel = episodeLabel ? String(episodeLabel).trim() : null;
      // Treat as series if imdbId is a TMDB TV show OR an episodeLabel was provided
      const isSeries = String(imdbId).startsWith("tmdb_tv:") || Boolean(normalizedEpisodeLabel);

      const baseCondition = and(
        eq(ticketsTable.userId, currentUserId),
        eq(ticketsTable.imdbId, imdbId),
        isNull(ticketsTable.deletedAt),
      );

      let whereCondition;
      if (isSeries) {
        // For series: block only if the exact same episodeLabel already exists
        // (null episodeLabel = general watch; a specific label = that episode)
        whereCondition = normalizedEpisodeLabel
          ? and(baseCondition, eq(ticketsTable.episodeLabel, normalizedEpisodeLabel))
          : and(baseCondition, isNull(ticketsTable.episodeLabel));
      } else {
        whereCondition = baseCondition;
      }

      const [existing] = await db
        .select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(whereCondition)
        .limit(1);

      if (existing) {
        throw new ConflictError(
          "duplicate_movie",
          isSeries
            ? (normalizedEpisodeLabel ? "duplicate_episode" : "duplicate_general")
            : "duplicate_movie",
        );
      }
    }

    // Party mode validation
    const isParty = partyMode === true;
    let validatedPartySize: number | undefined;
    let validatedSeat: number | undefined;
    let partyGroupId: string | undefined;

    if (isParty) {
      validatedPartySize = Math.floor(Number(partySize));
      validatedSeat = Math.floor(Number(partySeatNumber));

      if (!validatedPartySize || validatedPartySize < 2 || validatedPartySize > 10) {
        throw new ValidationError("partySize ต้องอยู่ระหว่าง 2-10");
      }
      if (!validatedSeat || validatedSeat < 1 || validatedSeat > validatedPartySize) {
        throw new ValidationError("partySeatNumber ไม่ถูกต้อง");
      }
      partyGroupId = nanoid();
    }

    const { tier, score, snapshot } = isReel
      ? { tier: "common" as const, score: 0, snapshot: {} }
      : await calculateRankTier(imdbId);

    // Release date guard — only allow posting movies that have already been released
    if (!isReel) {
      const releaseDateStr = (snapshot as any)?.releaseDate as string | null | undefined;
      if (releaseDateStr) {
        const today = new Date();
        // Compare at date granularity (YYYY-MM-DD), no time component
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        if (releaseDateStr > todayStr) {
          throw new ValidationError("movie_not_released");
        }
      }
    }

    const id = nanoid();
    const cleanNote = memoryNote ? sanitize(memoryNote.trim()) : null;
    const cleanCaption = caption ? sanitize(caption.trim()) : null;
    const cleanLocation = location ? sanitize(location.trim()) : null;

    const isRankLocked = !isReel && rankLocked === true && !!customRankTier;
    const validCustomTier =
      !isReel && isValidCustomTier(customRankTier) ? customRankTier : null;

    await db.insert(ticketsTable).values({
      id,
      userId: currentUserId,
      imdbId: isReel ? "reel" : imdbId,
      movieTitle: isReel ? "Reel" : sanitize(movieTitle),
      movieYear: isReel ? null : movieYear,
      posterUrl: isReel ? null : posterUrl,
      genre: isReel ? null : genre,
      template: template || "classic",
      memoryNote: cleanNote,
      caption: cleanCaption,
      captionAlign: ["left", "center", "right"].includes(captionAlign)
        ? captionAlign
        : "left",
      watchedAt: isReel ? null : watchedAt,
      location: cleanLocation,
      isPrivate: isPrivate ?? false,
      hideWatchedAt: isReel ? false : (hideWatchedAt ?? false),
      hideLocation: isReel ? false : (hideLocation ?? false),
      rating: isReel ? null : rating ? String(rating) : null,
      ratingType:
        isReel ? "star" : ratingType === "blackhole" ? "blackhole" : "star",
      hideRating: isReel ? false : (hideRating === true),
      isPrivateMemory: isPrivateMemory === true,
      isSpoiler: isSpoiler === true,
      rankTier: tier,
      currentRankTier: tier,
      popularityScore: score,
      tmdbSnapshot: JSON.stringify(snapshot),
      partyGroupId: isParty ? partyGroupId : null,
      partySeatNumber: isParty ? validatedSeat : null,
      partySize: isParty ? validatedPartySize : null,
      specialColor: null,
      customRankTier: isReel ? null : validCustomTier,
      rankLocked: isRankLocked,
      cardTheme: isReel
        ? "reel"
        : cardTheme === "poster"
          ? "poster"
          : "classic",
      cardBackdropUrl:
        cardTheme === "poster" ? (cardBackdropUrl ?? null) : null,
      cardBackdropOffsetX:
        cardTheme === "poster" && cardBackdropOffsetX != null
          ? Number(cardBackdropOffsetX)
          : 50,
      cardRuntime: cardTheme === "poster" ? (cardRuntime ?? null) : null,
      cardDirector: cardTheme === "poster" ? (cardDirector ?? null) : null,
      cardProducer: cardTheme === "poster" ? (cardProducer ?? null) : null,
      cardActors: cardTheme === "poster" ? (cardActors ?? null) : null,
      clipUrl: isReel ? (clipUrl ?? null) : null,
      episodeLabel: episodeLabel ? String(episodeLabel).slice(0, 200) : null,
    });

    // Tags
    if (Array.isArray(taggedUserIds) && taggedUserIds.length > 0) {
      await db.insert(ticketTagsTable).values(
        taggedUserIds.map((uid: string) => ({ ticketId: id, userId: uid })),
      );

      // Badge XP: award tag_ticket XP once per Ticket (not per tagged person).
      // Cap: 2 tickets with tags per day. See awardTagTicketXp in badge.service.ts.
      awardTagTicketXp(currentUserId, id).catch(() => {});
    }

    // Party invites — wrapped in try-catch so notification failures never
    // cause a 500 after the ticket row is already committed to the DB.
    if (
      isParty &&
      partyGroupId &&
      Array.isArray(partyInviteeIds) &&
      partyInviteeIds.length > 0
    ) {
      try {
        const [inviter] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, currentUserId))
          .limit(1);
        const inviterName =
          inviter?.displayName || inviter?.username || "Someone";

        for (const inviteeId of partyInviteeIds as string[]) {
          if (inviteeId === currentUserId) continue;

          try {
            // ไม่ตรวจ duplicate movie ที่นี่ — ถ้า invitee มีหนังนั้นอยู่แล้วก็ยังส่ง
            // invite + notification ได้ แต่ accept endpoint จะคืน 409 duplicate_movie
            // ให้ invitee ลบของเก่าก่อนค่อย accept (ตาม spec)
            const inviteId = nanoid();
            await db.insert(partyInvitesTable).values({
              id: inviteId,
              partyGroupId,
              inviterUserId: currentUserId,
              inviterTicketId: id,
              inviteeUserId: inviteeId,
              status: "pending",
              assignedSeat: null,
            });

            await createNotification({
              id: nanoid(),
              userId: inviteeId,
              fromUserId: currentUserId,
              type: "party_invite",
              ticketId: id,
              partyInviteId: inviteId,
              partyGroupId,
              message: `ชวนคุณร่วมปาร์ตี้ดูหนัง "${sanitize(movieTitle)}" ปาร์ตี้ ${validatedPartySize} คน`,
              isRead: false,
            });

            emitNotificationNew(inviteeId);
          } catch (err) {
            // per-invitee failure is non-fatal — ticket is already saved,
            // but log it: a silently swallowed error here is exactly why a
            // tagged friend can end up with neither an invite row nor an
            // in-app notification while others in the same party do.
            console.error(`[party-invite] failed to create invite/notification for invitee ${inviteeId} (ticket ${id}):`, err);
          }
        }
      } catch (err) {
        // party invite block failed — ticket is still valid, continue
        console.error(`[party-invite] party invite block failed for ticket ${id}:`, err);
      }
    }

    const [created] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, id))
      .limit(1);
    const result = await buildTicket(created!, currentUserId);

    // Badge XP: award post XP (fire-and-forget — never blocks the response)
    awardXp(currentUserId, "post_ticket", id).catch(() => {});

    // Notify followers via WebSocket — fire-and-forget so WS errors never
    // cause a 500 after the ticket is already committed.
    try {
      const followers = await db
        .select({ followerId: followsTable.followerId })
        .from(followsTable)
        .where(eq(followsTable.followingId, currentUserId));
      emitFeedNew(followers.map(f => f.followerId), currentUserId);
    } catch {
      // non-fatal — client will refresh feed via polling
    }

    // Push notify followers (best-effort, fire-and-forget) — skip private posts
    if (!isPrivate) {
      notifyFollowersNewPost({
        authorId: currentUserId,
        kind: "ticket",
        postId: id,
        movieTitle: movieTitle ?? null,
        posterUrl: posterUrl ?? null,
      }).catch(() => {});
    }

    res.status(201).json(result);
  }),
);

// ── GET /tickets/trash/list ───────────────────────────────────────────────────
router.get(
  "/trash/list",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const tickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.userId, currentUserId),
          isNotNull(ticketsTable.deletedAt),
        ),
      )
      .orderBy(desc(ticketsTable.deletedAt))
      .limit(50);

    const recentlyDeleted = tickets.filter(
      (t) => t.deletedAt && t.deletedAt > thirtyDaysAgo,
    );
    const result = await Promise.all(
      recentlyDeleted.map((t) => buildTicket(t, currentUserId)),
    );
    res.json({ tickets: result });
  }),
);

// ── POST /tickets/trash/:ticketId/restore ─────────────────────────────────────
router.post(
  "/trash/:ticketId/restore",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNotNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    // Mirror the same series/episode logic used in the create endpoint
    const normalizedEpisodeLabel = ticket.episodeLabel ? ticket.episodeLabel.trim() : null;
    const isSeries = String(ticket.imdbId).startsWith("tmdb_tv:") || Boolean(normalizedEpisodeLabel);

    const baseCondition = and(
      eq(ticketsTable.userId, currentUserId),
      eq(ticketsTable.imdbId, ticket.imdbId),
      isNull(ticketsTable.deletedAt),
    );
    const duplicateCondition = isSeries
      ? (normalizedEpisodeLabel
          ? and(baseCondition, eq(ticketsTable.episodeLabel, normalizedEpisodeLabel))
          : and(baseCondition, isNull(ticketsTable.episodeLabel)))
      : baseCondition;

    const [activeDuplicate] = await db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(duplicateCondition)
      .limit(1);
    if (activeDuplicate) {
      const errorMsg = isSeries && normalizedEpisodeLabel
        ? `คุณมีตอนนี้ของ ${ticket.movieTitle} อยู่แล้ว กรุณาลบออกก่อนจึงจะกู้คืนได้`
        : `คุณมี ${ticket.movieTitle} อยู่ในคอลเลกชันแล้ว กรุณาลบออกก่อนจึงจะกู้คืนได้`;
      throw new ConflictError("duplicate_movie", errorMsg);
    }

    await db
      .update(ticketsTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));

    const [restored] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .limit(1);
    const result = await buildTicket(restored!, currentUserId);
    res.json(result);
  }),
);

// ── DELETE /tickets/trash/:ticketId/purge ─────────────────────────────────────
router.delete(
  "/trash/:ticketId/purge",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNotNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    await db.delete(ticketsTable).where(eq(ticketsTable.id, ticketId));
    res.json({ success: true, message: "Permanently deleted" });
  }),
);

// ── PATCH /tickets/reorder ────────────────────────────────────────────────────
router.patch(
  "/reorder",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const { ticketIds } = req.body;
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      throw new ValidationError("ticketIds must be a non-empty array");
    }

    await Promise.all(
      (ticketIds as string[]).map((id, i) =>
        db
          .update(ticketsTable)
          .set({ displayOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(ticketsTable.id, id),
              eq(ticketsTable.userId, currentUserId),
              isNull(ticketsTable.deletedAt),
            ),
          ),
      ),
    );
    res.json({ success: true });
  }),
);

// ── GET /tickets/user/:username ───────────────────────────────────────────────
router.get(
  "/user/:username",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const username = String(req.params["username"]);
    const limit = Math.min(Number(req.query["limit"]) || 50, 100);

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    if (!user) throw new NotFoundError("User");

    const isOwn = currentUserId === user.id;
    const baseConditions = [
      eq(ticketsTable.userId, user.id),
      isNull(ticketsTable.deletedAt),
      isNull(ticketsTable.archivedAt),
      ...(isOwn ? [] : [eq(ticketsTable.isPrivate, false)]),
    ];

    const tickets = await db
      .select()
      .from(ticketsTable)
      .where(and(...baseConditions))
      .orderBy(desc(ticketsTable.createdAt))
      .limit(limit + 1);

    const hasMore = tickets.length > limit;
    const items = tickets.slice(0, limit);
    const result = await buildTicketBatch(items, currentUserId);
    res.json({
      tickets: result,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  }),
);

// ── GET /tickets/archived — list current user's archived tickets ──────────────
router.get(
  "/archived",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const tickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.userId, currentUserId),
          isNull(ticketsTable.deletedAt),
          isNotNull(ticketsTable.archivedAt),
        ),
      )
      .orderBy(desc(ticketsTable.archivedAt));

    const result = await buildTicketBatch(tickets, currentUserId);
    res.json({ tickets: result });
  }),
);

// ── PATCH /tickets/:ticketId/archive — toggle archive state ───────────────────
router.patch(
  "/:ticketId/archive",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
      .limit(1);

    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const nowArchived = !ticket.archivedAt;
    await db
      .update(ticketsTable)
      .set({ archivedAt: nowArchived ? new Date() : null, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));

    res.json({ success: true, archived: nowArchived });
  }),
);

// ── GET /tickets/:ticketId/party-invites — owner only ────────────────────────
router.get(
  "/:ticketId/party-invites",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();
    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();
    if (!ticket.partyGroupId) return res.json({ invites: [] });

    const invites = await db
      .select({
        inviteId: partyInvitesTable.id,
        inviteeId: partyInvitesTable.inviteeUserId,
        status: partyInvitesTable.status,
        assignedSeat: partyInvitesTable.assignedSeat,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(partyInvitesTable)
      .innerJoin(usersTable, eq(partyInvitesTable.inviteeUserId, usersTable.id))
      .where(eq(partyInvitesTable.partyGroupId, ticket.partyGroupId));

    return res.json({ invites });
  }),
);

// ── GET /tickets/:ticketId ────────────────────────────────────────────────────
router.get(
  "/:ticketId",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const ticketId = String(req.params["ticketId"]);

    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.isPrivate && ticket.userId !== currentUserId) {
      throw new ForbiddenError();
    }

    const result = await buildTicket(ticket, currentUserId);
    res.json(result);
  }),
);

// ── GET /tickets/:ticketId/export-card.png ───────────────────────────────────
// Server-side card render — produces a deterministic PNG that is identical
// across every device. Replaces the previous client-side html2canvas pipeline
// (which produced inconsistent results on iOS WebKit). Honours the same
// privacy rules as GET /tickets/:ticketId.
router.get(
  "/:ticketId/export-card.png",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const ticketId = String(req.params["ticketId"]);
    const lang = req.query["lang"] === "th" ? "th" : "en";

    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.isPrivate && ticket.userId !== currentUserId) {
      throw new ForbiddenError();
    }

    const built = await buildTicket(ticket, currentUserId);

    // Lazy-import the renderer so its (large) deps only load when actually used.
    const { renderTicketCardPng } = await import("../services/card-render.js");
    const png = await renderTicketCardPng(built, { lang });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.end(png);
  }),
);

// ── POST /tickets/:ticketId/refresh-rank ─────────────────────────────────────
router.post(
  "/:ticketId/refresh-rank",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");

    if (ticket.rankLocked) {
      const result = await buildTicket(ticket, currentUserId);
      res.json(result);
      return;
    }

    const { tier, score, snapshot } = await calculateRankTier(ticket.imdbId);
    await db
      .update(ticketsTable)
      .set({
        rankTier: tier,
        currentRankTier: tier,
        popularityScore: score,
        tmdbSnapshot: JSON.stringify(snapshot),
        updatedAt: new Date(),
      })
      .where(eq(ticketsTable.id, ticketId));

    const [updated] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .limit(1);
    const result = await buildTicket(updated!, currentUserId);
    res.json(result);
  }),
);

// ── PATCH /tickets/:ticketId/content — edit caption ───────────────────────────
router.patch(
  "/:ticketId/content",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();
    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();
    const { caption, captionAlign, memoryNote, rating, ratingType, watchedAt, location, isSpoiler, hideRating, partyMode, partySize, partySeatNumber, partyInviteeIds, removedInviteIds, cardTheme, cardBackdropUrl, cardBackdropOffsetX } = req.body;

    // Party field validation and update preparation
    let partyUpdate: Record<string, unknown> = {};
    if (typeof partyMode === "boolean") {
      if (partyMode) {
        const validatedPartySize = Math.floor(Number(partySize));
        const validatedSeat = Math.floor(Number(partySeatNumber));
        if (isNaN(validatedPartySize) || validatedPartySize < 2 || validatedPartySize > 10)
          throw new ValidationError("partySize ต้องอยู่ระหว่าง 2-10");
        if (isNaN(validatedSeat) || validatedSeat < 1 || validatedSeat > validatedPartySize)
          throw new ValidationError("partySeatNumber ไม่ถูกต้อง");
        const partyGroupId = ticket.partyGroupId ?? nanoid();
        partyUpdate = { partyMode: true, partySize: validatedPartySize, partySeatNumber: validatedSeat, partyGroupId };
      } else {
        partyUpdate = { partyMode: false, partySize: null, partySeatNumber: null };
      }
    }

    await db
      .update(ticketsTable)
      .set({
        caption: typeof caption === "string" ? caption.trim() || null : ticket.caption,
        captionAlign: ["left", "center", "right"].includes(captionAlign) ? captionAlign : ticket.captionAlign,
        memoryNote: typeof memoryNote === "string" ? memoryNote.trim() || null : ticket.memoryNote,
        rating: rating === null ? null : (typeof rating === "number" && rating >= 1 && rating <= 5 ? String(rating) : ticket.rating),
        ratingType: ratingType === "blackhole" || ratingType === "star" ? ratingType : ticket.ratingType,
        watchedAt: typeof watchedAt === "string" && watchedAt ? watchedAt : watchedAt === "" ? null : ticket.watchedAt,
        location: typeof location === "string" ? location.trim() || null : ticket.location,
        isSpoiler: typeof isSpoiler === "boolean" ? isSpoiler : ticket.isSpoiler,
        hideRating: typeof hideRating === "boolean" ? hideRating : ticket.hideRating,
        // Poster theme fields (only editable when not a reel)
        ...(!isReel && ["classic", "poster"].includes(cardTheme) ? {
          cardTheme,
          cardBackdropUrl: cardTheme === "poster" ? (typeof cardBackdropUrl === "string" ? cardBackdropUrl : ticket.cardBackdropUrl) : null,
          cardBackdropOffsetX: cardTheme === "poster" && typeof cardBackdropOffsetX === "number" ? cardBackdropOffsetX : ticket.cardBackdropOffsetX,
        } : {}),
        ...partyUpdate,
      })
      .where(eq(ticketsTable.id, ticketId));

    // Cancel pending invites the owner removed — do this FIRST so the resend
    // pass below never re-notifies someone who was just removed in this
    // same save.
    if (Array.isArray(removedInviteIds) && removedInviteIds.length > 0) {
      const resolvedGroupId = (partyUpdate["partyGroupId"] as string | undefined) ?? ticket.partyGroupId;
      if (resolvedGroupId) {
        try {
          await db.delete(partyInvitesTable).where(
            and(
              eq(partyInvitesTable.partyGroupId, resolvedGroupId),
              eq(partyInvitesTable.inviterUserId, currentUserId),
              inArray(partyInvitesTable.id, removedInviteIds as string[]),
              eq(partyInvitesTable.status, "pending"), // never cancel accepted
            ),
          );
        } catch { /* non-fatal */ }
      }
    }

    // Re-send party invite notifications on EVERY save while partyMode is on
    // (fire-and-forget, never fail the request) — not just when new invitees
    // are tagged. The owner may edit the ticket (or simply tap Save with no
    // changes) and every still-pending tagged friend should get a fresh
    // notification each time, since the notification row is independent of
    // the invite row: if they trashed an earlier notification the invite row
    // survives untouched and they'd otherwise never hear about it again.
    // Accepted or declined invitees are never re-notified.
    if (partyMode === true) {
      const resolvedGroupId = (partyUpdate["partyGroupId"] as string | undefined) ?? ticket.partyGroupId;
      if (resolvedGroupId) {
        const [inviter] = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
        const inviterName = inviter?.displayName || inviter?.username || "Someone";

        // Everyone already tracked for this party (pending/declined/accepted),
        // plus any brand-new invitees tagged in this save.
        const existingInvites = await db.select({
          id: partyInvitesTable.id,
          inviteeUserId: partyInvitesTable.inviteeUserId,
          status: partyInvitesTable.status,
        }).from(partyInvitesTable).where(eq(partyInvitesTable.partyGroupId, resolvedGroupId));
        const existingByInvitee = new Map(existingInvites.map(inv => [inv.inviteeUserId, inv]));

        const newInviteeIds = Array.isArray(partyInviteeIds) ? (partyInviteeIds as string[]) : [];
        const inviteeIdsToProcess = new Set<string>([
          ...existingInvites.map(inv => inv.inviteeUserId),
          ...newInviteeIds,
        ]);

        for (const inviteeId of inviteeIdsToProcess) {
          if (inviteeId === currentUserId) continue;
          try {
            const dup = existingByInvitee.get(inviteeId);
            if (dup?.status === "accepted" || dup?.status === "declined") continue;

            let inviteId: string;
            if (dup) {
              inviteId = dup.id;
            } else {
              inviteId = nanoid();
              await db.insert(partyInvitesTable).values({
                id: inviteId, partyGroupId: resolvedGroupId,
                inviterUserId: currentUserId, inviterTicketId: ticketId,
                inviteeUserId: inviteeId, status: "pending", assignedSeat: null,
              });
            }
            await createNotification({
              id: nanoid(), userId: inviteeId, fromUserId: currentUserId,
              type: "party_invite", ticketId, partyInviteId: inviteId, partyGroupId: resolvedGroupId,
              message: `${inviterName} ชวนคุณร่วมปาร์ตี้ดูหนัง`, isRead: false,
            });
            emitNotificationNew(inviteeId);
          } catch (err) {
            console.error(`[party-invite] resend failed for invitee ${inviteeId} (group ${resolvedGroupId}):`, err);
          }
        }
      }
    }

    res.json({ success: true });
  }),
);

// ── PATCH /tickets/:ticketId/caption-links — manage social link icons on caption ─
router.patch(
  "/:ticketId/caption-links",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();
    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select({ id: ticketsTable.id, userId: ticketsTable.userId })
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();
    const { links } = req.body;
    if (!Array.isArray(links) || links.length > 5)
      throw new ValidationError("links must be an array of max 5 items");
    const sanitized = (links as Record<string, unknown>[]).map(l => ({
      id: String(l["id"] ?? "").slice(0, 50),
      url: String(l["url"] ?? "").slice(0, 2000),
      platform: String(l["platform"] ?? "generic").slice(0, 20),
      label: l["label"] ? String(l["label"]).slice(0, 100) : undefined,
    }));
    await db.update(ticketsTable).set({ captionLinks: sanitized }).where(eq(ticketsTable.id, ticketId));
    res.json({ success: true, links: sanitized });
  }),
);

// ── PATCH /tickets/:ticketId/tag-rating — tagged co-watcher submits their rating ─
router.patch(
  "/:ticketId/tag-rating",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();
    const ticketId = String(req.params["ticketId"]);
    const { rating } = req.body;

    if (rating != null && (typeof rating !== "number" || rating < 1 || rating > 5)) {
      throw new ValidationError("rating ต้องอยู่ระหว่าง 1–5");
    }

    const [ticket] = await db
      .select({ id: ticketsTable.id, userId: ticketsTable.userId })
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId === currentUserId) throw new ValidationError("เจ้าของการ์ดใช้คะแนนที่ตั้งเมื่อสร้างการ์ดได้เลย");

    const [tag] = await db
      .select({ ticketId: ticketTagsTable.ticketId })
      .from(ticketTagsTable)
      .where(and(eq(ticketTagsTable.ticketId, ticketId), eq(ticketTagsTable.userId, currentUserId)))
      .limit(1);
    if (!tag) throw new ForbiddenError();

    await db
      .insert(ticketTagRatingsTable)
      .values({ ticketId, userId: currentUserId, rating: String(rating) })
      .onConflictDoUpdate({
        target: [ticketTagRatingsTable.ticketId, ticketTagRatingsTable.userId],
        set: { rating: String(rating) },
      });

    res.json({ success: true });
  }),
);

// ── PATCH /tickets/:ticketId/privacy ─────────────────────────────────────────
router.patch(
  "/:ticketId/privacy",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const newPrivate = !ticket.isPrivate;
    await db
      .update(ticketsTable)
      .set({ isPrivate: newPrivate, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));
    res.json({ success: true, isPrivate: newPrivate });
  }),
);

// ── PATCH /tickets/:ticketId/hide-likes ──────────────────────────────────────
router.patch(
  "/:ticketId/hide-likes",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const newHideLikes = !ticket.hideLikes;
    await db
      .update(ticketsTable)
      .set({ hideLikes: newHideLikes, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));
    res.json({ success: true, hideLikes: newHideLikes });
  }),
);

// ── PATCH /tickets/:ticketId/hide-comments ───────────────────────────────────
router.patch(
  "/:ticketId/hide-comments",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const newHideComments = !ticket.hideComments;
    await db
      .update(ticketsTable)
      .set({ hideComments: newHideComments, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));
    res.json({ success: true, hideComments: newHideComments });
  }),
);

// ── DELETE /tickets/:ticketId — soft delete ───────────────────────────────────
router.delete(
  "/:ticketId",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const partyGroupId = ticket.partyGroupId;
    const hadSpecialColor = !!ticket.specialColor;

    await db
      .update(ticketsTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId));

    // If party member deleted their ticket, revert foil color for remaining members
    if (partyGroupId) {
      const remainingTickets = await db
        .select()
        .from(ticketsTable)
        .where(
          and(
            eq(ticketsTable.partyGroupId, partyGroupId),
            isNull(ticketsTable.deletedAt),
            ne(ticketsTable.id, ticketId),
          ),
        );

      if (hadSpecialColor && remainingTickets.length > 0) {
        await db
          .update(ticketsTable)
          .set({ specialColor: null, updatedAt: new Date() })
          .where(
            and(
              eq(ticketsTable.partyGroupId, partyGroupId),
              isNull(ticketsTable.deletedAt),
            ),
          );

        const [deletingUser] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, currentUserId))
          .limit(1);
        const deletingName =
          deletingUser?.displayName || deletingUser?.username || "Someone";

        for (const t of remainingTickets) {
          if (t.userId === currentUserId) continue;
          await createNotification({
            id: nanoid(),
            userId: t.userId,
            fromUserId: currentUserId,
            type: "party_color_reverted",
            ticketId: t.id,
            partyGroupId,
            message: `${deletingName} ลบการ์ดออกจากปาร์ตี้ — สีพิเศษถูกรีเซ็ตกลับสู่สถานะปกติ`,
            isRead: false,
          });
        }
      }
    }

    res.json({ success: true, message: "Moved to trash" });
  }),
);

// ── POST /tickets/:ticketId/memory-request ────────────────────────────────────
router.post(
  "/:ticketId/memory-request",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (!ticket.isPrivateMemory) {
      throw new ValidationError("Ticket is not a private memory");
    }
    if (ticket.userId === currentUserId) {
      throw new ValidationError("Cannot request access to your own ticket");
    }

    const [existing] = await db
      .select()
      .from(memoryAccessRequestsTable)
      .where(
        and(
          eq(memoryAccessRequestsTable.ticketId, ticketId),
          eq(memoryAccessRequestsTable.requesterId, currentUserId),
          eq(memoryAccessRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) throw new ConflictError("already_requested", "Already requested");

    const id = nanoid();
    await db.insert(memoryAccessRequestsTable).values({
      id,
      ticketId,
      requesterId: currentUserId,
      ownerId: ticket.userId,
      status: "pending",
    });

    await createNotification({
      id: nanoid(),
      userId: ticket.userId,
      fromUserId: currentUserId,
      type: "memory_request",
      ticketId,
      message: `ขอดูความทรงจำส่วนตัวในการ์ด "${ticket.movieTitle}"`,
      isRead: false,
    });

    res.json({ success: true, requestId: id });
  }),
);

// ── GET /tickets/:ticketId/memory-requests ────────────────────────────────────
router.get(
  "/:ticketId/memory-requests",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const requests = await db
      .select({
        id: memoryAccessRequestsTable.id,
        status: memoryAccessRequestsTable.status,
        createdAt: memoryAccessRequestsTable.createdAt,
        expiresAt: memoryAccessRequestsTable.expiresAt,
        requester: {
          id: usersTable.id,
          username: usersTable.username,
          displayName: usersTable.displayName,
          avatarUrl: usersTable.avatarUrl,
        },
      })
      .from(memoryAccessRequestsTable)
      .innerJoin(
        usersTable,
        eq(memoryAccessRequestsTable.requesterId, usersTable.id),
      )
      .where(eq(memoryAccessRequestsTable.ticketId, ticketId))
      .orderBy(desc(memoryAccessRequestsTable.createdAt));

    res.json({ requests });
  }),
);

// ── POST /tickets/:ticketId/memory-requests/:requestId/approve ────────────────
router.post(
  "/:ticketId/memory-requests/:requestId/approve",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]); const requestId = String(req.params["requestId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    const [request] = await db
      .select()
      .from(memoryAccessRequestsTable)
      .where(
        and(
          eq(memoryAccessRequestsTable.id, requestId),
          eq(memoryAccessRequestsTable.ticketId, ticketId),
        ),
      )
      .limit(1);
    if (!request) throw new NotFoundError("Request");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db
      .update(memoryAccessRequestsTable)
      .set({ status: "approved", expiresAt })
      .where(eq(memoryAccessRequestsTable.id, requestId));

    await createNotification({
      id: nanoid(),
      userId: request.requesterId,
      fromUserId: currentUserId,
      type: "memory_approved",
      ticketId,
      message: "อนุมัติคำขอดูความทรงจำแล้ว คุณสามารถอ่านได้ภายใน 7 วัน",
      isRead: false,
    });

    res.json({ success: true, expiresAt });
  }),
);

// ── POST /tickets/:ticketId/memory-requests/:requestId/deny ──────────────────
router.post(
  "/:ticketId/memory-requests/:requestId/deny",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]); const requestId = String(req.params["requestId"]);
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId !== currentUserId) throw new ForbiddenError();

    await db
      .update(memoryAccessRequestsTable)
      .set({ status: "denied" })
      .where(
        and(
          eq(memoryAccessRequestsTable.id, requestId),
          eq(memoryAccessRequestsTable.ticketId, ticketId),
        ),
      );

    res.json({ success: true });
  }),
);

// ── POST /tickets/:ticketId/report ────────────────────────────────────────────
router.post(
  "/:ticketId/report",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const ticketId = String(req.params["ticketId"]);
    const { reason, details } = req.body;

    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(
        and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
      )
      .limit(1);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.userId === currentUserId) {
      throw new ValidationError("Cannot report your own ticket");
    }

    // Rate limit: 20 reports per user total
    const [recentReports] = await db
      .select({ c: count() })
      .from(reportsTable)
      .where(eq(reportsTable.reporterId, currentUserId));
    if ((recentReports?.c ?? 0) >= 20) {
      res
        .status(429)
        .json({ error: "rate_limited", message: "Too many reports" });
      return;
    }

    // Dedup
    const [already] = await db
      .select()
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.reporterId, currentUserId),
          eq(reportsTable.ticketId, ticketId),
        ),
      )
      .limit(1);
    if (already) throw new ConflictError("already_reported", "Already reported");

    const validReasons = [
      "spam",
      "inappropriate",
      "harassment",
      "other",
    ] as const;
    const safeReason = (
      validReasons as readonly string[]
    ).includes(reason)
      ? (reason as (typeof validReasons)[number])
      : "other";

    await db.insert(reportsTable).values({
      id: nanoid(),
      reporterId: currentUserId,
      reportedUserId: ticket.userId,
      ticketId,
      reason: safeReason,
      details: details ? sanitize(details) : null,
    });

    // Notify Discord
    const { notifyReport } = await import("../lib/discord");
    const [reporterUser] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);
    const [ticketOwner] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, ticket.userId))
      .limit(1);
    await notifyReport({
      type: "ticket",
      reason: safeReason,
      details,
      reporterUsername: reporterUser?.username ?? undefined,
      targetUsername: ticketOwner?.username ?? undefined,
      targetId: ticketId,
      extraLabel: `หนัง: ${ticket.movieTitle ?? ticketId}`,
    });

    // Auto-flag: 5+ unique reports → soft-hide pending review
    const [reportCount] = await db
      .select({ c: count() })
      .from(reportsTable)
      .where(eq(reportsTable.ticketId, ticketId));
    if ((reportCount?.c ?? 0) >= 5) {
      await db
        .update(ticketsTable)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)),
        );
    }

    res.json({ success: true });
  }),
);

export { buildTicket, checkAndUpdatePartyColor };
export default router;
