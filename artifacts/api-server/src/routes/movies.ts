/**
 * Movies Router — HTTP interface only.
 *
 * Thin handlers that delegate to movies.service.ts for all TMDB logic.
 * DB queries that are tightly scoped to a single route (e.g. likes, bookmarks)
 * remain here for clarity since they don't require a separate service.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  likesTable,
  commentsTable,
  movieLikesTable,
  movieCommentsTable,
  movieBookmarksTable,
  followsTable,
  apiCacheTable,
  moviesTable,
} from "@workspace/db/schema";
import { eq, desc, count, max, and, inArray, isNull } from "drizzle-orm";
import { asyncHandler } from "../middlewares/error-handler";
import { hotScore } from "../lib/hot-score";
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "../lib/errors";
import { tmdbFetch, posterUrl, TMDB_IMG_WIDE, isoDate } from "../lib/tmdb-client";
import { queryAwardsByImdbId } from "../lib/wikidata";
import {
  detectLanguage,
  normalizeItem,
  fetchCollectionIds,
  fetchWatchProviders,
  enrichUpcomingMovie,
  fetchMoodMovies,
  dailyStartPage,
  MOOD_CFG,
  SUB_FILTER_URLS,
  type TMDBItem,
  type PagedResult,
} from "../services/movies.service";

const router: IRouter = Router();

// ── DB-backed cache helpers ───────────────────────────────────────────────────
// Replaces module-level in-memory caches that are lost on cold starts.

const TRENDING_TTL_MS     = 1000 * 60 * 15;       // 15 min
const UPCOMING_TTL_MS     = 1000 * 60 * 30;       // 30 min
const MOVIE_DETAIL_TTL_MS = 1000 * 60 * 60;       // 1 h — score refreshes every hour
const MOOD_TTL_MS         = 1000 * 60 * 60 * 25;  // 25 h (covers timezone drift)

// Returns "YYYY-MM-DD" in UTC — used to build daily cache keys.
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Resolve UI language from request header (sent by web client).
// Returns the TMDB language code; defaults to "th-TH".
function getUILang(req: { header: (n: string) => string | undefined }): "th-TH" | "en-US" {
  const h = req.header("x-ui-lang")?.toLowerCase();
  return h === "en" ? "en-US" : "th-TH";
}

// Map a TMDB original_language ISO-639-1 code (e.g. "ja", "ko") to a TMDB
// locale code suitable for the `language` query param. Falls back to the bare
// code (which TMDB accepts) for languages we don't explicitly map.
function originalLangToLocale(code: string | null | undefined): string {
  if (!code) return "en-US";
  const c = code.toLowerCase();
  const map: Record<string, string> = {
    en: "en-US", th: "th-TH", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN",
    fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT", ru: "ru-RU",
    pt: "pt-BR", hi: "hi-IN", ar: "ar-SA", tr: "tr-TR", id: "id-ID",
    vi: "vi-VN", ms: "ms-MY", tl: "tl-PH",
  };
  return map[c] ?? c;
}

// Fetch a TMDB genre id → name map for the given media type, in the given UI
// language. Cached for 24h since the list rarely changes.
const GENRE_MAP_TTL_MS = 1000 * 60 * 60 * 24;
async function fetchGenreMap(
  mediaType: "movie" | "tv",
  lang: "th-TH" | "en-US",
): Promise<Map<number, string>> {
  const cacheKey = `genre_map:${mediaType}:${lang}`;
  const cached = await getCached(cacheKey, GENRE_MAP_TTL_MS);
  if (cached) {
    return new Map(Object.entries(cached as Record<string, string>).map(
      ([k, v]) => [Number(k), v],
    ));
  }
  const data = await tmdbFetch<{ genres?: Array<{ id: number; name: string }> }>(
    `/genre/${mediaType}/list`,
    { language: lang },
  );
  const map = new Map<number, string>();
  const obj: Record<string, string> = {};
  for (const g of data.genres ?? []) {
    map.set(g.id, g.name);
    obj[String(g.id)] = g.name;
  }
  await setCached(cacheKey, obj);
  return map;
}


async function getCached(key: string, ttlMs: number): Promise<unknown | null> {
  try {
    const [row] = await db
      .select()
      .from(apiCacheTable)
      .where(eq(apiCacheTable.cacheKey, key))
      .limit(1);
    if (!row) return null;
    const age = Date.now() - new Date(row.fetchedAt).getTime();
    return age < ttlMs ? row.data : null;
  } catch {
    return null;
  }
}

async function setCached(key: string, data: unknown): Promise<void> {
  try {
    await db
      .insert(apiCacheTable)
      .values({ cacheKey: key, data: data as Record<string, unknown>, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: apiCacheTable.cacheKey,
        set: { data: data as Record<string, unknown>, fetchedAt: new Date() },
      });
  } catch {
    // Cache write failure is non-fatal — log silently.
  }
}

// ── Per-movie rating cache — shared by category + detail endpoints ─────────────
// When the detail endpoint fetches fresh TMDB data, it writes here.
// Category endpoints enrich their movie lists from this cache at serve time,
// ensuring card rank and detail rank always use the same vote_average.

const MOVIE_CORE_TTL_MS = 1000 * 60 * 60; // 1 h — matches detail cache

type MovieCore = {
  tmdbRating: string | null;
  voteCount: number;
  popularity: number;
  genreIds: number[];
  releaseDate: string | null;
  franchiseIds: number[];
};

function setMovieCore(tmdbId: number, core: MovieCore): void {
  // Fire-and-forget — non-blocking, failure is silent.
  setCached(`movie_core:${tmdbId}`, core).catch(() => {});
}

// ── Background refresh helper — refreshes stale movie_core entries off the ──
// hot path so the NEXT request gets fresh data without blocking THIS one.
function refreshStaleCoresInBackground(
  items: Array<{ tmdbId: number; mediaType: string }>,
): void {
  if (items.length === 0) return;
  (async () => {
    try {
      for (let i = 0; i < items.length; i += 5) {
        await Promise.allSettled(
          items.slice(i, i + 5).map(async (m) => {
            try {
              const isTV = m.mediaType === "tv";
              const path = isTV ? `/tv/${m.tmdbId}` : `/movie/${m.tmdbId}`;
              const data = await tmdbFetch<{
                vote_average?: number;
                vote_count?: number;
                popularity?: number;
                genres?: { id: number }[];
                release_date?: string;
                first_air_date?: string;
                belongs_to_collection?: { id: number } | null;
              }>(path, { language: "en-US" });
              setMovieCore(m.tmdbId, {
                tmdbRating:
                  data.vote_average != null
                    ? data.vote_average.toFixed(1)
                    : null,
                voteCount: data.vote_count ?? 0,
                popularity: data.popularity ?? 0,
                genreIds: (data.genres ?? []).map((g) => g.id),
                releaseDate:
                  data.release_date ?? data.first_air_date ?? null,
                franchiseIds: data.belongs_to_collection
                  ? [data.belongs_to_collection.id]
                  : [],
              });
            } catch {
              /* per-movie failure is non-fatal */
            }
          }),
        );
      }
    } catch {
      /* silent — background refresh failure is non-fatal */
    }
  })();
}

// ── ensureMovieCores ──────────────────────────────────────────────────────────
//
// MUST be awaited before sending a list response. Guarantees that every movie
// in the array carries authoritative TMDB-detail-level fields (`tmdbRating`,
// `voteCount`, `popularity`, `genreIds`, `releaseDate`, `franchiseIds`) so the
// frontend computes the SAME rank/effects on first render as the movie-detail
// page would show.
//
// Why this matters:
//   TMDB list endpoints (`/trending`, `/discover`, `/search`) return SNAPSHOT
//   `vote_average` from when the list was compiled (often hours/days old) and
//   NEVER include `belongs_to_collection`. Without enrichment, cards show:
//     - stale ratings → may sit in a different rank tier than the detail page
//     - franchiseIds = [] → "FR" effect tag never appears on the card
//   The user then opens detail, the detail endpoint writes fresh data into the
//   same React Query cache key, and the card "jumps" to the correct rank.
//
// Strategy:
//   1. Bulk-load every existing movie_core cache row, regardless of age.
//      A stale TMDB-detail snapshot is still much closer to detail-page truth
//      than a list-endpoint snapshot, and is "good enough" for rank parity.
//   2. SYNCHRONOUSLY fetch and persist any TRULY MISSING entries from TMDB
//      (parallel batches of 5). This is the critical path — ranks for these
//      movies are wrong until we fetch them.
//   3. Fire a background refresh for stale-but-cached entries so the cache
//      stays warm without blocking this response.
//   4. Apply the resolved core fields to the movies array.
//
// Performance:
//   - Cold cache (movie unseen by anyone): adds ~200-600 ms to a list response.
//   - Warm cache (any age): adds only the bulk DB read (a few ms).
//   - Cache TTL is unchanged (1 h); fully populated lists pay nothing extra.
async function ensureMovieCores(
  movies: Array<Record<string, any>>,
): Promise<void> {
  if (movies.length === 0) return;
  const candidates = movies.filter(
    (m): m is Record<string, any> & { tmdbId: number; mediaType: string } =>
      typeof m["tmdbId"] === "number" && typeof m["mediaType"] === "string",
  );
  if (candidates.length === 0) return;

  // Dedupe by tmdbId so we only fetch each movie once even if the list
  // contains duplicates (e.g. cross-category merges).
  const uniqueCandidates = Array.from(
    new Map(candidates.map((m) => [m["tmdbId"] as number, m])).values(),
  );

  const coreMap = new Map<number, MovieCore>();
  const staleItems: Array<{ tmdbId: number; mediaType: string }> = [];

  // 1) Bulk-load every existing cache row regardless of age.
  try {
    const keys = uniqueCandidates.map(
      (m) => `movie_core:${m["tmdbId"]}`,
    );
    const rows = await db
      .select({
        cacheKey: apiCacheTable.cacheKey,
        data: apiCacheTable.data,
        fetchedAt: apiCacheTable.fetchedAt,
      })
      .from(apiCacheTable)
      .where(inArray(apiCacheTable.cacheKey, keys));
    const now = Date.now();
    for (const row of rows) {
      const tmdbId = parseInt(
        row.cacheKey.replace("movie_core:", ""),
        10,
      );
      if (isNaN(tmdbId)) continue;
      coreMap.set(tmdbId, row.data as MovieCore);
      const age = now - new Date(row.fetchedAt).getTime();
      if (age >= MOVIE_CORE_TTL_MS) {
        const candidate = uniqueCandidates.find(
          (c) => (c["tmdbId"] as number) === tmdbId,
        );
        if (candidate) {
          staleItems.push({
            tmdbId,
            mediaType: candidate["mediaType"] as string,
          });
        }
      }
    }
  } catch {
    // DB read failure is non-fatal; fall through to TMDB fetch for all items.
  }

  // 2) Synchronously fetch and persist TRULY missing entries.
  const missing = uniqueCandidates.filter(
    (m) => !coreMap.has(m["tmdbId"] as number),
  );
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.allSettled(
      missing.slice(i, i + 5).map(async (m) => {
        try {
          const isTV = m["mediaType"] === "tv";
          const tmdbId = m["tmdbId"] as number;
          const path = isTV ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
          const data = await tmdbFetch<{
            vote_average?: number;
            vote_count?: number;
            popularity?: number;
            genres?: { id: number }[];
            release_date?: string;
            first_air_date?: string;
            belongs_to_collection?: { id: number } | null;
          }>(path, { language: "en-US" });
          const core: MovieCore = {
            tmdbRating:
              data.vote_average != null
                ? data.vote_average.toFixed(1)
                : null,
            voteCount: data.vote_count ?? 0,
            popularity: data.popularity ?? 0,
            genreIds: (data.genres ?? []).map((g) => g.id),
            releaseDate:
              data.release_date ?? data.first_air_date ?? null,
            franchiseIds: data.belongs_to_collection
              ? [data.belongs_to_collection.id]
              : [],
          };
          coreMap.set(tmdbId, core);
          setMovieCore(tmdbId, core);
        } catch {
          // Per-movie failure is non-fatal. That single card will fall
          // back to whatever fields the list endpoint provided.
        }
      }),
    );
  }

  // 3) Background refresh for stale-but-cached entries.
  refreshStaleCoresInBackground(staleItems);

  // 4) Apply resolved core fields to the response array.
  for (const m of movies) {
    if (typeof m["tmdbId"] !== "number") continue;
    const core = coreMap.get(m["tmdbId"] as number);
    if (!core) continue;
    if (core.tmdbRating !== undefined) m["tmdbRating"] = core.tmdbRating;
    if (core.voteCount !== undefined) m["voteCount"] = core.voteCount;
    if (core.popularity !== undefined) m["popularity"] = core.popularity;
    if (core.genreIds !== undefined) m["genreIds"] = core.genreIds;
    if (core.releaseDate !== undefined) m["releaseDate"] = core.releaseDate;
    if (core.franchiseIds !== undefined)
      m["franchiseIds"] = core.franchiseIds;
  }
}

