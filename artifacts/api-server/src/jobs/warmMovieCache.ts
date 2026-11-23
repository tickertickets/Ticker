/**
 * warmMovieCache — background job
 *
 * Scans all unique imdbIds that have been ticketed, finds those whose
 * `movies` table row is stale (>22 h), refreshes them from TMDB, and
 * re-syncs rankTier + currentRankTier on all non-locked tickets so that
 * card ranks always reflect the current TMDB score.
 *
 * Cache writes target the SAME stores the live request handlers read from:
 *   - `moviesTable`  → `movieLiveSnapshot` source for ticket cards
 *   - `apiCacheTable["movie_core:<tmdbId>"]` → source for movie-list cards
 * (We previously also wrote to `apiCacheTable["movie_detail:<imdbId>:th"]`,
 *  but that key never matched the variant-suffixed format the detail route
 *  actually reads, so the writes were dead and the staleness check always
 *  treated everything as stale. Both are removed.)
 *
 * Rate-limited to one TMDB request per 700 ms to stay well within limits.
 */

import { db } from "@workspace/db";
import { ticketsTable, apiCacheTable, moviesTable } from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { tmdbFetch, posterUrl, TMDB_IMG_WIDE } from "../lib/tmdb-client";
import { weightedScore, computeRankTier } from "../services/rank.service";

const STALE_MS   = 22 * 60 * 60 * 1000; // refresh when >22 h old
const REQUEST_GAP_MS = 700;              // delay between TMDB calls

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── TMDB fetch helpers (mirrors the route handler logic) ──────────────────────

