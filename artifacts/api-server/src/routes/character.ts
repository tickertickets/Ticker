import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  getAniListMediaWithChars,
  getAniListCharacterById,
  getAniListCharacterByName,
  getAniListCharactersByMediaId,
  type AniListMedia,
  type AniListChar,
  type AniListCharDetail,
} from "../lib/anilist";
import {
  searchComicVineCharacters,
  searchComicVineVolumes,
  getCvVolumeCharacters,
  getComicVineCharacterById,
  cleanCvDescription,
  cvNameMatches,
  type VolumeCredit,
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

type StructuredInfoEntry = { key: string; value: string };

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

const BY_MOVIE_CACHE    = new Map<string, { results: CharResult[]; ts: number }>();
const FILMOGRAPHY_CACHE = new Map<string, { filmography: FilmographyEntry[]; ts: number }>();
const CACHE_TTL         = 12 * 60 * 60 * 1000;

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
 * Score how well a CV volume title matches a movie/series title.
 * Returns 0–1 (0 = no match, 1 = exact).
 *
 * Key fix: penalise very short/generic CV titles that are merely substrings
 * of a longer movie title (e.g. "Punisher" must NOT score high against
 * "Punisher: One Last Kill" because that would pull in every Punisher character
 * from unrelated story arcs).
 */
function volumeTitleScore(cvTitle: string, movieTitle: string): number {
  const cv = normTitle(cvTitle);
  const mv = normTitle(movieTitle);
  if (!cv || !mv) return 0;

  // Exact match
  if (cv === mv) return 1;

  // CV title contains the full movie title → the volume is a superset, good
  if (cv.includes(mv)) return 0.9;

  // Movie title contains the CV title — only accept if CV title is substantial
  // relative to movie title. "Punisher" (8 chars) vs "Punisher One Last Kill"
  // (22 chars) = ratio 0.36 → score 0.3 (below any useful threshold).
  if (mv.includes(cv)) {
    const ratio = cv.length / mv.length;
    if (ratio >= 0.65) return 0.85;
    if (ratio >= 0.45) return 0.60;
    return 0.25; // Too generic — reject
  }

  // Word-overlap fallback
  const cvWords = cv.split(" ").filter(w => w.length > 2);
  const mvWords = mv.split(" ").filter(w => w.length > 2);
  if (cvWords.length === 0 || mvWords.length === 0) return 0;
  const overlap = cvWords.filter(w => mvWords.includes(w));
  // Use max length to penalise one-sided overlap
  return overlap.length / Math.max(cvWords.length, mvWords.length);
}

// ── AniList match helpers ─────────────────────────────────────────────────────

function matchAniListChar(tmdbName: string, anilistChars: AniListChar[]): AniListChar | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm    = normalize(tmdbName);
  const tmdbRomaji  = normalizeRomaji(tmdbName);
  const tmdbWords   = tmdbNorm.split(/\s+/).filter(w => w.length > 1);
  const tmdbRomajiW = tmdbRomaji.split(/\s+/).filter(w => w.length > 1);

  // 1. Exact name match
  for (const ac of anilistChars) { if (normalize(ac.name) === tmdbNorm) return ac; }
  // 2. Romaji exact
  for (const ac of anilistChars) { if (normalizeRomaji(ac.name) === tmdbRomaji) return ac; }
  // 3. Full word overlap (normalised)
  for (const ac of anilistChars) {
    const alWords = normalize(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbWords.length, alWords.length)) return ac;
  }
  // 4. Full word overlap (romaji)
  for (const ac of anilistChars) {
    const alWords = normalizeRomaji(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbRomajiW.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbRomajiW.length, alWords.length)) return ac;
  }
  // 5. Reversed two-word romaji
  if (tmdbRomajiW.length === 2) {
    const reversed = `${tmdbRomajiW[1]} ${tmdbRomajiW[0]}`;
    for (const ac of anilistChars) { if (normalizeRomaji(ac.name) === reversed) return ac; }
  }
  // 6. Alternative names
  for (const ac of anilistChars) {
    for (const alt of ac.alternativeNames) {
      const altNorm   = normalize(alt);
      const altRomaji = normalizeRomaji(alt);
      if (altNorm === tmdbNorm || altRomaji === tmdbRomaji) return ac;
    }
  }
  return null;
}

/**
 * Validate that an AniList character search result actually belongs to an
 * anime whose title matches the expected media title.
 */
