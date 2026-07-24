import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import { db } from "@workspace/db";
import { characterCacheTable, characterBookmarksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { UnauthorizedError } from "../lib/errors";
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
  getComicVineCharacterById,
  cleanCvDescription,
  cvNameMatches,
  type VolumeCredit,
} from "../lib/comicvine";
import { searchFandom } from "../lib/fandom.js";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type CharResult = {
  name: string;
  wikidataId: string;
  description: string;
  imageUrl: string | null;
  alias: string | null;
  source: "anilist" | "comicvine" | "tmdb" | "cast" | "fandom";
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

/**
 * Match a TMDB character name against the AniList character list.
 *
 * Matching rules (strictest first):
 *  1. Exact full name match (normalised)
 *  2. Exact romaji full name match
 *  3. Reversed 2-word name (Japanese surname-given ↔ given-surname)
 *  4. Exact complete alternative-name match
 *  5. Single-component match: the TMDB query is a single word that EXACTLY
 *     equals one word-component of a 2-word AniList name.
 *     Requires ≥ 4 characters to avoid false positives on short/generic
 *     names like "Ma", "Jo", "Ko".
 *
 * IMPORTANT: partial/substring matching is intentionally excluded.
 * "Sukuna" matching "Ryomen Sukuna" is valid only via rule 5 (single
 * component, ≥4 chars).  "Jo" matching "Jo Someone" is NOT valid.
 */
function matchAniListChar(tmdbName: string, anilistChars: AniListChar[]): AniListChar | null {
  const normalize  = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm   = normalize(tmdbName);
  const tmdbRomaji = normalizeRomaji(tmdbName);

  // 1. Exact full name match
  for (const ac of anilistChars) { if (normalize(ac.name) === tmdbNorm) return ac; }
  // 2. Romaji exact match
  for (const ac of anilistChars) { if (normalizeRomaji(ac.name) === tmdbRomaji) return ac; }
  // 3. Reversed 2-word name (e.g. "Itadori Yuuji" ↔ "Yuuji Itadori")
  const tmdbWords      = tmdbNorm.split(/\s+/).filter(w => w.length > 1);
  const tmdbRomajiW    = tmdbRomaji.split(/\s+/).filter(w => w.length > 1);
  if (tmdbWords.length === 2) {
    const rev    = `${tmdbWords[1]} ${tmdbWords[0]}`;
    const revRom = `${tmdbRomajiW[1] ?? ""} ${tmdbRomajiW[0] ?? ""}`;
    for (const ac of anilistChars) {
      if (normalize(ac.name) === rev || normalizeRomaji(ac.name) === rev ||
          normalize(ac.name) === revRom || normalizeRomaji(ac.name) === revRom) return ac;
    }
  }
  // 4. Exact complete alternative name match
  for (const ac of anilistChars) {
    for (const alt of ac.alternativeNames) {
      if (normalize(alt) === tmdbNorm || normalizeRomaji(alt) === tmdbRomaji) return ac;
    }
  }
  // 5. Single-component match (TMDB has only one word, ≥ 4 chars)
  //    Matches if that word exactly equals one word in a multi-word AniList name.
  //    e.g. "Sukuna" → "Ryomen Sukuna", "Gojo" → "Satoru Gojo",
  //         "Chopper" → "Tony Tony Chopper"
  if (tmdbWords.length === 1 && tmdbWords[0]!.length >= 4) {
    const q      = tmdbWords[0]!;
    const qRom   = tmdbRomaji;
    for (const ac of anilistChars) {
      const acW    = normalize(ac.name).split(/\s+/).filter(w => w.length > 1);
      const acWRom = normalizeRomaji(ac.name).split(/\s+/).filter(w => w.length > 1);
      if (acW.length >= 2   && acW.includes(q))    return ac;
      if (acWRom.length >= 2 && acWRom.includes(qRom)) return ac;
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

/**
 * Build filmography from a CV character's volume_credits by searching TMDB
 * for each volume title. Supplements keyword-based search — especially useful
 * when the character's name differs from their media title (e.g. Homelander
 * in "The Boys"). Searches both movie and TV endpoints and returns the best
 * poster-bearing hit per volume.
 */
async function getFilmographyFromCvVolumeCredits(
  volumeCredits: VolumeCredit[],
): Promise<FilmographyEntry[]> {
  if (volumeCredits.length === 0) return [];

  // Deduplicate by normalised title; cap at 15 volumes to stay within rate limits
  const seen = new Set<string>();
  const toSearch: VolumeCredit[] = [];
  for (const vc of volumeCredits) {
    const key = normTitle(vc.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    toSearch.push(vc);
    if (toSearch.length >= 15) break;
  }

  const results = await Promise.allSettled(
    toSearch.map(async (vc): Promise<FilmographyEntry | null> => {
      try {
        type MovResult = { id: number; title?: string; poster_path?: string | null; release_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number; adult?: boolean };
        type TvResult  = { id: number; name?: string; poster_path?: string | null; first_air_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number; adult?: boolean };

        const [movRes, tvRes] = await Promise.allSettled([
          tmdbFetch<{ results?: MovResult[] }>("/search/movie", { query: vc.name, include_adult: "false" })
            .catch(() => ({ results: [] as MovResult[] })),
          tmdbFetch<{ results?: TvResult[]  }>("/search/tv",    { query: vc.name, include_adult: "false" })
            .catch(() => ({ results: [] as TvResult[] })),
        ]);

        const movItems = movRes.status === "fulfilled" ? (movRes.value.results ?? []) : [];
        const tvItems  = tvRes.status  === "fulfilled" ? (tvRes.value.results  ?? []) : [];

        const MIN_SCORE = 0.75;

        // Prefer TV first — comic volumes are far more often adapted to TV series
        const tvHit = tvItems.find(r =>
          !r.adult && r.poster_path && (r.vote_count ?? 0) >= 10 &&
          !isPornParody(r.name ?? "") &&
          volumeTitleScore(r.name ?? "", vc.name) >= MIN_SCORE,
        );
        if (tvHit) {
          return {
            title: tvHit.name ?? vc.name,
            year: tvHit.first_air_date?.slice(0, 4) ?? null,
            imdbId: `tmdb_tv:${tvHit.id}`,
            posterUrl: tvHit.poster_path ? posterUrl(tvHit.poster_path) : null,
            tmdbRating: tvHit.vote_average != null ? String(tvHit.vote_average.toFixed(1)) : null,
            voteCount: tvHit.vote_count ?? 0,
            genreIds: tvHit.genre_ids ?? [],
            popularity: tvHit.popularity ?? 0,
            franchiseIds: [],
            mediaType: "tv",
          };
        }

        // Fallback: movie — must also meet title-match threshold
        const movHit = movItems.find(r =>
          !r.adult && r.poster_path && (r.vote_count ?? 0) >= 10 &&
          !isPornParody(r.title ?? "") &&
          volumeTitleScore(r.title ?? "", vc.name) >= MIN_SCORE,
        );
        if (movHit) {
          return {
            title: movHit.title ?? vc.name,
            year: movHit.release_date?.slice(0, 4) ?? null,
            imdbId: `tmdb:${movHit.id}`,
            posterUrl: movHit.poster_path ? posterUrl(movHit.poster_path) : null,
            tmdbRating: movHit.vote_average != null ? String(movHit.vote_average.toFixed(1)) : null,
            voteCount: movHit.vote_count ?? 0,
            genreIds: movHit.genre_ids ?? [],
            popularity: movHit.popularity ?? 0,
            franchiseIds: [],
            mediaType: "movie",
          };
        }

        return null;
      } catch { return null; }
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FilmographyEntry | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is FilmographyEntry => v !== null);
}

// ── Franchise terms helper ────────────────────────────────────────────────────

type FranchiseTerms = {
  /** Strict terms used for VOLUME SEARCH (pass 1).
   *  Only specific, complete titles — never a bare generic base name.
   *  Prevents "Punisher" base from matching the 200-issue Punisher omnibus. */
  volumeSearch: string[];
  /** Broad terms used for FRANCHISE VALIDATION (pass 2 volume_credits check).
   *  Includes the stripped base name so a character can be validated against
   *  the wider franchise even if the volume title is only the root name. */
  validation: string[];
};

function buildFranchiseTerms(movieTitle: string, franchiseName: string | null): FranchiseTerms {
  const volumeSearch = new Set<string>();
  const validation   = new Set<string>();

  const add = (s: string, sets: Set<string>[]) => {
    if (s && s.trim().length > 3) sets.forEach(set => set.add(s.trim()));
  };

  // Franchise name (e.g. "The Boys Collection", "Predator Collection")
  if (franchiseName) add(franchiseName, [volumeSearch, validation]);

  // Full movie/show title
  add(movieTitle, [volumeSearch, validation]);

  // Strip year suffix: "The Boys (2019)" → "The Boys"
  const noYear = movieTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  if (noYear !== movieTitle) add(noYear, [volumeSearch, validation]);

  // Base name (strip subtitle): "Punisher: One Last Kill" → "Punisher"
  // Only added to VALIDATION so it can confirm franchise membership,
  // but NOT to volumeSearch — that would pull in every story arc in the
  // entire Punisher run.
  const base = movieTitle.replace(/[:\-–—].+$/, "").trim();
  if (base && base !== movieTitle) add(base, [validation]);

  // For movies WITHOUT a TMDB franchise, also add individual title words (≥4 chars)
  // as validation terms.  This is essential for standalone films like
  // "Star Wars Maul Shadow Lord" where the full title doesn't match any CV volume,
  // but individual words like "wars" or "maul" do match "Star Wars" or "Darth Maul".
  if (!franchiseName) {
    const STOP = new Set(["the", "and", "for", "from", "with", "into", "this", "that",
                          "last", "over", "dark", "rise", "fall", "true", "real"]);
    movieTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP.has(w))
      .forEach(w => add(w, [validation]));
  }

  return {
    volumeSearch: [...volumeSearch],
    validation:   [...validation],
  };
}

/**
 * Check if a CV character's volume_credits include any volume title that
 * matches one of the franchise terms well enough.
 * threshold defaults to 0.65 for franchise movies; pass 0.4 for standalone films.
 */
function characterBelongsToFranchise(
  volumeCredits: VolumeCredit[] | undefined,
  franchiseTerms: string[],
  threshold = 0.65,
): boolean {
  if (!volumeCredits || volumeCredits.length === 0) return false;
  for (const vc of volumeCredits) {
    for (const term of franchiseTerms) {
      if (volumeTitleScore(vc.name, term) >= threshold) return true;
    }
  }
  return false;
}

// ── CV Character Lookup ───────────────────────────────────────────────────────

/**
 * For non-anime movies/shows: find matching Comic Vine characters and validate
 * that they belong to this movie's source material.
 *
 * Strategy: direct character search + volume_credits validation.
 *  1. Search CV for each character name (top 5 results).
 *  2. Take the first result whose name matches (cvNameMatches).
 *  3. Fetch full character detail (cached after first call).
 *  4. Validate via volume_credits that the character is from this franchise.
 *     — Franchise movies (TMDB collection): strict threshold 0.65
 *     — Standalone movies: relaxed threshold 0.4 + word-level validation terms
 *  5. Require at least an image OR description (rejects empty stubs).
 *
 * Characters are processed in batches of 5 to avoid CV API rate limits.
 * Each character causes at most 2 CV API calls (search + detail), both cached.
 */
async function lookupComicVineForMovie(
  characterEntries: Array<{ name: string; altName: string | null }>,
  movieTitle: string,
  franchiseName: string | null,
): Promise<Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>> {
  const resultMap = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
  if (!process.env["COMIC_VINE_API_KEY"] || !movieTitle) return resultMap;

  const terms = buildFranchiseTerms(movieTitle, franchiseName);
  // Franchise movies use strict threshold; standalone films use relaxed threshold
  // because their title words (e.g. "wars", "maul") are used as validation terms.
  const threshold = franchiseName ? 0.65 : 0.4;

  // Try one candidate (search result) against the franchise validation.
  const tryCvCandidate = async (
    storeKey: string,
    searchName: string,
  ): Promise<boolean> => {
    const searchResults = await searchComicVineCharacters(searchName, 5);
    const candidates = searchResults.filter(r => cvNameMatches(r, searchName));
    for (const candidate of candidates) {
      const detail = await getComicVineCharacterById(candidate.id).catch(() => null);
      if (!detail) continue;
      const hasImage = !!(detail.image?.super_url || detail.image?.medium_url);
      const hasDesc  = !!(detail.deck || detail.description);
      if (!hasImage && !hasDesc) continue;

      // Primary validation: volume_credits franchise check
      const volumeOk = characterBelongsToFranchise(detail.volume_credits, terms.validation, threshold);

      if (!volumeOk) {
        // Fallback: characters with too many issues (e.g. 753+) often get
        // empty volume_credits from the CV API because the list is too large
        // to enumerate. In that case, check their deck/description text for
        // franchise keyword matches instead.
        if (!detail.volume_credits || detail.volume_credits.length === 0) {
          const descBlob = `${detail.deck ?? ""} ${detail.description ?? ""}`.toLowerCase();
          const descOk = terms.validation.some(term =>
            descBlob.includes(term.toLowerCase()),
          );
          if (!descOk) continue;
        } else {
          continue;
        }
      }

      resultMap.set(storeKey, {
        id:        detail.id,
        name:      detail.name,
        imageUrl:  detail.image?.super_url ?? detail.image?.medium_url ?? null,
        sourceUrl: detail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${detail.id}/`,
      });
      return true;
    }
    return false;
  };

  // Process in batches of 5 to avoid overwhelming the CV API with concurrent requests.
  const BATCH = 5;
  for (let i = 0; i < characterEntries.length; i += BATCH) {
    const batch = characterEntries.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(async ({ name: charName, altName }) => {
        if (charName.trim().length < 3) return;
        try {
          // Always try primary name, AND try altName as an independent lookup.
          // This handles cases like "Spider-Man / Ben Reilly" where the altName
          // (Ben Reilly) is a distinct CV character from the primary (Peter Parker
          // Spider-Man). Both are looked up independently and the results code
          // prefers the altName match when it resolves to a different character.
          await tryCvCandidate(charName, charName);
          if (altName && altName.trim().length >= 3 && altName !== charName) {
            await tryCvCandidate(altName, altName);
          }
        } catch { /* ignore — character simply won't be included */ }
      }),
    );
  }

  return resultMap;
}

// ── Build CV detail response ──────────────────────────────────────────────────

async function buildCvDetailResponse(cvId: number, now: number) {
  const cvDetail = await getComicVineCharacterById(cvId).catch(() => null);
  if (!cvDetail) return null;

  // CV profiles do not include filmography — they are comic characters, not actors.
  const filmography: FilmographyEntry[] = [];

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
    filmography: [] as FilmographyEntry[],
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
    const _emptyTtl = 60 * 60 * 1000;
    if (cached) {
      const age = Date.now() - cached.ts;
      const ttl = cached.results.length === 0 ? _emptyTtl : CACHE_TTL;
      if (age < ttl) return res.json({ results: cached.results });
    }

    // Check persistent DB cache (survives server restarts)
    // Empty results are only trusted for 1 hour — they may reflect a transient
    // API failure or missing API keys at the time of caching. Non-empty results
    // are trusted for the full CACHE_TTL (12 hours).
    const EMPTY_CACHE_TTL = 60 * 60 * 1000; // 1 hour for empty result sets
    try {
      const dbRow = await db
        .select()
        .from(characterCacheTable)
        .where(eq(characterCacheTable.tmdbId, tmdbId))
        .limit(1);
      if (dbRow.length > 0) {
        const row = dbRow[0];
        const ageMs = Date.now() - new Date(row.cachedAt).getTime();
        const rawResults = row.results as CharResult[];
        // Detect entries where a previous agent stored TMDB actor profile URLs
        // as imageUrl for anilist-sourced characters (those should use s4.anilist.co).
        // Invalidate any cache entry that still uses old al:/cv:/alm: format
        const hasOldFormat = rawResults.length > 0 && rawResults.some(
          r => !r.wikidataId?.startsWith("fm:"),
        );
        const hadBadImages = !hasOldFormat && rawResults.some(
          r => r.source === "anilist" && r.imageUrl?.includes("image.tmdb.org/t/p/"),
        );
        const results = rawResults.map(r =>
          r.source === "anilist" && r.imageUrl?.includes("image.tmdb.org/t/p/")
            ? { ...r, imageUrl: null }
            : r,
        );
        const effectiveTtl = results.length === 0 ? EMPTY_CACHE_TTL : CACHE_TTL;
        if (!hasOldFormat && !hadBadImages && ageMs < effectiveTtl) {
          BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() - ageMs });
          return res.json({ results });
        }
        // Old format or bad images — delete and re-fetch fresh Fandom stubs
        if (hasOldFormat || hadBadImages) {
          db.delete(characterCacheTable).where(eq(characterCacheTable.tmdbId, tmdbId)).catch(() => {});
        }
      }
    } catch { /* ignore DB errors — fall through to live fetch */ }

    const PROFILE_BASE = "https://image.tmdb.org/t/p/w185";
    let characterEntries: Array<{ name: string; altName: string | null; profilePath: string | null }> = [];
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
          tmdbFetch<{ cast?: Array<{ character?: string; roles?: Array<{ character?: string }>; profile_path?: string | null }> }>(
            `/tv/${tvId}/aggregate_credits`,
          ).catch(() => ({ cast: [] })),
          tmdbFetch<TvInfoShape>(`/tv/${tvId}`).catch((): TvInfoShape => ({})),
        ]);
        movieTitle = tvInfo.name ?? "";
        originalLanguage = tvInfo.original_language ?? "";
        genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map(g => g.id);
        {
          const seen = new Set<string>();
          characterEntries = (credits.cast ?? [])
            .map(c => {
              const raw = c.roles?.[0]?.character ?? c.character ?? "";
              const parts = raw.split("/");
              return { name: cleanCharacterName(parts[0] ?? ""), altName: parts[1] ? cleanCharacterName(parts[1]) : null, profilePath: c.profile_path ?? null };
            })
            .filter(e => {
              if (e.name.length <= 1 || isBlockedCharacterName(e.name)) return false;
              const k = e.name.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .slice(0, 30);
        }

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
              tmdbFetch<{ cast?: Array<{ character?: string; roles?: Array<{ character?: string }>; profile_path?: string | null }> }>(
                `/tv/${tvHit.id}/aggregate_credits`,
              ).catch(() => ({ cast: [] })),
              tmdbFetch<TvInfoShape>(`/tv/${tvHit.id}`).catch((): TvInfoShape => ({})),
            ]);
            movieTitle = tvInfo.name ?? "";
            originalLanguage = tvInfo.original_language ?? "";
            genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map(g => g.id);
            {
              const seen = new Set<string>();
              characterEntries = (credits.cast ?? [])
                .map(c => {
                  const raw = c.roles?.[0]?.character ?? c.character ?? "";
                  const parts = raw.split("/");
                  return { name: cleanCharacterName(parts[0] ?? ""), altName: parts[1] ? cleanCharacterName(parts[1]) : null, profilePath: c.profile_path ?? null };
                })
                .filter(e => {
                  if (e.name.length <= 1 || isBlockedCharacterName(e.name)) return false;
                  const k = e.name.toLowerCase();
                  if (seen.has(k)) return false;
                  seen.add(k);
                  return true;
                })
                .slice(0, 30);
            }
          } else if (movieHit) {
            movieNumId = String(movieHit.id);
          }
        }

        if (movieNumId && !isTvSeries) {
          const [credits, movieInfo] = await Promise.all([
            tmdbFetch<{ cast?: Array<{ character?: string; profile_path?: string | null }> }>(
              `/movie/${movieNumId}/credits`,
            ).catch(() => ({ cast: [] })),
            tmdbFetch<MovieInfoShape>(`/movie/${movieNumId}`).catch((): MovieInfoShape => ({})),
          ]);
          movieTitle = movieInfo.title ?? "";
          originalLanguage = movieInfo.original_language ?? "";
          genreIds = movieInfo.genre_ids ?? (movieInfo.genres ?? []).map(g => g.id);
          hasFranchise = !!movieInfo.belongs_to_collection;
          franchiseName = movieInfo.belongs_to_collection?.name ?? null;
          {
            const seen = new Set<string>();
            characterEntries = (credits.cast ?? [])
              .map(c => {
                const raw = c.character ?? "";
                const parts = raw.split("/");
                return { name: cleanCharacterName(parts[0] ?? ""), altName: parts[1] ? cleanCharacterName(parts[1]) : null, profilePath: c.profile_path ?? null };
              })
              .filter(e => {
                if (e.name.length <= 1 || isBlockedCharacterName(e.name)) return false;
                const k = e.name.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              })
              .slice(0, 25);
          }
        }
      }
    } catch { /* ignore */ }

    if (characterEntries.length === 0) {
      BY_MOVIE_CACHE.set(tmdbId, { results: [], ts: Date.now() });
      return res.json({ results: [] });
    }

    // Build Fandom stubs — character images and descriptions are fetched
    // lazily from Fandom wiki when the user opens the character detail page.
    // Actor profile photos are deliberately NOT used as character images.
    const results: CharResult[] = characterEntries.map(entry => ({
      name:        entry.name,
      wikidataId:  `fm:${encodeURIComponent(entry.name)}:${encodeURIComponent(movieTitle)}`,
      description: "",
      imageUrl:    null,
      alias:       null,
      source:      "fandom" as const,
    }));

    BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() });
    // Persist to DB cache (fire-and-forget — don't block the response)
    db.insert(characterCacheTable)
      .values({ tmdbId, results: results as unknown as unknown[], cachedAt: new Date() })
      .onConflictDoUpdate({
        target: characterCacheTable.tmdbId,
        set: { results: results as unknown as unknown[], cachedAt: new Date() },
      })
      .catch(() => { /* ignore */ });
    return res.json({ results });
  }),
);

// ── GET /character/bookmarked — list all bookmarked character IDs ─────────────
// IMPORTANT: must be defined before /:charId so Express doesn't eat it

router.get(
  "/bookmarked",
  asyncHandler(async (req, res) => {
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) throw new UnauthorizedError();
    const rows = await db
      .select({ characterId: characterBookmarksTable.characterId })
      .from(characterBookmarksTable)
      .where(eq(characterBookmarksTable.userId, userId));
    res.json({ characterIds: rows.map(r => r.characterId) });
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
    else if (lower.startsWith("fm%3a"))  rawCharId = "fm:"  + rawCharId.slice(5);
    // Always decode remaining percent-encoding (e.g. alm:204066%3ASuguru%20Geto has a second %3A)
    if (rawCharId.includes("%")) {
      try { rawCharId = decodeURIComponent(rawCharId); } catch { /* keep */ }
    }

    if (!rawCharId || rawCharId.length < 1) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const now = Date.now();

    // ── fm:<charName>:<movieTitle>  — Fandom wiki lookup ─────────────────────
    if (rawCharId.startsWith("fm:")) {
      const rest      = rawCharId.slice(3);
      const colonIdx  = rest.indexOf(":");
      if (colonIdx < 0) {
        return res.json({ wikidataId: rawCharId, charId: rawCharId, name: decodeURIComponent(rest),
          description: "", structuredInfo: [], imageUrl: null, filmography: [], source: "fandom" });
      }
      const charName   = decodeURIComponent(rest.slice(0, colonIdx));
      const movieTitle = decodeURIComponent(rest.slice(colonIdx + 1));
      const [fandomResult, filmography] = await Promise.all([
        searchFandom(charName, movieTitle),
        getFilmographyByKeyword(charName).catch(() => [] as FilmographyEntry[]),
      ]);
      return res.json({
        wikidataId:     rawCharId,
        charId:         rawCharId,
        name:           charName,
        description:    fandomResult?.description ?? "",
        structuredInfo: [],
        imageUrl:       fandomResult?.imageUrl ?? null,
        filmography,
        source:         "fandom",
        sourceUrl:      fandomResult?.sourceUrl ?? null,
      });
    }

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

      // Character not found in the pre-fetched list for this media.
      // Fallback: search AniList by name and check if the result has this
      // EXACT media ID in their media appearances. This handles cases where
      // the character appears in the franchise under a different season title
      // but is the same underlying character.
      const alByName = await getAniListCharacterByName(charName).catch(() => null);
      if (alByName && alByName.media.some(m => m.id === mediaId)) {
        // Character confirmed to belong to this exact media
        const alCacheKey2 = `al:${alByName.id}`;
        const filmCached2 = FILMOGRAPHY_CACHE.get(alCacheKey2);
        let filmography2: FilmographyEntry[] = [];
        if (filmCached2 && now - filmCached2.ts < CACHE_TTL) {
          filmography2 = filmCached2.filmography;
        } else {
          const [af2, kf2] = await Promise.all([
            getFilmographyFromAniListMedia(alByName.media),
            getFilmographyByKeyword(alByName.name).catch(() => [] as FilmographyEntry[]),
          ]);
          filmography2 = mergeFilmographies(af2, kf2);
          FILMOGRAPHY_CACHE.set(alCacheKey2, { filmography: filmography2, ts: now });
        }
        return res.json({
          wikidataId: rawCharId,
          charId: alCacheKey2,
          name: alByName.name,
          description: alByName.description ?? "",
          structuredInfo: alByName.structuredInfo ?? [],
          imageUrl: alByName.imageUrl,
          filmography: filmography2,
          source: "anilist",
          sourceUrl: `https://anilist.co/character/${alByName.id}`,
        });
      }

      // No confirmed match found in this franchise — return name-only stub
      // (avoids showing wrong character from a different franchise)
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

    // ── cast:<name>  — TMDB cast stub (no CV/AniList match) ─────────────────
    // Returns minimal data so the detail page still works.
    if (rawCharId.startsWith("cast:")) {
      const charName = decodeURIComponent(rawCharId.slice(5));
      return res.json({
        wikidataId: rawCharId,
        charId: rawCharId,
        name: charName,
        description: "",
        structuredInfo: [],
        imageUrl: null,
        filmography: [],
        source: "cast",
      });
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

// ── GET /character/:charId/bookmark ──────────────────────────────────────────
router.get(
  "/:charId/bookmark",
  asyncHandler(async (req, res) => {
    const charId = decodeURIComponent(String(req.params["charId"]));
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) {
      res.json({ isBookmarked: false });
      return;
    }
    const [row] = await db
      .select()
      .from(characterBookmarksTable)
      .where(
        and(
          eq(characterBookmarksTable.userId, userId),
          eq(characterBookmarksTable.characterId, charId),
        ),
      )
      .limit(1);
    res.json({ isBookmarked: !!row });
  }),
);

// ── POST /character/:charId/bookmark ─────────────────────────────────────────
router.post(
  "/:charId/bookmark",
  asyncHandler(async (req, res) => {
    const charId = decodeURIComponent(String(req.params["charId"]));
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) throw new UnauthorizedError();
    const [existing] = await db
      .select()
      .from(characterBookmarksTable)
      .where(
        and(
          eq(characterBookmarksTable.userId, userId),
          eq(characterBookmarksTable.characterId, charId),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .delete(characterBookmarksTable)
        .where(
          and(
            eq(characterBookmarksTable.userId, userId),
            eq(characterBookmarksTable.characterId, charId),
          ),
        );
      res.json({ bookmarked: false });
    } else {
      await db
        .insert(characterBookmarksTable)
        .values({ userId, characterId: charId });
      res.json({ bookmarked: true });
    }
  }),
);

export default router;
