/**
 * Movies Service — TMDB data fetching, normalisation, and discovery logic.
 *
 * Previously all of this lived inside routes/movies.ts, making that file
 * 1 100+ lines long. Route handlers now stay thin and call these functions.
 *
 * All external TMDB calls go through the shared tmdb-client module —
 * no raw fetch() calls with inline API keys.
 */

import { tmdbFetch, posterUrl, backdropUrl, logoUrl, TMDB_IMG_WIDE, isoDate } from "../lib/tmdb-client";
import { config } from "../config";

const { apiKey, baseUrl } = config.tmdb;

/**
 * Parse a fully-constructed TMDB URL (as built by MOOD_CFG/SUB_FILTER_URLS url factories)
 * and route the request through the shared tmdb-client instead of raw fetch().
 * This ensures a single TMDB call path and avoids exposing api_key in constructed strings.
 */
async function tmdbFetchFromUrl<T = PagedResult>(urlStr: string): Promise<T> {
  const parsed = new URL(urlStr);
  const path = parsed.pathname.replace(/^\/3/, "");
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    if (k !== "api_key") params[k] = v;
  });
  return tmdbFetch<T>(path, params);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TMDBItem = {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  original_title?: string;
  release_date?: string;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  popularity?: number;
  overview?: string;
  original_language?: string;
};

export type WatchProvider = {
  name: string;
  logoUrl: string;
  providerId: number;
};

export type WatchProviders = {
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};

export type PagedResult = {
  results?: TMDBItem[];
  total_pages?: number;
  total_results?: number;
};

export type NormalizedMovie = ReturnType<typeof normalizeItem>;

// ── Language detection ────────────────────────────────────────────────────────

export function detectLanguage(text: string): string {
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-TW";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0080-\u00FF]/.test(text)) {
    if (/[àâäéèêëîïôùûüç]/i.test(text)) return "fr";
    if (/[äöüß]/i.test(text)) return "de";
    if (/[áéíóúñ¿¡]/i.test(text)) return "es";
    if (/[àèéìíîòóùú]/i.test(text)) return "it";
  }
  return "en-US";
}

// ── Item normalisation ────────────────────────────────────────────────────────

export function normalizeItem(
  item: TMDBItem,
  mediaType: "movie" | "tv",
  collectionMap: Map<number, number[]>,
) {
  const isTv = mediaType === "tv";
  return {
    imdbId: isTv ? `tmdb_tv:${item.id}` : `tmdb:${item.id}`,
    tmdbId: item.id,
    mediaType,
    title:
      (isTv
        ? item.name || item.original_name
        : item.title || item.original_title) || "",
    year:
      (isTv ? item.first_air_date : item.release_date)?.slice(0, 4) ?? null,
    releaseDate:
      (isTv ? item.first_air_date : item.release_date) ?? null,
    posterUrl: posterUrl(item.poster_path),
    tmdbRating: item.vote_average ? item.vote_average.toFixed(1) : null,
    voteCount: item.vote_count ?? 0,
    genreIds: item.genre_ids ?? [],
    popularity: item.popularity ?? 0,
    franchiseIds: isTv ? [] : (collectionMap.get(item.id) ?? []),
  };
}

// ── Collection ID fetch ───────────────────────────────────────────────────────

/**
 * Fetch belongs_to_collection IDs from TMDB for a batch of movie IDs.
 * Returns a Map<tmdbId, collectionId[]>.
 */
export async function fetchCollectionIds(
  tmdbIds: number[],
): Promise<Map<number, number[]>> {
  const results = await Promise.allSettled(
    tmdbIds.map((id) =>
      tmdbFetch<{ id: number; belongs_to_collection?: { id: number } | null }>(
        `/movie/${id}`,
        { language: "en-US" },
      ),
    ),
  );

  const map = new Map<number, number[]>();
  for (const r of results) {
    if (r.status === "fulfilled") {
      const d = r.value;
      map.set(d.id, d.belongs_to_collection ? [d.belongs_to_collection.id] : []);
    }
  }
  return map;
}

// ── Watch providers ───────────────────────────────────────────────────────────

type RawProvider = {
  provider_name: string;
  logo_path: string;
  provider_id: number;
};

type RawRegion = {
  link?: string;
  flatrate?: RawProvider[];
  rent?: RawProvider[];
  buy?: RawProvider[];
};