// ── GET /movies/trending ──────────────────────────────────────────────────────
router.get(
  "/trending",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
    const isPage1 = page === 1;
    const lang = getUILang(req);
    const cacheKey = `trending-${lang}-p${page}`;

    if (isPage1) {
      const cached = await getCached(cacheKey, TRENDING_TTL_MS);
      if (cached) {
        const c = cached as { movies: Record<string, any>[]; totalPages: number; totalResults: number };
        await ensureMovieCores(c.movies);
        res.json({ movies: c.movies, page: 1, totalPages: c.totalPages, totalResults: c.totalResults });
        return;
      }
    }

    const data = await tmdbFetch<{
      results?: TMDBItem[];
      total_pages?: number;
      total_results?: number;
    }>("/trending/all/day", { language: lang, page: String(page) });

    const raw = (data.results || []).filter(
      (m) => m.media_type === "movie" || m.media_type === "tv",
    );
    const movieIds = raw.filter((m) => m.media_type === "movie").map((m) => m.id);
    const collectionMap = await fetchCollectionIds(movieIds);
    const movies = raw.map((m) =>
      normalizeItem(m, m.media_type as "movie" | "tv", collectionMap),
    );
    const totalPages = data.total_pages ?? 1;
    const totalResults = data.total_results ?? 0;

    await ensureMovieCores(movies as Record<string, any>[]);
    if (isPage1 && movies.length > 0) {
      await setCached(cacheKey, { movies, totalPages, totalResults });
    }
    res.json({ movies, page, totalPages, totalResults });
  }),
);

// ── GET /movies/top-rated (Legendary tier) ────────────────────────────────────
router.get(
  "/top-rated",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
    const cutoffYear = new Date().getFullYear() - 20;
    const lang = getUILang(req);

    const [movieData, tvData] = await Promise.all([
      tmdbFetch<{ results?: TMDBItem[]; total_pages?: number; total_results?: number }>(
        "/discover/movie",
        {
          language: lang,
          sort_by: "vote_average.desc",
          "vote_count.gte": "10000",
          "vote_average.gte": "8.3",
          "primary_release_date.lte": `${cutoffYear}-12-31`,
          include_adult: "false",
          page: String(page),
        },
      ),
      tmdbFetch<{ results?: TMDBItem[]; total_pages?: number; total_results?: number }>(
        "/discover/tv",
        {
          language: lang,
          sort_by: "vote_average.desc",
          "vote_count.gte": "5000",
          "vote_average.gte": "8.3",
          "first_air_date.lte": `${cutoffYear}-12-31`,
          include_adult: "false",
          page: String(page),
        },
      ),
    ]);

    const movieRaw = movieData.results || [];
    const tvRaw = (tvData.results || []).map((t) => ({
      ...t,
      media_type: "tv" as const,
    }));

    const collectionMap = await fetchCollectionIds(movieRaw.map((m) => m.id));
    const movieItems = movieRaw.map((m) => normalizeItem(m, "movie", collectionMap));
    const tvItems = tvRaw.map((t) => normalizeItem(t, "tv", new Map()));

    const validLegendary = [...movieItems, ...tvItems].filter((m) => {
      const rating = parseFloat(m.tmdbRating ?? "0");
      const yearStr = m.year ? parseInt(String(m.year)) : 0;
      const age = yearStr > 0 ? new Date().getFullYear() - yearStr : 0;
      return rating >= 8.3 && age >= 20;
    });
    const merged = validLegendary.sort(
      (a, b) =>
        parseFloat(b.tmdbRating ?? "0") - parseFloat(a.tmdbRating ?? "0"),
    );

    await ensureMovieCores(merged as Record<string, any>[]);
    res.json({
      movies: merged,
      page,
      totalPages: Math.max(movieData.total_pages ?? 1, tvData.total_pages ?? 1),
      totalResults:
        (movieData.total_results ?? 0) + (tvData.total_results ?? 0),
    });
  }),
);

// ── GET /movies/rare-finds (Cult Classic tier) ────────────────────────────────
router.get(
  "/rare-finds",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));

    const lang = getUILang(req);
    // Daily cache — cult classics don't change often
    const cacheKey = `rare-finds-${lang}-${todayStr()}-p${page}`;
    const cached = await getCached(cacheKey, MOOD_TTL_MS);
    if (cached) {
      const c = cached as { movies: Record<string, any>[] };
      await ensureMovieCores(c.movies);
      res.json(cached);
      return;
    }

    const cutoffYear = new Date().getFullYear() - 20;

    async function fetchCultPage(p: number) {
      return Promise.all([
        tmdbFetch<{ results?: TMDBItem[]; total_pages?: number; total_results?: number }>(
          "/discover/movie",
          {
            language: lang,
            sort_by: "vote_count.desc",
            "vote_count.gte": "1000",
            "vote_average.lte": "5.0",
            "primary_release_date.lte": `${cutoffYear}-12-31`,
            include_adult: "false",
            page: String(p),
          },
        ),
        tmdbFetch<{ results?: TMDBItem[]; total_pages?: number; total_results?: number }>(
          "/discover/tv",
          {
            language: lang,
            sort_by: "vote_count.desc",
            "vote_count.gte": "500",
            "vote_average.lte": "5.0",
            "first_air_date.lte": `${cutoffYear}-12-31`,
            include_adult: "false",
            page: String(p),
          },
        ),
      ]);
    }

    // Try a daily-rotated page; if it yields nothing, fall back to page 1
    const dailyPage = dailyStartPage(`rare-finds-p${page}`);
    let [movieData, tvData] = await fetchCultPage(dailyPage);
    const hasResults = (movieData.results?.length ?? 0) > 0 || (tvData.results?.length ?? 0) > 0;
    if (!hasResults && dailyPage > 1) {
      [movieData, tvData] = await fetchCultPage(page);
    }

    const movieRaw = movieData.results || [];
    const tvRaw = (tvData.results || []).map((t) => ({
      ...t,
      media_type: "tv" as const,
    }));

    const collectionMap = await fetchCollectionIds(movieRaw.map((m) => m.id));
    const movieItems = movieRaw.map((m) => normalizeItem(m, "movie", collectionMap));
    const tvItems = tvRaw.map((t) => normalizeItem(t, "tv", new Map()));

    const validCult = [...movieItems, ...tvItems].filter((m) => {
      const rating = parseFloat(m.tmdbRating ?? "0");
      const yearStr = m.year ? parseInt(String(m.year)) : 0;
      const age = yearStr > 0 ? new Date().getFullYear() - yearStr : 0;
      return rating <= 5.0 && age >= 20;
    });
    const merged = validCult.sort(
      (a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0),
    );

    await ensureMovieCores(merged as Record<string, any>[]);
    const result = {
      movies: merged,
      page,
      totalPages: Math.max(movieData.total_pages ?? 1, tvData.total_pages ?? 1),
      totalResults:
        (movieData.total_results ?? 0) + (tvData.total_results ?? 0),
    };
    await setCached(cacheKey, result);
    res.json(result);
  }),
);

// ── GET /movies/mood/:moodId ──────────────────────────────────────────────────
router.get(
  "/mood/:moodId",
  asyncHandler(async (req, res) => {
    const moodId = String(req.params["moodId"]);
    const page = Math.max(
      1,
      parseInt((req.query["page"] as string) || "1", 10),
    );
    const subFilter = ((req.query["subFilter"] as string) || "").trim();

    const cfg = MOOD_CFG[moodId];
    if (!cfg) throw new NotFoundError(`Mood '${moodId}'`);

    const subFilterFn = subFilter
      ? SUB_FILTER_URLS[moodId]?.[subFilter]
      : undefined;
    const urlFn = subFilterFn ?? cfg.urlA;
    const lang = getUILang(req);

    // Curated moods (those with cfg.limit) use daily rotation:
    // - cache the FULL pool per calendar day so all pages are served from one fetch
    // - paginate the pool into pages of 20 so infinite scroll works
    if (cfg.limit) {
      const PAGE_SIZE = 20;
      const poolCacheKey = `mood-pool-${moodId}-${subFilter || "main"}-${lang}-${todayStr()}`;
      let allMovies: Record<string, any>[];

      const cachedPool = await getCached(poolCacheKey, MOOD_TTL_MS);
      if (cachedPool && Array.isArray((cachedPool as any).allMovies)) {
        allMovies = (cachedPool as any).allMovies as Record<string, any>[];
      } else {
        const startPage = dailyStartPage(subFilter ? `${moodId}:${subFilter}` : moodId);
        const result = await fetchMoodMovies(cfg, urlFn, 1, startPage, lang);
        allMovies = result.movies as Record<string, any>[];
        await setCached(poolCacheKey, { allMovies });
      }

      const start = (page - 1) * PAGE_SIZE;
      const pageMovies = allMovies.slice(start, start + PAGE_SIZE);
      const totalPages = Math.max(1, Math.ceil(allMovies.length / PAGE_SIZE));

      await ensureMovieCores(pageMovies);
      res.json({ movies: pageMovies, page, totalPages, totalResults: allMovies.length });
      return;
    }

    // Non-curated moods (now_playing etc.): standard pagination.
    const result = await fetchMoodMovies(cfg, urlFn, page, 1, lang);

    // For now_playing: guard against TMDB community data errors where old movies
    // get tagged with incorrect recent Thai release dates. Any movie whose
    // release_date is more than 5 years old almost certainly isn't actually in
    // cinemas today — drop it so it doesn't confuse users.
    if (moodId === "now_playing") {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      result.movies = result.movies.filter(
        (m) => !m.releaseDate || m.releaseDate >= cutoffStr,
      );
    }

    await ensureMovieCores(result.movies as Record<string, any>[]);
    res.json(result);
  }),
);

// ── GET /movies/random?category=<id> ─────────────────────────────────────────
// Picks one random movie from the requested category (same logic as the
// category list endpoints). Returns { movie } or 404 if nothing found.
router.get(
  "/random",
  asyncHandler(async (req, res) => {
    const category = ((req.query["category"] as string) || "trending").trim();
    const lang = getUILang(req);
    const apiLang = lang === "th-TH" ? "th-TH" : "en-US";
    const langQs = lang === "th-TH" ? "th" : "en-US";

    // Helper: fetch a paged result from the right endpoint
    async function fetchPage(page: number): Promise<{ movies: Record<string, any>[]; totalPages: number }> {
      if (category === "trending") {
        const d = await tmdbFetch<{ results?: TMDBItem[]; total_pages?: number }>(
          "/trending/all/day", { language: apiLang, page: String(page) },
        );
        const raw = (d.results ?? []).filter(m => m.media_type === "movie" || m.media_type === "tv");
        const collMap = await fetchCollectionIds(raw.filter(m => m.media_type === "movie").map(m => m.id));
        return { movies: raw.map(m => normalizeItem(m, m.media_type as "movie" | "tv", collMap)) as Record<string, any>[], totalPages: d.total_pages ?? 1 };
      }
      if (category === "legendary") {
        const cutoffYear = new Date().getFullYear() - 20;
        const [md, tvd] = await Promise.all([
          tmdbFetch<{ results?: TMDBItem[]; total_pages?: number }>("/discover/movie", { language: apiLang, sort_by: "vote_average.desc", "vote_count.gte": "10000", "vote_average.gte": "8.3", "primary_release_date.lte": `${cutoffYear}-12-31`, include_adult: "false", page: String(page) }),
          tmdbFetch<{ results?: TMDBItem[]; total_pages?: number }>("/discover/tv",    { language: apiLang, sort_by: "vote_average.desc", "vote_count.gte": "5000",  "vote_average.gte": "8.3", "first_air_date.lte":     `${cutoffYear}-12-31`, include_adult: "false", page: String(page) }),
        ]);
        const collMap = await fetchCollectionIds((md.results ?? []).map(m => m.id));
        const movies = [
          ...(md.results ?? []).map(m => normalizeItem(m, "movie", collMap)),
          ...(tvd.results ?? []).map(m => normalizeItem({ ...m, media_type: "tv" as const }, "tv", new Map())),
        ];
        return { movies: movies as Record<string, any>[], totalPages: Math.max(md.total_pages ?? 1, tvd.total_pages ?? 1) };
      }
      if (category === "cult_classic") {
        const cutoffYear = new Date().getFullYear() - 20;
        const [md, tvd] = await Promise.all([
          tmdbFetch<{ results?: TMDBItem[]; total_pages?: number }>("/discover/movie", { language: apiLang, sort_by: "vote_count.desc", "vote_count.gte": "1000", "vote_average.lte": "5.0", "primary_release_date.lte": `${cutoffYear}-12-31`, include_adult: "false", page: String(page) }),
          tmdbFetch<{ results?: TMDBItem[]; total_pages?: number }>("/discover/tv",    { language: apiLang, sort_by: "vote_count.desc", "vote_count.gte": "500",  "vote_average.lte": "5.0", "first_air_date.lte":      `${cutoffYear}-12-31`, include_adult: "false", page: String(page) }),
        ]);
        const collMap = await fetchCollectionIds((md.results ?? []).map(m => m.id));
        const movies = [
          ...(md.results ?? []).map(m => normalizeItem(m, "movie", collMap)),
          ...(tvd.results ?? []).map(m => normalizeItem({ ...m, media_type: "tv" as const }, "tv", new Map())),
        ];
        return { movies: movies as Record<string, any>[], totalPages: Math.max(md.total_pages ?? 1, tvd.total_pages ?? 1) };
      }
      // All mood-based categories
      const cfg = MOOD_CFG[category];
      if (!cfg) throw new NotFoundError(`Category '${category}'`);
      const result = await fetchMoodMovies(cfg, cfg.urlA, page, 1, lang);
      return { movies: result.movies as Record<string, any>[], totalPages: result.totalPages ?? 1 };
    }

    // Discover how many pages exist (fetch page 1)
    const first = await fetchPage(1);
    if (first.movies.length === 0) {
      res.status(404).json({ error: "No movies found for this category" });
      return;
    }

    // Pick a random page (cap at 10 to keep response fast)
    const maxPage = Math.min(first.totalPages, 10);
    const randomPage = Math.floor(Math.random() * maxPage) + 1;
    const pool = randomPage === 1 ? first : await fetchPage(randomPage);
    const movies = pool.movies.length > 0 ? pool.movies : first.movies;

    // Pick one random movie
    const movie = movies[Math.floor(Math.random() * movies.length)];
    await ensureMovieCores([movie]);
    res.json({ movie, category, langQs });
  }),
);