function isValidAniListForMedia(
  charDetail: AniListCharDetail,
  expectedTitle: string,
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const exp = norm(expectedTitle);
  if (!exp) return charDetail.media.some(m => m.type === "ANIME");

  return charDetail.media.some(m => {
    if (m.type !== "ANIME") return false;
    const titleE = m.titleEnglish ? norm(m.titleEnglish) : "";
    const titleR = m.titleRomaji  ? norm(m.titleRomaji)  : "";
    if (titleE === exp || titleR === exp) return true;
    if (titleE && exp.includes(titleE)) return true;
    if (titleR && exp.includes(titleR)) return true;
    if (titleE && titleE.includes(exp)) return true;
    if (titleR && titleR.includes(exp)) return true;
    return false;
  });
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

// ── Franchise terms helper ────────────────────────────────────────────────────

function buildFranchiseTerms(movieTitle: string, franchiseName: string | null): string[] {
  const terms = new Set<string>();
  if (franchiseName && franchiseName.length > 2) terms.add(franchiseName);
  if (movieTitle && movieTitle.length > 2) terms.add(movieTitle);
  // Strip subtitle after colon/dash: "Predator: Badlands" → "Predator"
  const base = movieTitle.replace(/[:\-–—].+$/, "").trim();
  if (base && base.length > 2 && base !== movieTitle) terms.add(base);
  // Strip year suffixes: "The Boys (2019)" → "The Boys"
  const noYear = movieTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  if (noYear && noYear !== movieTitle) terms.add(noYear);
  return [...terms].filter(t => t.length > 2);
}

/**
 * Check if a CV character's volume_credits include any volume title that
 * matches one of the franchise terms well enough.
 * This is the core franchise-validation gate that prevents wrong characters.
 */
function characterBelongsToFranchise(
  volumeCredits: VolumeCredit[] | undefined,
  franchiseTerms: string[],
): boolean {
  if (!volumeCredits || volumeCredits.length === 0) return false;
  for (const vc of volumeCredits) {
    for (const term of franchiseTerms) {
      if (volumeTitleScore(vc.name, term) >= 0.65) return true;
    }
  }
  return false;
}

// ── CV Volume-First + Fallback Lookup ────────────────────────────────────────

/**
 * For non-anime movies/shows: find matching Comic Vine characters while
 * strictly validating they belong to the correct franchise.
 *
 * Two-pass strategy:
 *  Pass 1 — Volume-based (strict 0.75 threshold):
 *    Find the CV volume that best matches the franchise title, then
 *    cross-reference TMDB character names against that volume's characters.
 *
 *  Pass 2 — Direct search + volume_credits validation (for chars missed in pass 1):
 *    Search CV for the character name directly, then validate via
 *    volume_credits that the result actually belongs to this franchise.
 *    Only include results that have an image (or at minimum a description).
 *
 * Characters not validated by either pass are excluded entirely.
 */
async function lookupComicVineForMovie(
  characterNames: string[],
  movieTitle: string,
  franchiseName: string | null,
): Promise<Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>> {
  const resultMap = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
  if (!process.env["COMIC_VINE_API_KEY"] || !movieTitle) return resultMap;

  const franchiseTerms = buildFranchiseTerms(movieTitle, franchiseName);

  // ── Pass 1: Volume-based matching ─────────────────────────────────────────

  let bestVolume: { id: number; name: string } | null = null;
  let bestScore = 0;

  for (const query of franchiseTerms) {
    const volumes = await searchComicVineVolumes(query, 10).catch(() => []);
    for (const vol of volumes) {
      let score = 0;
      for (const term of franchiseTerms) {
        score = Math.max(score, volumeTitleScore(vol.name, term));
      }
      if (score > bestScore) {
        bestScore = score;
        bestVolume = vol;
      }
    }
    if (bestScore >= 0.9) break;
  }

  // Only use the volume if we have a strong enough title match
  const VOLUME_THRESHOLD = 0.75;
  const matchedVolumeChars: Array<{ id: number; name: string }> = [];

  if (bestVolume && bestScore >= VOLUME_THRESHOLD) {
    const vChars = await getCvVolumeCharacters(bestVolume.id).catch(() => []);
    matchedVolumeChars.push(...vChars);
  }

  const unmatchedNames = new Set(characterNames);

  // Process volume matches first
  await Promise.allSettled(
    characterNames.map(async (charName) => {
      const match = matchedVolumeChars.find(vc => cvNameMatches(vc, charName));
      if (!match) return;
      try {
        const cvDetail = await getComicVineCharacterById(match.id);
        if (cvDetail) {
          resultMap.set(charName, {
            id: match.id,
            name: cvDetail.name,
            imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
            sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${match.id}/`,
          });
          unmatchedNames.delete(charName);
        }
      } catch { /* ignore */ }
    }),
  );

  // ── Pass 2: Direct search + volume_credits franchise validation ────────────
  // Only for chars not found in volume pass

  await Promise.allSettled(
    [...unmatchedNames].map(async (charName) => {
      try {
        // Search CV for up to 10 results for this character name
        const cvResults = await searchComicVineCharacters(charName, 10);
        const candidates = cvResults.filter(r => cvNameMatches(r, charName));
        if (candidates.length === 0) return;

        for (const candidate of candidates) {
          // Use volume_credits from search result first (avoids extra fetch)
          let volumeCredits = candidate.volume_credits;

          // If not in search result, fetch full detail to get volume_credits
          if (!volumeCredits || volumeCredits.length === 0) {
            const full = await getComicVineCharacterById(candidate.id).catch(() => null);
            volumeCredits = full?.volume_credits ?? [];
          }

          // Validate franchise
          if (!characterBelongsToFranchise(volumeCredits, franchiseTerms)) continue;

          // Fetch full detail for image/description
          const cvDetail = await getComicVineCharacterById(candidate.id).catch(() => null);
          if (!cvDetail) continue;

          // Require at least an image OR a non-empty description for pass-2 matches
          // This prevents blank/placeholder CV entries from polluting results
          const hasImage = !!(cvDetail.image?.super_url || cvDetail.image?.medium_url);
          const hasDesc  = !!(cvDetail.deck || cvDetail.description);
          if (!hasImage && !hasDesc) continue;

          resultMap.set(charName, {
            id: cvDetail.id,
            name: cvDetail.name,
            imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
            sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${cvDetail.id}/`,
          });
          break; // First valid match wins
        }
      } catch { /* ignore */ }
    }),
  );

  return resultMap;
}

// ── Build CV detail response ──────────────────────────────────────────────────

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

  // Use deck as primary short description; fall back to first paragraph of description
  const deckText = cvDetail.deck?.trim() ?? "";
  const descText = cleanCvDescription(cvDetail.description);
  // Combine deck + description (avoid duplication)
  let fullDescription = deckText;
  if (descText && !descText.startsWith(deckText)) {
    fullDescription = deckText ? `${deckText}\n\n${descText}` : descText;
  }

  return {
    wikidataId: `cv:${cvId}`,
    charId: `cv:${cvId}`,
    name: cvDetail.name,
    description: fullDescription.trim(),
    structuredInfo: [] as StructuredInfoEntry[],
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
        hasFranchise = true;
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

    // Standalone movies with no franchise collection → no character section
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
    // Use getAniListMediaWithChars so we capture the media ID.
    // Matched chars get `al:ID`; unmatched chars get `alm:mediaId:charName`
    // so the detail handler can validate them against the exact media.
    let anilistMediaId: number | null = null;
    let anilistChars: AniListChar[] = [];

    if (anime && movieTitle) {
      const mediaInfo = await getAniListMediaWithChars(movieTitle).catch(() => null);
      if (mediaInfo) {
        anilistMediaId = mediaInfo.mediaId;
        anilistChars = mediaInfo.chars;
      }
    }

    // ── Non-anime: match via CV two-pass lookup ───────────────────────────────
    let cvLookup = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
    if (!anime) {
      cvLookup = await lookupComicVineForMovie(
        characterEntries.map(e => e.name),
        movieTitle,
        franchiseName,
      );
    }

    // Build results
    const results: CharResult[] = [];

    for (const entry of characterEntries) {
      if (anime) {
        const alMatch = matchAniListChar(entry.name, anilistChars);
        if (alMatch) {
          // Confirmed match within the specific anime
          results.push({
            name: alMatch.name,
            wikidataId: `al:${alMatch.id}`,
            description: alMatch.description ?? "",
            imageUrl: alMatch.imageUrl ?? null,
            alias: null,
            source: "anilist",
            sourceUrl: `https://anilist.co/character/${alMatch.id}`,
          });
        } else if (anilistMediaId) {
          // Unmatched in pre-fetched list — encode media ID for validated lazy fetch
          // `alm:mediaId:charName` tells the detail handler to search within that specific media
          results.push({
            name: entry.name,
            wikidataId: `alm:${anilistMediaId}:${encodeURIComponent(entry.name)}`,
            description: "",
            imageUrl: null,
            alias: null,
            source: "anilist",
          });
        }
        // If anilistMediaId is null (AniList doesn't know this anime), skip entirely
      } else {
        const cvMatch = cvLookup.get(entry.name) ?? null;
        if (cvMatch) {
          results.push({
            name: cvMatch.name,
            wikidataId: `cv:${cvMatch.id}`,
            description: "",
            imageUrl: cvMatch.imageUrl ?? null,
            alias: null,
            source: "comicvine",
            sourceUrl: cvMatch.sourceUrl,
          });
        }
        // Unmatched non-anime chars excluded entirely — no stubs
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
    else if (lower.startsWith("alm%3a")) rawCharId = "alm:" + rawCharId.slice(6);
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
        structuredInfo: charDetail.structuredInfo ?? [],
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

    // ── alm:<mediaId>:<charName>  — AniList char validated against specific media
    // Used by new by-movie stubs for unmatched anime characters.
    if (rawCharId.startsWith("alm:")) {
      const rest = rawCharId.slice(4);
      const colonIdx = rest.indexOf(":");
      if (colonIdx < 1) {
        return res.json({ wikidataId: rawCharId, charId: rawCharId, name: decodeURIComponent(rest), description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "anilist" });
      }
      const mediaId  = parseInt(rest.slice(0, colonIdx), 10);
      const charName = decodeURIComponent(rest.slice(colonIdx + 1));

      if (isNaN(mediaId)) {
        return res.json({ wikidataId: rawCharId, charId: rawCharId, name: charName, description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "anilist" });
      }

      // Fetch the character list for this specific AniList media ID
      const mediaChars = await getAniListCharactersByMediaId(mediaId).catch(() => [] as AniListChar[]);
      const alMatch = matchAniListChar(charName, mediaChars);

      if (alMatch) {
        // Found within the exact media — treat as a confirmed al: character
        const alCacheKey = `al:${alMatch.id}`;
        const charDetail = await getAniListCharacterById(alMatch.id).catch(() => null);

        if (charDetail) {
          const filmCached = FILMOGRAPHY_CACHE.get(alCacheKey);
          let filmography: FilmographyEntry[] = [];
          if (filmCached && now - filmCached.ts < CACHE_TTL) {
            filmography = filmCached.filmography;
          } else {
            const [anilistFilmo, kwFilmo] = await Promise.all([
              getFilmographyFromAniListMedia(charDetail.media),
              getFilmographyByKeyword(charDetail.name).catch(() => [] as FilmographyEntry[]),
            ]);
            filmography = mergeFilmographies(anilistFilmo, kwFilmo);
            FILMOGRAPHY_CACHE.set(alCacheKey, { filmography, ts: now });
          }
          return res.json({
            wikidataId: rawCharId,
            charId: alCacheKey,
            name: charDetail.name,
            description: charDetail.description ?? "",
            structuredInfo: charDetail.structuredInfo ?? [],
            imageUrl: charDetail.imageUrl ?? alMatch.imageUrl,
            filmography,
            source: "anilist",
            sourceUrl: `https://anilist.co/character/${alMatch.id}`,
          });
        }
      }

      // Character not found within this specific media — return name-only stub
      // (no wrong data, no cross-franchise confusion)
      return res.json({
        wikidataId: rawCharId,
        charId: rawCharId,
        name: charName,
        description: "",
        structuredInfo: [],
        imageUrl: null,
        filmography: [],
        source: "anilist",
      });
    }

    // ── als:<name>  — Legacy AniList name search (backward compat only) ───────
    // Old cached entries may still use this prefix.
    // We now do a name search but do NOT validate against franchise context,
    // so we only return results with very strong name matches and anime media.
    if (rawCharId.startsWith("als:")) {
      const charName = decodeURIComponent(rawCharId.slice(4));
      // Strip any legacy pipe-encoded media title
      const cleanName = charName.split("|")[0]!.trim();

      const alByName = await getAniListCharacterByName(cleanName).catch(() => null);

      if (alByName && alByName.media.some(m => m.type === "ANIME")) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        const exactMatch =
          normalize(alByName.name) === normalize(cleanName) ||
          alByName.alternativeNames.some(a => normalize(a) === normalize(cleanName));

        if (exactMatch) {
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
            structuredInfo: alByName.structuredInfo ?? [],
            imageUrl: alByName.imageUrl,
            filmography,
            source: "anilist",
            sourceUrl: `https://anilist.co/character/${alByName.id}`,
          });
        }
      }

      return res.json({ wikidataId: rawCharId, charId: rawCharId, name: cleanName, description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "anilist" });
    }

    // ── cvs:<name>  — Legacy CV name search (backward compat only) ────────────
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

      return res.json({ wikidataId: rawCharId, charId: rawCharId, name: charName, description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "comicvine" });
    }

    // ── Plain name (legacy fallback) ──────────────────────────────────────────
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
      if (alByName && alByName.media.some(m => m.type === "ANIME")) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        if (normalize(alByName.name) === normalize(characterName)) {
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
            structuredInfo: alByName.structuredInfo ?? [],
            imageUrl: alByName.imageUrl,
            filmography,
            source: "anilist",
            sourceUrl: `https://anilist.co/character/${alByName.id}`,
          });
        }
      }
    }

    return res.json({ wikidataId: rawCharId, charId: rawCharId, name: characterName, description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "tmdb" });
  }),
);

export default router;
