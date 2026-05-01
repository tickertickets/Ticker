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
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { hotScore, applyDiversityCap, DIVERSITY_CAP } from "../lib/hot-score";
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
import { awardXp } from "../services/badge.service";

const router: IRouter = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const createTicketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Too many tickets created. Please wait before posting again." },
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

// ── GET /tickets — feed ───────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    const limit = Math.min(Number(req.query["limit"]) || 20, 50);
    const feed = (req.query["feed"] as string) || "discovery";
    const typeParam = (req.query["type"] as string) || "all";
    const notDeleted = isNull(ticketsTable.deletedAt);

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

    // ── Fresh-post boost (industry-standard "velocity" signal) ────────────────
    // Posts < 60 min old from the current user (all modes) or from followed
    // users (home/following mode) receive a decaying multiplier: 15× at t=0,
    // dropping linearly to 1× at t=1 (60 min). After expiry they compete
    // purely on hotScore — no permanent affinity multiplier.
    // Matches Instagram/Reddit behaviour.
    const FRESH_WINDOW_MS = 60 * 60 * 1000;
    const makeFreshBoost = (followedSet?: Set<string>) =>
      (userId: string, createdAt: Date): number => {
        const isOwnPost = currentUserId && userId === currentUserId;
        const isFollowedPost = followedSet ? followedSet.has(userId) : false;
        if (!isOwnPost && !isFollowedPost) return 1.0;
        const ageMs = Date.now() - createdAt.getTime();
        if (ageMs >= FRESH_WINDOW_MS) return 1.0;
        const t = ageMs / FRESH_WINDOW_MS;
        return 1.0 + 14.0 * (1 - t); // 15× at t=0, 1× at t=1
      };

    // ── Shared helper: bulk-score a list of tickets ────────────────────────────
    // Uses likesTable (heart likes) — the single engagement currency.
    // Consistent with the unified feed scoring in /api/feed.
    const bulkScore = async (
      rows: RawTicket[],
      affinityFn?: (userId: string) => number,
      freshBoostFn?: (userId: string, createdAt: Date) => number,
    ): Promise<Array<{ t: RawTicket; score: number }>> => {
      if (rows.length === 0) return [];
      const ids = rows.map((t) => t.id);
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
      const likeLastAt = new Map(likeRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));
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
      // Final ranking: hotScore × freshBoost, merged and sorted.
      // No permanent affinity multiplier — followed users only get the
      // 60-minute fresh boost (and own/followed posts get pulled into Tier A).
      // After the fresh window, every post competes equally.

      const POOL = limit * 4;
      const AFFINITY_FOLLOWED = 1.0;
      const AFFINITY_DISCOVERY = 1.0;

      // 1. Get followed user IDs
      const followRows = await db
        .select({ followingId: followsTable.followingId })
        .from(followsTable)
        .where(eq(followsTable.followerId, currentUserId));
      const followedIds = followRows.map((f) => f.followingId);
      const followedSet = new Set([...followedIds, currentUserId]);

      // 2a. Tier A: own posts (any privacy) + followed users' non-private posts
      const tierAWhere = and(
        notDeleted,
        typeFilter,
        followedIds.length > 0
          ? inArray(ticketsTable.userId, [...followedIds, currentUserId])
          : eq(ticketsTable.userId, currentUserId),
        // own posts: show all; followed users: only non-private tickets
        // We fetch all then filter: private tickets from others are excluded below
      );
      const tierARaw = await db
        .select()
        .from(ticketsTable)
        .where(tierAWhere)
        .orderBy(desc(sql`GREATEST(
          ${ticketsTable.createdAt},
          COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
        )`))
        .limit(POOL);

      // exclude other users' private tickets (keep own private tickets)
      const tierA = tierARaw.filter((t) => t.userId === currentUserId || !t.isPrivate);

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
              // exclude posts already in tier A to avoid duplicates
              tierA.length > 0
                ? notInArray(ticketsTable.id, tierA.map((t) => t.id))
                : undefined,
            ))
            .orderBy(desc(sql`GREATEST(
              ${ticketsTable.createdAt},
              COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
              COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
            )`))
            .limit(POOL)
        : [];

      // 3. Score both tiers and merge
      const affinityFn = (uid: string) => followedSet.has(uid) ? AFFINITY_FOLLOWED : AFFINITY_DISCOVERY;
      const freshBoostFn = makeFreshBoost(followedSet);
      const [scoredA, scoredB] = await Promise.all([
        bulkScore(tierA, affinityFn, freshBoostFn),
        bulkScore(tierBRaw, affinityFn, freshBoostFn),
      ]);

      const merged = [...scoredA, ...scoredB];
      merged.sort((a, b) => b.score - a.score);
      const capped = applyDiversityCap(merged, (s) => s.t.userId, DIVERSITY_CAP, limit + 1);
      tickets = capped.map((s) => s.t);

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
        const POOL = limit * 4;
        const raw = await db
          .select()
          .from(ticketsTable)
          .where(and(
            inArray(ticketsTable.userId, feedUserIds),
            notDeleted,
            typeFilter,
            // own posts shown regardless of privacy; others' only if non-private
          ))
          .orderBy(desc(sql`GREATEST(
            ${ticketsTable.createdAt},
            COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
            COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
          )`))
          .limit(POOL);

        // filter: keep own private posts, exclude others' private tickets
        const filtered = raw.filter((t) => t.userId === currentUserId || !t.isPrivate);
        const followedSet = new Set(feedUserIds);
        const freshBoostFn = makeFreshBoost(followedSet);
        const scored = await bulkScore(filtered, undefined, freshBoostFn);
        scored.sort((a, b) => b.score - a.score);
        const capped = applyDiversityCap(scored, (s) => s.t.userId, DIVERSITY_CAP, limit + 1);
        tickets = capped.map((s) => s.t);
      }

    } else {
      // ── Discovery / Explore Feed ────────────────────────────────────────────
      //
      // Global hot-score ranking — no affinity boost.
      // Used for dedicated type tabs (Tickets / Reels) and unauthenticated users.
      // Visibility: public accounts + non-private posts only.

      const DISC_POOL = limit * 5;

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
            ))
            .orderBy(desc(sql`GREATEST(
              ${ticketsTable.createdAt},
              COALESCE((SELECT MAX(created_at) FROM likes WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt}),
              COALESCE((SELECT MAX(created_at) FROM comments WHERE ticket_id = ${ticketsTable.id}), ${ticketsTable.createdAt})
            )`))
            .limit(DISC_POOL)
        : [];

      // In discovery mode only own posts get freshBoost (no social graph context)
      const freshBoostFn = makeFreshBoost();
      const scored = await bulkScore(discRaw, undefined, freshBoostFn);
      scored.sort((a, b) => b.score - a.score);
      const capped = applyDiversityCap(scored, (s) => s.t.userId, DIVERSITY_CAP, limit + 1);
      tickets = capped.map((s) => s.t);
    }

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