// ── GET /movies/upcoming-feed ─────────────────────────────────────────────────
router.get(
  "/upcoming-feed",
  asyncHandler(async (req, res) => {
    const lang = getUILang(req);
    const cacheKey = `upcoming-feed-${lang}`;
    const cached = await getCached(cacheKey, UPCOMING_TTL_MS);
    if (cached) {
      res.json({ movies: cached });
      return;
    }

    const p1Data = await tmdbFetch<{ results?: TMDBItem[] }>("/movie/upcoming", {
      language: lang,
      region: "TH",
      page: "1",
    });

    const today = new Date().toISOString().slice(0, 10);
    const movies = (p1Data.results || []).filter(
      (m) => m.release_date && m.release_date >= today,
    );

    // Enrich with backdrops/trailer — data-augmentation, not filtering.
    const enriched = await Promise.all(movies.map(enrichUpcomingMovie));

    // Sort by release date ascending (nearest first).
    enriched.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate);
    });

    await setCached(cacheKey, enriched);
    res.json({ movies: enriched });
  }),
);

// ── GET /movies/news ──────────────────────────────────────────────────────────
router.get(
  "/news",
  asyncHandler(async (req, res) => {
    const [nowData, upcomingData] = await Promise.all([
      tmdbFetch<{ results?: TMDBItem[] }>("/movie/now_playing", {
        language: "en-US",
        region: "TH",
        page: "1",
      }),
      tmdbFetch<{ results?: TMDBItem[] }>("/movie/upcoming", {
        language: "en-US",
        region: "TH",
        page: "1",
      }),
    ]);

    const normalize = (item: TMDBItem, status: "now_playing" | "upcoming") => ({
      imdbId: `tmdb:${item.id}`,
      tmdbId: item.id,
      title: item.title || item.original_title || "",
      year: item.release_date?.slice(0, 4) ?? null,
      releaseDate: item.release_date ?? null,
      posterUrl: posterUrl(item.poster_path ?? null),
      tmdbRating: item.vote_average ? item.vote_average.toFixed(1) : null,
      voteCount: item.vote_count ?? 0,
      overview: item.overview || null,
      status,
    });

    const now = (nowData.results || []).map((m) => normalize(m, "now_playing"));
    const upcoming = (upcomingData.results || []).map((m) =>
      normalize(m, "upcoming"),
    );

    const seen = new Set<number>();
    const all = [...now, ...upcoming].filter((m) => {
      if (seen.has(m.tmdbId)) return false;
      seen.add(m.tmdbId);
      return true;
    });

    all.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate);
    });

    res.json({ movies: all });
  }),
);

// ── GET /movies/search ────────────────────────────────────────────────────────
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { query, page = "1" } = req.query;
    if (!query || typeof query !== "string") {
      throw new ValidationError("query is required");
    }
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    if (!normalizedQuery) throw new ValidationError("query is required");

    // Always derive language from the query script itself, never from the UI
    // language. This ensures titles/posters in search results are returned in
    // the language the user is typing in (e.g. "ゴジラ" → ja-JP), and those
    // values get snapshot into tickets/chains at creation time.
    const lang = detectLanguage(normalizedQuery);

    // Run title search AND person search in parallel. Person search catches
    // queries like "Cillian Murphy", "Christopher Nolan", "สการ์เล็ตต์ โจแฮนสัน".
    type PersonResult = { id: number; known_for_department?: string };
    const [data, personData] = await Promise.all([
      tmdbFetch<{ results?: TMDBItem[]; total_results?: number }>("/search/multi", {
        query: normalizedQuery,
        page: String(page),
        include_adult: "false",
        language: lang,
      }),
      // Only run person search on page 1 to avoid redundant calls
      Number(page) === 1
        ? tmdbFetch<{ results?: PersonResult[] }>("/search/person", {
            query: normalizedQuery,
            include_adult: "false",
            language: lang,
          }).catch(() => ({ results: [] as PersonResult[] }))
        : Promise.resolve({ results: [] as PersonResult[] }),
    ]);

    const raw = (data.results || []).filter(
      (m) => m.media_type === "movie" || m.media_type === "tv",
    );

    // If the top person result looks like a match, fetch their movie credits
    // and prepend those results so actor/director queries surface their films.
    const topPerson = personData.results?.[0];
    let personMovies: TMDBItem[] = [];
    if (topPerson && Number(page) === 1) {
      const dept = topPerson.known_for_department ?? "";
      const isDirector = dept === "Directing";
      const isCast = dept === "Acting" || !dept;
      try {
        const [castData, crewData] = await Promise.all([
          isCast
            ? tmdbFetch<{ cast?: TMDBItem[] }>(`/person/${topPerson.id}/movie_credits`, { language: lang })
                .catch(() => ({ cast: [] as TMDBItem[] }))
            : Promise.resolve({ cast: [] as TMDBItem[] }),
          isDirector
            ? tmdbFetch<{ crew?: TMDBItem[] }>(`/person/${topPerson.id}/movie_credits`, { language: lang })
                .catch(() => ({ crew: [] as TMDBItem[] }))
            : Promise.resolve({ crew: [] as TMDBItem[] }),
        ]);
        const castMovies = (castData.cast ?? [])
          .filter((m) => m.vote_count && m.vote_count > 50)
          .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
          .slice(0, 10)
          .map((m) => ({ ...m, media_type: "movie" as const }));
        const crewMovies = (crewData.crew ?? [])
          .filter((m) => m.job === "Director" || !m.job)
          .filter((m) => m.vote_count && m.vote_count > 50)
          .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
          .slice(0, 10)
          .map((m) => ({ ...m, media_type: "movie" as const }));
        personMovies = [...castMovies, ...crewMovies];
      } catch { /* ignore */ }
    }

    // Merge person movies first, then title results; deduplicate by TMDB id
    const allRaw = [...personMovies, ...raw];
    const seenIds = new Set<number>();
    const deduped = allRaw.filter((m) => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });

    const movieIds = deduped
      .filter((m) => m.media_type === "movie")
      .map((m) => m.id);
    const collectionMap = await fetchCollectionIds(movieIds);

    const movies = deduped.map((m) =>
      normalizeItem(m, m.media_type as "movie" | "tv", collectionMap),
    );

    // Enrich so search-result cards show the same rank as the detail page
    // does — without this, the card uses TMDB's stale search-index snapshot
    // (vote_average, vote_count) and never has franchiseIds, so the user
    // sees a wrong rank/effect until they open detail.
    await ensureMovieCores(movies as Record<string, any>[]);

    res.json({
      movies,
      totalResults: Math.max(data.total_results || 0, movies.length),
      page: Number(page),
    });
  }),
);

// ── GET /movies/bookmarked ────────────────────────────────────────────────────
router.get(
  "/bookmarked",
  asyncHandler(async (req, res) => {
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const rows = await db
      .select({
        movieId: movieBookmarksTable.movieId,
        createdAt: movieBookmarksTable.createdAt,
      })
      .from(movieBookmarksTable)
      .where(eq(movieBookmarksTable.userId, currentUserId))
      .orderBy(desc(movieBookmarksTable.createdAt));

    res.json({ movieIds: rows.map((r) => r.movieId) });
  }),
);

// ── GET /movies/:movieId/likes ────────────────────────────────────────────────
router.get(
  "/:movieId/likes",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;

    const [likeCountResult] = await db
      .select({ count: count() })
      .from(movieLikesTable)
      .where(eq(movieLikesTable.movieId, movieId));

    let isLiked = false;
    let followedLikers: {
      username: string | null;
      displayName: string | null;
    }[] = [];

    if (currentUserId) {
      const [liked] = await db
        .select()
        .from(movieLikesTable)
        .where(
          and(
            eq(movieLikesTable.userId, currentUserId),
            eq(movieLikesTable.movieId, movieId),
          ),
        )
        .limit(1);
      isLiked = !!liked;

      const following = await db
        .select({ followingId: followsTable.followingId })
        .from(followsTable)
        .where(eq(followsTable.followerId, currentUserId));

      if (following.length > 0) {
        const followingIds = following.map((f) => f.followingId);
        const likedByFollowed = await db
          .select({ userId: movieLikesTable.userId })
          .from(movieLikesTable)
          .where(
            and(
              eq(movieLikesTable.movieId, movieId),
              inArray(movieLikesTable.userId, followingIds),
            ),
          );

        if (likedByFollowed.length > 0) {
          const userIds = likedByFollowed.map((l) => l.userId);
          followedLikers = await db
            .select({
              username: usersTable.username,
              displayName: usersTable.displayName,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
            .limit(3);
        }
      }
    }

    res.json({
      likeCount: Number(likeCountResult?.count ?? 0),
      isLiked,
      followedLikers,
    });
  }),
);

// ── POST /movies/:movieId/like ────────────────────────────────────────────────
router.post(
  "/:movieId/like",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const [existing] = await db
      .select()
      .from(movieLikesTable)
      .where(
        and(
          eq(movieLikesTable.userId, currentUserId),
          eq(movieLikesTable.movieId, movieId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .delete(movieLikesTable)
        .where(
          and(
            eq(movieLikesTable.userId, currentUserId),
            eq(movieLikesTable.movieId, movieId),
          ),
        );
      res.json({ liked: false });
    } else {
      await db
        .insert(movieLikesTable)
        .values({ userId: currentUserId, movieId });
      res.json({ liked: true });
    }
  }),
);

// ── GET /movies/:movieId/movie-comments ──────────────────────────────────────
router.get(
  "/:movieId/movie-comments",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;
    const limit = Math.min(Number(req.query["limit"]) || 30, 50);

    const comments = await db
      .select()
      .from(movieCommentsTable)
      .where(eq(movieCommentsTable.movieId, movieId))
      .orderBy(desc(movieCommentsTable.createdAt))
      .limit(limit);

    let followingIds: string[] = [];
    if (currentUserId) {
      const following = await db
        .select({ followingId: followsTable.followingId })
        .from(followsTable)
        .where(eq(followsTable.followerId, currentUserId));
      followingIds = following.map((f) => f.followingId);
    }

    const result = await Promise.all(
      comments.map(async (comment) => {
        const [user] = await db
          .select({
            id: usersTable.id,
            username: usersTable.username,
            displayName: usersTable.displayName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(eq(usersTable.id, comment.userId))
          .limit(1);

        return {
          id: comment.id,
          content: comment.content,
          createdAt: comment.createdAt,
          isOwnComment: comment.userId === currentUserId,
          isFromFollowed: followingIds.includes(comment.userId),
          user: user ?? null,
        };
      }),
    );

    res.json({ comments: result });
  }),
);

// ── POST /movies/:movieId/movie-comments ─────────────────────────────────────
router.post(
  "/:movieId/movie-comments",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const { content } = req.body as { content?: string };
    if (!content || content.trim().length === 0) {
      throw new ValidationError("Content is required");
    }
    if (content.length > 500) {
      throw new ValidationError("Comment too long (max 500 characters)");
    }

    const id = crypto.randomUUID();
    await db.insert(movieCommentsTable).values({
      id,
      userId: currentUserId,
      movieId,
      content: content.trim(),
    });

    const [user] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);

    res.json({
      id,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      isOwnComment: true,
      isFromFollowed: false,
      user: user ?? null,
    });
  }),
);