function parseProviders(regionData: RawRegion | undefined): WatchProviders {
  const norm = (arr?: RawProvider[]): WatchProvider[] =>
    (arr ?? []).map((p) => ({
      name: p.provider_name,
      logoUrl: logoUrl(p.logo_path) ?? "",
      providerId: p.provider_id,
    }));

  return {
    link: regionData?.link ?? null,
    flatrate: norm(regionData?.flatrate),
    rent: norm(regionData?.rent),
    buy: norm(regionData?.buy),
  };
}

export async function fetchWatchProviders(
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<WatchProviders> {
  try {
    const data = await tmdbFetch<{
      results?: Record<string, RawRegion>;
    }>(`/${mediaType}/${tmdbId}/watch/providers`);

    const region = data.results?.["TH"] ?? data.results?.["US"];
    return parseProviders(region);
  } catch {
    return { link: null, flatrate: [], rent: [], buy: [] };
  }
}

// ── Upcoming feed ─────────────────────────────────────────────────────────────

type VideoResult = {
  key: string;
  site: string;
  type: string;
  official: boolean;
};

type ImageResult = { file_path: string; width: number };

export async function enrichUpcomingMovie(m: TMDBItem) {
  const needsOverview = !m.overview;

  const [videosData, imagesData, detailEn] = await Promise.all([
    tmdbFetch<{ results?: VideoResult[] }>(`/movie/${m.id}/videos`, {
      language: "en-US",
    }),
    tmdbFetch<{ backdrops?: ImageResult[] }>(`/movie/${m.id}/images`),
    needsOverview
      ? tmdbFetch<{ overview?: string }>(`/movie/${m.id}`, { language: "en-US" })
      : Promise.resolve(null),
  ]);

  const ytVideos = (videosData.results || []).filter(
    (v) => v.site === "YouTube",
  );
  const trailer =
    ytVideos.find((v) => v.type === "Trailer" && v.official) ||
    ytVideos.find((v) => v.type === "Trailer") ||
    ytVideos.find((v) => v.type === "Teaser") ||
    ytVideos[0];

  const backdrops = (imagesData.backdrops || [])
    .filter((b) => b.width >= 1280)
    .slice(0, 12)
    .map((b) => `${TMDB_IMG_WIDE}${b.file_path}`);

  const overview = m.overview || detailEn?.overview || null;

  return {
    imdbId: `tmdb:${m.id}`,
    tmdbId: m.id,
    title: m.title || m.original_title || "",
    overview,
    releaseDate: m.release_date ?? null,
    posterUrl: posterUrl(m.poster_path),
    backdropUrl: backdropUrl(m.backdrop_path),
    backdrops,
    trailerKey: trailer?.key ?? null,
    popularity: m.popularity ?? 0,
  };
}

// ── Mood configuration ────────────────────────────────────────────────────────
//
// Centralised URL factories for every mood / curated category.
// The route handler just looks up the config and calls fetchMoodMovies().

export interface MoodConfig {
  urlA: (page: number) => string;
  urlB?: (page: number) => string;
  mediaTypeA: "movie" | "tv";
  mediaTypeB?: "movie" | "tv";
  sortMergedBy?: "popularity" | "rating";
  limit?: number;
}

const B = baseUrl;
const K = apiKey;

export const SUB_FILTER_URLS: Record<
  string,
  Record<string, (p: number) => string>
> = {
  "2am_deep_talk": {
    drama: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=18&sort_by=vote_average.desc&vote_count.gte=2000&vote_average.gte=7.2&without_genres=35&page=${p}`,
    mystery: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=9648&sort_by=vote_average.desc&vote_count.gte=1500&vote_average.gte=7.2&page=${p}`,
    slowburn: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=53%2C18&sort_by=vote_average.desc&vote_count.gte=2000&vote_average.gte=7.0&without_genres=35%2C28&page=${p}`,
  },
  brain_rot: {
    blockbuster: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=28&sort_by=popularity.desc&vote_count.gte=5000&vote_average.gte=4.5&vote_average.lte=7.0&primary_release_date.gte=2000-01-01&page=${p}`,
    comedy: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=35&sort_by=popularity.desc&vote_count.gte=3000&vote_average.gte=4.5&vote_average.lte=7.0&primary_release_date.gte=2005-01-01&page=${p}`,
    disaster: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=28%2C12&sort_by=popularity.desc&vote_count.gte=3000&vote_average.gte=4.0&vote_average.lte=7.2&primary_release_date.gte=1990-01-01&page=${p}`,
  },
  main_character: {
    adventure: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=12%7C28&sort_by=popularity.desc&vote_count.gte=2000&vote_average.gte=6.5&primary_release_date.gte=1990-01-01&without_genres=27&page=${p}`,
    comingofage: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=18&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=7.2&primary_release_date.gte=1990-01-01&without_genres=27%2C10749&page=${p}`,
    feelgood: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=35&sort_by=popularity.desc&vote_count.gte=2000&vote_average.gte=6.8&primary_release_date.gte=2000-01-01&without_genres=27&page=${p}`,
  },
  heartbreak: {
    romantic: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=10749&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=7.0&page=${p}`,
    sadlove: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=10749%2C18&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=6.8&page=${p}`,
    feelinglove: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=10749&sort_by=popularity.desc&vote_count.gte=2000&vote_average.gte=6.5&primary_release_date.gte=2000-01-01&page=${p}`,
  },
  chaos_red_flags: {
    psychological: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=53%2C9648&sort_by=vote_average.desc&vote_count.gte=2000&vote_average.gte=7.5&page=${p}`,
    crime: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=80&sort_by=vote_average.desc&vote_count.gte=3000&vote_average.gte=7.5&page=${p}`,
    darkcomedy: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=35%2C80&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=7.0&page=${p}`,
  },
  anime: {
    movie: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_original_language=ja&with_genres=16&sort_by=vote_average.desc&vote_count.gte=300&vote_average.gte=7.0&page=${p}`,
    action: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_original_language=ja&with_genres=16%2C28&sort_by=vote_average.desc&vote_count.gte=200&vote_average.gte=6.5&page=${p}`,
  },
  tokusatsu: {
    rider: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=5822%7C5671&sort_by=popularity.desc&vote_count.gte=5&page=${p}`,
    ultraman: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=5905&sort_by=popularity.desc&vote_count.gte=5&page=${p}`,
  },
  disney_dreamworks: {
    disney: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=2%7C3&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=6.5&page=${p}`,
    dreamworks: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=521%7C6704&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=6.0&page=${p}`,
  },
  k_wave: {
    movie: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_original_language=ko&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=7.0&page=${p}`,
    tv: (p) =>
      `${B}/discover/tv?api_key=${K}&language=th&with_original_language=ko&sort_by=vote_average.desc&vote_count.gte=200&vote_average.gte=7.5&page=${p}`,
  },
  midnight_horror: {
    classic: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=27&sort_by=vote_average.desc&vote_count.gte=3000&vote_average.gte=7.0&page=${p}`,
    recent: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=27&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=6.5&primary_release_date.gte=2010-01-01&page=${p}`,
  },
};

export const MOOD_CFG: Record<string, MoodConfig> = {
  now_playing: {
    urlA: (p) =>
      `${B}/movie/now_playing?api_key=${K}&language=th-TH&region=TH&page=${p}`,
    mediaTypeA: "movie",
  },

  // ── Atmospheric slow-burn: Drama / Mystery / Thriller, no comedy fluff ──
  "2am_deep_talk": {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=18%7C9648%7C53&sort_by=vote_average.desc&vote_count.gte=2000&vote_average.gte=7.2&without_genres=35%2C28&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Mindless fun: high-popularity blockbusters / comedies, mediocre rating ──
  brain_rot: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=28%7C35&sort_by=popularity.desc&vote_count.gte=3000&vote_average.gte=4.5&vote_average.lte=7.0&primary_release_date.gte=2000-01-01&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Main Character energy: adventure / coming-of-age / feel-good (no horror, no romance) ──
  main_character: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=12%7C28%7C35&sort_by=popularity.desc&vote_count.gte=2000&vote_average.gte=6.5&primary_release_date.gte=1990-01-01&without_genres=27%2C10749&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Heartbreak / Romance: acclaimed love stories ──
  heartbreak: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=10749&sort_by=vote_average.desc&vote_count.gte=1000&vote_average.gte=7.0&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Dark & chaotic: Thriller / Crime / Mystery, high quality ──
  chaos_red_flags: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=53%7C9648%7C80&sort_by=vote_average.desc&vote_count.gte=3000&vote_average.gte=7.5&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Japanese animated films (anime movies) ──
  anime: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_original_language=ja&with_genres=16&sort_by=vote_average.desc&vote_count.gte=300&vote_average.gte=6.5&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Tokusatsu: Kamen Rider / Super Sentai (Toei 5822) + Ultraman (Tsuburaya 5905) ──
  // with_genres=878 (Sci-Fi) targets superhero/monster films; without_genres=16 removes anime
  tokusatsu: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=5822%7C5905%7C5671&with_genres=878&without_genres=16&sort_by=popularity.desc&vote_count.gte=5&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Disney / Pixar / DreamWorks / Illumination ──
  disney_dreamworks: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=2%7C3%7C521%7C6704&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=6.0&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Korean cinema: acclaimed films ──
  k_wave: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_original_language=ko&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=7.0&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Pure horror: for the horror faithful ──
  midnight_horror: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_genres=27&sort_by=vote_average.desc&vote_count.gte=2000&vote_average.gte=6.5&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },

  // ── Marvel Studios + DC Films + DC Entertainment ──
  marvel_dc: {
    urlA: (p) =>
      `${B}/discover/movie?api_key=${K}&language=th&with_companies=420%7C128064%7C429&sort_by=vote_average.desc&vote_count.gte=200&vote_average.gte=5.0&page=${p}`,
    mediaTypeA: "movie",
    limit: 30,
  },
};

/**
 * Fetch movies for a mood, handling both paginated (now_playing) and
 * curated (limit-based) configurations.
 *
 * @param startPage - first TMDB page to fetch from; used for daily rotation
 *   so that each day's results start from a different offset.
 */
// Swap the hard-coded `language=th(-TH)` query param in a TMDB URL with the
// caller-provided UI language. Mood/discover URLs are template strings, so we
// rewrite them at fetch time rather than parameterising every builder.
function applyLang(url: string, lang: "th-TH" | "en-US"): string {
  return url.replace(/language=th(?:-TH)?(?=&|$)/, `language=${lang}`);
}

/**
 * Compute a daily start-page (1–10) for a given mood ID.
 * Exported so that the notification job can use the same rotation as the route.
 */
export function dailyStartPage(moodId: string): number {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const idHash = moodId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return ((daysSinceEpoch + idHash) % 10) + 1; // cycles pages 1–10
}

export async function fetchMoodMovies(
  cfg: MoodConfig,
  urlFn: (page: number) => string,
  page: number,
  startPage: number = 1,
  lang: "th-TH" | "en-US" = "th-TH",
): Promise<{
  movies: NormalizedMovie[];
  page: number;
  totalPages: number;
  totalResults: number;
}> {
  if (cfg.limit) {
    // Fetch 5 pages to build a richer pool (~100 items before dedup).
    // The route handler paginates the full pool into 20-item frontend pages,
    // so we no longer apply cfg.limit here — the caller slices as needed.
    const POOL_PAGES = 5;
    const fetches = await Promise.all(
      Array.from({ length: POOL_PAGES }, (_, i) =>
        tmdbFetchFromUrl(applyLang(urlFn(1 + i), lang)).catch(
          () => ({ results: [] }) as PagedResult,
        ),
      ),
    );

    const allRaw = fetches.flatMap((d) => d.results || []);
    const seen = new Set<number>();
    const deduped = allRaw.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Daily deterministic shuffle: use startPage as rotation seed so the
    // displayed order changes each day without risking empty TMDB pages.
    const rotateSeed = startPage;
    const shuffled = deduped.slice().sort((a, b) => {
      const ha = (((a.id ^ rotateSeed) * 1664525 + 1013904223) >>> 0);
      const hb = (((b.id ^ rotateSeed) * 1664525 + 1013904223) >>> 0);
      return ha - hb;
    });

    const collMap =
      cfg.mediaTypeA === "movie"
        ? await fetchCollectionIds(shuffled.map((m) => m.id))
        : new Map<number, number[]>();
    const movies = shuffled
      .map((m) => normalizeItem(m, cfg.mediaTypeA, collMap));
    return { movies, page: 1, totalPages: 1, totalResults: movies.length };
  }

  // Standard pagination
  const data = await tmdbFetchFromUrl(applyLang(urlFn(page), lang));
  const raw = data.results || [];
  const collMap =
    cfg.mediaTypeA === "movie"
      ? await fetchCollectionIds(raw.map((m) => m.id))
      : new Map<number, number[]>();
  const movies = raw.map((m) => normalizeItem(m, cfg.mediaTypeA, collMap));
  return {
    movies,
    page,
    totalPages: data.total_pages ?? 1,
    totalResults: data.total_results ?? 0,
  };
}
