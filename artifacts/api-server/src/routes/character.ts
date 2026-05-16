import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  getAniListCharacters,
  getAniListCharacterById,
  getAniListCharacterByName,
  type AniListMedia,
  type AniListChar,
  type AniListCharDetail,
} from "../lib/anilist";
import {
  searchComicVineCharacters,
  searchComicVineVolumes,
  getCvVolumeCharacters,
  getComicVineCharacterById,
  cvNameMatches,
} from "../lib/comicvine";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type CharResult = {
  name: string;
  wikidataId: string;
  description: string;
  imageUrl: string | null;
  alias: string | null;
  source: "anilist" | "comicvine" | "tmdb";
  sourceUrl?: string;
};

type FilmographyEntry = {
  title: string;
  year: string | null;
  imdbId: string | null;
  posterUrl: string | null;
  tmdbRating: string | null;
  voteCount: number;
  genreIds: number[];
  popularity: number;
  franchiseIds: number[];
  mediaType: "movie" | "tv";
};

type TvInfoShape = {
  name?: string;
  original_language?: string;
  genre_ids?: number[];
  genres?: Array<{ id: number }>;
};
type MovieInfoShape = {
  title?: string;
  original_language?: string;
  genre_ids?: number[];
  genres?: Array<{ id: number }>;
  belongs_to_collection?: { id: number; name: string } | null;
};
type FindShape = {
  movie_results?: Array<{ id: number }>;
  tv_results?: Array<{ id: number }>;
};

// ── Caches ────────────────────────────────────────────────────────────────────

const BY_MOVIE_CACHE      = new Map<string, { results: CharResult[]; ts: number }>();
const FILMOGRAPHY_CACHE   = new Map<string, { filmography: FilmographyEntry[]; ts: number }>();
const CACHE_TTL           = 12 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORN_KEYWORDS = [
  "porn", "xxx", "adult film", "erotic", "sex film", "nude", "hardcore",
  "softcore", "hentai parody",
];
function isPornParody(title: string): boolean {
  return PORN_KEYWORDS.some(kw => title.toLowerCase().includes(kw));
}

function isAnime(originalLanguage: string, genreIds: number[]): boolean {
  const asianLangs = new Set(["ja", "ko", "zh", "cn"]);
  return asianLangs.has(originalLanguage) && genreIds.includes(16);
}

const BLOCKED_NAMES = new Set([
  "narration", "narrator", "additional voices", "additional voice",
  "various", "various voices", "various characters",
  "self", "themselves", "ensemble", "chorus",
  "announcer", "voice over", "voiceover", "v.o.",
  "uncredited", "extra", "background",
]);

function isBlockedCharacterName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return BLOCKED_NAMES.has(lower) || lower.length < 2;
}

function cleanCharacterName(raw: string): string {
  return raw
    .split("/")[0]!
    .replace(/\s*\(voice\)/i, "")
    .replace(/\s*\(uncredited\)/i, "")
    .replace(/\s*\(archive footage\)/i, "")
    .replace(/\s*\(as [^)]+\)/i, "")
    .replace(/\s*\(cameo\)/i, "")
    .replace(/\s*\(segment[^)]*\)/i, "")
    .trim();
}