// ── GET /movies/:movieId/social-status ───────────────────────────────────────
router.get(
  "/:movieId/social-status",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;

    const [likeResult] = await db
      .select({ count: count() })
      .from(movieLikesTable)
      .where(eq(movieLikesTable.movieId, movieId));
    const [commentResult] = await db
      .select({ count: count() })
      .from(movieCommentsTable)
      .where(eq(movieCommentsTable.movieId, movieId));

    let isLiked = false;
    let isBookmarked = false;

    if (currentUserId) {
      const [liked] = await db
        .select()
        .from(movieLikesTable)
        .where(
          and(
            eq(movieLikesTable.userId, currentUserId),
            eq(movieLikesTable.movieId, movieId),
          ),
        )
        .limit(1);
      isLiked = !!liked;

      const [bookmarked] = await db
        .select()
        .from(movieBookmarksTable)
        .where(
          and(
            eq(movieBookmarksTable.userId, currentUserId),
            eq(movieBookmarksTable.movieId, movieId),
          ),
        )
        .limit(1);
      isBookmarked = !!bookmarked;
    }

    res.json({
      likeCount: Number(likeResult?.count ?? 0),
      commentCount: Number(commentResult?.count ?? 0),
      isLiked,
      isBookmarked,
    });
  }),
);

// ── POST /movies/:movieId/bookmark ────────────────────────────────────────────
router.post(
  "/:movieId/bookmark",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;
    if (!currentUserId) throw new UnauthorizedError();

    const [existing] = await db
      .select()
      .from(movieBookmarksTable)
      .where(
        and(
          eq(movieBookmarksTable.userId, currentUserId),
          eq(movieBookmarksTable.movieId, movieId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .delete(movieBookmarksTable)
        .where(
          and(
            eq(movieBookmarksTable.userId, currentUserId),
            eq(movieBookmarksTable.movieId, movieId),
          ),
        );
      res.json({ bookmarked: false });
    } else {
      await db
        .insert(movieBookmarksTable)
        .values({ userId: currentUserId, movieId });
      res.json({ bookmarked: true });
    }
  }),
);

// ── GET /movies/:movieId/ratings-summary ─────────────────────────────────────
router.get(
  "/:movieId/ratings-summary",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const tickets = await db
      .select({ rating: ticketsTable.rating, ratingType: ticketsTable.ratingType })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.imdbId, movieId),
          isNull(ticketsTable.deletedAt),
        ),
      );

    let totalRating = 0;
    let count = 0;
    let positiveTotal = 0;
    let positiveCount = 0;

    for (const t of tickets) {
      const r = t.rating ? Math.min(Math.max(1, Math.round(Number(t.rating))), 5) : null;
      if (!r) continue;
      count++;
      if (t.ratingType === "blackhole") {
        // Dying star: each star subtracts from the community total
        totalRating -= r;
      } else {
        totalRating += r;
        positiveTotal += r;
        positiveCount++;
      }
    }

    res.json({
      total: count,
      totalStars: totalRating,
      average: positiveCount > 0 ? +(positiveTotal / positiveCount).toFixed(1) : null,
    });
  }),
);

// ── GET /movies/:movieId/community ────────────────────────────────────────────
router.get(
  "/:movieId/community",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const currentUserId = req.session?.userId;
    const limit = Math.min(Number(req.query["limit"]) || 20, 50);
    const POOL = limit * 4;

    // Fetch a larger pool — scoring will pick the best
    const rawTickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.imdbId, movieId),
          isNull(ticketsTable.deletedAt),
        ),
      )
      .orderBy(desc(ticketsTable.createdAt))
      .limit(POOL);

    if (rawTickets.length === 0) {
      res.json({ tickets: [], total: 0 });
      return;
    }

    const ticketIds = rawTickets.map((t) => t.id);

    // Bulk-fetch engagement counts + last activity timestamps (no N+1)
    const [likeRows, commentRows] = await Promise.all([
      db
        .select({ ticketId: likesTable.ticketId, n: count(), lastAt: max(likesTable.createdAt) })
        .from(likesTable)
        .where(inArray(likesTable.ticketId, ticketIds))
        .groupBy(likesTable.ticketId),
      db
        .select({ ticketId: commentsTable.ticketId, n: count(), lastAt: max(commentsTable.createdAt) })
        .from(commentsTable)
        .where(inArray(commentsTable.ticketId, ticketIds))
        .groupBy(commentsTable.ticketId),
    ]);

    const likeMap         = new Map(likeRows.map((r) => [r.ticketId, Number(r.n)]));
    const commentMap      = new Map(commentRows.map((r) => [r.ticketId, Number(r.n)]));
    const likeLastAtMap   = new Map(likeRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));
    const cmtLastAtMap    = new Map(commentRows.map((r) => [r.ticketId, r.lastAt ? new Date(r.lastAt) : null]));

    // Universal hot score — same formula used across all feeds
    //   lastActivityAt = most recent like OR comment (or post creation)
    const scored = rawTickets.map((t) => {
      const likeAt    = likeLastAtMap.get(t.id);
      const commentAt = cmtLastAtMap.get(t.id);
      const lastActivityAt = [t.createdAt, likeAt, commentAt]
        .filter((d): d is Date => d instanceof Date)
        .reduce((a, b) => (a > b ? a : b), t.createdAt);
      return {
        ticket: t,
        score: hotScore({ likes: likeMap.get(t.id) ?? 0, comments: commentMap.get(t.id) ?? 0, lastActivityAt }),
      };
    });

    scored.sort((a, b) => {
      const aTime = (a.ticket.createdAt instanceof Date ? a.ticket.createdAt : new Date(a.ticket.createdAt)).getTime();
      const bTime = (b.ticket.createdAt instanceof Date ? b.ticket.createdAt : new Date(b.ticket.createdAt)).getTime();
      return bTime - aTime;
    });
    const topTickets = scored.slice(0, limit).map((s) => s.ticket);

    // Resolve users
    const userIds = [...new Set(topTickets.map((t) => t.userId))];
    const [users, followRows] = await Promise.all([
      db.select().from(usersTable).where(inArray(usersTable.id, userIds)),
      currentUserId && userIds.length > 0
        ? db.select({ followingId: followsTable.followingId })
            .from(followsTable)
            .where(and(eq(followsTable.followerId, currentUserId), inArray(followsTable.followingId, userIds)))
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const followingSet = new Set((followRows as { followingId: string }[]).map(r => r.followingId));

    const result = topTickets.map((ticket) => {
      const user = userMap.get(ticket.userId);
      const isUserPrivate = user?.isPrivate ?? false;
      const isFollowedByMe = followingSet.has(ticket.userId) || ticket.userId === currentUserId;
      return {
        id: ticket.id,
        userId: ticket.userId,
        user: user
          ? {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              isPrivate: user.isPrivate,
            }
          : null,
        isUserPrivate,
        isFollowedByMe,
        isPrivate: ticket.isPrivate,
        rating: ticket.rating ? Number(ticket.rating) : null,
        ratingType: ticket.ratingType,
        rankTier: ticket.rankTier,
        currentRankTier: ticket.currentRankTier,
        isPrivateMemory: ticket.isPrivateMemory,
        memoryNote: ticket.isPrivateMemory ? null : ticket.memoryNote,
        caption: ticket.caption,
        captionAlign: ticket.captionAlign,
        episodeLabel: ticket.episodeLabel,
        watchedAt: ticket.hideWatchedAt ? null : ticket.watchedAt,
        createdAt: ticket.createdAt,
        isSpoiler: ticket.isSpoiler === true,
      };
    });

    res.json({ tickets: result, total: result.length });
  }),
);

// ── GET /movies/:movieId/collection ──────────────────────────────────────────
router.get(
  "/:movieId/collection",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    // Prefer explicit ?lang= query param (from frontend passing apiLang),
    // then fall back to x-ui-lang header. Also support ?srclang= to map
    // the original search language to a TMDB locale.
    const srclangQ = typeof req.query["srclang"] === "string" ? req.query["srclang"] : "";
    const langQ    = typeof req.query["lang"] === "string" ? req.query["lang"] : "";
    const lang: string = srclangQ
      ? originalLangToLocale(srclangQ)
      : (langQ || getUILang(req));

    let tmdbId: number | null = null;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      try {
        const findData = await tmdbFetch<{
          movie_results?: Array<{ id: number }>;
          tv_results?: Array<{ id: number }>;
        }>(`/find/${encodeURIComponent(movieId)}`, { external_source: "imdb_id" });
        if (findData.tv_results?.length) {
          tmdbId = findData.tv_results[0]!.id;
          isTv = true;
        } else if (findData.movie_results?.length) {
          tmdbId = findData.movie_results[0]!.id;
        }
      } catch {
        res.json({ movies: [], collectionName: null });
        return;
      }
    }

    if (!tmdbId) {
      res.json({ movies: [], collectionName: null });
      return;
    }

    try {
      // ── TV Show: use recommendations to find related/spinoff series ──────────
      if (isTv) {
        let relatedShows: Array<{ id: number; name?: string; poster_path?: string | null; first_air_date?: string }> = [];
        try {
          const [recData, recData2, simData, simData2] = await Promise.all([
            tmdbFetch<{ results?: typeof relatedShows }>(
              `/tv/${tmdbId}/recommendations`, { language: lang, page: "1" }
            ).catch(() => ({ results: [] })),
            tmdbFetch<{ results?: typeof relatedShows }>(
              `/tv/${tmdbId}/recommendations`, { language: lang, page: "2" }
            ).catch(() => ({ results: [] })),
            tmdbFetch<{ results?: typeof relatedShows }>(
              `/tv/${tmdbId}/similar`, { language: lang, page: "1" }
            ).catch(() => ({ results: [] })),
            tmdbFetch<{ results?: typeof relatedShows }>(
              `/tv/${tmdbId}/similar`, { language: lang, page: "2" }
            ).catch(() => ({ results: [] })),
          ]);
          const recResults = [...(recData.results ?? []), ...(recData2.results ?? [])];
          const simResults = [...(simData.results ?? []), ...(simData2.results ?? [])];
          const seen = new Set<number>([tmdbId]);
          const combined: typeof relatedShows = [];
          for (const s of [...recResults, ...simResults]) {
            if (!seen.has(s.id) && s.name) { seen.add(s.id); combined.push(s); }
          }
          relatedShows = combined.slice(0, 20);
        } catch { /* ignore */ }

        const spinoffs = relatedShows.map((s, idx) => ({
          imdbId: `tmdb_tv:${s.id}`,
          tmdbId: s.id,
          title: s.name ?? "",
          year: (s.first_air_date ?? "").slice(0, 4) || null,
          releaseDate: s.first_air_date ?? null,
          posterUrl: s.poster_path ? posterUrl(s.poster_path) : null,
          isCurrent: false,
          collectionIndex: idx,
          isSpinoff: true,
        })).filter(s => s.title);

        res.json({ movies: spinoffs, collectionName: lang === "th" ? "ซีรีส์ที่เกี่ยวข้อง" : "Related Shows" });
        return;
      }

      // ── Movie: get collection parts + recommendations (curated related) ──────
      const movieData = await tmdbFetch<{
        belongs_to_collection?: { id: number; name: string } | null;
      }>(`/movie/${tmdbId}`, { language: lang });

      if (!movieData.belongs_to_collection) {
        // No collection — fetch recommendations + similar as spinoffs
        type RecMovie = { id: number; title?: string; poster_path?: string | null; release_date?: string };
        let combined: RecMovie[] = [];
        try {
          const [recData, simData] = await Promise.all([
            tmdbFetch<{ results?: RecMovie[] }>(`/movie/${tmdbId}/recommendations`, { language: lang, page: "1" }).catch(() => ({ results: [] as RecMovie[] })),
            tmdbFetch<{ results?: RecMovie[] }>(`/movie/${tmdbId}/similar`, { language: lang, page: "1" }).catch(() => ({ results: [] as RecMovie[] })),
          ]);
          const seen = new Set<number>([tmdbId]);
          for (const r of [...(recData.results ?? []), ...(simData.results ?? [])]) {
            if (!seen.has(r.id) && r.title) { seen.add(r.id); combined.push(r); }
          }
          combined = combined.slice(0, 15);
        } catch { /* ignore */ }

        if (combined.length === 0) {
          res.json({ movies: [], collectionName: null });
          return;
        }

        const spinoffs = combined.map((s, idx) => ({
          imdbId: `tmdb:${s.id}`,
          tmdbId: s.id,
          title: s.title ?? "",
          year: (s.release_date ?? "").slice(0, 4) || null,
          releaseDate: s.release_date ?? null,
          posterUrl: s.poster_path ? posterUrl(s.poster_path) : null,
          isCurrent: false,
          collectionIndex: idx,
          isSpinoff: true,
        }));

        res.json({ movies: spinoffs, collectionName: lang === "th" ? "ที่แนะนำ" : "Recommended" });
        return;
      }

      const collectionId = movieData.belongs_to_collection.id;
      const collectionName = movieData.belongs_to_collection.name;

      const [collectionData, recData, simData] = await Promise.all([
        tmdbFetch<{
          parts?: Array<{
            id: number;
            title?: string;
            poster_path?: string | null;
            release_date?: string;
            order?: number;
          }>;
        }>(`/collection/${collectionId}`, { language: lang }),
        tmdbFetch<{
          results?: Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string }>;
        }>(`/movie/${tmdbId}/recommendations`, { language: lang, page: "1" }).catch(() => ({ results: [] as Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string }> })),
        tmdbFetch<{
          results?: Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string }>;
        }>(`/movie/${tmdbId}/similar`, { language: lang, page: "1" }).catch(() => ({ results: [] as Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string }> })),
      ]);

      const rawParts = collectionData.parts ?? [];

      // Collection parts — use TMDB's `order` field (story/canonical order).
      // TMDB returns parts sorted by release date but the `order` field holds
      // the in-universe position (e.g. Star Wars Ep I = order 0, Ep IV = order 3).
      const movies = rawParts
        .map((p, idx) => ({
          imdbId: `tmdb:${p.id}`,
          tmdbId: p.id,
          title: p.title ?? "",
          year: (p.release_date ?? "").slice(0, 4) || null,
          releaseDate: p.release_date ?? null,
          posterUrl: p.poster_path ? posterUrl(p.poster_path) : null,
          isCurrent: p.id === tmdbId,
          collectionIndex: p.order ?? idx,
          isSpinoff: false,
        }))
        .filter(p => p.title);

      // Add recommended + similar movies not already in collection as spinoffs
      const collectionTmdbIds = new Set([...rawParts.map(p => p.id), tmdbId]);
      const seenSpinoffIds = new Set(collectionTmdbIds);
      const spinoffSources: Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string }> = [];
      for (const s of [...(recData.results ?? []), ...(simData.results ?? [])]) {
        if (!seenSpinoffIds.has(s.id) && s.title) { seenSpinoffIds.add(s.id); spinoffSources.push(s); }
      }
      const spinoffs = spinoffSources.slice(0, 15)
        .map((s, idx) => ({
          imdbId: `tmdb:${s.id}`,
          tmdbId: s.id,
          title: s.title ?? "",
          year: (s.release_date ?? "").slice(0, 4) || null,
          releaseDate: s.release_date ?? null,
          posterUrl: s.poster_path ? posterUrl(s.poster_path) : null,
          isCurrent: false,
          collectionIndex: rawParts.length + idx,
          isSpinoff: true,
        }));

      res.json({ movies: [...movies, ...spinoffs], collectionName });
    } catch {
      res.json({ movies: [], collectionName: null });
    }
  }),
);