// ── POST /tickets — create ────────────────────────────────────────────────────
router.post(
  "/",
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
    } = req.body;

    const isReel = cardTheme === "reel";

    if (!isReel && (!imdbId || !movieTitle)) {
      throw new ValidationError("imdbId and movieTitle are required");
    }
    if (isReel && !clipUrl) {
      throw new ValidationError("clipUrl is required for reel posts");
    }
    if (!isReel && (!rating || Number(rating) < 1 || Number(rating) > 5)) {
      throw new ValidationError("rating is required (1–5)");
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
            ? (normalizedEpisodeLabel ? "คุณโพสต์ตอนนี้ไปแล้ว" : "คุณโพสต์ดูทั่วไปของซีรีส์นี้ไปแล้ว ลองเลือกตอนเพื่อโพสต์ใหม่")
            : "คุณโพสต์หนังเรื่องนี้ไปแล้ว",
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

      // Badge XP: award tag_friend XP for each unique, non-blocked tagged user
      const BLOCKED_USERNAMES = ["tickerofficial"];
      const taggedUsers = await db
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(inArray(usersTable.id, taggedUserIds as string[]));

      for (const taggedUser of taggedUsers) {
        if (!taggedUser.username) continue;
        if (BLOCKED_USERNAMES.includes(taggedUser.username.toLowerCase())) continue;
        if (taggedUser.id === currentUserId) continue;
        awardXp(currentUserId, "tag_friend", `tag:${id}:${taggedUser.id}`, taggedUser.id).catch(() => {});
      }
    }

    // Party invites
    if (
      isParty &&
      partyGroupId &&
      Array.isArray(partyInviteeIds) &&
      partyInviteeIds.length > 0
    ) {
      const [inviter] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, currentUserId))
        .limit(1);
      const inviterName =
        inviter?.displayName || inviter?.username || "Someone";

      for (const inviteeId of partyInviteeIds as string[]) {
        if (inviteeId === currentUserId) continue;

        const [dupCheck] = await db
          .select({ id: ticketsTable.id })
          .from(ticketsTable)
          .where(
            and(
              eq(ticketsTable.userId, inviteeId),
              eq(ticketsTable.imdbId, imdbId),
              isNull(ticketsTable.deletedAt),
              eq(ticketsTable.isPrivateMemory, false),
            ),
          )
          .limit(1);
        if (dupCheck) continue;

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

    // Notify followers via WebSocket that a new post appeared in their feed
    const followers = await db
      .select({ followerId: followsTable.followerId })
      .from(followsTable)
      .where(eq(followsTable.followingId, currentUserId));
    emitFeedNew(followers.map(f => f.followerId), currentUserId);

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
    const { caption, captionAlign, memoryNote, rating, watchedAt, location, isSpoiler } = req.body;
    await db
      .update(ticketsTable)
      .set({
        caption: typeof caption === "string" ? caption.trim() || null : ticket.caption,
        captionAlign: ["left", "center", "right"].includes(captionAlign) ? captionAlign : ticket.captionAlign,
        memoryNote: typeof memoryNote === "string" ? memoryNote.trim() || null : ticket.memoryNote,
        rating: typeof rating === "number" && rating >= 1 && rating <= 5 ? String(rating) : ticket.rating,
        watchedAt: typeof watchedAt === "string" && watchedAt ? watchedAt : watchedAt === "" ? null : ticket.watchedAt,
        location: typeof location === "string" ? location.trim() || null : ticket.location,
        isSpoiler: typeof isSpoiler === "boolean" ? isSpoiler : ticket.isSpoiler,
      })
      .where(eq(ticketsTable.id, ticketId));
    res.json({ success: true });
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

    if (typeof rating !== "number" || rating < 1 || rating > 5) {
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
