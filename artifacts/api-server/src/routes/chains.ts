import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  chainsTable,
  chainMoviesTable,
  chainRunsTable,
  chainRunItemsTable,
  chainLikesTable,
  chainBookmarksTable,
  chainCommentsTable,
  chainHuntFoundMoviesTable,
  ticketsTable,
  followsTable,
  reportsTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, isNotNull, count, max, asc, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { hotScore, makeFreshBoost } from "../lib/hot-score";
import { tmdbFetch } from "../lib/tmdb-client";
import { awardXp } from "../services/badge.service";
import { notifyFollowersNewPost, createNotification } from "../services/notify.service";

const router: IRouter = Router();

type DbTier = "common" | "rare" | "ultra" | "legendary" | "holographic" | "cult_classic";

type TmdbSnapshot = {
  tmdbRating: number;
  voteCount: number;
  year: number | null;
  popularity: number;
  genreIds: number[];
};

async function fetchTmdbSnapshot(movieId: string): Promise<TmdbSnapshot | null> {
  try {
    let tmdbId: number;
    if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{ movie_results?: Array<{ id: number }> }>(
        `/find/${encodeURIComponent(movieId)}`,
        { external_source: "imdb_id" },
      );
      if (!findData.movie_results?.length) return null;
      tmdbId = findData.movie_results[0]!.id;
    }
    const data = await tmdbFetch<{
      vote_average?: number; vote_count?: number; release_date?: string;
      popularity?: number; genre_ids?: number[]; genres?: Array<{ id: number }>;
    }>(`/movie/${tmdbId}`);
    return {
      tmdbRating: data.vote_average || 0,
      voteCount: data.vote_count || 0,
      year: data.release_date ? parseInt(data.release_date.slice(0, 4), 10) : null,
      popularity: data.popularity || 0,
      genreIds: data.genre_ids ?? data.genres?.map(g => g.id) ?? [],
    };
  } catch {
    return null;
  }
}

function buildRunSummary(
  run: typeof chainRunsTable.$inferSelect,
  items: (typeof chainRunItemsTable.$inferSelect)[],
  chainMovies: (typeof chainMoviesTable.$inferSelect)[],
  user: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null } | undefined,
) {
  const movieMap = new Map(chainMovies.map(m => [m.id, m]));
  return {
    id: run.id,
    chainId: run.chainId,
    userId: run.userId,
    user: user ? {
      id: user.id,
      username: user.username ?? "",
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    } : null,
    status: run.status,
    totalElapsedMs: run.totalElapsedMs,
    completedCount: run.completedCount,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    items: items.map(item => ({
      id: item.id,
      position: item.position,
      status: item.status,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      elapsedMs: item.elapsedMs,
      ticketId: item.ticketId,
      rating: item.rating,
      ratingType: item.ratingType,
      customRankTier: item.customRankTier,
      memoryNote: item.memoryNote,
      movie: movieMap.get(item.chainMovieId) ? {
        id: movieMap.get(item.chainMovieId)!.id,
        imdbId: movieMap.get(item.chainMovieId)!.imdbId,
        movieTitle: movieMap.get(item.chainMovieId)!.movieTitle,
        movieYear: movieMap.get(item.chainMovieId)!.movieYear,
        posterUrl: movieMap.get(item.chainMovieId)!.posterUrl,
        genre: movieMap.get(item.chainMovieId)!.genre,
        customRankTier: movieMap.get(item.chainMovieId)!.customRankTier,
        tmdbSnapshot: movieMap.get(item.chainMovieId)!.tmdbSnapshot ? (() => { try { return JSON.parse(movieMap.get(item.chainMovieId)!.tmdbSnapshot!); } catch { return null; } })() : null,
      } : null,
    })),
  };
}

export async function buildChain(
  chain: typeof chainsTable.$inferSelect,
  currentUserId?: string,
) {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, chain.userId)).limit(1);
  const movies = await db.select().from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chain.id))
    .orderBy(asc(chainMoviesTable.position));

  const [runCountResult] = await db.select({ count: count() }).from(chainRunsTable)
    .where(eq(chainRunsTable.chainId, chain.id));

  const [likeCountResult] = await db.select({ count: count() }).from(chainLikesTable)
    .where(eq(chainLikesTable.chainId, chain.id));

  const [commentCountResult] = await db.select({ count: count() }).from(chainCommentsTable)
    .where(eq(chainCommentsTable.chainId, chain.id));

  let myRun = null;
  let ownerRun = null;
  let isLiked = false;
  let isBookmarked = false;

  if (currentUserId) {
    const [run] = await db.select().from(chainRunsTable)
      .where(and(eq(chainRunsTable.chainId, chain.id), eq(chainRunsTable.userId, currentUserId)))
      .orderBy(desc(chainRunsTable.startedAt))
      .limit(1);
    if (run) {
      const items = await db.select().from(chainRunItemsTable)
        .where(eq(chainRunItemsTable.runId, run.id))
        .orderBy(asc(chainRunItemsTable.position));
      myRun = buildRunSummary(run, items, movies, owner);
    }

    const [likeRow] = await db.select().from(chainLikesTable)
      .where(and(eq(chainLikesTable.chainId, chain.id), eq(chainLikesTable.userId, currentUserId)))
      .limit(1);
    isLiked = !!likeRow;

    const [bookmarkRow] = await db.select().from(chainBookmarksTable)
      .where(and(eq(chainBookmarksTable.chainId, chain.id), eq(chainBookmarksTable.userId, currentUserId)))
      .limit(1);
    isBookmarked = !!bookmarkRow;
  }

  // ownerRun — the chain creator's most recent run (visible to everyone)
  if (chain.userId !== currentUserId) {
    const [oRun] = await db.select().from(chainRunsTable)
      .where(and(eq(chainRunsTable.chainId, chain.id), eq(chainRunsTable.userId, chain.userId)))
      .orderBy(desc(chainRunsTable.startedAt))
      .limit(1);
    if (oRun) {
      const oItems = await db.select().from(chainRunItemsTable)
        .where(eq(chainRunItemsTable.runId, oRun.id))
        .orderBy(asc(chainRunItemsTable.position));
      ownerRun = buildRunSummary(oRun, oItems, movies, owner);
    }
  } else {
    ownerRun = myRun;
  }

  // Fetch addedBy user info for community chains
  const addedByUserIds = [...new Set(movies.filter(m => m.addedByUserId).map(m => m.addedByUserId!))];
  const addedByUserMap = new Map<string, { id: string; username: string; displayName: string | null; avatarUrl: string | null }>();
  if (addedByUserIds.length > 0) {
    const addedUsers = await db.select().from(usersTable).where(inArray(usersTable.id, addedByUserIds));
    for (const u of addedUsers) {
      addedByUserMap.set(u.id, { id: u.id, username: u.username ?? "", displayName: u.displayName, avatarUrl: u.avatarUrl });
    }
  }

  // fetch found movie IDs for hunt chains
  let foundMovieIds: string[] = [];
  if (chain.mode === "hunt") {
    const foundRows = await db.select({ chainMovieId: chainHuntFoundMoviesTable.chainMovieId })
      .from(chainHuntFoundMoviesTable)
      .where(eq(chainHuntFoundMoviesTable.chainId, chain.id));
    foundMovieIds = foundRows.map(r => r.chainMovieId);
  }

  return {
    id: chain.id,
    userId: chain.userId,
    user: owner ? {
      id: owner.id,
      username: owner.username ?? "",
      displayName: owner.displayName,
      avatarUrl: owner.avatarUrl,
    } : null,
    title: chain.title,
    description: chain.description,
    descriptionAlign: (chain.descriptionAlign ?? "left") as "left" | "center" | "right",
    isPrivate: chain.isPrivate,
    mode: chain.mode ?? "standard",
    chainCount: Number(runCountResult?.count ?? chain.chainCount),
    movieCount: movies.length,
    likeCount: Number(likeCountResult?.count ?? 0),
    commentCount: Number(commentCountResult?.count ?? 0),
    isLiked,
    isBookmarked,
    foundMovieIds,
    movies: movies.map(m => ({
      id: m.id,
      position: m.position,
      imdbId: m.imdbId,
      movieTitle: m.movieTitle,
      movieYear: m.movieYear,
      posterUrl: m.posterUrl,
      genre: m.genre,
      customRankTier: m.customRankTier,
      addedByUserId: m.addedByUserId ?? null,
      addedBy: m.addedByUserId ? (addedByUserMap.get(m.addedByUserId) ?? null) : null,
      memoryNote: m.memoryNote ?? null,
      tmdbSnapshot: m.tmdbSnapshot ? (() => { try { return JSON.parse(m.tmdbSnapshot!); } catch { return null; } })() : null,
    })),
    myRun,
    ownerRun,
    challengeDurationMs: chain.challengeDurationMs ?? null,
    hideComments: chain.hideComments ?? false,
    hideLikes: chain.hideLikes ?? false,
    hideChainCount: chain.hideChainCount ?? false,
    createdAt: chain.createdAt,
    updatedAt: chain.updatedAt,
    foundMovieCount: foundMovieIds.length,
  };
}