// ── GET /movies/:movieId/backdrops ────────────────────────────────────────────
router.get(
  "/:movieId/backdrops",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);

    let tmdbId: number;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
        tv_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (findData.tv_results?.length) {
        tmdbId = findData.tv_results[0]!.id;
        isTv = true;
      } else if (findData.movie_results?.length) {
        tmdbId = findData.movie_results[0]!.id;
      } else {
        res.json({ backdrops: [] });
        return;
      }
    }

    const data = await tmdbFetch<{ backdrops?: Array<{ file_path: string }> }>(
      `/${isTv ? "tv" : "movie"}/${tmdbId}/images`,
      { include_image_language: "en,null" },
    );

    const backdrops = (data.backdrops ?? [])
      .slice(0, 10)
      .map((b) => `${TMDB_IMG_WIDE}${b.file_path}`);

    res.json({ backdrops });
  }),
);

// ── GET /movies/:movieId/videos ───────────────────────────────────────────────
router.get(
  "/:movieId/videos",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);

    let tmdbId: number;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
        tv_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (findData.tv_results?.length) {
        tmdbId = findData.tv_results[0]!.id;
        isTv = true;
      } else if (findData.movie_results?.length) {
        tmdbId = findData.movie_results[0]!.id;
      } else {
        throw new NotFoundError("Movie");
      }
    }

    const vidsData = await tmdbFetch<{
      results?: Array<{
        key: string;
        site: string;
        type: string;
        official: boolean;
        name: string;
      }>;
    }>(`/${isTv ? "tv" : "movie"}/${tmdbId}/videos`, { language: "en-US" });

    const ytVideos = (vidsData.results ?? []).filter(
      (v) => v.site === "YouTube",
    );
    const trailer =
      ytVideos.find((v) => v.type === "Trailer" && v.official) ??
      ytVideos.find((v) => v.type === "Trailer") ??
      ytVideos[0] ??
      null;

    res.json({
      trailerKey: trailer?.key ?? null,
      trailerName: trailer?.name ?? null,
    });
  }),
);

// ── GET /movies/:movieId/seasons — TV episode list with ratings ───────────────
router.get(
  "/:movieId/seasons",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);

    let tmdbId: number;
    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      res.json({ seasons: [] });
      return;
    }

    const lang = getUILang(req);

    // Fetch TV series overview to get season count + season list
    const overview = await tmdbFetch<{
      number_of_seasons?: number;
      seasons?: Array<{
        id: number;
        season_number: number;
        name: string;
        episode_count: number;
        air_date?: string | null;
        poster_path?: string | null;
      }>;
    }>(`/tv/${tmdbId}`, { language: lang });

    const rawSeasons = (overview.seasons ?? []).filter(
      (s) => s.season_number > 0,
    );

    // Fetch all seasons in parallel (limit concurrency for large shows)
    const MAX = 10; // fetch at most 10 seasons
    const seasonsToFetch = rawSeasons.slice(0, MAX);

    const seasonDetails = await Promise.all(
      seasonsToFetch.map((s) =>
        tmdbFetch<{
          season_number: number;
          name: string;
          episodes?: Array<{
            episode_number: number;
            name: string;
            air_date?: string | null;
            vote_average?: number;
            vote_count?: number;
            runtime?: number | null;
          }>;
        }>(`/tv/${tmdbId}/season/${s.season_number}`, { language: lang }),
      ),
    );

    res.json({
      seasons: seasonDetails.map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        episodes: (s.episodes ?? []).map((ep) => ({
          episodeNumber: ep.episode_number,
          name: ep.name,
          airDate: ep.air_date ?? null,
          rating: ep.vote_average ?? null,
          voteCount: ep.vote_count ?? 0,
          runtime: ep.runtime ?? null,
        })),
      })),
    });
  }),
);