async function fetchTvDetail(tmdbId: number): Promise<Record<string, unknown>> {
  const [data, watchProviders] = await Promise.all([
    tmdbFetch<{
      id: number; name?: string; original_name?: string;
      first_air_date?: string; genres?: Array<{ id: number; name: string }>;
      overview?: string; vote_average?: number; vote_count?: number;
      popularity?: number; episode_run_time?: number[];
      poster_path?: string | null;
      spoken_languages?: Array<{ name: string }>;
      production_countries?: Array<{ name: string }>;
      created_by?: Array<{ name: string }>;
      credits?: { cast?: Array<{ name: string }> };
      number_of_seasons?: number;
    }>(`/tv/${tmdbId}`, { language: "th", append_to_response: "credits" }),
    fetchWatchProvidersLocal(tmdbId, "tv"),
  ]);

  const creator = data.created_by?.map((c) => c.name).join(", ") || null;
  const actors  = data.credits?.cast?.slice(0, 5).map((a) => a.name).join(", ") || null;
  const genreList = data.genres?.map((g) => g.name) ?? [];
  const genreIds  = data.genres?.map((g) => g.id) ?? [];

  return {
    imdbId: `tmdb_tv:${tmdbId}`, tmdbId, mediaType: "tv",
    title: data.name || data.original_name || "",
    originalTitle: data.original_name || data.name || "",
    year: data.first_air_date ? data.first_air_date.slice(0, 4) : null,
    genre: genreList.join(", ") || null, genreList, genreIds, franchiseIds: [],
    plot: data.overview || null, director: creator, actors,
    imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
    tmdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
    voteCount: data.vote_count ?? 0, popularity: data.popularity ?? 0,
    runtime: data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min/ep` : null,
    posterUrl: posterUrl(data.poster_path),
    language: data.spoken_languages?.map((l) => l.name).join(", ") || null,
    country: data.production_countries?.map((c) => c.name).join(", ") || null,
    numberOfSeasons: data.number_of_seasons ?? null,
    watchProviders,
  };
}

async function fetchMovieDetail(tmdbId: number): Promise<Record<string, unknown>> {
  const [data, watchProviders] = await Promise.all([
    tmdbFetch<{
      id: number; title: string; original_title?: string;
      release_date?: string; genres?: Array<{ id: number; name: string }>;
      overview?: string; vote_average?: number; vote_count?: number;
      popularity?: number; runtime?: number;
      poster_path?: string | null;
      spoken_languages?: Array<{ name: string }>;
      production_countries?: Array<{ name: string }>;
      belongs_to_collection?: { id: number; name: string } | null;
      credits?: {
        crew?: Array<{ job: string; name: string }>;
        cast?: Array<{ name: string }>;
      };
    }>(`/movie/${tmdbId}`, { language: "th", append_to_response: "credits" }),
    fetchWatchProvidersLocal(tmdbId, "movie"),
  ]);

  const director = data.credits?.crew?.find((c) => c.job === "Director")?.name || null;
  const producer = data.credits?.crew?.filter((c) => c.job === "Producer")
    .slice(0, 3).map((c) => c.name).join(", ") || null;
  const actors   = data.credits?.cast?.slice(0, 5).map((a) => a.name).join(", ") || null;
  const genreList = data.genres?.map((g) => g.name) ?? [];
  const genreIds  = data.genres?.map((g) => g.id) ?? [];

  return {
    imdbId: `tmdb:${tmdbId}`, tmdbId, mediaType: "movie",
    title: data.title || data.original_title || "",
    originalTitle: data.original_title || data.title || "",
    year: data.release_date ? data.release_date.slice(0, 4) : null,
    genre: genreList.join(", ") || null, genreList, genreIds,
    franchiseIds: data.belongs_to_collection ? [data.belongs_to_collection.id] : [],
    plot: data.overview || null, director, producer, actors,
    imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
    tmdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
    voteCount: data.vote_count ?? 0, popularity: data.popularity ?? 0,
    runtime: data.runtime ? `${data.runtime} min` : null,
    posterUrl: posterUrl(data.poster_path),
    language: data.spoken_languages?.map((l) => l.name).join(", ") || null,
    country: data.production_countries?.map((c) => c.name).join(", ") || null,
    watchProviders,
  };
}

async function fetchWatchProvidersLocal(tmdbId: number, type: "movie" | "tv"): Promise<Record<string, unknown>> {
  try {
    const data = await tmdbFetch<{
      results?: Record<string, {
        flatrate?: Array<{ provider_name: string; logo_path: string }>;
        rent?: Array<{ provider_name: string; logo_path: string }>;
        buy?: Array<{ provider_name: string; logo_path: string }>;
      }>;
    }>(`/${type}/${tmdbId}/watch/providers`);

    const th = data.results?.["TH"];
    if (!th) return {};
    const toItems = (arr?: Array<{ provider_name: string; logo_path: string }>) =>
      (arr ?? []).map((p) => ({ name: p.provider_name, logo: `${TMDB_IMG_WIDE.replace("w1280", "w92")}${p.logo_path}` }));
    return {
      flatrate: toItems(th.flatrate),
      rent: toItems(th.rent),
      buy: toItems(th.buy),
    };
  } catch {
    return {};
  }
}

// ── Core warm function ────────────────────────────────────────────────────────

export async function warmMovieDetailCache(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_MS);

  // 1. Distinct imdbIds from ticketsTable
  const rows = await db
    .selectDistinct({ imdbId: ticketsTable.imdbId })
    .from(ticketsTable);

  if (rows.length === 0) return;

  // 2. Resolve each imdbId → numeric tmdbId. Skip raw IMDb ids (tt-codes)
  //    and "reel" placeholders — they have no TMDB record to refresh.
  type Candidate = { imdbId: string; tmdbId: number; isTv: boolean };
  const candidates: Candidate[] = [];
  for (const { imdbId } of rows) {
    if (imdbId.startsWith("tmdb_tv:")) {
      const n = parseInt(imdbId.slice(8), 10);
      if (!isNaN(n)) candidates.push({ imdbId, tmdbId: n, isTv: true });
    } else if (imdbId.startsWith("tmdb:")) {
      const n = parseInt(imdbId.slice(5), 10);
      if (!isNaN(n)) candidates.push({ imdbId, tmdbId: n, isTv: false });
    }
  }
  if (candidates.length === 0) return;

  // 3. Batch-load fetchedAt from moviesTable — the ACTUAL source ticket
  //    cards (and `calculateRankTier`) read from. If a row is missing or
  //    older than STALE_MS we refresh it.
  const tmdbIds = candidates.map((c) => c.tmdbId);
  const existingRows = await db
    .select({ tmdbId: moviesTable.tmdbId, fetchedAt: moviesTable.fetchedAt })
    .from(moviesTable)
    .where(inArray(moviesTable.tmdbId, tmdbIds));

  const freshMap = new Map<number, Date>(
    existingRows.map((r) => [r.tmdbId, r.fetchedAt]),
  );

  const stale: Candidate[] = candidates.filter((c) => {
    const fetchedAt = freshMap.get(c.tmdbId);
    return !fetchedAt || fetchedAt < staleThreshold;
  });

  if (stale.length === 0) {
    console.log("[warmMovieCache] All movies fresh — nothing to refresh");
    return;
  }

  console.log(`[warmMovieCache] Refreshing ${stale.length} stale movie(s)…`);
  let refreshed = 0;
  let rankSynced = 0;
  let failed = 0;

  for (const { imdbId, tmdbId, isTv } of stale) {
    try {
      const result = isTv
        ? await fetchTvDetail(tmdbId)
        : await fetchMovieDetail(tmdbId);

      // ── 1. Update moviesTable so ticket cards' `movieLiveSnapshot` and
      //       `calculateRankTier`'s in-DB cache see fresh values immediately.
      const tmdbRating  = parseFloat((result["tmdbRating"] as string | null) ?? "0") || 0;
      const voteCount   = typeof result["voteCount"] === "number" ? result["voteCount"] : 0;
      const popularity  = typeof result["popularity"] === "number" ? result["popularity"] : 0;
      const genreIds    = Array.isArray(result["genreIds"]) ? (result["genreIds"] as number[]) : [];
      const franchiseIds = Array.isArray(result["franchiseIds"]) ? (result["franchiseIds"] as number[]) : [];
      const yearRaw     = typeof result["year"] === "string" ? parseInt(result["year"] as string, 10) : null;
      const releaseYear = yearRaw && !isNaN(yearRaw) ? yearRaw : null;
      const releaseDate = (releaseYear ? `${releaseYear}-01-01` : null);

      await db
        .insert(moviesTable)
        .values({
          tmdbId,
          mediaType: isTv ? "tv" : "movie",
          title: (result["title"] as string) || String(tmdbId),
          posterUrl: (result["posterUrl"] as string | null) ?? null,
          releaseDate,
          voteAverage: tmdbRating ? tmdbRating.toString() : null,
          voteCount,
          popularity: popularity.toString(),
          genreIds,
          franchiseIds,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: moviesTable.tmdbId,
          set: {
            voteAverage: tmdbRating ? tmdbRating.toString() : null,
            voteCount,
            popularity: popularity.toString(),
            genreIds,
            franchiseIds,
            fetchedAt: new Date(),
          },
        });

      // ── 2. Update movie_core cache so list-endpoint cards (search/explore)
      //       pick up the fresh values on their next render without paying
      //       the cold-cache TMDB round-trip themselves.
      const coreData = {
        tmdbRating: tmdbRating ? tmdbRating.toFixed(1) : null,
        voteCount,
        popularity,
        genreIds,
        releaseDate,
        franchiseIds,
      };
      await db
        .insert(apiCacheTable)
        .values({
          cacheKey: `movie_core:${tmdbId}`,
          data: coreData,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: apiCacheTable.cacheKey,
          set: { data: coreData, fetchedAt: new Date() },
        });

      refreshed++;

      // ── 3. Re-compute rankTier and sync all non-locked tickets ────────────
      const ws   = weightedScore(tmdbRating, voteCount);
      const tier = computeRankTier(ws, releaseYear);

      const snapshot = JSON.stringify({
        tmdbRating,
        voteCount,
        year: releaseYear,
        popularity,
        genreIds,
      });

      await db
        .update(ticketsTable)
        .set({
          rankTier:        tier,
          currentRankTier: tier,
          popularityScore: Math.round(ws * 10),
          tmdbSnapshot:    snapshot,
          updatedAt:       new Date(),
        })
        .where(
          and(
            eq(ticketsTable.imdbId,     imdbId),
            eq(ticketsTable.rankLocked, false),
          ),
        );

      rankSynced++;
    } catch (err) {
      failed++;
      console.warn(`[warmMovieCache] Failed to refresh ${imdbId}:`, err);
    }

    await sleep(REQUEST_GAP_MS);
  }

  // sql import is used implicitly by drizzle for typed updates above — keep
  // an explicit reference so build doesn't strip the import.
  void sql;

  console.log(`[warmMovieCache] Done — ${refreshed} refreshed, ${rankSynced} rank-synced, ${failed} failed`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function scheduleWarmMovieCache(intervalMs = 23 * 60 * 60 * 1000): void {
  // Initial run 3 minutes after server starts — gives the DB pool and session store
  // time to fully stabilize before running a batch of TMDB+DB operations.
  setTimeout(() => {
    warmMovieDetailCache().catch((e) =>
      console.error("[warmMovieCache] Initial run failed:", e)
    );
  }, 3 * 60 * 1000);

  // Then repeat every 23 hours
  setInterval(() => {
    warmMovieDetailCache().catch((e) =>
      console.error("[warmMovieCache] Scheduled run failed:", e)
    );
  }, intervalMs).unref();
}