// ── GET /chains — list recent chains (explore) ────────────────────────────────
router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const userId = req.query["userId"] as string | undefined;

  // When viewing another user's created chains, respect their account privacy
  if (userId && userId !== currentUserId) {
    const [owner] = await db.select({ isPrivate: usersTable.isPrivate })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (owner?.isPrivate) {
      // Check if current user follows them
      const isFollowing = currentUserId
        ? (await db.select().from(followsTable)
            .where(and(eq(followsTable.followerId, currentUserId), eq(followsTable.followingId, userId)))
            .limit(1)).length > 0
        : false;
      if (!isFollowing) {
        res.json({ chains: [], hasMore: false });
        return;
      }
    }
  }

  let chains: typeof chainsTable.$inferSelect[];
  if (userId) {
    chains = await db.select().from(chainsTable)
      .where(and(
        isNull(chainsTable.deletedAt),
        eq(chainsTable.userId, userId),
        ...(userId !== currentUserId ? [eq(chainsTable.isPrivate, false)] : []),
      ))
      .orderBy(
        desc(sql`(SELECT COUNT(*) FROM chain_bookmarks WHERE chain_id = ${chainsTable.id})`),
        desc(chainsTable.createdAt),
      )
      .limit(limit + 1);
  } else {
    // Explore: filter both chain-level privacy AND owner account privacy,
    // then rank with hotScore so popular chains surface above stale ones.
    const POOL = limit * 4;
    const rawRows = await db.select({ chain: chainsTable }).from(chainsTable)
      .innerJoin(usersTable, and(eq(chainsTable.userId, usersTable.id), eq(usersTable.isPrivate, false)))
      .where(and(isNull(chainsTable.deletedAt), eq(chainsTable.isPrivate, false)))
      .orderBy(desc(sql`GREATEST(
        ${chainsTable.createdAt},
        COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
        COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
        COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt})
      )`))
      .limit(POOL);
    const poolChains = rawRows.map(r => r.chain);

    if (poolChains.length > 0) {
      const poolIds = poolChains.map(c => c.id);
      const [likeRows, commentRows, runRows, followRows] = await Promise.all([
        db.select({ chainId: chainLikesTable.chainId, n: count(), lastAt: max(chainLikesTable.createdAt) })
          .from(chainLikesTable).where(inArray(chainLikesTable.chainId, poolIds)).groupBy(chainLikesTable.chainId),
        db.select({ chainId: chainCommentsTable.chainId, n: count(), lastAt: max(chainCommentsTable.createdAt) })
          .from(chainCommentsTable).where(inArray(chainCommentsTable.chainId, poolIds)).groupBy(chainCommentsTable.chainId),
        db.select({ chainId: chainRunsTable.chainId, n: count(), lastAt: max(chainRunsTable.startedAt) })
          .from(chainRunsTable).where(inArray(chainRunsTable.chainId, poolIds)).groupBy(chainRunsTable.chainId),
        currentUserId
          ? db.select({ followingId: followsTable.followingId })
              .from(followsTable).where(eq(followsTable.followerId, currentUserId))
          : Promise.resolve([] as { followingId: string }[]),
      ]);
      const likeMap    = new Map(likeRows.map(r => [r.chainId, Number(r.n)]));
      const commentMap = new Map(commentRows.map(r => [r.chainId, Number(r.n)]));
      const runMap     = new Map(runRows.map(r => [r.chainId, Number(r.n)]));
      const likeLastAt = new Map(likeRows.map(r => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
      const cmtLastAt  = new Map(commentRows.map(r => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
      const runLastAt  = new Map(runRows.map(r => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));

      // Explore mode: own fresh posts get a temporary boost (15×→1× over 60 min).
      // Followed users' posts are NOT boosted here — this is a discovery/explore
      // context and merit-based ranking should be fair across all creators.
      const followedSet = currentUserId
        ? new Set<string>([...followRows.map(r => r.followingId), currentUserId])
        : null;
      const freshBoostFn = makeFreshBoost(followedSet, currentUserId);

      const scored = poolChains.map(c => {
        const lastActivityAt = [c.createdAt, likeLastAt.get(c.id), cmtLastAt.get(c.id), runLastAt.get(c.id)]
          .filter((d): d is Date => d instanceof Date)
          .reduce((a, b) => (a > b ? a : b), c.createdAt);
        // bonus = actual chain_runs count (0 if none). Never fall back to the
        // denormalized chainCount column — it may be stale.
        const base = hotScore({ likes: likeMap.get(c.id) ?? 0, comments: commentMap.get(c.id) ?? 0, bonus: runMap.get(c.id) ?? 0, lastActivityAt });
        return {
          chain: c,
          score: base * freshBoostFn(c.userId, c.createdAt),
        };
      });
      scored.sort((a, b) => {
        const diff = b.score - a.score;
        if (Math.abs(diff) > 1e-10) return diff;
        return b.chain.createdAt.getTime() - a.chain.createdAt.getTime();
      });
      chains = scored.slice(0, limit + 1).map(s => s.chain);
    } else {
      chains = [];
    }
  }

  const hasMore = chains.length > limit;
  const items = chains.slice(0, limit);
  const result = await Promise.all(items.map(c => buildChain(c, currentUserId)));
  res.json({ chains: result, hasMore });
});

// ── GET /chains/runs — chain runs for a user (for profile page) ───────────────
router.get("/runs", async (req, res) => {
  const currentUserId = req.session?.userId;
  const userId = (req.query["userId"] as string) || currentUserId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const runs = await db.select().from(chainRunsTable)
    .where(eq(chainRunsTable.userId, userId))
    .orderBy(desc(chainRunsTable.startedAt))
    .limit(20);

  if (runs.length === 0) { res.json({ runs: [] }); return; }

  // Fetch all chains in bulk — exclude deleted chains
  const chainIds = [...new Set(runs.map(r => r.chainId))];
  const chains = await db.select().from(chainsTable)
    .where(and(inArray(chainsTable.id, chainIds), isNull(chainsTable.deletedAt)));
  const chainMap = new Map(chains.map(c => [c.id, c]));

  // Determine which chain owners are private — filter them out for non-owners
  let blockedOwnerIds = new Set<string>();
  if (currentUserId !== userId) {
    const ownerIds = [...new Set(chains.map(c => c.userId))];
    if (ownerIds.length > 0) {
      const [privateOwners, followRows] = await Promise.all([
        db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.isPrivate, true), inArray(usersTable.id, ownerIds))),
        currentUserId
          ? db.select({ followingId: followsTable.followingId })
              .from(followsTable)
              .where(and(
                eq(followsTable.followerId, currentUserId),
                inArray(followsTable.followingId, ownerIds),
              ))
          : Promise.resolve([]),
      ]);
      const followedOwners = new Set((followRows as { followingId: string }[]).map(r => r.followingId));
      for (const row of privateOwners) {
        if (!followedOwners.has(row.id)) blockedOwnerIds.add(row.id);
      }
    }
  }

  // Bulk fetch: movies (first 4 per chain), movie counts, run counts, likes, comments, user interactions
  const visibleChainIds = chains
    .filter(c => !blockedOwnerIds.has(c.userId))
    .map(c => c.id);

  const [allMovies, movieCounts, runCounts, likeCounts, commentCounts, userLikes, userBookmarks] = await Promise.all([
    visibleChainIds.length > 0
      ? db.select().from(chainMoviesTable)
          .where(inArray(chainMoviesTable.chainId, visibleChainIds))
          .orderBy(asc(chainMoviesTable.position))
      : Promise.resolve([]),
    visibleChainIds.length > 0
      ? db.select({ chainId: chainMoviesTable.chainId, n: count() })
          .from(chainMoviesTable)
          .where(inArray(chainMoviesTable.chainId, visibleChainIds))
          .groupBy(chainMoviesTable.chainId)
      : Promise.resolve([]),
    visibleChainIds.length > 0
      ? db.select({ chainId: chainRunsTable.chainId, n: count() })
          .from(chainRunsTable)
          .where(inArray(chainRunsTable.chainId, visibleChainIds))
          .groupBy(chainRunsTable.chainId)
      : Promise.resolve([]),
    visibleChainIds.length > 0
      ? db.select({ chainId: chainLikesTable.chainId, n: count() })
          .from(chainLikesTable)
          .where(inArray(chainLikesTable.chainId, visibleChainIds))
          .groupBy(chainLikesTable.chainId)
      : Promise.resolve([]),
    visibleChainIds.length > 0
      ? db.select({ chainId: chainCommentsTable.chainId, n: count() })
          .from(chainCommentsTable)
          .where(inArray(chainCommentsTable.chainId, visibleChainIds))
          .groupBy(chainCommentsTable.chainId)
      : Promise.resolve([]),
    visibleChainIds.length > 0 && currentUserId
      ? db.select({ chainId: chainLikesTable.chainId })
          .from(chainLikesTable)
          .where(and(eq(chainLikesTable.userId, currentUserId), inArray(chainLikesTable.chainId, visibleChainIds)))
      : Promise.resolve([]),
    visibleChainIds.length > 0 && currentUserId
      ? db.select({ chainId: chainBookmarksTable.chainId })
          .from(chainBookmarksTable)
          .where(and(eq(chainBookmarksTable.userId, currentUserId), inArray(chainBookmarksTable.chainId, visibleChainIds)))
      : Promise.resolve([]),
  ]);

  // Build lookup maps
  const moviesByChain = new Map<string, typeof allMovies>();
  for (const m of allMovies) {
    if (!moviesByChain.has(m.chainId)) moviesByChain.set(m.chainId, []);
    moviesByChain.get(m.chainId)!.push(m);
  }
  const movieCountMap = new Map(movieCounts.map(r => [r.chainId, Number(r.n)]));
  const runCountMap = new Map(runCounts.map(r => [r.chainId, Number(r.n)]));
  const likeCountMap = new Map((likeCounts as { chainId: string; n: unknown }[]).map(r => [r.chainId, Number(r.n)]));
  const commentCountMap = new Map((commentCounts as { chainId: string; n: unknown }[]).map(r => [r.chainId, Number(r.n)]));
  const likedSet = new Set((userLikes as { chainId: string }[]).map(r => r.chainId));
  const bookmarkedSet = new Set((userBookmarks as { chainId: string }[]).map(r => r.chainId));

  // Pre-fetch found movie counts for hunt chains
  const huntChainIds = [...chainMap.values()].filter(c => c.mode === "hunt").map(c => c.id);
  const foundCountRows = huntChainIds.length > 0
    ? await db.select({ chainId: chainHuntFoundMoviesTable.chainId, n: count() })
        .from(chainHuntFoundMoviesTable)
        .where(inArray(chainHuntFoundMoviesTable.chainId, huntChainIds))
        .groupBy(chainHuntFoundMoviesTable.chainId)
    : [];
  const foundCountMap = new Map(foundCountRows.map(r => [r.chainId, Number(r.n)]));

  const result = runs.map(run => {
    const chain = chainMap.get(run.chainId);
    if (!chain) return null;
    if (blockedOwnerIds.has(chain.userId)) return null;
    const movies = (moviesByChain.get(chain.id) ?? []).slice(0, 4);
    const movieCount = movieCountMap.get(chain.id) ?? chain.movieCount ?? 0;
    const chainCount = runCountMap.get(chain.id) ?? 0;
    return {
      runId: run.id,
      status: run.status,
      completedCount: run.completedCount,
      totalElapsedMs: run.totalElapsedMs,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      chain: {
        id: chain.id,
        title: chain.title,
        movieCount,
        chainCount,
        mode: chain.mode ?? "standard",
        challengeDurationMs: chain.challengeDurationMs ?? null,
        movies: movies.map(m => ({ posterUrl: m.posterUrl })),
        likeCount: likeCountMap.get(chain.id) ?? 0,
        commentCount: commentCountMap.get(chain.id) ?? 0,
        isLiked: likedSet.has(chain.id),
        isBookmarked: bookmarkedSet.has(chain.id),
        foundMovieCount: foundCountMap.get(chain.id) ?? 0,
      },
    };
  });

  res.json({ runs: result.filter(Boolean) });
});