// ── GET /movies/:movieId/tunefind — soundtrack with scene descriptions ────────
router.get(
  "/:movieId/tunefind",
  asyncHandler(async (req, res) => {
    const title = typeof req.query["title"] === "string" ? req.query["title"] : "";
    const year  = typeof req.query["year"]  === "string" ? req.query["year"]  : "";
    const mediaType = typeof req.query["mediaType"] === "string" ? req.query["mediaType"] : "movie";
    const isTv = mediaType === "tv";

    if (!title) {
      res.json({ songs: [] });
      return;
    }

    // Build slug: TV shows don't use year in slug, movies do
    const baseSlug = title
      .toLowerCase()
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const slug = isTv ? baseSlug : baseSlug + (year ? `-${year}` : "");
    const baseUrl = `https://www.tunefind.com/${isTv ? "show" : "movie"}/${slug}`;

    // ── Shared curl helper ──────────────────────────────────────────────────
    const fetchHtml = async (
      pageUrl: string,
      opts: { saveCookies?: string; loadCookies?: string; referer?: string } = {}
    ): Promise<string> => {
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const exec = promisify(execFile);
        const args: string[] = [
          "-s", "--compressed", "--max-time", "12",
          "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "-H", "Accept-Language: en-US,en;q=0.9",
          "-H", "Accept-Encoding: gzip, deflate, br",
          "-H", "Cache-Control: no-cache",
          "-H", "Pragma: no-cache",
          "-H", "Sec-Fetch-Dest: document",
          "-H", "Sec-Fetch-Mode: navigate",
          "-H", "Sec-Fetch-Site: none",
          "-H", "Sec-Fetch-User: ?1",
          "-H", "Upgrade-Insecure-Requests: 1",
        ];
        if (opts.saveCookies) args.push("-c", opts.saveCookies);
        if (opts.loadCookies) args.push("-b", opts.loadCookies);
        if (opts.referer) args.push("-H", `Referer: ${opts.referer}`);
        args.push(pageUrl);
        const { stdout } = await exec("curl", args, { maxBuffer: 10 * 1024 * 1024, timeout: 15_000 });
        return stdout;
      } catch {
        return "";
      }
    };

    // Robust JSON extractor using bracket counting — regex with *? is non-greedy
    // and cuts nested objects short, causing JSON.parse to fail silently.
    const parseRemixCtx = (html: string): { state?: { loaderData?: Record<string, unknown> } } | null => {
      const marker = "window.__remixContext = ";
      const start = html.indexOf(marker);
      if (start === -1) return null;
      const jsonStart = html.indexOf("{", start + marker.length);
      if (jsonStart === -1) return null;
      let depth = 0, inString = false, escaped = false, i = jsonStart;
      for (; i < html.length; i++) {
        const c = html[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\" && inString) { escaped = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
      }
      try { return JSON.parse(html.slice(jsonStart, i + 1)); }
      catch { return null; }
    };

    type RawSong = { name: string; description?: string | null; artists: Array<{ name: string }> };
    type RawSoundtrack = { songs?: RawSong[] };

    let allSongs: RawSong[] = [];

    if (!isTv) {
      // ── MOVIE: use cookie jar (same approach as TV) to handle Cloudflare ──
      const { randomUUID } = await import("crypto");
      const { tmpdir } = await import("os");
      const { unlink } = await import("fs/promises");
      const cookieJar = `${tmpdir()}/tunefind-movie-${randomUUID()}.txt`;

      // Warmup: fetch main page and save cookies
      const warmupHtml = await fetchHtml(baseUrl, { saveCookies: cookieJar });
      // Use cookies on all subsequent page fetches
      for (let page = 1; page <= 10; page++) {
        const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
        const html = page === 1 ? warmupHtml : await fetchHtml(pageUrl, { loadCookies: cookieJar, saveCookies: cookieJar, referer: baseUrl });
        const ctx = parseRemixCtx(html);
        if (!ctx) break;
        const loaderData = ctx.state?.loaderData ?? {};
        let found = false;
        for (const val of Object.values(loaderData)) {
          const v = val as Record<string, unknown>;
          const apiData = v?.apiData as { songs?: RawSong[] } | null;
          if (apiData?.songs?.length) {
            allSongs = [...allSongs, ...apiData.songs];
            found = true;
            break;
          }
        }
        if (!found) break;
      }
      await unlink(cookieJar).catch(() => {});
    } else {
      // ── TV SHOW: main page has no songs; seasons are at /show/{slug}/season-{N} ──
      const { randomUUID } = await import("crypto");
      const { tmpdir } = await import("os");
      const { unlink } = await import("fs/promises");
      const cookieJar = `${tmpdir()}/tunefind-${randomUUID()}.txt`;

      // Step 1: fetch main page to discover season numbers (and save cookies)
      const mainHtml = await fetchHtml(baseUrl, { saveCookies: cookieJar });
      
      // Extract season numbers specifically for this show's slug
      const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const seasonRe = new RegExp(`href="/${isTv ? "show" : "movie"}/${escapedSlug}/season-(\\d+)"`, "g");
      const seasonNums = [...new Set(
        [...mainHtml.matchAll(seasonRe)].map(m => parseInt(m[1], 10))
      )].sort((a, b) => a - b);

      if (seasonNums.length === 0) {
        await unlink(cookieJar).catch(() => {});
        res.json({ songs: [], slug });
        return;
      }

      // Step 2: fetch season pages sequentially (CF blocks parallel requests)
      const seasonHtmls: string[] = [];
      for (const n of seasonNums) {
        const html = await fetchHtml(`${baseUrl}/season-${n}`, {
          loadCookies: cookieJar,
          saveCookies: cookieJar,
          referer: baseUrl,
        });
        seasonHtmls.push(html);
        // Delay to avoid CF rate-limiting between sequential requests
        await new Promise(r => setTimeout(r, 1200));
      }
      
      await unlink(cookieJar).catch(() => {});

      // Step 3: extract songs from each season's soundtracks
      for (const html of seasonHtmls) {
        const ctx = parseRemixCtx(html);
        if (!ctx) continue;
        const loaderData = ctx.state?.loaderData ?? {};
        for (const val of Object.values(loaderData)) {
          const v = val as Record<string, unknown>;
          const apiData = v?.apiData as { soundtracks?: RawSoundtrack[] } | null;
          if (apiData?.soundtracks?.length) {
            for (const st of apiData.soundtracks) {
              if (st.songs?.length) allSongs = [...allSongs, ...st.songs];
            }
          }
        }
      }
    }

    if (allSongs.length === 0) {
      res.json({ songs: [], slug });
      return;
    }

    // Deduplicate by name+artists
    const seen = new Set<string>();
    const unique = allSongs.filter((s) => {
      const key = `${s.name}|${s.artists.map((a) => a.name).join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: songs with descriptions first
    const withDesc = unique.filter((s) => s.description);
    const withoutDesc = unique.filter((s) => !s.description);
    const sorted = [...withDesc, ...withoutDesc];

    res.json({
      slug,
      songs: sorted.map((s) => ({
        name:        s.name,
        artists:     s.artists.map((a) => a.name).join(", "),
        description: s.description ?? null,
      })),
    });
  }),
);

// ── GET /movies/detect — keyword + filter-based discovery (Movie Detective) ───
router.get(
  "/detect",
  asyncHandler(async (req, res) => {
    const page     = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
    const genres   = (req.query["genres"] as string) || "";
    const decade   = (req.query["decade"] as string) || "";
    const origLang = (req.query["lang"] as string) || "";
    const country  = (req.query["country"] as string) || "";
    const query    = (req.query["query"] as string) || "";
    const srclang  = (req.query["srclang"] as string) || "";
    const uiLang   = getUILang(req);

    // Map srclang (from detectSearchLang on client) → TMDB language code
    const SRCLANG_TO_TMDB: Record<string, string> = {
      "th":    "th-TH",
      "ja":    "ja",
      "ko":    "ko-KR",
      "zh-TW": "zh-TW",
      "zh":    "zh-CN",
      "ar":    "ar",
      "ru":    "ru",
      "hi":    "hi-IN",
      "en-US": "en-US",
    };
    // Keyword present → titles follow keyword language; filter-only → follow UI language
    const tmdbLang = (query && srclang)
      ? (SRCLANG_TO_TMDB[srclang] ?? srclang)
      : uiLang;

    if (!genres && !decade && !origLang && !country && !query) {
      res.status(400).json({ error: "bad_request", message: "at least one filter or keyword required" });
      return;
    }

    let raw: TMDBItem[] = [];
    let totalPages = 1;
    let totalResults = 0;

    if (query) {
      // Run person search and movie title search in parallel
      type PersonResult = { id: number; name: string; popularity: number; known_for_department?: string };
      const [personData, movieData] = await Promise.all([
        tmdbFetch<{ results?: PersonResult[] }>("/search/person", {
          query,
          include_adult: "false",
        }),
        tmdbFetch<{ results?: TMDBItem[]; total_pages?: number; total_results?: number }>(
          "/search/movie",
          { query, language: tmdbLang, include_adult: "false", page: String(page) }
        ),
      ]);

      const topPerson = personData.results?.[0];
      const isPersonSearch =
        !!topPerson &&
        topPerson.popularity > 3 &&
        ["Acting", "Directing", "Production"].includes(topPerson.known_for_department ?? "");

      if (isPersonSearch) {
        // Discover movies by cast/crew — supports all server-side filters
        const dp: Record<string, string> = {
          sort_by: "popularity.desc",
          include_adult: "false",
          language: tmdbLang,
          "vote_count.gte": "10",
          page: String(page),
        };
        if (topPerson.known_for_department === "Directing") {
          dp["with_crew"] = String(topPerson.id);
        } else {
          dp["with_cast"] = String(topPerson.id);
        }
        if (genres)   dp["with_genres"] = genres;
        if (origLang) dp["with_original_language"] = origLang;
        if (country)  dp["with_origin_country"] = country;
        if (decade) {
          const base = parseInt(decade.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(base)) {
            dp["primary_release_date.gte"] = `${base}-01-01`;
            dp["primary_release_date.lte"] = `${base + 9}-12-31`;
          }
        }
        const discoverData = await tmdbFetch<{
          results?: TMDBItem[];
          total_pages?: number;
          total_results?: number;
        }>("/discover/movie", dp);
        raw = discoverData.results ?? [];
        totalPages = discoverData.total_pages ?? 1;
        totalResults = discoverData.total_results ?? 0;
      } else {
        // Title / keyword search — client-side filter by decade/genre/lang
        raw = movieData.results ?? [];
        totalPages = movieData.total_pages ?? 1;
        totalResults = movieData.total_results ?? 0;

        if (decade) {
          const base = parseInt(decade.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(base)) {
            raw = raw.filter((m) => {
              const year = parseInt((m.release_date ?? "").slice(0, 4), 10);
              return !isNaN(year) && year >= base && year <= base + 9;
            });
          }
        }
        if (genres) {
          const genreIds = genres.split(",").map(Number).filter(Boolean);
          raw = raw.filter((m) => m.genre_ids?.some((g) => genreIds.includes(g)));
        }
        if (origLang) {
          raw = raw.filter((m) => m.original_language === origLang);
        }
      }
    } else {
      const params: Record<string, string> = {
        language: tmdbLang,
        sort_by: "popularity.desc",
        include_adult: "false",
        "vote_count.gte": "50",
        page: String(page),
      };
      if (genres) params["with_genres"] = genres;
      if (decade) {
        const base = parseInt(decade.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(base)) {
          params["primary_release_date.gte"] = `${base}-01-01`;
          params["primary_release_date.lte"] = `${base + 9}-12-31`;
        }
      }
      if (origLang) params["with_original_language"] = origLang;
      if (country)  params["with_origin_country"] = country;

      const data = await tmdbFetch<{
        results?: TMDBItem[];
        total_pages?: number;
        total_results?: number;
      }>("/discover/movie", params);

      raw = data.results ?? [];
      totalPages = data.total_pages ?? 1;
      totalResults = data.total_results ?? 0;
    }

    const movieIds = raw.map((m) => m.id);
    const collectionMap = await fetchCollectionIds(movieIds);
    const movies = raw.map((m) => normalizeItem(m, "movie", collectionMap));

    res.json({ movies, page, totalPages, totalResults });
  }),
);

// ── GET /movies/core — batch rank-relevant fields ────────────────────────────
// Returns ONLY the fields needed for badge/rank computation, keyed by imdbId.
// Mounted before /:movieId so the parameter route doesn't swallow it.
//
// Why this exists:
//   The trending/category/search list endpoints return tmdbRating that can be
//   slightly different from the per-movie /movie/:id endpoint, and they don't
//   include franchiseIds (collection_id) needed for FR / LEGENDARY tiers.
//   The client uses this batch endpoint to seed the React Query cache for all
//   visible cards in one round-trip so badges show the correct rank IMMEDIATELY
//   without the user needing to open the detail page first.
router.get(
  "/core",
  asyncHandler(async (req, res) => {
    const idsParam = String(req.query["ids"] ?? "").trim();
    if (!idsParam) { res.json({ cores: {} }); return; }

    const rawIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
    const resolved = rawIds
      .map((id) => {
        if (id.startsWith("tmdb_tv:")) {
          const n = parseInt(id.slice(8), 10);
          return isNaN(n) ? null : { imdbId: id, tmdbId: n, isTv: true };
        }
        if (id.startsWith("tmdb:")) {
          const n = parseInt(id.slice(5), 10);
          return isNaN(n) ? null : { imdbId: id, tmdbId: n, isTv: false };
        }
        if (/^\d+$/.test(id)) {
          return { imdbId: id, tmdbId: parseInt(id, 10), isTv: false };
        }
        return null;
      })
      .filter((x): x is { imdbId: string; tmdbId: number; isTv: boolean } => x !== null);

    if (resolved.length === 0) { res.json({ cores: {} }); return; }

    // 1) Read fresh cores from the shared movie_core cache.
    const cacheKeys = resolved.map((r) => `movie_core:${r.tmdbId}`);
    const rows = await db
      .select({
        cacheKey: apiCacheTable.cacheKey,
        data: apiCacheTable.data,
        fetchedAt: apiCacheTable.fetchedAt,
      })
      .from(apiCacheTable)
      .where(inArray(apiCacheTable.cacheKey, cacheKeys));

    const now = Date.now();
    const coreByTmdbId = new Map<number, MovieCore>();
    for (const row of rows) {
      if (now - new Date(row.fetchedAt).getTime() < MOVIE_CORE_TTL_MS) {
        const tmdbId = parseInt(row.cacheKey.replace("movie_core:", ""), 10);
        if (!isNaN(tmdbId)) coreByTmdbId.set(tmdbId, row.data as MovieCore);
      }
    }

    // 2) For missing items, fetch from TMDB in parallel batches and persist.
    const missing = resolved.filter((r) => !coreByTmdbId.has(r.tmdbId));
    for (let i = 0; i < missing.length; i += 8) {
      const batch = missing.slice(i, i + 8);
      await Promise.allSettled(
        batch.map(async (m) => {
          try {
            const path = m.isTv ? `/tv/${m.tmdbId}` : `/movie/${m.tmdbId}`;
            const data = await tmdbFetch<{
              vote_average?: number;
              vote_count?: number;
              popularity?: number;
              genres?: { id: number }[];
              release_date?: string;
              first_air_date?: string;
              belongs_to_collection?: { id: number } | null;
            }>(path, { language: "en-US" });
            const core: MovieCore = {
              tmdbRating:
                data.vote_average != null ? data.vote_average.toFixed(1) : null,
              voteCount: data.vote_count ?? 0,
              popularity: data.popularity ?? 0,
              genreIds: (data.genres ?? []).map((g) => g.id),
              releaseDate: data.release_date ?? data.first_air_date ?? null,
              franchiseIds: data.belongs_to_collection
                ? [data.belongs_to_collection.id]
                : [],
            };
            coreByTmdbId.set(m.tmdbId, core);
            setMovieCore(m.tmdbId, core);
          } catch {
            /* silent — this movie just won't get a core */
          }
        }),
      );
    }

    // 3) Build response keyed by imdbId.
    const cores: Record<string, MovieCore> = {};
    for (const r of resolved) {
      const c = coreByTmdbId.get(r.tmdbId);
      if (c) cores[r.imdbId] = c;
    }
    res.json({ cores });
  }),
);

// ── GET /movies/:movieId — full detail ────────────────────────────────────────
router.get(
  "/:movieId",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const uiLang = getUILang(req);

    // If the caller came from a search result, they pass ?srclang= with the
    // detected search language. Overview should be in that language. Otherwise
    // (viewing via someone else's card/chain) use the viewer's UI language.
    const srclangParam = typeof req.query["srclang"] === "string" ? req.query["srclang"] : null;
    // Optional explicit override for title + overview (used by the in-page
    // language toggle on the movie detail screen). Accepts "th" or "en"/"en-US".
    // When present, BOTH title/poster and overview are forced to this locale.
    const rawForceLang = typeof req.query["forceLang"] === "string" ? req.query["forceLang"] : "";
    const forceLang: string | null =
      rawForceLang === "th" ? "th" :
      (rawForceLang === "en" || rawForceLang === "en-US") ? "en-US" :
      null;
    const overviewLang: string = forceLang ?? (srclangParam ? originalLangToLocale(srclangParam) : uiLang);

    // Cache key includes both UI lang (for genres) and overview lang.
    const cacheKey = `movie_detail:${movieId}:ui:${uiLang}:ovl:${overviewLang}:slc:${srclangParam ?? ""}:fl:${forceLang ?? ""}`;
    const cached = await getCached(cacheKey, MOVIE_DETAIL_TTL_MS);
    if (cached) { res.json(cached); return; }

    let tmdbId: number;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
        tv_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (findData.tv_results?.length) {
        tmdbId = findData.tv_results[0]!.id;
        isTv = true;
      } else if (findData.movie_results?.length) {
        tmdbId = findData.movie_results[0]!.id;
      } else {
        throw new NotFoundError("Movie");
      }
    }

    if (isTv) {
      type TvData = {
        id: number;
        name?: string;
        original_name?: string;
        original_language?: string;
        first_air_date?: string;
        genres?: Array<{ id: number; name: string }>;
        overview?: string;
        vote_average?: number;
        vote_count?: number;
        popularity?: number;
        episode_run_time?: number[];
        poster_path?: string | null;
        spoken_languages?: Array<{ name: string }>;
        production_countries?: Array<{ name: string }>;
        created_by?: Array<{ name: string }>;
        credits?: { cast?: Array<{ name: string }> };
        number_of_seasons?: number;
        success?: boolean;
      };
      // Probe with en-US to discover original_language and use as fallback
      const probe = await tmdbFetch<TvData>(`/tv/${tmdbId}`, {
        language: "en-US", append_to_response: "credits",
      });
      if (probe.success === false) throw new NotFoundError("TV series");
      const nativeLang = originalLangToLocale(probe.original_language);

      // When caller came from a search, srclang is set → use it for title/poster/overview.
      // When caller came from chain/post (no srclang), use native lang for title/poster
      // and uiLang for overview only.
      // When forceLang is set (in-page toggle), force both title and overview to it.
      const titlePosterLang = forceLang ?? (srclangParam ? overviewLang : nativeLang);

      // Fetch in title/poster language. Reuse probe if it matches en-US.
      const native: TvData = titlePosterLang === "en-US"
        ? probe
        : await tmdbFetch<TvData>(`/tv/${tmdbId}`, {
            language: titlePosterLang, append_to_response: "credits",
          });

      // Fetch overview in a different language only if needed.
      const uiOverviewFetch: Promise<{ overview?: string } | null> =
        (overviewLang !== titlePosterLang)
          ? tmdbFetch<{ overview?: string }>(`/tv/${tmdbId}`, { language: overviewLang })
          : Promise.resolve(null);

      const [data, watchProviders, genreMap, uiOverview] = await Promise.all([
        Promise.resolve(native),
        fetchWatchProviders(tmdbId, "tv"),
        fetchGenreMap("tv", uiLang),
        uiOverviewFetch,
      ]);

      const creator =
        data.created_by?.map((c) => c.name).join(", ") || null;
      const actors =
        data.credits?.cast?.slice(0, 5).map((a) => a.name).join(", ") || null;
      const genreIds = data.genres?.map((g) => g.id) ?? [];
      const genreList = genreIds.map(
        (id) => genreMap.get(id) ?? data.genres?.find((g) => g.id === id)?.name ?? "",
      ).filter(Boolean);

      const tvResult = {
        imdbId: `tmdb_tv:${tmdbId}`,
        tmdbId,
        mediaType: "tv",
        title: data.name || data.original_name || "",
        originalTitle: data.original_name || data.name || "",
        year: data.first_air_date ? data.first_air_date.slice(0, 4) : null,
        releaseDate: data.first_air_date ?? null,
        genre: genreList.join(", ") || null,
        genreList,
        genreIds,
        franchiseIds: [],
        plot: (uiOverview?.overview || data.overview) || null,
        director: creator,
        actors,
        imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
        tmdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
        voteCount: data.vote_count ?? 0,
        popularity: data.popularity ?? 0,
        runtime: data.episode_run_time?.[0]
          ? `${data.episode_run_time[0]} min/ep`
          : null,
        posterUrl: posterUrl(data.poster_path),
        language: data.spoken_languages?.map((l) => l.name).join(", ") || null,
        country:
          data.production_countries?.map((c) => c.name).join(", ") || null,
        numberOfSeasons: data.number_of_seasons ?? null,
        watchProviders,
      };
      setMovieCore(tmdbId, {
        tmdbRating: tvResult.tmdbRating,
        voteCount: tvResult.voteCount,
        popularity: tvResult.popularity,
        genreIds: tvResult.genreIds,
        releaseDate: tvResult.releaseDate,
        franchiseIds: tvResult.franchiseIds,
      });
      // Also upsert into moviesTable so ticket rank cards always get fresh score
      db.insert(moviesTable).values({
        tmdbId,
        mediaType: "tv",
        title: tvResult.title,
        posterUrl: tvResult.posterUrl,
        releaseDate: tvResult.releaseDate,
        voteAverage: data.vote_average ? data.vote_average.toString() : null,
        voteCount: tvResult.voteCount,
        popularity: tvResult.popularity.toString(),
        genreIds: tvResult.genreIds,
        franchiseIds: tvResult.franchiseIds,
        fetchedAt: new Date(),
      }).onConflictDoUpdate({
        target: moviesTable.tmdbId,
        set: {
          voteAverage: data.vote_average ? data.vote_average.toString() : null,
          voteCount: tvResult.voteCount,
          popularity: tvResult.popularity.toString(),
          genreIds: tvResult.genreIds,
          franchiseIds: tvResult.franchiseIds,
          fetchedAt: new Date(),
        },
      }).catch(() => {});
      await setCached(cacheKey, tvResult);
      res.json(tvResult);
      return;
    }

    type MovieData = {
      id: number;
      title: string;
      original_title?: string;
      original_language?: string;
      release_date?: string;
      genres?: Array<{ id: number; name: string }>;
      overview?: string;
      vote_average?: number;
      vote_count?: number;
      popularity?: number;
      runtime?: number;
      poster_path?: string | null;
      spoken_languages?: Array<{ name: string }>;
      production_countries?: Array<{ name: string }>;
      belongs_to_collection?: { id: number; name: string } | null;
      credits?: {
        crew?: Array<{ job: string; name: string }>;
        cast?: Array<{ name: string }>;
      };
      success?: boolean;
    };
    // Probe with en-US to discover original_language and serve as fallback
    const probe = await tmdbFetch<MovieData>(`/movie/${tmdbId}`, {
      language: "en-US", append_to_response: "credits",
    });
    if (probe.success === false) throw new NotFoundError("Movie");
    const nativeLang = originalLangToLocale(probe.original_language);

    // When caller came from a search, srclang is set → use it for title/poster/overview.
    // When caller came from chain/post (no srclang), use native lang for title/poster
    // and uiLang for overview only.
    // When forceLang is set (in-page toggle), force both title and overview to it.
    const titlePosterLang = forceLang ?? (srclangParam ? overviewLang : nativeLang);

    // Fetch in title/poster language. Reuse probe if it matches en-US.
    const native: MovieData = titlePosterLang === "en-US"
      ? probe
      : await tmdbFetch<MovieData>(`/movie/${tmdbId}`, {
          language: titlePosterLang, append_to_response: "credits",
        });

    // Fetch overview in a different language only if needed.
    // For search: titlePosterLang === overviewLang so no extra call.
    // For chain/post: titlePosterLang = nativeLang, overviewLang = uiLang — extra call when different.
    const uiOverviewFetch: Promise<{ overview?: string } | null> =
      (overviewLang !== titlePosterLang)
        ? tmdbFetch<{ overview?: string }>(`/movie/${tmdbId}`, { language: overviewLang })
        : Promise.resolve(null);

    const [data, watchProviders, genreMap, uiOverview] = await Promise.all([
      Promise.resolve(native),
      fetchWatchProviders(tmdbId, "movie"),
      fetchGenreMap("movie", uiLang),
      uiOverviewFetch,
    ]);

    const director =
      data.credits?.crew?.find((c) => c.job === "Director")?.name || null;
    const producer =
      data.credits?.crew
        ?.filter((c) => c.job === "Producer")
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ") || null;
    const actors =
      data.credits?.cast?.slice(0, 5).map((a) => a.name).join(", ") || null;
    const genreIds = data.genres?.map((g) => g.id) ?? [];
    const genreList = genreIds.map(
      (id) => genreMap.get(id) ?? data.genres?.find((g) => g.id === id)?.name ?? "",
    ).filter(Boolean);

    const movieResult = {
      imdbId: `tmdb:${tmdbId}`,
      mediaType: "movie",
      tmdbId,
      title: data.title || data.original_title || "",
      originalTitle: data.original_title || data.title || "",
      year: data.release_date ? data.release_date.slice(0, 4) : null,
      releaseDate: data.release_date ?? null,
      genre: genreList.join(", ") || null,
      genreList,
      genreIds,
      franchiseIds: data.belongs_to_collection
        ? [data.belongs_to_collection.id]
        : [],
      plot: (uiOverview?.overview || data.overview) || null,
      director,
      producer,
      actors,
      imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
      tmdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
      voteCount: data.vote_count ?? 0,
      popularity: data.popularity ?? 0,
      runtime: data.runtime ? `${data.runtime} min` : null,
      posterUrl: posterUrl(data.poster_path),
      language: data.spoken_languages?.map((l) => l.name).join(", ") || null,
      country:
        data.production_countries?.map((c) => c.name).join(", ") || null,
      watchProviders,
    };
    setMovieCore(tmdbId, {
      tmdbRating: movieResult.tmdbRating,
      voteCount: movieResult.voteCount,
      popularity: movieResult.popularity,
      genreIds: movieResult.genreIds,
      releaseDate: movieResult.releaseDate,
      franchiseIds: movieResult.franchiseIds,
    });
    // Also upsert into moviesTable so ticket rank cards always get fresh score
    db.insert(moviesTable).values({
      tmdbId,
      mediaType: "movie",
      title: movieResult.title,
      posterUrl: movieResult.posterUrl,
      releaseDate: movieResult.releaseDate,
      voteAverage: data.vote_average ? data.vote_average.toString() : null,
      voteCount: movieResult.voteCount,
      popularity: movieResult.popularity.toString(),
      genreIds: movieResult.genreIds,
      franchiseIds: movieResult.franchiseIds,
      fetchedAt: new Date(),
    }).onConflictDoUpdate({
      target: moviesTable.tmdbId,
      set: {
        voteAverage: data.vote_average ? data.vote_average.toString() : null,
        voteCount: movieResult.voteCount,
        popularity: movieResult.popularity.toString(),
        genreIds: movieResult.genreIds,
        franchiseIds: movieResult.franchiseIds,
        fetchedAt: new Date(),
      },
    }).catch(() => {});
    await setCached(cacheKey, movieResult);
    res.json(movieResult);
  }),
);

// ── /smart-search — keyword/genre-aware search (Feature 3) ───────────────────
// Maps Thai + English genre/mood keywords → TMDB genre IDs, then searches TMDB
// Also uses TMDB keyword API for topic-based discovery (e.g., "จระเข้" → crocodile movies)

// Thai → English topic term for TMDB keyword/text search
// Each entry is [thaiTerm, englishSearchTerm]
const THAI_TOPIC_PAIRS: Array<[string, string]> = [
  // Animals
  ["จระเข้", "crocodile"], ["ครอคอไดล์", "crocodile"], ["จรเข้", "crocodile"],
  ["ฉลาม", "shark"], ["กระโทงแทง", "shark"],
  ["งู", "snake"], ["อนาคอนดา", "anaconda"],
  ["แมงมุม", "spider"],
  ["สิงโต", "lion"], ["เสือ", "tiger"], ["เสือดาว", "leopard"],
  ["หมี", "bear"], ["หมีกริซลี่", "grizzly bear"],
  ["หมาป่า", "wolf"], ["มนุษย์หมาป่า", "werewolf"],
  ["มังกร", "dragon"],
  ["ยักษ์", "giant monster"], ["สัตว์ประหลาด", "creature"], ["ไคจู", "kaiju"],
  ["กอริลลา", "gorilla"], ["กิงกง", "king kong"],
  ["ไดโนเสาร์", "dinosaur"], ["จูราสสิก", "jurassic"],
  ["ฉลามยักษ์", "megalodon"], ["เมกาโลดอน", "megalodon"],
  ["หมู", "pig"], ["หนู", "rat"], ["นก", "bird"],
  // Supernatural / Horror
  ["ผีดิบ", "zombie"], ["ซอมบี้", "zombie"],
  ["แวมไพร์", "vampire"], ["ดูดเลือด", "vampire"],
  ["ผีสิง", "haunted"], ["บ้านผีสิง", "haunted house"], ["บ้านหลอน", "haunted house"],
  ["ปีศาจ", "demon"], ["ซาตาน", "satan"], ["ปีศาจร้าย", "devil"],
  ["ผี", "ghost"], ["วิญญาณ", "spirit"],
  // Sci-fi / Tech
  ["หุ่นยนต์", "robot"], ["ไซบอร์ก", "cyborg"], ["หุ่นกล", "android"],
  ["เอเลี่ยน", "alien"], ["มนุษย์ต่างดาว", "alien"], ["จานบิน", "ufo"],
  ["อวกาศ", "space"], ["นักบินอวกาศ", "astronaut"], ["ยานอวกาศ", "spaceship"],
  ["ดาวเคราะห์", "planet"], ["กาแล็กซี่", "galaxy"],
  ["ไวรัส", "virus outbreak"], ["โรคระบาด", "pandemic"],
  // Action / Crime
  ["ตำรวจ", "police"], ["นักสืบ", "detective"], ["นักสืบเอกชน", "private detective"],
  ["สายลับ", "spy"], ["จารกรรม", "espionage"],
  ["นักฆ่า", "assassin"], ["มือปืน", "hitman"], ["จ้างฆ่า", "assassin"],
  ["โจร", "heist"], ["ปล้น", "heist"], ["ปล้นธนาคาร", "bank heist"],
  ["มาเฟีย", "mafia"], ["แก๊งค์", "gang"], ["อาชญากร", "crime"],
  // Fantasy / Adventure
  ["โจรสลัด", "pirate"],
  ["อัศวิน", "knight"], ["ดาบ", "sword"], ["นักรบ", "warrior"],
  ["ซูเปอร์ฮีโร่", "superhero"], ["ซุปเปอร์ฮีโร่", "superhero"],
  ["เวทมนตร์", "magic"], ["แม่มด", "witch"], ["พ่อมด", "wizard"],
  ["นินจา", "ninja"], ["ซามูไร", "samurai"],
  ["กังฟู", "kung fu"], ["มวยกังฟู", "kung fu"], ["กังฟูแพนด้า", "kung fu"],
  ["นักมวย", "boxing"], ["มวยไทย", "muay thai"],
  // Vehicles / Racing
  ["รถ", "car"], ["รถยนต์", "car"], ["รถแข่ง", "racing"], ["แข่งรถ", "racing"],
  ["รถไฟ", "train"], ["รถบัส", "bus"], ["เรือ", "boat"], ["เรือดำน้ำ", "submarine"],
  ["เครื่องบิน", "aircraft"], ["นักบิน", "pilot"], ["เฮลิคอปเตอร์", "helicopter"],
  ["มอเตอร์ไซค์", "motorcycle"], ["รถบรรทุก", "truck"],
  // Disaster / Nature
  ["ภูเขาไฟ", "volcano"], ["แผ่นดินไหว", "earthquake"], ["สึนามิ", "tsunami"],
  ["น้ำท่วม", "flood"], ["ไฟป่า", "wildfire"], ["พายุ", "storm"], ["ทอร์นาโด", "tornado"],
  ["ภัยพิบัติ", "disaster"], ["หายนะ", "apocalypse"],
  // Settings
  ["เกาะร้าง", "island"], ["หมู่เกาะ", "island"], ["ป่า", "jungle"], ["ป่าดงดิบ", "jungle"],
  ["ทะเลทราย", "desert"], ["ขั้วโลก", "arctic"], ["ใต้น้ำ", "underwater"],
  // Legal / Social
  ["ทนายความ", "lawyer"], ["ผู้พิพากษา", "judge"], ["ศาล", "courtroom"],
  // Actors (search by person)
  ["เจสัน สเตแธม", "jason statham"], ["ทอม ครูซ", "tom cruise"],
  ["ดเวย์น จอห์นสัน", "dwayne johnson"], ["วิน ดีเซล", "vin diesel"],
  ["อาร์โนลด์", "arnold schwarzenegger"], ["บรูซ วิลลิส", "bruce willis"],
  ["แบรด พิตต์", "brad pitt"], ["สการ์เล็ตต์ โจแฮนสัน", "scarlett johansson"],
  ["ลีโอนาร์โด", "leonardo dicaprio"], ["แอนเจลินา โจลี", "angelina jolie"],
  // English keywords (user might type English in Thai context)
  ["crocodile", "crocodile"], ["shark", "shark"], ["zombie", "zombie"],
  ["vampire", "vampire"], ["robot", "robot"], ["alien", "alien"],
  ["pirate", "pirate"], ["ninja", "ninja"], ["samurai", "samurai"],
  ["car", "car"], ["racing", "racing"], ["heist", "heist"], ["spy", "spy"],
];

// Build lookup: thaiTerm → englishTerm (longest match first)
const THAI_TOPIC_EN: Record<string, string> = Object.fromEntries(THAI_TOPIC_PAIRS);

/** Strip Thai movie-type prefixes and try to find a topic match */
function resolveTopicEnglish(query: string): string | null {
  const q = query.trim();
  // Direct exact match
  if (THAI_TOPIC_EN[q]) return THAI_TOPIC_EN[q];
  // Strip leading "หนัง" (movie) prefix
  const stripped = q.replace(/^หนัง(เรื่อง)?/, "").trim();
  if (stripped && THAI_TOPIC_EN[stripped]) return THAI_TOPIC_EN[stripped];
  // Partial match: check if query contains any known term (longest first)
  const sortedPairs = THAI_TOPIC_PAIRS.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [term, en] of sortedPairs) {
    if (q.includes(term) || stripped.includes(term)) return en;
  }
  return null;
}

async function findTmdbKeywordIds(query: string, apiKey: string): Promise<number[]> {
  try {
    const resp = await fetch(
      `https://api.themoviedb.org/3/search/keyword?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=1`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: { id: number; name: string }[] };
    return (data.results ?? []).slice(0, 3).map((k: { id: number }) => k.id);
  } catch {
    return [];
  }
}

const TMDB_GENRE_MAP: Record<string, number[]> = {
  // Thai genre names
  "แอคชั่น": [28], "แอกชั่น": [28], "บู๊": [28],
  "ผจญภัย": [12],
  "การ์ตูน": [16], "แอนิเมชั่น": [16],
  "ตลก": [35], "คอมเมดี้": [35],
  "อาชญากรรม": [80],
  "สารคดี": [99],
  "ดราม่า": [18],
  "ครอบครัว": [10751],
  "แฟนตาซี": [14],
  "ประวัติศาสตร์": [36],
  "สยองขวัญ": [27], "ผี": [27], "หลอน": [27],
  "ดนตรี": [10402],
  "ลึกลับ": [9648],
  "โรแมนติก": [10749], "รัก": [10749], "รักโรแมนติก": [10749],
  "ไซไฟ": [878], "วิทยาศาสตร์": [878],
  "ทริลเลอร์": [53], "ระทึกขวัญ": [53], "เขย่าขวัญ": [53],
  "สงคราม": [10752],
  "คาวบอย": [37], "เวสเทิร์น": [37],
  // English genre names
  "action": [28], "adventure": [12], "animation": [16],
  "comedy": [35], "funny": [35],
  "crime": [80], "documentary": [99], "drama": [18],
  "family": [10751], "fantasy": [14], "history": [36],
  "horror": [27], "ghost": [27], "scary": [27],
  "music": [10402], "mystery": [9648],
  "romance": [10749], "romantic": [10749],
  "scifi": [878], "sci-fi": [878], "science fiction": [878],
  "thriller": [53], "war": [10752], "western": [37],
};

function extractGenreIds(q: string): number[] {
  const lower = q.toLowerCase().trim();
  const found = new Set<number>();
  for (const [keyword, ids] of Object.entries(TMDB_GENRE_MAP)) {
    if (lower.includes(keyword)) ids.forEach(id => found.add(id));
  }
  return [...found];
}

router.get(
  "/smart-search",
  asyncHandler(async (req, res) => {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_API_KEY) return res.json({ results: [] });

    const q = (req.query.q as string || "").trim();
    const lang = (req.query.lang as string) === "th" ? "th" : "en-US";
    if (!q) return res.json({ results: [] });

    const genreIds = extractGenreIds(q);

    // Resolve Thai/English topic to English search term
    // e.g. "จระเข้" → "crocodile", "รถ" → "car", "บู๊" → handled by genreIds
    const topicEn = resolveTopicEnglish(q);

    type TmdbRaw = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number; media_type?: string };

    let allResults: TmdbRaw[] = [];
    let usedKeywordIds: number[] = [];

    // ── Step 1: TMDB Keyword-based discover (most semantically accurate) ───────
    // Find TMDB keyword IDs for the resolved English topic (e.g. "crocodile")
    if (topicEn) {
      const keywordIds = await findTmdbKeywordIds(topicEn, TMDB_API_KEY);
      usedKeywordIds = keywordIds;

      if (keywordIds.length > 0) {
        const [movieResp, tvResp] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_keywords=${keywordIds.join("|")}&sort_by=vote_average.desc&vote_count.gte=50&page=1&language=${lang}`, { signal: AbortSignal.timeout(5000) }),
          fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&with_keywords=${keywordIds.join("|")}&sort_by=vote_average.desc&vote_count.gte=20&page=1&language=${lang}`, { signal: AbortSignal.timeout(5000) }),
        ]);
        const [movieData, tvData] = await Promise.all([
          movieResp.ok ? movieResp.json() as Promise<{ results?: TmdbRaw[] }> : Promise.resolve({ results: [] as TmdbRaw[] }),
          tvResp.ok ? tvResp.json() as Promise<{ results?: TmdbRaw[] }> : Promise.resolve({ results: [] as TmdbRaw[] }),
        ]);
        allResults = [
          ...(movieData.results ?? []).map(m => ({ ...m, media_type: "movie" })),
          ...(tvData.results ?? []).map(m => ({ ...m, media_type: "tv" })),
        ];
      }
    }

    // ── Step 2: Genre-based discover (for "บู๊" → Action, "ผจญภัย" → Adventure) ─
    if (genreIds.length > 0 && allResults.length < 10) {
      const resp = await fetch(
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreIds.join("|")}&sort_by=vote_average.desc&vote_count.gte=500&page=1&language=${lang}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null);
      if (resp?.ok) {
        const data = await resp.json() as { results?: TmdbRaw[] };
        const existingIds = new Set(allResults.map(r => r.id));
        const extra = (data.results ?? []).map(m => ({ ...m, media_type: "movie" })).filter(m => !existingIds.has(m.id));
        allResults = [...allResults, ...extra];
      }
    }

    // ── Step 3: Text search fallback with English term (catches keyword gaps) ──
    // Runs when: keyword discover returned no/few results, or no keyword IDs found
    // Uses topicEn if available (e.g. "crocodile"), otherwise raw query
    if (allResults.length < 5) {
      const searchQuery = topicEn ?? q;
      const [mResp, tvResp] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchQuery)}&page=1&language=${lang}`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
        fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchQuery)}&page=1&language=${lang}`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
      ]);
      const existingIds = new Set(allResults.map(r => r.id));
      const [mData, tvData] = await Promise.all([
        mResp?.ok ? mResp.json() as Promise<{ results?: TmdbRaw[] }> : Promise.resolve({ results: [] as TmdbRaw[] }),
        tvResp?.ok ? tvResp.json() as Promise<{ results?: TmdbRaw[] }> : Promise.resolve({ results: [] as TmdbRaw[] }),
      ]);
      const extra = [
        ...(mData.results ?? []).map(m => ({ ...m, media_type: "movie" })),
        ...(tvData.results ?? []).map(m => ({ ...m, media_type: "tv" })),
      ].filter(m => !existingIds.has(m.id));
      allResults = [...allResults, ...extra];
    }

    // Sort by vote_average desc, then popularity desc
    allResults.sort((a, b) => {
      const ratingDiff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
      if (Math.abs(ratingDiff) > 0.5) return ratingDiff;
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    });

    const results = allResults.slice(0, 20).map((m) => ({
      tmdbId: m.id,
      title: m.title ?? m.name ?? "",
      releaseDate: m.release_date ?? m.first_air_date ?? null,
      posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      tmdbRating: m.vote_average != null ? String(m.vote_average) : null,
      voteCount: m.vote_count ?? 0,
      genreIds: m.genre_ids ?? [],
      popularity: m.popularity ?? 0,
      mediaType: m.media_type ?? "movie",
    }));

    // isTopicSearch: true when we resolved a topic (not just raw text fallback)
    const isTopicSearch = !!(topicEn || genreIds.length > 0);
    res.json({ results, genreIds, keywordIds: usedKeywordIds, isTopicSearch });
  }),
);

