/**
 * Tickets Service — core business logic for movie tickets.
 *
 * Contains:
 *  - calculateRankTier:   fetches TMDB data and returns a rank tier + score
 *  - buildTicket:         assembles the full ticket API response object
 *  - updatePartyColor:    updates special foil color for all party members
 *
 * Previously all of this lived inside routes/tickets.ts, making that file
 * 1 000+ lines long and untestable in isolation.
 */

import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  likesTable,
  bookmarksTable,
  commentsTable,
  ticketTagsTable,
  ticketTagRatingsTable,
  memoryAccessRequestsTable,
  notificationsTable,
  moviesTable,
  ticketReactionsTable,
  partyInvitesTable,
} from "@workspace/db/schema";
import { eq, and, desc, count, isNull, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { tmdbFetch } from "../lib/tmdb-client";
import {
  weightedScore,
  computeRankTier,
  type RankTier,
  type SpecialColor,
} from "./rank.service";

const REACTION_POINTS: Record<string, number> = {
  heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5,
};

function computeReactionData(
  allRows: { userId: string; ticketId: string; reactionType: string; count: number }[],
  ticketId: string,
  currentUserId?: string,
) {
  const rows = allRows.filter((r) => r.ticketId === ticketId);
  const totalScore = rows.reduce((s, r) => s + r.count * (REACTION_POINTS[r.reactionType] ?? 1), 0);

  const reactionBreakdown: Record<string, number> = { heart: 0, fire: 0, lightning: 0, sparkle: 0, popcorn: 0 };
  for (const r of rows) {
    if (r.reactionType in reactionBreakdown) reactionBreakdown[r.reactionType] += r.count;
  }

  const myReactions: Record<string, number> = { heart: 0, fire: 0, lightning: 0, sparkle: 0, popcorn: 0 };
  let hasReacted = false;
  if (currentUserId) {
    for (const r of rows.filter((r) => r.userId === currentUserId)) {
      if (r.reactionType in myReactions) myReactions[r.reactionType] = r.count;
    }
    hasReacted = Object.values(myReactions).some((v) => v > 0);
  }

  return { totalScore, reactionBreakdown, myReactions, hasReacted };
}

const MOVIE_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour — TTL for movies table entries

// ── TMDB Snapshot shape ───────────────────────────────────────────────────────

export type TmdbSnapshot = {
  tmdbRating: number;
  voteCount: number;
  year: number | null;
  popularity: number;
  genreIds: number[];
  franchiseIds?: number[];
  /** Global (primary) release date from TMDB, YYYY-MM-DD */
  releaseDate?: string | null;
  /** Thailand-specific theatrical release date (TMDB /release_dates, iso TH), YYYY-MM-DD */
  thReleaseDate?: string | null;
};

// ── calculateRankTier ─────────────────────────────────────────────────────────

export async function calculateRankTier(
  movieId: string,
): Promise<{ tier: RankTier; score: number; snapshot: TmdbSnapshot }> {
  const empty: TmdbSnapshot = {
    tmdbRating: 0,
    voteCount: 0,
    year: null,
    popularity: 0,
    genreIds: [],
  };

  try {
    let tmdbId: number;

    if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      // External ID lookup (e.g. IMDb tt-code)
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (!findData.movie_results || findData.movie_results.length === 0) {
        return { tier: "common", score: 0, snapshot: empty };
      }
      tmdbId = findData.movie_results[0]!.id;
    }

    // ── Check movies table cache before calling TMDB ──────────────────────────
    const [cached] = await db
      .select()
      .from(moviesTable)
      .where(eq(moviesTable.tmdbId, tmdbId))
      .limit(1);

    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      // ข้ามแคชถ้า thReleaseDate เป็น null และหนังออกฉายภายใน 180 วันที่ผ่านมา:
      // หนังกลุ่มนี้อาจถูก cache ก่อนที่ TMDB จะมีวันฉายไทย → บังคับ re-fetch
      // เพื่อให้ release guard ใช้วันฉายไทยที่ถูกต้อง แทนที่จะ fallback ไปวันฉายสากล
      const thReleaseDate = (cached as any).thReleaseDate as string | null;
      const isRecentMovie = cached.releaseDate
        ? Date.now() - new Date(cached.releaseDate).getTime() < 180 * 24 * 60 * 60 * 1000
        : false;
      const needsFreshThDate = thReleaseDate === null && isRecentMovie;

      if (age < MOVIE_CACHE_TTL_MS && !needsFreshThDate) {
        const rating = parseFloat(cached.voteAverage ?? "0");
        const votes = cached.voteCount ?? 0;
        const popularity = parseFloat(cached.popularity ?? "0");
        const genreIds = (cached.genreIds as number[]) ?? [];
        const franchiseIds = (cached.franchiseIds as number[] | null) ?? [];
        const releaseYear = cached.releaseDate
          ? parseInt(cached.releaseDate.slice(0, 4), 10)
          : null;
        const ws = weightedScore(rating, votes);
        const tier = computeRankTier(ws, releaseYear);
        return {
          tier,
          score: Math.round(ws * 10),
          snapshot: {
            tmdbRating: rating, voteCount: votes, year: releaseYear, popularity, genreIds, franchiseIds,
            releaseDate: cached.releaseDate ?? null,
            thReleaseDate,
          },
        };
      }
    }

    // ── Cache miss / stale — fetch from TMDB ─────────────────────────────────
    // append_to_response=release_dates เพื่อดึงวันฉายในแต่ละประเทศ (รวมไทย) ในคำขอเดียว
    const data = await tmdbFetch<{
      vote_average?: number;
      vote_count?: number;
      release_date?: string;
      popularity?: number;
      genre_ids?: number[];
      genres?: Array<{ id: number }>;
      belongs_to_collection?: { id: number } | null;
      title?: string;
      name?: string;
      poster_path?: string | null;
      backdrop_path?: string | null;
      overview?: string | null;
      success?: boolean;
      release_dates?: {
        results?: Array<{
          iso_3166_1: string;
          release_dates: Array<{ release_date: string; type: number }>;
        }>;
      };
    }>(`/movie/${tmdbId}`, { append_to_response: "release_dates" });

    if (data.success === false) {
      return { tier: "common", score: 0, snapshot: empty };
    }

    const rating = data.vote_average || 0;
    const votes = data.vote_count || 0;
    const popularity = data.popularity || 0;
    const genreIds = data.genre_ids ?? data.genres?.map((g) => g.id) ?? [];
    const franchiseIds = data.belongs_to_collection
      ? [data.belongs_to_collection.id]
      : [];
    const releaseYear = data.release_date
      ? parseInt(data.release_date.slice(0, 4), 10)
      : null;

    // ── Parse วันฉายไทย จาก append_to_response=release_dates ────────────────
    // type 3 = Theatrical (โรงหนัง) — ใช้ก่อน, fallback ไป entry แรก
    const thEntry = data.release_dates?.results?.find((r) => r.iso_3166_1 === "TH");
    const thDateEntry =
      thEntry?.release_dates?.find((d) => d.type === 3) ??
      thEntry?.release_dates?.[0];
    const thReleaseDate = thDateEntry?.release_date
      ? thDateEntry.release_date.slice(0, 10)
      : null;

    // ── Upsert into movies table ──────────────────────────────────────────────
    try {
      await db
        .insert(moviesTable)
        .values({
          tmdbId,
          mediaType: "movie",
          title: data.title || data.name || String(tmdbId),
          posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
          backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
          overview: data.overview ?? null,
          releaseDate: data.release_date ?? null,
          thReleaseDate,
          voteAverage: rating.toString(),
          voteCount: votes,
          popularity: popularity.toString(),
          genreIds,
          franchiseIds,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: moviesTable.tmdbId,
          set: {
            voteAverage: rating.toString(),
            voteCount: votes,
            popularity: popularity.toString(),
            genreIds,
            franchiseIds,
            thReleaseDate,
            fetchedAt: new Date(),
          },
        });
    } catch {
      // Cache write failure is non-fatal.
    }

    const ws = weightedScore(rating, votes);
    const tier = computeRankTier(ws, releaseYear);
    const score = Math.round(ws * 10);

    const snapshot: TmdbSnapshot = {
      tmdbRating: rating,
      voteCount: votes,
      year: releaseYear,
      popularity,
      genreIds,
      franchiseIds,
      releaseDate: data.release_date ?? null,
      thReleaseDate,
    };

    return { tier, score, snapshot };
  } catch {
    return { tier: "common", score: 0, snapshot: empty };
  }
}