// ── GET /chains/hot — popular chains (universal hot score) ───────────────────
router.get("/hot", async (req, res) => {
  const currentUserId = req.session?.userId;
  const limit = Math.min(Number(req.query["limit"]) || 10, 30);
  const POOL = limit * 4;

  // Fetch a larger pool — in-memory hotScore picks the best
  // Also filter out chains from private accounts
  const rawRows = await db.select({ chain: chainsTable }).from(chainsTable)
    .innerJoin(usersTable, and(eq(chainsTable.userId, usersTable.id), eq(usersTable.isPrivate, false)))
    .where(and(isNull(chainsTable.deletedAt), eq(chainsTable.isPrivate, false)))
    .orderBy(desc(sql`GREATEST(
      ${chainsTable.createdAt},
      COALESCE((SELECT MAX(created_at) FROM chain_likes WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
      COALESCE((SELECT MAX(created_at) FROM chain_comments WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt}),
      COALESCE((SELECT MAX(started_at) FROM chain_runs WHERE chain_id = ${chainsTable.id}), ${chainsTable.createdAt})
    )`))
    .limit(POOL);
  const rawChains = rawRows.map(r => r.chain);

  if (rawChains.length === 0) {
    res.json({ chains: [] });
    return;
  }

  const chainIds = rawChains.map((c) => c.id);

  // Bulk engagement: likes, comments, runs (no N+1) + follow graph for affinity
  const [likeRows, commentRows, runRows, followRows] = await Promise.all([
    db.select({ chainId: chainLikesTable.chainId, n: count(), lastAt: max(chainLikesTable.createdAt) })
      .from(chainLikesTable)
      .where(inArray(chainLikesTable.chainId, chainIds))
      .groupBy(chainLikesTable.chainId),
    db.select({ chainId: chainCommentsTable.chainId, n: count(), lastAt: max(chainCommentsTable.createdAt) })
      .from(chainCommentsTable)
      .where(inArray(chainCommentsTable.chainId, chainIds))
      .groupBy(chainCommentsTable.chainId),
    db.select({ chainId: chainRunsTable.chainId, n: count(), lastAt: max(chainRunsTable.startedAt) })
      .from(chainRunsTable)
      .where(inArray(chainRunsTable.chainId, chainIds))
      .groupBy(chainRunsTable.chainId),
    currentUserId
      ? db.select({ followingId: followsTable.followingId })
          .from(followsTable).where(eq(followsTable.followerId, currentUserId))
      : Promise.resolve([] as { followingId: string }[]),
  ]);

  const likeMap      = new Map(likeRows.map((r) => [r.chainId, Number(r.n)]));
  const commentMap   = new Map(commentRows.map((r) => [r.chainId, Number(r.n)]));
  const runMap       = new Map(runRows.map((r) => [r.chainId, Number(r.n)]));
  const likeLastAt   = new Map(likeRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
  const cmtLastAt    = new Map(commentRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));
  const runLastAt    = new Map(runRows.map((r) => [r.chainId, r.lastAt ? new Date(r.lastAt) : null]));

  // Hot endpoint: own fresh posts get a boost (15×→1× over 60 min).
  // Followed users are NOT boosted — this is a global ranking, not a personal feed.
  const followedSet = currentUserId
    ? new Set<string>([...followRows.map(r => r.followingId), currentUserId])
    : null;
  const freshBoostFn = makeFreshBoost(followedSet, currentUserId);

  // hotScore: likes×1 + comments×2 + chainRuns×3, decayed by lastActivityAt.
  // bonus = actual chain_runs count. Never fall back to denormalized chainCount.
  const scored = rawChains.map((c) => {
    const lastActivityAt = [c.createdAt, likeLastAt.get(c.id), cmtLastAt.get(c.id), runLastAt.get(c.id)]
      .filter((d): d is Date => d instanceof Date)
      .reduce((a, b) => (a > b ? a : b), c.createdAt);
    const base = hotScore({
      likes:    likeMap.get(c.id) ?? 0,
      comments: commentMap.get(c.id) ?? 0,
      bonus:    runMap.get(c.id) ?? 0,
      lastActivityAt,
    });
    return {
      chain: c,
      score: base * freshBoostFn(c.userId, c.createdAt),
    };
  });

  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-10) return diff;
    return b.chain.createdAt.getTime() - a.chain.createdAt.getTime();
  });
  const topChains = scored.slice(0, limit).map((s) => s.chain);

  const result = await Promise.all(topChains.map(c => buildChain(c, currentUserId)));
  res.json({ chains: result });
});