function normalizeRomaji(s: string): string {
  return s
    .toLowerCase()
    .replace(/ou/g, "o")
    .replace(/uu/g, "u")
    .replace(/ii/g, "i")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a title for CV volume matching.
 * Strips "The" prefix, punctuation, and extra spaces.
 */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/\s+vs\.?\s+/g, " vs ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a CV volume title is a good match for a movie/series title.
 * Returns a numeric score (0 = no match, 1 = perfect match).
 */
function volumeTitleScore(cvTitle: string, movieTitle: string): number {
  const cv = normTitle(cvTitle);
  const mv = normTitle(movieTitle);
  if (!cv || !mv) return 0;
  if (cv === mv) return 1;
  if (cv.includes(mv) || mv.includes(cv)) return 0.9;

  const cvWords = cv.split(" ").filter(w => w.length > 2);
  const mvWords = mv.split(" ").filter(w => w.length > 2);
  if (cvWords.length === 0 || mvWords.length === 0) return 0;
  const overlap = cvWords.filter(w => mvWords.includes(w));
  return overlap.length / Math.min(cvWords.length, mvWords.length);
}

// ── AniList match helpers ─────────────────────────────────────────────────────

function matchAniListChar(tmdbName: string, anilistChars: AniListChar[]): AniListChar | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm = normalize(tmdbName);
  const tmdbRomaji = normalizeRomaji(tmdbName);
  const tmdbWords = tmdbNorm.split(/\s+/).filter(w => w.length > 1);
  const tmdbRomajiWords = tmdbRomaji.split(/\s+/).filter(w => w.length > 1);

  for (const ac of anilistChars) { if (normalize(ac.name) === tmdbNorm) return ac; }
  for (const ac of anilistChars) { if (normalizeRomaji(ac.name) === tmdbRomaji) return ac; }
  for (const ac of anilistChars) {
    const alWords = normalize(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbWords.length, alWords.length)) return ac;
  }
  for (const ac of anilistChars) {
    const alWords = normalizeRomaji(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbRomajiWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbRomajiWords.length, alWords.length)) return ac;
  }
  if (tmdbRomajiWords.length === 2) {
    const reversed = `${tmdbRomajiWords[1]} ${tmdbRomajiWords[0]}`;
    for (const ac of anilistChars) { if (normalizeRomaji(ac.name) === reversed) return ac; }
  }
  for (const ac of anilistChars) {
    for (const alt of ac.alternativeNames) {
      const altNorm = normalize(alt);
      const altRomaji = normalizeRomaji(alt);
      if (altNorm === tmdbNorm) return ac;
      if (altRomaji === tmdbRomaji) return ac;
    }
  }
  return null;
}

function isValidAniListNameMatch(query: string, result: AniListCharDetail): boolean {
  const hasAnimeMedia = result.media.some(m => m.type === "ANIME");
  if (!hasAnimeMedia) return false;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const q = normalize(query);
  const qRomaji = normalizeRomaji(query);
  const qWords = q.split(/\s+/).filter(w => w.length > 2);

  if (normalize(result.name) === q) return true;
  if (normalizeRomaji(result.name) === qRomaji) return true;

  const nameWords = normalize(result.name).split(/\s+/).filter(w => w.length > 2);
  if (qWords.length > 0 && nameWords.length > 0) {
    const overlap = qWords.filter(w => nameWords.includes(w));
    if (overlap.length >= Math.min(qWords.length, nameWords.length)) return true;
  }

  for (const alt of result.alternativeNames) {
    if (normalize(alt) === q) return true;
    if (normalizeRomaji(alt) === qRomaji) return true;
  }
  return false;
}

// ── Filmography helpers ───────────────────────────────────────────────────────