// ── buildTicketBatch ──────────────────────────────────────────────────────────
//
// Batch-assembles full API response shapes for a list of tickets.
// Fires exactly 4-6 queries total regardless of list size, eliminating N+1.
// Use this for all feed/list endpoints. Use buildTicket for single-ticket reads.

export async function buildTicketBatch(
  tickets: (typeof ticketsTable.$inferSelect)[],
  currentUserId?: string,
) {
  if (tickets.length === 0) return [];

  const ticketIds = tickets.map((t) => t.id);
  const userIds = [...new Set(tickets.map((t) => t.userId))];

  // Parse ticket.imdbId → numeric TMDB id.
  // ticket.imdbId can be:  "12345"         (movie)
  //                        "tmdb_tv:12345"  (TV show)
  //                        "reel"           (short clip — no movie record)
  const parseTmdbId = (imdbId: string): number | null => {
    if (!imdbId || imdbId === "reel") return null;
    const raw = imdbId.startsWith("tmdb_tv:") ? imdbId.slice("tmdb_tv:".length) : imdbId;
    const id = parseInt(raw, 10);
    return isNaN(id) || id <= 0 ? null : id;
  };

  const uniqueTmdbIds = [
    ...new Set(tickets.map((t) => parseTmdbId(t.imdbId)).filter((id): id is number => id !== null)),
  ];

  const [users, allReactionRows, commentCounts, allTags, freshMovieRows] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, userIds)),
    db
      .select({
        userId: ticketReactionsTable.userId,
        ticketId: ticketReactionsTable.ticketId,
        reactionType: ticketReactionsTable.reactionType,
        count: ticketReactionsTable.count,
      })
      .from(ticketReactionsTable)
      .where(inArray(ticketReactionsTable.ticketId, ticketIds)),
    db
      .select({ ticketId: commentsTable.ticketId, n: count() })
      .from(commentsTable)
      .where(inArray(commentsTable.ticketId, ticketIds))
      .groupBy(commentsTable.ticketId),
    db
      .select({ ticketId: ticketTagsTable.ticketId, user: usersTable })
      .from(ticketTagsTable)
      .innerJoin(usersTable, eq(ticketTagsTable.userId, usersTable.id))
      .where(inArray(ticketTagsTable.ticketId, ticketIds)),
    uniqueTmdbIds.length > 0
      ? db
          .select({
            tmdbId:       moviesTable.tmdbId,
            voteAverage:  moviesTable.voteAverage,
            voteCount:    moviesTable.voteCount,
            genreIds:     moviesTable.genreIds,
            franchiseIds: moviesTable.franchiseIds,
            popularity:   moviesTable.popularity,
            releaseDate:  moviesTable.releaseDate,
            fetchedAt:    moviesTable.fetchedAt,
          })
          .from(moviesTable)
          .where(inArray(moviesTable.tmdbId, uniqueTmdbIds))
      : Promise.resolve([] as {
          tmdbId: number;
          voteAverage: string | null;
          voteCount: number | null;
          genreIds: number[] | null;
          franchiseIds: number[] | null;
          popularity: string | null;
          releaseDate: string | null;
          fetchedAt: Date | null;
        }[]),
  ]);

  // Key: numeric tmdbId → fresh movie data from the DB cache.
  // This lets every ticket carry the current TMDB score rather than the value
  // frozen in tmdbSnapshot at ticket-creation time (which drifts for new releases).
  const freshMovieMap = new Map(freshMovieRows.map((m) => [m.tmdbId, m]));

  // ── Background TMDB refresh for movies missing or stale in the cache ────────
  // • Missing  — never fetched; card falls back to tmdbSnapshot (creation-time).
  // • Stale    — in the DB but older than the 1-hour TTL; rank may drift.
  // Fire-and-forget: no extra latency for the current response, but the NEXT
  // feed load gets an up-to-date movieLiveSnapshot for every card.
  // Capped at 5 per request to avoid hitting TMDB rate limits.
  const staleIds = uniqueTmdbIds.filter((id) => {
    const m = freshMovieMap.get(id);
    if (!m) return true; // missing
    const age = m.fetchedAt ? Date.now() - new Date(m.fetchedAt).getTime() : Infinity;
    return age > MOVIE_CACHE_TTL_MS;
  });
  const toRefresh = staleIds.slice(0, 5);
  for (const id of toRefresh) {
    calculateRankTier(`${id}`).catch(() => {});
  }

  let viewerBookmarkedSet = new Set<string>();

  if (currentUserId) {
    const viewerBookmarks = await db
      .select({ ticketId: bookmarksTable.ticketId })
      .from(bookmarksTable)
      .where(and(eq(bookmarksTable.userId, currentUserId), inArray(bookmarksTable.ticketId, ticketIds)));
    viewerBookmarkedSet = new Set(viewerBookmarks.map((r) => r.ticketId));
  }

  const userMap = new Map(users.map((u) => [u.id, u]));
  const commentCountMap = new Map(commentCounts.map((r) => [r.ticketId, Number(r.n)]));
  const tagsMap = new Map<string, (typeof allTags)[0]["user"][]>();
  for (const row of allTags) {
    const existing = tagsMap.get(row.ticketId) ?? [];
    existing.push(row.user);
    tagsMap.set(row.ticketId, existing);
  }

  // Fetch party members for all party tickets
  const partyGroupIds = [...new Set(tickets.filter(t => t.partyGroupId).map(t => t.partyGroupId!))];
  type PartyMemberRow = { partyGroupId: string; seatNumber: number; userId: string; ticketId: string | null; username: string | null; displayName: string | null; avatarUrl: string | null };
  let allPartyMemberRows: PartyMemberRow[] = [];
  if (partyGroupIds.length > 0) {
    // (1) Members who have already posted their own ticket in this party
    const ticketRows = await db
      .select({
        id: ticketsTable.id,
        partyGroupId: ticketsTable.partyGroupId,
        seatNumber: ticketsTable.partySeatNumber,
        userId: ticketsTable.userId,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(ticketsTable)
      .innerJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
      .where(and(inArray(ticketsTable.partyGroupId, partyGroupIds), isNull(ticketsTable.deletedAt)));

    // Track postedUserIds PER partyGroupId — a global set would incorrectly exclude
    // users who posted in party A from appearing as invitees in party B.
    const postedUserIdsByGroup = new Map<string, Set<string>>();
    for (const r of ticketRows) {
      if (!r.partyGroupId) continue;
      if (!postedUserIdsByGroup.has(r.partyGroupId)) postedUserIdsByGroup.set(r.partyGroupId, new Set());
      postedUserIdsByGroup.get(r.partyGroupId)!.add(r.userId);
    }

    // (2) Accepted invitees who haven't posted their ticket yet — fill the gap
    const inviteRows = await db
      .select({
        partyGroupId: partyInvitesTable.partyGroupId,
        assignedSeat: partyInvitesTable.assignedSeat,
        inviteeUserId: partyInvitesTable.inviteeUserId,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(partyInvitesTable)
      .innerJoin(usersTable, eq(partyInvitesTable.inviteeUserId, usersTable.id))
      .where(and(
        inArray(partyInvitesTable.partyGroupId, partyGroupIds),
        eq(partyInvitesTable.status, "accepted"),
      ));

    allPartyMemberRows = [
      ...ticketRows.map((r): PartyMemberRow => ({
        partyGroupId: r.partyGroupId!,
        seatNumber: r.seatNumber ?? 0,
        userId: r.userId,
        ticketId: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
      })),
      // Only include invite rows for users not already represented by a ticket IN THIS GROUP
      ...inviteRows
        .filter((r) => !postedUserIdsByGroup.get(r.partyGroupId!)?.has(r.inviteeUserId))
        .map((r): PartyMemberRow => ({
          partyGroupId: r.partyGroupId!,
          seatNumber: r.assignedSeat ?? 0,
          userId: r.inviteeUserId,
          ticketId: null,
          username: r.username,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
        })),
    ];
  }

  return tickets.map((ticket) => {
    const user = userMap.get(ticket.userId);
    const isOwner = currentUserId === ticket.userId;
    const rxData = computeReactionData(allReactionRows, ticket.id, currentUserId);
    const isLiked = rxData.hasReacted;
    const isBookmarked = viewerBookmarkedSet.has(ticket.id);
    const tags = tagsMap.get(ticket.id) ?? [];

    const snap: TmdbSnapshot | null = ticket.tmdbSnapshot
      ? (() => { try { return JSON.parse(ticket.tmdbSnapshot!); } catch { return null; } })()
      : null;

    // Build a live snapshot from the movies DB cache (refreshed every 1 hour from TMDB).
    // This gives the frontend the SAME data source that the movie-detail page uses,
    // so rank badges on cards are always identical to what's shown inside the detail —
    // INCLUDING franchiseIds, which is required to award FR / LEGENDARY tiers when a
    // movie is part of a franchise (TMDB sometimes adds franchise memberships AFTER
    // the ticket was created, so the per-ticket tmdbSnapshot can be stale).
    const tmdbIdNum = parseTmdbId(ticket.imdbId);
    const freshMovie = tmdbIdNum != null ? freshMovieMap.get(tmdbIdNum) : undefined;
    const movieLiveSnapshot = freshMovie != null ? {
      rating:       freshMovie.voteAverage != null ? parseFloat(freshMovie.voteAverage) : null,
      voteCount:    freshMovie.voteCount   ?? null,
      genreIds:     freshMovie.genreIds    ?? null,
      franchiseIds: freshMovie.franchiseIds ?? null,
      popularity:   freshMovie.popularity  != null ? parseFloat(freshMovie.popularity)  : null,
      releaseDate:  freshMovie.releaseDate ?? null,
      // Extract year from "YYYY-MM-DD" release date stored in movies table
      year:         freshMovie.releaseDate ? parseInt(freshMovie.releaseDate.slice(0, 4), 10) : null,
    } : null;

    return {
      id: ticket.id,
      userId: ticket.userId,
      user: {
        id: user!.id,
        username: user!.username!,
        displayName: user!.displayName,
        avatarUrl: user!.avatarUrl,
      },
      imdbId: ticket.imdbId,
      movieTitle: ticket.movieTitle,
      movieYear: ticket.movieYear,
      posterUrl: ticket.posterUrl,
      genre: ticket.genre,
      template: ticket.template,
      memoryNote: ticket.isPrivateMemory && !isOwner ? null : ticket.memoryNote,
      caption: ticket.caption,
      captionAlign: ticket.captionAlign ?? "left",
      isPrivateMemory: ticket.isPrivateMemory,
      isSpoiler: ticket.isSpoiler === true,
      memoryAccessStatus: isOwner ? "owner" : "none",
      memoryAccessExpiresAt: null,
      watchedAt: ticket.hideWatchedAt ? null : ticket.watchedAt,
      location: ticket.hideLocation ? null : ticket.location,
      isPrivate: ticket.isPrivate,
      hideWatchedAt: ticket.hideWatchedAt,
      hideLocation: ticket.hideLocation,
      hideLikes: ticket.hideLikes,
      hideComments: ticket.hideComments,
      hideRating: ticket.hideRating,
      rating: ticket.rating ? Number(ticket.rating) : null,
      ratingType: ticket.ratingType,
      rankTier: ticket.rankTier,
      currentRankTier: ticket.currentRankTier,
      popularityScore: ticket.popularityScore,
      tmdbSnapshot: snap,
      deletedAt: ticket.deletedAt,
      likeCount: rxData.totalScore,
      totalScore: rxData.totalScore,
      reactionBreakdown: rxData.reactionBreakdown,
      myReactions: rxData.myReactions,
      hasReacted: rxData.hasReacted,
      commentCount: commentCountMap.get(ticket.id) ?? 0,
      isLiked,
      reactionType: null,
      isBookmarked,
      taggedUsers: tags.map((u) => ({
        id: u.id,
        username: u.username!,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      })),
      partyGroupId: ticket.partyGroupId,
      partySeatNumber: ticket.partySeatNumber,
      partySize: ticket.partySize,
      partyMembers: ticket.partyGroupId
        ? allPartyMemberRows
            .filter(m => m.partyGroupId === ticket.partyGroupId && m.userId !== ticket.userId)
            .sort((a, b) => a.seatNumber - b.seatNumber)
            .map(m => ({ seatNumber: m.seatNumber, ticketId: m.ticketId, username: m.username!, displayName: m.displayName, avatarUrl: m.avatarUrl }))
        : [],
      specialColor: ticket.specialColor,
      customRankTier: ticket.customRankTier,
      rankLocked: ticket.rankLocked,
      cardTheme: ticket.cardTheme,
      cardBackdropUrl: ticket.cardBackdropUrl,
      cardBackdropOffsetX: ticket.cardBackdropOffsetX,
      cardRuntime: ticket.cardRuntime,
      cardDirector: ticket.cardDirector,
      cardProducer: ticket.cardProducer,
      cardActors: ticket.cardActors,
      captionLinks: Array.isArray(ticket.captionLinks) ? ticket.captionLinks : [],
      clipUrl: ticket.clipUrl,
      episodeLabel: ticket.episodeLabel,
      createdAt: ticket.createdAt,
      // Live rank inputs from the movies DB cache — same data source as the
      // movie-detail page, so card ranks always match the detail view exactly.
      movieLiveSnapshot,
    };
  });
}

// ── buildTicket ───────────────────────────────────────────────────────────────
//
// Assembles the full API response shape for a single ticket row.
// For feed/list use cases, prefer buildTicketBatch to avoid N+1 queries.

export async function buildTicket(
  ticket: typeof ticketsTable.$inferSelect,
  currentUserId?: string,
) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, ticket.userId))
    .limit(1);

  const allReactionRowsSingle = await db
    .select({
      userId: ticketReactionsTable.userId,
      ticketId: ticketReactionsTable.ticketId,
      reactionType: ticketReactionsTable.reactionType,
      count: ticketReactionsTable.count,
    })
    .from(ticketReactionsTable)
    .where(eq(ticketReactionsTable.ticketId, ticket.id));

  const [commentCountResult] = await db
    .select({ count: count() })
    .from(commentsTable)
    .where(eq(commentsTable.ticketId, ticket.id));

  const [tags, tagRatings] = await Promise.all([
    db
      .select({ user: usersTable })
      .from(ticketTagsTable)
      .innerJoin(usersTable, eq(ticketTagsTable.userId, usersTable.id))
      .where(eq(ticketTagsTable.ticketId, ticket.id)),
    db
      .select({ userId: ticketTagRatingsTable.userId, rating: ticketTagRatingsTable.rating })
      .from(ticketTagRatingsTable)
      .where(eq(ticketTagRatingsTable.ticketId, ticket.id)),
  ]);

  const rxDataSingle = computeReactionData(allReactionRowsSingle, ticket.id, currentUserId);
  let isLiked = rxDataSingle.hasReacted;
  let isBookmarked = false;
  let memoryAccessStatus: "none" | "pending" | "approved" | "denied" = "none";
  let memoryAccessExpiresAt: Date | null = null;
  const isOwner = currentUserId === ticket.userId;

  if (currentUserId) {
    const [bookmarked] = await db
      .select()
      .from(bookmarksTable)
      .where(
        and(
          eq(bookmarksTable.userId, currentUserId),
          eq(bookmarksTable.ticketId, ticket.id),
        ),
      )
      .limit(1);

    isBookmarked = !!bookmarked;

    if (ticket.isPrivateMemory && !isOwner) {
      const [accessReq] = await db
        .select()
        .from(memoryAccessRequestsTable)
        .where(
          and(
            eq(memoryAccessRequestsTable.ticketId, ticket.id),
            eq(memoryAccessRequestsTable.requesterId, currentUserId),
          ),
        )
        .orderBy(desc(memoryAccessRequestsTable.createdAt))
        .limit(1);

      if (accessReq) {
        if (
          accessReq.status === "approved" &&
          accessReq.expiresAt &&
          accessReq.expiresAt > new Date()
        ) {
          memoryAccessStatus = "approved";
          memoryAccessExpiresAt = accessReq.expiresAt;
        } else if (accessReq.status === "approved") {
          memoryAccessStatus = "denied"; // expired
        } else {
          memoryAccessStatus = accessReq.status as "pending" | "denied";
        }
      }
    }
  }

  const snap = ticket.tmdbSnapshot
    ? (() => {
        try {
          return JSON.parse(ticket.tmdbSnapshot!);
        } catch {
          return null;
        }
      })()
    : null;

  // ── Live snapshot from movies DB cache ────────────────────────────────────
  const parsedTmdbId = (() => {
    if (!ticket.imdbId || ticket.imdbId === "reel") return null;
    const raw = ticket.imdbId.startsWith("tmdb_tv:") ? ticket.imdbId.slice("tmdb_tv:".length) : ticket.imdbId;
    const id = parseInt(raw, 10);
    return isNaN(id) || id <= 0 ? null : id;
  })();

  let movieLiveSnapshot: {
    rating: number | null; voteCount: number | null; genreIds: number[] | null;
    franchiseIds: number[] | null; popularity: number | null;
    releaseDate: string | null; year: number | null;
  } | null = null;

  if (parsedTmdbId != null) {
    const [cached] = await db
      .select({
        voteAverage:  moviesTable.voteAverage,
        voteCount:    moviesTable.voteCount,
        genreIds:     moviesTable.genreIds,
        franchiseIds: moviesTable.franchiseIds,
        popularity:   moviesTable.popularity,
        releaseDate:  moviesTable.releaseDate,
        fetchedAt:    moviesTable.fetchedAt,
      })
      .from(moviesTable)
      .where(eq(moviesTable.tmdbId, parsedTmdbId))
      .limit(1);

    if (cached) {
      movieLiveSnapshot = {
        rating:       cached.voteAverage != null ? parseFloat(cached.voteAverage) : null,
        voteCount:    cached.voteCount   ?? null,
        genreIds:     cached.genreIds    ?? null,
        franchiseIds: cached.franchiseIds ?? null,
        popularity:   cached.popularity  != null ? parseFloat(cached.popularity)  : null,
        releaseDate:  cached.releaseDate ?? null,
        year:         cached.releaseDate ? parseInt(cached.releaseDate.slice(0, 4), 10) : null,
      };
      const age = cached.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
      if (age > MOVIE_CACHE_TTL_MS) {
        calculateRankTier(`${parsedTmdbId}`).catch(() => {});
      }
    } else {
      calculateRankTier(`${parsedTmdbId}`).catch(() => {});
    }
  }

  let partyMembers: Array<{ seatNumber: number; ticketId: string | null; username: string; displayName: string | null; avatarUrl: string | null }> = [];
  if (ticket.partyGroupId) {
    // (1) Members who have already posted their own ticket in this party
    const ticketRows = await db
      .select({
        id: ticketsTable.id,
        seatNumber: ticketsTable.partySeatNumber,
        userId: ticketsTable.userId,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(ticketsTable)
      .innerJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
      .where(and(eq(ticketsTable.partyGroupId, ticket.partyGroupId), isNull(ticketsTable.deletedAt)));

    const postedUserIds = new Set(ticketRows.map(r => r.userId));

    // (2) Accepted invitees who haven't posted their ticket yet
    const inviteRows = await db
      .select({
        assignedSeat: partyInvitesTable.assignedSeat,
        inviteeUserId: partyInvitesTable.inviteeUserId,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(partyInvitesTable)
      .innerJoin(usersTable, eq(partyInvitesTable.inviteeUserId, usersTable.id))
      .where(and(
        eq(partyInvitesTable.partyGroupId, ticket.partyGroupId),
        eq(partyInvitesTable.status, "accepted"),
      ));

    type MemberEntry = { seatNumber: number; ticketId: string | null; username: string; displayName: string | null; avatarUrl: string | null };
    const merged: MemberEntry[] = [
      ...ticketRows
        .filter((r) => r.userId !== ticket.userId)
        .map((r): MemberEntry => ({ seatNumber: r.seatNumber ?? 0, ticketId: r.id, username: r.username!, displayName: r.displayName, avatarUrl: r.avatarUrl })),
      ...inviteRows
        .filter((r) => r.inviteeUserId !== ticket.userId && !postedUserIds.has(r.inviteeUserId))
        .map((r): MemberEntry => ({ seatNumber: r.assignedSeat ?? 0, ticketId: null, username: r.username!, displayName: r.displayName, avatarUrl: r.avatarUrl })),
    ];
    partyMembers = merged.sort((a, b) => a.seatNumber - b.seatNumber);
  }

  return {
    id: ticket.id,
    userId: ticket.userId,
    user: {
      id: user!.id,
      username: user!.username!,
      displayName: user!.displayName,
      avatarUrl: user!.avatarUrl,
    },
    imdbId: ticket.imdbId,
    movieTitle: ticket.movieTitle,
    movieYear: ticket.movieYear,
    posterUrl: ticket.posterUrl,
    genre: ticket.genre,
    template: ticket.template,
    memoryNote:
      ticket.isPrivateMemory && !isOwner && memoryAccessStatus !== "approved"
        ? null
        : ticket.memoryNote,
    caption: ticket.caption,
    captionAlign: ticket.captionAlign ?? "left",
    isPrivateMemory: ticket.isPrivateMemory,
    isSpoiler: ticket.isSpoiler === true,
    memoryAccessStatus: isOwner ? "owner" : memoryAccessStatus,
    memoryAccessExpiresAt:
      memoryAccessStatus === "approved" ? memoryAccessExpiresAt : null,
    watchedAt: ticket.hideWatchedAt ? null : ticket.watchedAt,
    location: ticket.hideLocation ? null : ticket.location,
    isPrivate: ticket.isPrivate,
    hideWatchedAt: ticket.hideWatchedAt,
    hideLocation: ticket.hideLocation,
    hideLikes: ticket.hideLikes,
    hideComments: ticket.hideComments,
    rating: ticket.rating ? Number(ticket.rating) : null,
    ratingType: ticket.ratingType,
    rankTier: ticket.rankTier,
    currentRankTier: ticket.currentRankTier,
    popularityScore: ticket.popularityScore,
    tmdbSnapshot: snap,
    deletedAt: ticket.deletedAt,
    likeCount: rxDataSingle.totalScore,
    totalScore: rxDataSingle.totalScore,
    reactionBreakdown: rxDataSingle.reactionBreakdown,
    myReactions: rxDataSingle.myReactions,
    hasReacted: rxDataSingle.hasReacted,
    commentCount: Number(commentCountResult?.count ?? 0),
    isLiked,
    reactionType: null,
    isBookmarked,
    taggedUsers: tags.map((t) => ({
      id: t.user.id,
      username: t.user.username!,
      displayName: t.user.displayName,
      avatarUrl: t.user.avatarUrl,
    })),
    tagRatings: tagRatings.map((r) => ({
      userId: r.userId,
      rating: Number(r.rating),
    })),
    partyGroupId: ticket.partyGroupId,
    partySeatNumber: ticket.partySeatNumber,
    partySize: ticket.partySize,
    partyMembers,
    specialColor: ticket.specialColor,
    customRankTier: ticket.customRankTier,
    rankLocked: ticket.rankLocked,
    cardTheme: ticket.cardTheme,
    cardBackdropUrl: ticket.cardBackdropUrl,
    cardBackdropOffsetX: ticket.cardBackdropOffsetX,
    cardRuntime: ticket.cardRuntime,
    cardDirector: ticket.cardDirector,
    cardProducer: ticket.cardProducer,
    cardActors: ticket.cardActors,
    captionLinks: Array.isArray(ticket.captionLinks) ? ticket.captionLinks : [],
    clipUrl: ticket.clipUrl,
    episodeLabel: ticket.episodeLabel,
    hideRating: ticket.hideRating,
    archivedAt: ticket.archivedAt,
    createdAt: ticket.createdAt,
    movieLiveSnapshot,
  };
}

// ── Party color helpers ───────────────────────────────────────────────────────

export async function updatePartySpecialColor(
  partyGroupId: string,
  color: SpecialColor | null,
): Promise<void> {
  await db
    .update(ticketsTable)
    .set({ specialColor: (color ?? null) as "bronze" | "silver" | "gold" | "diamond" | null, updatedAt: new Date() })
    .where(
      and(
        eq(ticketsTable.partyGroupId, partyGroupId),
        isNull(ticketsTable.deletedAt),
      ),
    );
}

export async function checkAndUpdatePartyColor(
  _partyGroupId: string,
  _partySize: number,
  _fromUserId: string,
): Promise<void> {
  // Party mode special colors are disabled — no-op
}