// ── GET /chains/bookmarked — chains bookmarked by current user ────────────────
router.get("/bookmarked", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }

  const bookmarks = await db.select()
    .from(chainBookmarksTable)
    .where(eq(chainBookmarksTable.userId, currentUserId))
    .orderBy(desc(chainBookmarksTable.createdAt));

  const chainIds = bookmarks.map(b => b.chainId);
  if (chainIds.length === 0) { res.json({ chains: [] }); return; }

  const chains = await db.select().from(chainsTable)
    .where(and(inArray(chainsTable.id, chainIds), isNull(chainsTable.deletedAt)));

  const result = await Promise.all(chains.map(c => buildChain(c, currentUserId)));
  res.json({ chains: result });
});

// ── GET /chains/:chainId ──────────────────────────────────────────────────────
router.get("/:chainId", async (req, res) => {
  const currentUserId = req.session?.userId;
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt)))
    .limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.isPrivate && chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  const result = await buildChain(chain, currentUserId);
  res.json(result);
});

// ── POST /chains — create chain ────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }

  const { title, description, descriptionAlign, isPrivate, challengeDurationMs, movies, mode } = req.body;
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "bad_request", message: "title is required" });
    return;
  }
  const isHunt = mode === "hunt";
  if (!Array.isArray(movies) || (!isHunt && movies.length < 1)) {
    res.status(400).json({ error: "bad_request", message: "at least 1 movie required" });
    return;
  }

  const chainMode = isHunt ? "hunt" : mode === "community" ? "community" : "standard";
  const chainId = nanoid();
  await db.insert(chainsTable).values({
    id: chainId,
    userId: currentUserId,
    title: sanitize(title.trim()),
    description: description ? sanitize(description.trim()) : null,
    descriptionAlign: (descriptionAlign === "center" || descriptionAlign === "right") ? descriptionAlign : "left",
    isPrivate: isPrivate === true,
    mode: chainMode,
    challengeDurationMs: typeof challengeDurationMs === "number" ? challengeDurationMs : null,
    chainCount: 0,
  });

  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    const snapshot = await fetchTmdbSnapshot(m.imdbId);
    await db.insert(chainMoviesTable).values({
      id: nanoid(),
      chainId,
      position: i + 1,
      imdbId: m.imdbId,
      movieTitle: sanitize(m.movieTitle ?? ""),
      movieYear: m.movieYear ?? null,
      posterUrl: m.posterUrl ?? null,
      genre: m.genre ?? null,
      customRankTier: m.customRankTier ?? null,
      addedByUserId: currentUserId,
      tmdbSnapshot: snapshot ? JSON.stringify(snapshot) : null,
    });
  }

  const [created] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(created!, currentUserId);

  // Badge XP: award chain post XP (fire-and-forget)
  awardXp(currentUserId, "post_chain", chainId).catch(() => {});

  // Push notify followers (best-effort, fire-and-forget) — skip private chains
  if (isPrivate !== true) {
    const [firstMovie] = await db.select({ posterUrl: chainMoviesTable.posterUrl })
      .from(chainMoviesTable)
      .where(eq(chainMoviesTable.chainId, chainId))
      .orderBy(asc(chainMoviesTable.position))
      .limit(1);
    notifyFollowersNewPost({
      authorId: currentUserId,
      kind: "chain",
      postId: chainId,
      chainTitle: title?.trim() ?? null,
      posterUrl: firstMovie?.posterUrl ?? null,
    }).catch(() => {});
  }

  res.status(201).json(result);
});