// ── GET /movies/:movieId/awards ──────────────────────────────────────────────
router.get(
  "/:movieId/awards",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);

    let tmdbId: number;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
        tv_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (findData.tv_results?.length) {
        tmdbId = findData.tv_results[0]!.id;
        isTv = true;
      } else if (findData.movie_results?.length) {
        tmdbId = findData.movie_results[0]!.id;
      } else {
        res.json({ results: [] });
        return;
      }
    }

    type AwardEntry = {
      year: string;
      award_category: string;
      participants?: Array<{ person_id: number; name: string; character?: string }>;
    };
    type AwardResult = {
      department: string;
      name: string;
      winners: AwardEntry[];
      nominees: AwardEntry[];
    };

    const data = await tmdbFetch<{ id?: number; results?: AwardResult[] }>(
      `/${isTv ? "tv" : "movie"}/${tmdbId}/awards`,
    ).catch(() => ({ results: [] as AwardResult[] }));

    const results = (data.results ?? []).filter(
      r => (r.winners?.length ?? 0) > 0 || (r.nominees?.length ?? 0) > 0,
    );

    if (results.length === 0) {
      let imdbId: string | null = /^tt\d+$/.test(movieId) ? movieId : null;
      if (!imdbId && !isTv) {
        const extIds = await tmdbFetch<{ imdb_id?: string | null }>(`/movie/${tmdbId}/external_ids`).catch(() => ({}));
        imdbId = extIds.imdb_id || null;
      }
      if (imdbId) {
        const wikidataResults = await queryAwardsByImdbId(imdbId).catch(() => []);
        if (wikidataResults.length > 0) {
          return res.json({ results: wikidataResults });
        }
      }
    }

    res.json({ results });
  }),
);