async function getFilmographyFromAniListMedia(media: AniListMedia[]): Promise<FilmographyEntry[]> {
  const animeOnly = media.filter(m => m.type === "ANIME").slice(0, 25);
  if (animeOnly.length === 0) return [];

  const results = await Promise.allSettled(
    animeOnly.map(async (m): Promise<FilmographyEntry | null> => {
      const searchTitle = m.titleEnglish || m.titleRomaji || "";
      if (!searchTitle) return null;
      const isMovie = m.format === "MOVIE";
      if (isMovie) {
        const sr = await tmdbFetch<{ results?: Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }>(
          "/search/movie", { query: searchTitle, include_adult: "false" },
        ).catch(() => ({ results: [] as Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }));
        const hit = sr.results?.find(r => r.poster_path) ?? sr.results?.[0];
        if (!hit) return null;
        return { title: hit.title ?? searchTitle, year: hit.release_date?.slice(0, 4) ?? (m.startYear ? String(m.startYear) : null), imdbId: hit.id ? `tmdb:${hit.id}` : null, posterUrl: hit.poster_path ? posterUrl(hit.poster_path) : (m.coverImage ?? null), tmdbRating: hit.vote_average != null ? String(hit.vote_average.toFixed(1)) : null, voteCount: hit.vote_count ?? 0, genreIds: hit.genre_ids ?? [16], popularity: hit.popularity ?? m.popularity, franchiseIds: [], mediaType: "movie" };
      } else {
        const sr = await tmdbFetch<{ results?: Array<{ id: number; name?: string; poster_path?: string | null; first_air_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }>(
          "/search/tv", { query: searchTitle, include_adult: "false" },
        ).catch(() => ({ results: [] as Array<{ id: number; name?: string; poster_path?: string | null; first_air_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }));
        const hit = sr.results?.find(r => r.poster_path) ?? sr.results?.[0];
        if (!hit) return null;
        return { title: hit.name ?? searchTitle, year: hit.first_air_date?.slice(0, 4) ?? (m.startYear ? String(m.startYear) : null), imdbId: hit.id ? `tmdb_tv:${hit.id}` : null, posterUrl: hit.poster_path ? posterUrl(hit.poster_path) : (m.coverImage ?? null), tmdbRating: hit.vote_average != null ? String(hit.vote_average.toFixed(1)) : null, voteCount: hit.vote_count ?? 0, genreIds: hit.genre_ids ?? [16], popularity: hit.popularity ?? m.popularity, franchiseIds: [], mediaType: "tv" };
      }
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FilmographyEntry | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is FilmographyEntry => v !== null);
}

async function getFilmographyByKeyword(characterName: string): Promise<FilmographyEntry[]> {
  try {
    const kwData = await tmdbFetch<{ results?: Array<{ id: number; name: string }> }>(
      "/search/keyword", { query: characterName, page: "1" },
    );
    const nameLower = characterName.toLowerCase();
    const exact = (kwData.results ?? []).find(k => k.name.toLowerCase() === nameLower);
    if (!exact) return [];

    const kwId = String(exact.id);
    const [moviesResp, tvResp] = await Promise.allSettled([
      tmdbFetch<{ results?: Array<{ id: number; title?: string; release_date?: string; poster_path?: string | null; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number; adult?: boolean }> }>(
        "/discover/movie", { with_keywords: kwId, sort_by: "vote_count.desc", include_adult: "false", page: "1" }),
      tmdbFetch<{ results?: Array<{ id: number; name?: string; first_air_date?: string; poster_path?: string | null; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number; adult?: boolean }> }>(
        "/discover/tv", { with_keywords: kwId, sort_by: "vote_count.desc", include_adult: "false", page: "1" }),
    ]);

    const out: FilmographyEntry[] = [];
    if (moviesResp.status === "fulfilled") {
      for (const r of (moviesResp.value.results ?? []).slice(0, 20)) {
        if (r.adult || !r.poster_path || !r.title) continue;
        if (isPornParody(r.title)) continue;
        if ((r.vote_count ?? 0) < 1) continue;
        out.push({ title: r.title, year: r.release_date?.slice(0, 4) ?? null, imdbId: `tmdb:${r.id}`, posterUrl: posterUrl(r.poster_path), tmdbRating: r.vote_average != null ? String(r.vote_average.toFixed(1)) : null, voteCount: r.vote_count ?? 0, genreIds: r.genre_ids ?? [], popularity: r.popularity ?? 0, franchiseIds: [], mediaType: "movie" });
      }
    }
    if (tvResp.status === "fulfilled") {
      for (const r of (tvResp.value.results ?? []).slice(0, 10)) {
        if (r.adult || !r.poster_path || !r.name) continue;
        if (isPornParody(r.name)) continue;
        if ((r.vote_count ?? 0) < 1) continue;
        out.push({ title: r.name, year: r.first_air_date?.slice(0, 4) ?? null, imdbId: `tmdb_tv:${r.id}`, posterUrl: posterUrl(r.poster_path), tmdbRating: r.vote_average != null ? String(r.vote_average.toFixed(1)) : null, voteCount: r.vote_count ?? 0, genreIds: r.genre_ids ?? [], popularity: r.popularity ?? 0, franchiseIds: [], mediaType: "tv" });
      }
    }
    return out;
  } catch { return []; }
}

function mergeFilmographies(a: FilmographyEntry[], b: FilmographyEntry[]): FilmographyEntry[] {
  const seen = new Set<string>();
  const out: FilmographyEntry[] = [];
  for (const e of [...a, ...b]) {
    if (e.imdbId && !seen.has(e.imdbId)) {
      seen.add(e.imdbId);
      out.push(e);
    }
  }
  return out.sort((x, y) => (y.voteCount ?? 0) - (x.voteCount ?? 0));
}

// ── CV Volume-First Lookup ────────────────────────────────────────────────────
/**
 * For non-anime movies/shows: find the matching Comic Vine volume (series),
 * then cross-reference TMDB character names against that volume's character list.
 *
 * This prevents false positives like "Stone" (Punisher) matching the Marvel
 * Daredevil "Stone", or "Bud" (Predator) matching Harley Quinn's hyena.
 * We only return characters whose name AND franchise/series both match.
 *
 * Returns a map of TMDB char name → CV match data.
 */
async function lookupComicVineForMovie(
  characterNames: string[],
  movieTitle: string,
  franchiseName: string | null,
): Promise<Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>> {
  const resultMap = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
  if (!process.env["COMIC_VINE_API_KEY"] || !movieTitle) return resultMap;

  // Build search queries: try franchise name first (more specific), then movie title
  const queries = [...new Set([
    franchiseName ?? "",
    movieTitle,
    // Strip year/subtitle for cleaner search
    movieTitle.replace(/:\s*.+$/, "").trim(),
    movieTitle.replace(/\s*\(\d{4}\)/, "").trim(),
  ].filter(q => q.length > 2))];

  let bestVolume: { id: number; name: string } | null = null;
  let bestScore = 0;

  for (const query of queries) {
    const volumes = await searchComicVineVolumes(query, 10).catch(() => []);
    for (const vol of volumes) {
      // Score against both movie title and franchise name
      const s1 = volumeTitleScore(vol.name, movieTitle);
      const s2 = franchiseName ? volumeTitleScore(vol.name, franchiseName) : 0;
      const score = Math.max(s1, s2);
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestVolume = vol;
      }
    }
    if (bestScore >= 0.9) break; // Perfect match found
  }

  if (!bestVolume) return resultMap; // No CV volume found for this franchise

  // Get all characters from the matched volume
  const volumeChars = await getCvVolumeCharacters(bestVolume.id).catch(() => []);
  if (volumeChars.length === 0) return resultMap;

  // Cross-reference TMDB character names against volume characters
  const toFetch: Array<{ charName: string; cvId: number }> = [];
  for (const charName of characterNames) {
    const match = volumeChars.find(vc => cvNameMatches(vc, charName));
    if (match) toFetch.push({ charName, cvId: match.id });
  }

  // Fetch full details (with images) for matched characters
  await Promise.allSettled(
    toFetch.map(async ({ charName, cvId }) => {
      try {
        const cvDetail = await getComicVineCharacterById(cvId);
        if (cvDetail) {
          resultMap.set(charName, {
            id: cvId,
            name: cvDetail.name,
            imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
            sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${cvId}/`,
          });
        }
      } catch { /* ignore individual failures */ }
    }),
  );

  return resultMap;
}

// ── Build CV detail response (shared by cv: handler and cvs: handler) ─────────

async function buildCvDetailResponse(cvId: number, now: number) {
  const cvDetail = await getComicVineCharacterById(cvId).catch(() => null);
  if (!cvDetail) return null;

  const filmCacheKey = `cv:${cvId}`;
  const filmCached = FILMOGRAPHY_CACHE.get(filmCacheKey);
  let filmography: FilmographyEntry[] = [];
  if (filmCached && now - filmCached.ts < CACHE_TTL) {
    filmography = filmCached.filmography;
  } else {
    const specificRealName = (cvDetail.real_name && cvDetail.real_name.length >= 6)
      ? cvDetail.real_name : null;
    const [kwFilmo1, kwFilmo2] = await Promise.allSettled([
      getFilmographyByKeyword(cvDetail.name),
      specificRealName ? getFilmographyByKeyword(specificRealName) : Promise.resolve([] as FilmographyEntry[]),
    ]);
    filmography = mergeFilmographies(
      kwFilmo1.status === "fulfilled" ? kwFilmo1.value : [],
      kwFilmo2.status === "fulfilled" ? kwFilmo2.value : [],
    );
    FILMOGRAPHY_CACHE.set(filmCacheKey, { filmography, ts: now });
  }

  const rawDesc = cvDetail.deck || cvDetail.description || "";
  const description = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

  return {
    wikidataId: `cv:${cvId}`,
    charId: `cv:${cvId}`,
    name: cvDetail.name,
    description,
    imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
    filmography,
    source: "comicvine" as const,
    sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${cvId}/`,
  };
}

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────

router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    let tmdbId = req.params.tmdbId as string;
    if (tmdbId.includes("%")) {
      try { tmdbId = decodeURIComponent(tmdbId); } catch { /* keep */ }
    }

    const cached = BY_MOVIE_CACHE.get(tmdbId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json({ results: cached.results });
    }

    let characterEntries: Array<{ name: string }> = [];
    let movieTitle = "";
    let originalLanguage = "";
    let genreIds: number[] = [];
    let isTvSeries = false;
    let hasFranchise = false;
    let franchiseName: string | null = null;

    try {
      if (tmdbId.startsWith("tmdb_tv:")) {
        isTvSeries = true;
        hasFranchise = true; // TV series are always ongoing franchises
        const tvId = tmdbId.replace("tmdb_tv:", "");
        const [credits, tvInfo] = await Promise.all([
          tmdbFetch<{ cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }> }>(
            `/tv/${tvId}/aggregate_credits`,
          ).catch(() => ({ cast: [] })),
          tmdbFetch<TvInfoShape>(`/tv/${tvId}`).catch((): TvInfoShape => ({})),
        ]);
        movieTitle = tvInfo.name ?? "";
        originalLanguage = tvInfo.original_language ?? "";
        genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map(g => g.id);
        characterEntries = (credits.cast ?? [])
          .map(c => ({ name: cleanCharacterName(c.roles?.[0]?.character ?? c.character ?? "") }))
          .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
          .slice(0, 20);

      } else {
        // Movie paths — resolve to a numeric TMDB movie ID
        let movieNumId: string | null = null;

        if (tmdbId.startsWith("tmdb:")) {
          movieNumId = tmdbId.replace("tmdb:", "");
        } else if (/^\d+$/.test(tmdbId)) {
          movieNumId = tmdbId;
        } else if (/^tt\d+$/.test(tmdbId)) {
          const findData = await tmdbFetch<FindShape>(
            `/find/${encodeURIComponent(tmdbId)}`, { external_source: "imdb_id" },
          ).catch((): FindShape => ({}));
          const movieHit = findData.movie_results?.[0];
          const tvHit = findData.tv_results?.[0];
          if (tvHit && !movieHit) {
            // IMDb ID resolved to a TV show — re-enter as TV
            isTvSeries = true;
            hasFranchise = true;
            const [credits, tvInfo] = await Promise.all([
              tmdbFetch<{ cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }> }>(
                `/tv/${tvHit.id}/aggregate_credits`,
              ).catch(() => ({ cast: [] })),
              tmdbFetch<TvInfoShape>(`/tv/${tvHit.id}`).catch((): TvInfoShape => ({})),
            ]);
            movieTitle = tvInfo.name ?? "";
            originalLanguage = tvInfo.original_language ?? "";
            genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map(g => g.id);
            characterEntries = (credits.cast ?? [])
              .map(c => ({ name: cleanCharacterName(c.roles?.[0]?.character ?? c.character ?? "") }))
              .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
              .slice(0, 20);
          } else if (movieHit) {
            movieNumId = String(movieHit.id);
          }
        }

        if (movieNumId && !isTvSeries) {
          const [credits, movieInfo] = await Promise.all([
            tmdbFetch<{ cast?: Array<{ character?: string }> }>(
              `/movie/${movieNumId}/credits`,
            ).catch(() => ({ cast: [] })),
            tmdbFetch<MovieInfoShape>(`/movie/${movieNumId}`).catch((): MovieInfoShape => ({})),
          ]);
          movieTitle = movieInfo.title ?? "";
          originalLanguage = movieInfo.original_language ?? "";
          genreIds = movieInfo.genre_ids ?? (movieInfo.genres ?? []).map(g => g.id);
          hasFranchise = !!movieInfo.belongs_to_collection;
          franchiseName = movieInfo.belongs_to_collection?.name ?? null;
          characterEntries = (credits.cast ?? [])
            .map(c => ({ name: cleanCharacterName(c.character ?? "") }))
            .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
            .slice(0, 20);
        }
      }
    } catch { /* ignore */ }

    // Standalone movies (no franchise collection) → no character section
    if (!isTvSeries && !hasFranchise) {
      BY_MOVIE_CACHE.set(tmdbId, { results: [], ts: Date.now() });
      return res.json({ results: [] });
    }

    if (characterEntries.length === 0) {
      BY_MOVIE_CACHE.set(tmdbId, { results: [], ts: Date.now() });
      return res.json({ results: [] });
    }

    const anime = isAnime(originalLanguage, genreIds);

    // ── Anime: match via AniList ──────────────────────────────────────────────
    let anilistChars: AniListChar[] = [];
    if (anime && movieTitle) {
      anilistChars = await getAniListCharacters(movieTitle).catch(() => []);
    }

    // ── Non-anime: match via CV volume-first (must validate against franchise) ─
    let cvLookup = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
    if (!anime) {
      cvLookup = await lookupComicVineForMovie(
        characterEntries.map(e => e.name),
        movieTitle,
        franchiseName,
      );
    }

    // Build results — only include characters that were successfully matched.
    // Unmatched characters are excluded entirely (no stubs, no wrong data).
    const results: CharResult[] = [];

    for (const entry of characterEntries) {
      if (anime) {
        const alMatch = matchAniListChar(entry.name, anilistChars);
        if (alMatch) {
          results.push({
            name: alMatch.name,
            wikidataId: `al:${alMatch.id}`,
            description: alMatch.description ?? "",
            imageUrl: alMatch.imageUrl ?? null,
            alias: null,
            source: "anilist",
            sourceUrl: `https://anilist.co/character/${alMatch.id}`,
          });
        } else {
          // Include as AniList-context stub (no image yet, but correct source)
          // als: prefix tells the detail handler to search AniList only
          results.push({
            name: entry.name,
            wikidataId: `als:${entry.name}`,
            description: "",
            imageUrl: null,
            alias: null,
            source: "anilist",
          });
        }
      } else {
        const cvMatch = cvLookup.get(entry.name) ?? null;
        if (cvMatch) {
          // Only show characters that are validated against the franchise volume
          results.push({
            name: cvMatch.name,
            wikidataId: `cv:${cvMatch.id}`,
            description: "",
            imageUrl: cvMatch.imageUrl ?? null,
            alias: null,
            source: "comicvine",
            sourceUrl: cvMatch.sourceUrl,
          });
          // Unmatched non-anime chars are intentionally excluded
        }
      }
    }

    BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() });
    return res.json({ results });
  }),
);

// ── GET /character/:charId ────────────────────────────────────────────────────

router.get(
  "/:charId",
  asyncHandler(async (req, res) => {
    let rawCharId = req.params["charId"] as string;

    // Normalise URL-encoded prefixes (encodeURIComponent encodes ":" as "%3A")
    const lower = rawCharId.toLowerCase();
    if (lower.startsWith("al%3a"))       rawCharId = "al:"  + rawCharId.slice(5);
    else if (lower.startsWith("cv%3a"))  rawCharId = "cv:"  + rawCharId.slice(5);
    else if (lower.startsWith("als%3a")) rawCharId = "als:" + rawCharId.slice(6);
    else if (lower.startsWith("cvs%3a")) rawCharId = "cvs:" + rawCharId.slice(6);
    else if (rawCharId.includes("%")) {
      try { rawCharId = decodeURIComponent(rawCharId); } catch { /* keep */ }
    }
    if (!rawCharId || rawCharId.length < 1) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const now = Date.now();

    // ── al:<id>  — AniList character by ID ───────────────────────────────────
    if (rawCharId.startsWith("al:")) {
      const anilistId = parseInt(rawCharId.slice(3), 10);
      if (isNaN(anilistId)) return res.status(400).json({ error: "Invalid AniList ID" });

      const charDetail = await getAniListCharacterById(anilistId).catch(() => null);
      if (!charDetail) return res.status(404).json({ error: "Character not found" });

      const filmCached = FILMOGRAPHY_CACHE.get(rawCharId);
      let filmography: FilmographyEntry[] = [];
      if (filmCached && now - filmCached.ts < CACHE_TTL) {
        filmography = filmCached.filmography;
      } else {
        const [anilistFilmo, kwFilmo] = await Promise.all([
          getFilmographyFromAniListMedia(charDetail.media),
          getFilmographyByKeyword(charDetail.name).catch(() => [] as FilmographyEntry[]),
        ]);
        filmography = mergeFilmographies(anilistFilmo, kwFilmo);
        FILMOGRAPHY_CACHE.set(rawCharId, { filmography, ts: now });
      }

      return res.json({
        wikidataId: rawCharId,
        charId: rawCharId,
        name: charDetail.name,
        description: charDetail.description ?? "",
        imageUrl: charDetail.imageUrl,
        filmography,
        source: "anilist",
        sourceUrl: `https://anilist.co/character/${anilistId}`,
      });
    }

    // ── cv:<id>  — Comic Vine character by ID ────────────────────────────────
    if (rawCharId.startsWith("cv:")) {
      const cvId = parseInt(rawCharId.slice(3), 10);
      if (isNaN(cvId)) return res.status(400).json({ error: "Invalid Comic Vine ID" });

      const result = await buildCvDetailResponse(cvId, now);
      if (!result) return res.status(404).json({ error: "Character not found" });
      return res.json({ ...result, wikidataId: rawCharId });
    }

    // ── als:<name>  — AniList search by name (anime context) ─────────────────
    // Triggered when by-movie found the title is anime but couldn't pre-match
    // the character to an AniList ID. Stays within AniList — never touches CV.
    if (rawCharId.startsWith("als:")) {
      const charName = decodeURIComponent(rawCharId.slice(4));
      const alByName = await getAniListCharacterByName(charName).catch(() => null);

      if (alByName && isValidAniListNameMatch(charName, alByName)) {
        const alCacheKey = `al:${alByName.id}`;
        const filmCached = FILMOGRAPHY_CACHE.get(alCacheKey);
        let filmography: FilmographyEntry[] = [];
        if (filmCached && now - filmCached.ts < CACHE_TTL) {
          filmography = filmCached.filmography;
        } else {
          const [anilistFilmo, kwFilmo] = await Promise.all([
            getFilmographyFromAniListMedia(alByName.media),
            getFilmographyByKeyword(alByName.name).catch(() => [] as FilmographyEntry[]),
          ]);
          filmography = mergeFilmographies(anilistFilmo, kwFilmo);
          FILMOGRAPHY_CACHE.set(alCacheKey, { filmography, ts: now });
        }
        return res.json({
          wikidataId: rawCharId,
          charId: alCacheKey,
          name: alByName.name,
          description: alByName.description ?? "",
          imageUrl: alByName.imageUrl,
          filmography,
          source: "anilist",
          sourceUrl: `https://anilist.co/character/${alByName.id}`,
        });
      }

      // No valid AniList match
      return res.json({ wikidataId: rawCharId, charId: rawCharId, name: decodeURIComponent(rawCharId.slice(4)), description: "", imageUrl: null, filmography: [], source: "anilist" });
    }

    // ── cvs:<name>  — CV search by name (non-anime, backward compat) ─────────
    // Generated by old cached by-movie data. Does a name-based CV search.
    if (rawCharId.startsWith("cvs:")) {
      const charName = decodeURIComponent(rawCharId.slice(4));

      if (process.env["COMIC_VINE_API_KEY"]) {
        try {
          const cvResults = await searchComicVineCharacters(charName, 5);
          const cvMatch = cvResults.find(r => cvNameMatches(r, charName)) ?? null;
          if (cvMatch) {
            const result = await buildCvDetailResponse(cvMatch.id, now);
            if (result) return res.json({ ...result, wikidataId: rawCharId });
          }
        } catch { /* CV optional */ }
      }

      return res.json({ wikidataId: rawCharId, charId: rawCharId, name: charName, description: "", imageUrl: null, filmography: [], source: "comicvine" });
    }

    // ── Plain name (legacy fallback for old cached wikidataIds) ──────────────
    const characterName = decodeURIComponent(rawCharId);

    let cvFound = false;
    if (process.env["COMIC_VINE_API_KEY"]) {
      try {
        const cvResults = await searchComicVineCharacters(characterName, 5);
        const cvMatch = cvResults.find(r => cvNameMatches(r, characterName)) ?? null;
        if (cvMatch) {
          cvFound = true;
          const result = await buildCvDetailResponse(cvMatch.id, now);
          if (result) return res.json({ ...result, wikidataId: rawCharId });
        }
      } catch { /* CV optional */ }
    }

    if (!cvFound) {
      const alByName = await getAniListCharacterByName(characterName).catch(() => null);
      if (alByName && isValidAniListNameMatch(characterName, alByName)) {
        const alCacheKey = `al:${alByName.id}`;
        const filmCached = FILMOGRAPHY_CACHE.get(alCacheKey);
        let filmography: FilmographyEntry[] = [];
        if (filmCached && now - filmCached.ts < CACHE_TTL) {
          filmography = filmCached.filmography;
        } else {
          const [anilistFilmo, kwFilmo] = await Promise.all([
            getFilmographyFromAniListMedia(alByName.media),
            getFilmographyByKeyword(alByName.name).catch(() => [] as FilmographyEntry[]),
          ]);
          filmography = mergeFilmographies(anilistFilmo, kwFilmo);
          FILMOGRAPHY_CACHE.set(alCacheKey, { filmography, ts: now });
        }
        return res.json({
          wikidataId: rawCharId,
          charId: alCacheKey,
          name: alByName.name,
          description: alByName.description ?? "",
          imageUrl: alByName.imageUrl,
          filmography,
          source: "anilist",
          sourceUrl: `https://anilist.co/character/${alByName.id}`,
        });
      }
    }

    return res.json({ wikidataId: rawCharId, charId: rawCharId, name: characterName, description: "", imageUrl: null, filmography: [], source: "tmdb" });
  }),
);

export default router;