// ── DELETE /chains/:chainId ────────────────────────────────────────────────────
router.delete("/:chainId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ deletedAt: new Date() }).where(eq(chainsTable.id, chainId));
  res.json({ success: true });
});

// ── PATCH /chains/:chainId — edit title/description ───────────────────────────
router.patch("/:chainId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  const { title, description, descriptionAlign } = req.body;
  if (typeof title === "string" && !title.trim()) {
    res.status(400).json({ error: "bad_request", message: "title is required" });
    return;
  }
  await db.update(chainsTable).set({
    title: typeof title === "string" ? title.trim() : chain.title,
    description: typeof description === "string" ? (description.trim() || null) : chain.description,
    descriptionAlign: (descriptionAlign === "center" || descriptionAlign === "right") ? descriptionAlign : chain.descriptionAlign ?? "left",
  }).where(eq(chainsTable.id, chainId));
  const [updated] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(updated!, currentUserId);
  res.json(result);
});

// ── PATCH /chains/:chainId/privacy — toggle isPrivate ─────────────────────────
router.patch("/:chainId/privacy", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ isPrivate: !chain.isPrivate }).where(eq(chainsTable.id, chainId));
  res.json({ success: true, isPrivate: !chain.isPrivate });
});

// ── PATCH /chains/:chainId/hide-comments — toggle hideComments ────────────────
router.patch("/:chainId/hide-comments", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ hideComments: !chain.hideComments }).where(eq(chainsTable.id, chainId));
  res.json({ success: true, hideComments: !chain.hideComments });
});

// ── PATCH /chains/:chainId/hide-likes — toggle hideLikes ─────────────────────
router.patch("/:chainId/hide-likes", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ hideLikes: !chain.hideLikes }).where(eq(chainsTable.id, chainId));
  res.json({ success: true, hideLikes: !chain.hideLikes });
});

// ── PATCH /chains/:chainId/hide-chain-count — toggle hideChainCount ───────────
router.patch("/:chainId/hide-chain-count", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ hideChainCount: !chain.hideChainCount }).where(eq(chainsTable.id, chainId));
  res.json({ success: true, hideChainCount: !chain.hideChainCount });
});