// ── GET /movies/:movieId/credits ─────────────────────────────────────────────
router.get(
  "/:movieId/credits",
  asyncHandler(async (req, res) => {
    const movieId = String(req.params["movieId"]);
    const lang = (req.query["lang"] as string) || "en-US";

    let tmdbId: number;
    let isTv = false;

    if (movieId.startsWith("tmdb_tv:")) {
      tmdbId = parseInt(movieId.slice(8), 10);
      isTv = true;
    } else if (movieId.startsWith("tmdb:")) {
      tmdbId = parseInt(movieId.slice(5), 10);
    } else if (/^\d+$/.test(movieId)) {
      tmdbId = parseInt(movieId, 10);
    } else {
      const findData = await tmdbFetch<{
        movie_results?: Array<{ id: number }>;
        tv_results?: Array<{ id: number }>;
      }>(`/find/${encodeURIComponent(movieId)}`, {
        external_source: "imdb_id",
      });
      if (findData.tv_results?.length) {
        tmdbId = findData.tv_results[0]!.id;
        isTv = true;
      } else if (findData.movie_results?.length) {
        tmdbId = findData.movie_results[0]!.id;
      } else {
        res.json({ cast: [], directors: [] });
        return;
      }
    }

    const PROFILE_BASE = "https://image.tmdb.org/t/p/w185";

    const creditsData = await tmdbFetch<{
      cast?: Array<{ id: number; name: string; character?: string; profile_path?: string | null; order?: number }>;
      crew?: Array<{ id: number; name: string; job: string; profile_path?: string | null }>;
    }>(`/${isTv ? "tv" : "movie"}/${tmdbId}/credits`, { language: lang });

    const cast = (creditsData.cast ?? [])
      .filter(c => (c.order ?? 99) < 10)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map(c => ({
        id: c.id,
        name: c.name,
        character: c.character || "",
        profileUrl: c.profile_path ? `${PROFILE_BASE}${c.profile_path}` : null,
      }));

    const directors = (creditsData.crew ?? [])
      .filter(c => c.job === "Director")
      .slice(0, 5)
      .map(c => ({
        id: c.id,
        name: c.name,
        profileUrl: c.profile_path ? `${PROFILE_BASE}${c.profile_path}` : null,
      }));

    res.json({ cast, directors });
  }),
);

export default router;