// ── POST /chains/:chainId/movies — add movie to community chain ───────────────
router.post("/:chainId/movies", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  // standard: only owner can add
  // community: anyone can add
  // hunt: anyone EXCEPT the owner can add (community fills the hunt)
  if (chain.mode === "standard" && chain.userId !== currentUserId) {
    res.status(403).json({ error: "forbidden" }); return;
  }
  if (chain.mode === "hunt" && chain.userId === currentUserId) {
    res.status(403).json({ error: "owner_cannot_add_to_hunt" }); return;
  }

  const [countResult] = await db.select({ count: count() }).from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId));
  if (Number(countResult?.count ?? 0) >= 50) {
    res.status(400).json({ error: "movie_limit_reached", message: "Chain นี้มีหนังครบ 50 เรื่องแล้ว" });
    return;
  }

  const { imdbId, movieTitle, movieYear, posterUrl, genre, memoryNote } = req.body;
  if (!imdbId || !movieTitle) {
    res.status(400).json({ error: "bad_request", message: "imdbId and movieTitle are required" });
    return;
  }

  const [existing] = await db.select().from(chainMoviesTable)
    .where(and(eq(chainMoviesTable.chainId, chainId), eq(chainMoviesTable.imdbId, String(imdbId)))).limit(1);
  if (existing) {
    res.status(409).json({ error: "duplicate_movie", message: "หนังนี้มีอยู่ใน Chain แล้ว" });
    return;
  }

  const [maxPosResult] = await db.select({ max: max(chainMoviesTable.position) }).from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId));
  const nextPosition = (maxPosResult?.max ?? 0) + 1;

  const snapshot = await fetchTmdbSnapshot(String(imdbId));
  await db.insert(chainMoviesTable).values({
    id: nanoid(),
    chainId,
    position: nextPosition,
    imdbId: String(imdbId),
    movieTitle: sanitize(String(movieTitle)),
    movieYear: movieYear ? String(movieYear) : null,
    posterUrl: posterUrl ? String(posterUrl) : null,
    genre: genre ? String(genre) : null,
    customRankTier: null,
    addedByUserId: currentUserId,
    memoryNote: memoryNote ? String(memoryNote).slice(0, 100) : null,
    tmdbSnapshot: snapshot ? JSON.stringify(snapshot) : null,
  });

  await db.update(chainsTable).set({ updatedAt: new Date() }).where(eq(chainsTable.id, chainId));

  // Notify the chain owner when someone else adds a movie (community mode)
  if (currentUserId !== chain.userId) {
    createNotification({
      id: nanoid(),
      userId: chain.userId,
      fromUserId: currentUserId,
      type: "chain_continued",
      chainId: chainId,
      message: chain.title,
      isRead: false,
    }).catch(() => { /* best-effort */ });
  }

  const [updated] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(updated!, currentUserId);
  res.status(201).json(result);
});

// ── PATCH /chains/:chainId/movies/:movieId/note — update memory note ──────────
router.patch("/:chainId/movies/:movieId/note", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId, movieId } = req.params;

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.mode !== "community" && chain.mode !== "hunt") { res.status(400).json({ error: "not_community_chain" }); return; }

  const [movie] = await db.select().from(chainMoviesTable)
    .where(and(eq(chainMoviesTable.id, movieId), eq(chainMoviesTable.chainId, chainId))).limit(1);
  if (!movie) { res.status(404).json({ error: "not_found" }); return; }

  const canEdit = chain.userId === currentUserId || movie.addedByUserId === currentUserId;
  if (!canEdit) { res.status(403).json({ error: "forbidden" }); return; }

  const { note } = req.body;
  const memoryNote = note ? String(note).trim().slice(0, 100) : null;

  await db.update(chainMoviesTable).set({ memoryNote }).where(eq(chainMoviesTable.id, movieId));
  await db.update(chainsTable).set({ updatedAt: new Date() }).where(eq(chainsTable.id, chainId));

  const [updated] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(updated!, currentUserId);
  res.json(result);
});

// ── PATCH /chains/:chainId/movies/reorder — owner reorders movies ─────────────
router.patch("/:chainId/movies/reorder", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const { movieIds } = req.body as { movieIds: string[] };
  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    res.status(400).json({ error: "movieIds must be a non-empty array" }); return;
  }

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await Promise.all(
    movieIds.map((id, idx) =>
      db.update(chainMoviesTable)
        .set({ position: idx + 1 })
        .where(and(eq(chainMoviesTable.id, id), eq(chainMoviesTable.chainId, chainId)))
    )
  );

  await db.update(chainsTable).set({ updatedAt: new Date() }).where(eq(chainsTable.id, chainId));

  const movies = await db.select().from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId))
    .orderBy(asc(chainMoviesTable.position));
  res.json({ movies });
});

// ── DELETE /chains/:chainId/movies/:movieId — owner removes movie ─────────────
router.delete("/:chainId/movies/:movieId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId, movieId } = req.params;

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }

  const [movie] = await db.select().from(chainMoviesTable)
    .where(and(eq(chainMoviesTable.id, movieId), eq(chainMoviesTable.chainId, chainId))).limit(1);
  if (!movie) { res.status(404).json({ error: "not_found" }); return; }

  // chain owner can always remove; in community/hunt mode the user who added the movie can also remove it
  const isChainOwner = chain.userId === currentUserId;
  const isMovieAdder = (chain.mode === "community" || chain.mode === "hunt") && movie.addedByUserId === currentUserId;
  if (!isChainOwner && !isMovieAdder) { res.status(403).json({ error: "forbidden" }); return; }

  await db.delete(chainMoviesTable).where(eq(chainMoviesTable.id, movieId));
  await db.update(chainsTable).set({ updatedAt: new Date() }).where(eq(chainsTable.id, chainId));

  const [updated] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(updated!, currentUserId);
  res.json(result);
});

// ── PATCH /chains/:chainId/hunt-found — owner toggles a movie as found ──────────
router.patch("/:chainId/hunt-found", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const { movieId } = req.body as { movieId: string };
  if (!movieId) { res.status(400).json({ error: "movieId required" }); return; }

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.mode !== "hunt") { res.status(400).json({ error: "not_hunt_chain" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const [movie] = await db.select().from(chainMoviesTable)
    .where(and(eq(chainMoviesTable.id, movieId), eq(chainMoviesTable.chainId, chainId))).limit(1);
  if (!movie) { res.status(404).json({ error: "movie_not_found" }); return; }

  const [existing] = await db.select().from(chainHuntFoundMoviesTable)
    .where(and(eq(chainHuntFoundMoviesTable.chainId, chainId), eq(chainHuntFoundMoviesTable.chainMovieId, movieId)))
    .limit(1);

  if (existing) {
    await db.delete(chainHuntFoundMoviesTable)
      .where(and(eq(chainHuntFoundMoviesTable.chainId, chainId), eq(chainHuntFoundMoviesTable.chainMovieId, movieId)));
  } else {
    await db.insert(chainHuntFoundMoviesTable).values({ chainId, chainMovieId: movieId });
  }

  const [updated] = await db.select().from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
  const result = await buildChain(updated!, currentUserId);
  res.json(result);
});

// ── GET /chains/trash/list — soft-deleted chains for current user ──────────────
router.get("/trash/list", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const chains = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.userId, currentUserId), isNotNull(chainsTable.deletedAt)))
    .orderBy(desc(chainsTable.deletedAt))
    .limit(50);
  const recent = chains.filter(c => c.deletedAt && c.deletedAt > thirtyDaysAgo);
  const built = await Promise.all(recent.map(c => buildChain(c, currentUserId)));
  const result = built.map((b, i) => ({ ...b, deletedAt: recent[i].deletedAt!.toISOString() }));
  res.json({ chains: result });
});

// ── POST /chains/trash/:chainId/restore ───────────────────────────────────────
router.post("/trash/:chainId/restore", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNotNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.update(chainsTable).set({ deletedAt: null, updatedAt: new Date() }).where(eq(chainsTable.id, chainId));
  res.json({ success: true });
});

// ── DELETE /chains/trash/:chainId/purge — permanent delete ────────────────────
router.delete("/trash/:chainId/purge", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNotNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.delete(chainsTable).where(eq(chainsTable.id, chainId));
  res.json({ success: true });
});

// ── POST /chains/:chainId/run — start a run ───────────────────────────────────
router.post("/:chainId/run", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }

  const existingRun = await db.select().from(chainRunsTable)
    .where(and(
      eq(chainRunsTable.chainId, chainId),
      eq(chainRunsTable.userId, currentUserId),
      eq(chainRunsTable.status, "live"),
    )).limit(1);
  if (existingRun.length > 0) {
    res.status(409).json({ error: "already_running", runId: existingRun[0]!.id });
    return;
  }

  const movies = await db.select().from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId))
    .orderBy(asc(chainMoviesTable.position));

  const runId = nanoid();
  await db.insert(chainRunsTable).values({
    id: runId,
    chainId,
    userId: currentUserId,
    status: "live",
    totalElapsedMs: 0,
    completedCount: 0,
  });

  for (const movie of movies) {
    await db.insert(chainRunItemsTable).values({
      id: nanoid(),
      runId,
      chainMovieId: movie.id,
      position: movie.position,
      status: "pending",
    });
  }

  await db.update(chainsTable).set({
    chainCount: chain.chainCount + 1,
    updatedAt: new Date(),
  }).where(eq(chainsTable.id, chainId));

  // Notify the chain owner when someone else starts a run
  if (currentUserId !== chain.userId) {
    createNotification({
      id: nanoid(),
      userId: chain.userId,
      fromUserId: currentUserId,
      type: "chain_run_started",
      chainId: chainId,
      message: chain.title,
      isRead: false,
    }).catch(() => { /* best-effort */ });
  }

  const [run] = await db.select().from(chainRunsTable).where(eq(chainRunsTable.id, runId)).limit(1);
  const items = await db.select().from(chainRunItemsTable)
    .where(eq(chainRunItemsTable.runId, runId)).orderBy(asc(chainRunItemsTable.position));
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, chain.userId)).limit(1);
  res.status(201).json(buildRunSummary(run!, items, movies, owner));
});

// ── GET /chains/:chainId/run — get my current run ─────────────────────────────
router.get("/:chainId/run", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;

  const [run] = await db.select().from(chainRunsTable)
    .where(and(eq(chainRunsTable.chainId, chainId), eq(chainRunsTable.userId, currentUserId)))
    .orderBy(desc(chainRunsTable.startedAt)).limit(1);
  if (!run) { res.status(404).json({ error: "not_found" }); return; }

  const items = await db.select().from(chainRunItemsTable)
    .where(eq(chainRunItemsTable.runId, run.id)).orderBy(asc(chainRunItemsTable.position));
  const movies = await db.select().from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId)).orderBy(asc(chainMoviesTable.position));
  const [chainOwner] = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);

  res.json(buildRunSummary(run, items, movies, chainOwner));
});

// ── PATCH /chains/:chainId/run/:runId/item/:itemId/start ──────────────────────
router.patch("/:chainId/run/:runId/item/:itemId/start", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }

  const { runId, itemId } = req.params;
  const [run] = await db.select().from(chainRunsTable)
    .where(and(eq(chainRunsTable.id, runId), eq(chainRunsTable.userId, currentUserId))).limit(1);
  if (!run) { res.status(404).json({ error: "not_found" }); return; }

  await db.update(chainRunItemsTable).set({
    status: "watching",
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(chainRunItemsTable.id, itemId), eq(chainRunItemsTable.runId, runId)));

  res.json({ success: true });
});

// ── PATCH /chains/:chainId/run/:runId/item/:itemId/finish ─────────────────────
router.patch("/:chainId/run/:runId/item/:itemId/finish", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }

  const { runId, itemId } = req.params;
  const { elapsedMs, rating, ratingType, customRankTier, memoryNote } = req.body;

  const [run] = await db.select().from(chainRunsTable)
    .where(and(eq(chainRunsTable.id, runId), eq(chainRunsTable.userId, currentUserId))).limit(1);
  if (!run) { res.status(404).json({ error: "not_found" }); return; }

  const finishedAt = new Date();
  await db.update(chainRunItemsTable).set({
    status: "done",
    finishedAt,
    elapsedMs: elapsedMs ?? null,
    rating: rating ?? null,
    ratingType: ratingType ?? null,
    customRankTier: customRankTier ?? null,
    memoryNote: memoryNote ? sanitize(memoryNote) : null,
    updatedAt: new Date(),
  }).where(and(eq(chainRunItemsTable.id, itemId), eq(chainRunItemsTable.runId, runId)));

  const allItems = await db.select().from(chainRunItemsTable)
    .where(eq(chainRunItemsTable.runId, runId));
  const doneCount = allItems.filter(i => i.status === "done").length;
  const totalElapsed = allItems.reduce((sum, i) => sum + (i.elapsedMs ?? 0), 0);
  const allDone = doneCount === allItems.length;

  await db.update(chainRunsTable).set({
    completedCount: doneCount,
    totalElapsedMs: totalElapsed,
    status: allDone ? "completed" : "live",
    completedAt: allDone ? finishedAt : null,
    updatedAt: new Date(),
  }).where(eq(chainRunsTable.id, runId));

  res.json({ success: true, allDone });
});

// ── DELETE /chains/:chainId/run/:runId — cancel a run ─────────────────────────
router.delete("/:chainId/run/:runId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId, runId } = req.params;

  const [run] = await db.select().from(chainRunsTable)
    .where(and(eq(chainRunsTable.id, runId), eq(chainRunsTable.userId, currentUserId))).limit(1);
  if (!run) { res.status(404).json({ error: "not_found" }); return; }
  if (run.status !== "live") { res.status(409).json({ error: "not_live" }); return; }

  await db.delete(chainRunItemsTable).where(eq(chainRunItemsTable.runId, runId));
  await db.delete(chainRunsTable).where(eq(chainRunsTable.id, runId));

  await db.update(chainsTable).set({
    chainCount: Math.max(0, (await db.select({ c: count() }).from(chainRunsTable).where(eq(chainRunsTable.chainId, chainId)))[0]!.c),
    updatedAt: new Date(),
  }).where(eq(chainsTable.id, chainId));

  res.json({ success: true });
});

// ── GET /chains/:chainId/runs — get all runs (live ones first) ────────────────
router.get("/:chainId/runs", async (req, res) => {
  const currentUserId = req.session?.userId;
  const { chainId } = req.params;
  const limit = Math.min(Number(req.query["limit"]) || 10, 30);

  const [chain] = await db.select().from(chainsTable)
    .where(and(eq(chainsTable.id, chainId), isNull(chainsTable.deletedAt))).limit(1);
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }

  const runs = await db.select().from(chainRunsTable)
    .where(eq(chainRunsTable.chainId, chainId))
    .orderBy(desc(chainRunsTable.startedAt))
    .limit(limit);

  const movies = await db.select().from(chainMoviesTable)
    .where(eq(chainMoviesTable.chainId, chainId)).orderBy(asc(chainMoviesTable.position));

  const result = await Promise.all(runs.map(async run => {
    const items = await db.select().from(chainRunItemsTable)
      .where(eq(chainRunItemsTable.runId, run.id)).orderBy(asc(chainRunItemsTable.position));
    const [runUser] = await db.select().from(usersTable).where(eq(usersTable.id, run.userId)).limit(1);
    return buildRunSummary(run, items, movies, runUser);
  }));

  res.json({ runs: result });
});

// ── POST /chains/:chainId/like ────────────────────────────────────────────────
router.post("/:chainId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  try {
    await db.insert(chainLikesTable).values({ userId: currentUserId, chainId }).onConflictDoNothing();
  } catch (err) {
    console.warn("[chains] like insert error (non-fatal):", (err as Error).message);
  }
  res.json({ success: true });
});

// ── DELETE /chains/:chainId/like ──────────────────────────────────────────────
router.delete("/:chainId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  await db.delete(chainLikesTable)
    .where(and(eq(chainLikesTable.userId, currentUserId), eq(chainLikesTable.chainId, chainId)));
  res.json({ success: true });
});

// ── POST /chains/:chainId/bookmark ────────────────────────────────────────────
router.post("/:chainId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  try {
    await db.insert(chainBookmarksTable).values({ userId: currentUserId, chainId }).onConflictDoNothing();
  } catch (err) {
    console.warn("[chains] bookmark insert error (non-fatal):", (err as Error).message);
  }
  res.json({ success: true });
});

// ── DELETE /chains/:chainId/bookmark ──────────────────────────────────────────
router.delete("/:chainId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  await db.delete(chainBookmarksTable)
    .where(and(eq(chainBookmarksTable.userId, currentUserId), eq(chainBookmarksTable.chainId, chainId)));
  res.json({ success: true });
});

// ── GET /chains/:chainId/comments ─────────────────────────────────────────────
router.get("/:chainId/comments", async (req, res) => {
  const { chainId } = req.params;
  const comments = await db.select({
    id: chainCommentsTable.id,
    content: chainCommentsTable.content,
    createdAt: chainCommentsTable.createdAt,
    userId: chainCommentsTable.userId,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
  })
    .from(chainCommentsTable)
    .leftJoin(usersTable, eq(chainCommentsTable.userId, usersTable.id))
    .where(eq(chainCommentsTable.chainId, chainId))
    .orderBy(desc(chainCommentsTable.createdAt))
    .limit(50);
  res.json({ comments });
});

// ── DELETE /chains/:chainId/comments/:commentId ───────────────────────────────
router.delete("/:chainId/comments/:commentId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { commentId } = req.params;
  const { chainId } = req.params;
  const [comment] = await db.select().from(chainCommentsTable).where(eq(chainCommentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "not_found" }); return; }
  // comment author OR chain owner can delete
  if (comment.userId !== currentUserId) {
    const [chain] = await db.select({ userId: chainsTable.userId }).from(chainsTable).where(eq(chainsTable.id, chainId)).limit(1);
    if (!chain || chain.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  }
  await db.delete(chainCommentsTable).where(eq(chainCommentsTable.id, commentId));
  res.json({ success: true });
});

// ── POST /chains/:chainId/comments ────────────────────────────────────────────
router.post("/:chainId/comments", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const { content } = req.body;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "bad_request", message: "content required" });
    return;
  }
  const id = nanoid();
  await db.insert(chainCommentsTable).values({
    id,
    chainId,
    userId: currentUserId,
    content: sanitize(content.trim()),
  });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
  res.json({
    id,
    chainId,
    content: sanitize(content.trim()),
    createdAt: new Date().toISOString(),
    userId: currentUserId,
    username: user?.username ?? null,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
  });
});

// ── POST /chains/:chainId/report ──────────────────────────────────────────────
router.post("/:chainId/report", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { chainId } = req.params;
  const { reason, details } = req.body;
  if (!reason) { res.status(400).json({ error: "reason_required" }); return; }

  const [chain] = await db.select({ userId: chainsTable.userId }).from(chainsTable).where(eq(chainsTable.id, chainId));
  if (!chain) { res.status(404).json({ error: "not_found" }); return; }
  if (chain.userId === currentUserId) { res.status(403).json({ error: "cannot_report_own" }); return; }

  const [already] = await db.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.reporterId, currentUserId), eq(reportsTable.chainId, chainId)));
  if (already) { res.status(409).json({ error: "already_reported" }); return; }

  await db.insert(reportsTable).values({
    id: nanoid(),
    reporterId: currentUserId,
    chainId,
    reportedUserId: chain.userId,
    reason,
    details: details ? String(details).slice(0, 500) : null,
  });
  res.json({ success: true });
});

export default router;
