import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import { getAniListCharacters, getAniListCharacterById, getAniListCharacterByName, type AniListMedia, type AniListChar, type AniListCharDetail } from "../lib/anilist";
import { searchComicVineCharacters, getComicVineCharacterById, cvNameMatches } from "../lib/comicvine";

const router = Router();

// ── In-memory caches ──────────────────────────────────────────────────────────
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

type TvInfoShape = { name?: string; original_language?: string; genre_ids?: number[]; genres?: Array<{ id: number }> };
type MovieInfoShape = { title?: string; original_language?: string; genre_ids?: number[]; genres?: Array<{ id: number }> };
type FindShape = { movie_results?: Array<{ id: number }>; tv_results?: Array<{ id: number }> };

const BY_MOVIE_CACHE = new Map<string, { results: CharResult[]; ts: number }>();
const FILMOGRAPHY_CACHE = new Map<string, { filmography: FilmographyEntry[]; ts: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORN_KEYWORDS = [
  "porn", "xxx", "adult film", "erotic", "sex film", "nude", "hardcore",
  "softcore", "hentai parody",
];
function isPornParody(title: string): boolean {
  const lower = title.toLowerCase();
  return PORN_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Anime = Japanese-language animation (genre 16).
 * Also catches Korean/Chinese animation to route through AniList.
 */
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
    .split("/")[0]
    .replace(/\s*\(voice\)/i, "")
    .replace(/\s*\(uncredited\)/i, "")
    .replace(/\s*\(archive footage\)/i, "")
    .replace(/\s*\(as [^)]+\)/i, "")
    .replace(/\s*\(cameo\)/i, "")
    .replace(/\s*\(segment[^)]*\)/i, "")
    .trim();
}

/**
 * Normalize Japanese romanization variations so matching works despite
 * spelling differences (e.g. AniList "Yuuji Itadori" vs TMDB "Yuji Itadori",
 * "Satoru Gojou" vs "Satoru Gojo").
 */
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
 * Match a TMDB character name against the AniList character list.
 * Multi-pass: exact → romaji → word-overlap → romaji word-overlap → reversed name → alternative names.
 */
function matchAniListChar(
  tmdbName: string,
  anilistChars: AniListChar[],
): AniListChar | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm = normalize(tmdbName);
  const tmdbRomaji = normalizeRomaji(tmdbName);
  const tmdbWords = tmdbNorm.split(/\s+/).filter(w => w.length > 1);
  const tmdbRomajiWords = tmdbRomaji.split(/\s+/).filter(w => w.length > 1);

  // Pass 1: exact match on full name
  for (const ac of anilistChars) {
    if (normalize(ac.name) === tmdbNorm) return ac;
  }
  // Pass 2: exact match after romaji normalization
  for (const ac of anilistChars) {
    if (normalizeRomaji(ac.name) === tmdbRomaji) return ac;
  }
  // Pass 3: word-overlap match (standard)
  for (const ac of anilistChars) {
    const alWords = normalize(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbWords.length, alWords.length)) return ac;
  }
  // Pass 4: word-overlap after romaji normalization
  for (const ac of anilistChars) {
    const alWords = normalizeRomaji(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbRomajiWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbRomajiWords.length, alWords.length)) return ac;
  }
  // Pass 5: reversed name (Japanese "Last First" order)
  if (tmdbRomajiWords.length === 2) {
    const reversed = `${tmdbRomajiWords[1]} ${tmdbRomajiWords[0]}`;
    for (const ac of anilistChars) {
      if (normalizeRomaji(ac.name) === reversed) return ac;
    }
  }
  // Pass 6: match against alternative names (nickname, alias, native name)
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

/**
 * Validate that an AniList character result is a genuine match for a query name.
 * Prevents cases like "Dek" → returning L Lawliet because AniList fuzzy-matched.
 * Rules:
 *  1. The character must have at least one ANIME media (it's an anime character).
 *  2. The returned character's name (or any alternative) must closely match the query.
 */
function isValidAniListNameMatch(query: string, result: AniListCharDetail): boolean {
  // Rule 1: must have at least one ANIME media entry
  const hasAnimeMedia = result.media.some(m => m.type === "ANIME");
  if (!hasAnimeMedia) return false;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const q = normalize(query);
  const qRomaji = normalizeRomaji(query);
  const qWords = q.split(/\s+/).filter(w => w.length > 2);

  // Rule 2a: exact full name match
  if (normalize(result.name) === q) return true;
  if (normalizeRomaji(result.name) === qRomaji) return true;

  // Rule 2b: word overlap (at least one substantive word must match)
  const nameWords = normalize(result.name).split(/\s+/).filter(w => w.length > 2);
  if (qWords.length > 0 && nameWords.length > 0) {
    const overlap = qWords.filter(w => nameWords.includes(w));
    if (overlap.length >= Math.min(qWords.length, nameWords.length)) return true;
  }

  // Rule 2c: check all alternative names
  for (const alt of result.alternativeNames) {
    const altNorm = normalize(alt);
    if (altNorm === q) return true;
    if (normalizeRomaji(alt) === qRomaji) return true;
  }

  return false;
}

/**
 * Build filmography from AniList media appearances (anime/movies the character is in).
 * For each AniList media item we search TMDB to get the correct poster + rating.
 */
async function getFilmographyFromAniListMedia(media: AniListMedia[]): Promise<FilmographyEntry[]> {
  const animeOnly = media.filter(m => m.type === "ANIME").slice(0, 25);
  if (animeOnly.length === 0) return [];

  const results = await Promise.allSettled(
    animeOnly.map(async (m): Promise<FilmographyEntry | null> => {
      const searchTitle = m.titleEnglish || m.titleRomaji || "";
      if (!searchTitle) return null;

      const isMovie = m.format === "MOVIE";

      if (isMovie) {
        const sr = await tmdbFetch<{
          results?: Array<{
            id: number; title?: string; poster_path?: string | null;
            release_date?: string; vote_average?: number; vote_count?: number;
            genre_ids?: number[]; popularity?: number;
          }>;
        }>("/search/movie", { query: searchTitle, include_adult: "false" }).catch(() => ({ results: [] as Array<{ id: number; title?: string; poster_path?: string | null; release_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }));

        const hit = sr.results?.find(r => r.poster_path) ?? sr.results?.[0];
        if (!hit) return null;

        return {
          title: hit.title ?? searchTitle,
          year: hit.release_date?.slice(0, 4) ?? (m.startYear ? String(m.startYear) : null),
          imdbId: hit.id ? `tmdb:${hit.id}` : null,
          posterUrl: hit.poster_path ? posterUrl(hit.poster_path) : (m.coverImage ?? null),
          tmdbRating: hit.vote_average != null ? String(hit.vote_average.toFixed(1)) : null,
          voteCount: hit.vote_count ?? 0,
          genreIds: hit.genre_ids ?? [16],
          popularity: hit.popularity ?? m.popularity,
          franchiseIds: [],
          mediaType: "movie",
        };
      } else {
        const sr = await tmdbFetch<{
          results?: Array<{
            id: number; name?: string; poster_path?: string | null;
            first_air_date?: string; vote_average?: number; vote_count?: number;
            genre_ids?: number[]; popularity?: number;
          }>;
        }>("/search/tv", { query: searchTitle, include_adult: "false" }).catch(() => ({ results: [] as Array<{ id: number; name?: string; poster_path?: string | null; first_air_date?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; popularity?: number }> }));

        const hit = sr.results?.find(r => r.poster_path) ?? sr.results?.[0];
        if (!hit) return null;

        return {
          title: hit.name ?? searchTitle,
          year: hit.first_air_date?.slice(0, 4) ?? (m.startYear ? String(m.startYear) : null),
          imdbId: hit.id ? `tmdb_tv:${hit.id}` : null,
          posterUrl: hit.poster_path ? posterUrl(hit.poster_path) : (m.coverImage ?? null),
          tmdbRating: hit.vote_average != null ? String(hit.vote_average.toFixed(1)) : null,
          voteCount: hit.vote_count ?? 0,
          genreIds: hit.genre_ids ?? [16],
          popularity: hit.popularity ?? m.popularity,
          franchiseIds: [],
          mediaType: "tv",
        };
      }
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FilmographyEntry | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is FilmographyEntry => v !== null);
}

/**
 * Supplement filmography with TMDB keyword search (finds live-action appearances).
 * Deduplicates by imdbId vs what's already in the list.
 */
async function getFilmographyByKeyword(characterName: string): Promise<FilmographyEntry[]> {
  try {
    const kwData = await tmdbFetch<{ results?: Array<{ id: number; name: string }> }>(
      "/search/keyword",
      { query: characterName, page: "1" },
    );
    const kwResults = kwData.results ?? [];
    const nameLower = characterName.toLowerCase();
    const exact = kwResults.find(k => k.name.toLowerCase() === nameLower);
    if (!exact) return [];

    const kwId = String(exact.id);
    const [moviesResp, tvResp] = await Promise.allSettled([
      tmdbFetch<{
        results?: Array<{
          id: number; title?: string; release_date?: string;
          poster_path?: string | null; vote_average?: number;
          vote_count?: number; genre_ids?: number[]; popularity?: number;
          adult?: boolean;
        }>;
      }>("/discover/movie", { with_keywords: kwId, sort_by: "vote_count.desc", include_adult: "false", page: "1" }),
      tmdbFetch<{
        results?: Array<{
          id: number; name?: string; first_air_date?: string;
          poster_path?: string | null; vote_average?: number;
          vote_count?: number; genre_ids?: number[]; popularity?: number;
          adult?: boolean;
        }>;
      }>("/discover/tv", { with_keywords: kwId, sort_by: "vote_count.desc", include_adult: "false", page: "1" }),
    ]);

    const out: FilmographyEntry[] = [];
    if (moviesResp.status === "fulfilled") {
      for (const r of (moviesResp.value.results ?? []).slice(0, 20)) {
        if (r.adult || !r.poster_path || !r.title) continue;
        if (isPornParody(r.title)) continue;
        if ((r.vote_count ?? 0) < 1) continue;
        out.push({
          title: r.title,
          year: r.release_date?.slice(0, 4) ?? null,
          imdbId: `tmdb:${r.id}`,
          posterUrl: posterUrl(r.poster_path),
          tmdbRating: r.vote_average != null ? String(r.vote_average.toFixed(1)) : null,
          voteCount: r.vote_count ?? 0,
          genreIds: r.genre_ids ?? [],
          popularity: r.popularity ?? 0,
          franchiseIds: [],
          mediaType: "movie",
        });
      }
    }
    if (tvResp.status === "fulfilled") {
      for (const r of (tvResp.value.results ?? []).slice(0, 10)) {
        if (r.adult || !r.poster_path || !r.name) continue;
        if (isPornParody(r.name)) continue;
        if ((r.vote_count ?? 0) < 1) continue;
        out.push({
          title: r.name,
          year: r.first_air_date?.slice(0, 4) ?? null,
          imdbId: `tmdb_tv:${r.id}`,
          posterUrl: posterUrl(r.poster_path),
          tmdbRating: r.vote_average != null ? String(r.vote_average.toFixed(1)) : null,
          voteCount: r.vote_count ?? 0,
          genreIds: r.genre_ids ?? [],
          popularity: r.popularity ?? 0,
          franchiseIds: [],
          mediaType: "tv",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge AniList filmography + TMDB keyword filmography, deduplicating by imdbId.
 * AniList entries take priority (more accurate for anime).
 */
function mergeFilmographies(anilistEntries: FilmographyEntry[], tmdbEntries: FilmographyEntry[]): FilmographyEntry[] {
  const seen = new Set<string>();
  const out: FilmographyEntry[] = [];

  for (const e of anilistEntries) {
    if (e.imdbId && !seen.has(e.imdbId)) {
      seen.add(e.imdbId);
      out.push(e);
    }
  }
  for (const e of tmdbEntries) {
    if (e.imdbId && !seen.has(e.imdbId)) {
      seen.add(e.imdbId);
      out.push(e);
    }
  }

  return out.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
}

/**
 * For non-anime movies: look up each character name in Comic Vine in parallel.
 * Returns a map of charName → CV match data.
 * Only exact name / real_name / alias matches are accepted.
 */
async function lookupComicVineForMovie(
  characterNames: string[],
): Promise<Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>> {
  const resultMap = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
  if (!process.env["COMIC_VINE_API_KEY"]) return resultMap;

  await Promise.allSettled(
    characterNames.slice(0, 12).map(async (charName) => {
      try {
        const cvResults = await searchComicVineCharacters(charName, 5);
        const match = cvResults.find(r => cvNameMatches(r, charName)) ?? null;
        if (match) {
          resultMap.set(charName, {
            id: match.id,
            name: match.name,
            imageUrl: match.image?.medium_url ?? null,
            sourceUrl: match.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${match.id}/`,
          });
        }
      } catch {
        // ignore individual failures
      }
    }),
  );

  return resultMap;
}

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────

router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    let tmdbId = req.params.tmdbId as string;
    if (tmdbId.includes("%")) {
      try { tmdbId = decodeURIComponent(tmdbId); } catch { /* keep as-is */ }
    }

    const cached = BY_MOVIE_CACHE.get(tmdbId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json({ results: cached.results });
    }

    let characterEntries: Array<{ name: string }> = [];
    let movieTitle = "";
    let originalLanguage = "";
    let genreIds: number[] = [];

    try {
      if (tmdbId.startsWith("tmdb_tv:")) {
        const tvId = tmdbId.replace("tmdb_tv:", "");
        const [credits, tvInfo] = await Promise.all([
          tmdbFetch<{
            cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
          }>(`/tv/${tvId}/aggregate_credits`).catch(() => ({ cast: [] })),
          tmdbFetch<{
            name?: string; original_language?: string; genre_ids?: number[];
            genres?: Array<{ id: number }>;
          }>(`/tv/${tvId}`).catch((): TvInfoShape => ({})),
        ]);
        movieTitle = tvInfo.name ?? "";
        originalLanguage = tvInfo.original_language ?? "";
        genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map((g: { id: number }) => g.id);
        characterEntries = (credits.cast ?? [])
          .map(c => {
            const raw = c.roles?.[0]?.character ?? c.character ?? "";
            return { name: cleanCharacterName(raw) };
          })
          .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
          .slice(0, 20);

      } else if (tmdbId.startsWith("tmdb:")) {
        const movieNumId = tmdbId.replace("tmdb:", "");
        const [credits, movieInfo] = await Promise.all([
          tmdbFetch<{ cast?: Array<{ character?: string }> }>(
            `/movie/${movieNumId}/credits`,
          ).catch(() => ({ cast: [] })),
          tmdbFetch<{
            title?: string; original_language?: string; genre_ids?: number[];
            genres?: Array<{ id: number }>;
          }>(`/movie/${movieNumId}`).catch((): MovieInfoShape => ({})),
        ]);
        movieTitle = movieInfo.title ?? "";
        originalLanguage = movieInfo.original_language ?? "";
        genreIds = movieInfo.genre_ids ?? (movieInfo.genres ?? []).map((g: { id: number }) => g.id);
        characterEntries = (credits.cast ?? [])
          .map(c => ({ name: cleanCharacterName(c.character ?? "") }))
          .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
          .slice(0, 20);

      } else if (/^\d+$/.test(tmdbId)) {
        const [credits, movieInfo] = await Promise.all([
          tmdbFetch<{ cast?: Array<{ character?: string }> }>(
            `/movie/${tmdbId}/credits`,
          ).catch(() => ({ cast: [] })),
          tmdbFetch<{
            title?: string; original_language?: string; genre_ids?: number[];
            genres?: Array<{ id: number }>;
          }>(`/movie/${tmdbId}`).catch((): MovieInfoShape => ({})),
        ]);
        movieTitle = movieInfo.title ?? "";
        originalLanguage = movieInfo.original_language ?? "";
        genreIds = movieInfo.genre_ids ?? (movieInfo.genres ?? []).map((g: { id: number }) => g.id);
        characterEntries = (credits.cast ?? [])
          .map(c => ({ name: cleanCharacterName(c.character ?? "") }))
          .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
          .slice(0, 20);

      } else if (/^tt\d+$/.test(tmdbId)) {
        const findData = await tmdbFetch<{
          movie_results?: Array<{ id: number }>;
          tv_results?: Array<{ id: number }>;
        }>(`/find/${encodeURIComponent(tmdbId)}`, { external_source: "imdb_id" }).catch((): FindShape => ({}));
        const movieHit = findData.movie_results?.[0];
        const tvHit = findData.tv_results?.[0];
        if (movieHit) {
          const [credits, movieInfo] = await Promise.all([
            tmdbFetch<{ cast?: Array<{ character?: string }> }>(
              `/movie/${movieHit.id}/credits`,
            ).catch(() => ({ cast: [] })),
            tmdbFetch<{
              title?: string; original_language?: string;
              genres?: Array<{ id: number }>; genre_ids?: number[];
            }>(`/movie/${movieHit.id}`).catch((): MovieInfoShape => ({})),
          ]);
          movieTitle = movieInfo.title ?? "";
          originalLanguage = movieInfo.original_language ?? "";
          genreIds = movieInfo.genre_ids ?? (movieInfo.genres ?? []).map((g: { id: number }) => g.id);
          characterEntries = (credits.cast ?? [])
            .map(c => ({ name: cleanCharacterName(c.character ?? "") }))
            .filter(e => e.name.length > 1)
            .slice(0, 20);
        } else if (tvHit) {
          const [credits, tvInfo] = await Promise.all([
            tmdbFetch<{
              cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
            }>(`/tv/${tvHit.id}/aggregate_credits`).catch(() => ({ cast: [] })),
            tmdbFetch<{
              name?: string; original_language?: string;
              genres?: Array<{ id: number }>; genre_ids?: number[];
            }>(`/tv/${tvHit.id}`).catch((): TvInfoShape => ({})),
          ]);
          movieTitle = tvInfo.name ?? "";
          originalLanguage = tvInfo.original_language ?? "";
          genreIds = tvInfo.genre_ids ?? (tvInfo.genres ?? []).map((g: { id: number }) => g.id);
          characterEntries = (credits.cast ?? [])
            .map(c => {
              const raw = c.roles?.[0]?.character ?? c.character ?? "";
              return { name: cleanCharacterName(raw) };
            })
            .filter(e => e.name.length > 1 && !isBlockedCharacterName(e.name))
            .slice(0, 20);
        }
      }
    } catch { /* ignore */ }

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

    // ── Non-anime: match via Comic Vine (parallel, exact matches only) ────────
    let cvLookup = new Map<string, { id: number; name: string; imageUrl: string | null; sourceUrl: string }>();
    if (!anime) {
      cvLookup = await lookupComicVineForMovie(characterEntries.map(e => e.name));
    }

    const results: CharResult[] = characterEntries.map(entry => {
      if (anime) {
        const alMatch = matchAniListChar(entry.name, anilistChars);
        return {
          name: alMatch?.name ?? entry.name,
          wikidataId: alMatch ? `al:${alMatch.id}` : entry.name,
          description: alMatch?.description ?? "",
          imageUrl: alMatch?.imageUrl ?? null,
          alias: null,
          source: alMatch ? "anilist" : "tmdb",
          sourceUrl: alMatch ? `https://anilist.co/character/${alMatch.id}` : undefined,
        };
      } else {
        const cvMatch = cvLookup.get(entry.name) ?? null;
        return {
          name: cvMatch?.name ?? entry.name,
          wikidataId: cvMatch ? `cv:${cvMatch.id}` : entry.name,
          description: "",
          imageUrl: cvMatch?.imageUrl ?? null,
          alias: null,
          source: cvMatch ? "comicvine" : "tmdb",
          sourceUrl: cvMatch?.sourceUrl,
        };
      }
    });

    BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() });
    return res.json({ results });
  }),
);

// ── GET /character/:charId ─────────────────────────────────────────────────────

router.get(
  "/:charId",
  asyncHandler(async (req, res) => {
    let rawCharId = req.params["charId"] as string;
    // Normalise double-encoded colons (Vercel rewrite proxy)
    if (rawCharId.toLowerCase().startsWith("al%3a")) {
      rawCharId = "al:" + rawCharId.slice(5);
    } else if (rawCharId.toLowerCase().startsWith("cv%3a")) {
      rawCharId = "cv:" + rawCharId.slice(5);
    } else if (rawCharId.includes("%")) {
      try { rawCharId = decodeURIComponent(rawCharId); } catch { /* keep as-is */ }
    }
    if (!rawCharId || rawCharId.length < 1) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    // Optional ?lang parameter for bio language
    const reqLang = (req.query["lang"] as string | undefined)?.toLowerCase() ?? "en";

    const now = Date.now();

    // ── AniList character (al:<id>) ───────────────────────────────────────────
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

      // AniList only has English descriptions — for non-EN requests return null description
      // so the frontend can show the correct fallback note.
      const description = reqLang === "en" ? (charDetail.description ?? "") : null;

      return res.json({
        wikidataId: rawCharId,
        charId: rawCharId,
        name: charDetail.name,
        description,
        descriptionLang: "en",
        imageUrl: charDetail.imageUrl,
        filmography,
        source: "anilist",
        sourceUrl: `https://anilist.co/character/${anilistId}`,
      });
    }

    // ── Comic Vine character (cv:<id>) ────────────────────────────────────────
    if (rawCharId.startsWith("cv:")) {
      const cvId = parseInt(rawCharId.slice(3), 10);
      if (isNaN(cvId)) return res.status(400).json({ error: "Invalid Comic Vine ID" });

      const cvDetail = await getComicVineCharacterById(cvId).catch(() => null);
      if (!cvDetail) return res.status(404).json({ error: "Character not found" });

      const filmCached = FILMOGRAPHY_CACHE.get(rawCharId);
      let filmography: FilmographyEntry[] = [];
      if (filmCached && now - filmCached.ts < CACHE_TTL) {
        filmography = filmCached.filmography;
      } else {
        // Use real_name for keyword search (e.g. "Peter Parker" finds more than "Spider-Man")
        const searchName = cvDetail.real_name || cvDetail.name;
        const [kwFilmo1, kwFilmo2] = await Promise.allSettled([
          getFilmographyByKeyword(cvDetail.name),
          cvDetail.real_name ? getFilmographyByKeyword(cvDetail.real_name) : Promise.resolve([] as FilmographyEntry[]),
        ]);
        const combined = mergeFilmographies(
          kwFilmo1.status === "fulfilled" ? kwFilmo1.value : [],
          kwFilmo2.status === "fulfilled" ? kwFilmo2.value : [],
        );
        filmography = combined;
        void searchName; // used above
        FILMOGRAPHY_CACHE.set(rawCharId, { filmography, ts: now });
      }

      const rawDesc = cvDetail.deck || cvDetail.description || "";
      const description = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

      return res.json({
        wikidataId: rawCharId,
        charId: rawCharId,
        name: cvDetail.name,
        description,
        descriptionLang: "en",
        imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
        filmography,
        source: "comicvine",
        sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${cvId}/`,
      });
    }

    // ── Plain character name (legacy / unmatched) ─────────────────────────────
    // Strategy:
    //  1. Try Comic Vine first with exact match (better for Western chars)
    //  2. Try AniList with strict validation (must be ANIME + name must closely match)
    //  3. Return minimal stub (name only) rather than wrong data

    const characterName = decodeURIComponent(rawCharId);

    // Step 1 — Comic Vine exact match
    let cvFound = false;
    if (process.env["COMIC_VINE_API_KEY"]) {
      try {
        const cvResults = await searchComicVineCharacters(characterName, 5);
        const cvMatch = cvResults.find(r => cvNameMatches(r, characterName)) ?? null;
        if (cvMatch) {
          cvFound = true;
          const cvDetail = await getComicVineCharacterById(cvMatch.id).catch(() => null);
          if (cvDetail) {
            const filmCached = FILMOGRAPHY_CACHE.get(`cv:${cvMatch.id}`);
            let filmography: FilmographyEntry[] = [];
            if (filmCached && now - filmCached.ts < CACHE_TTL) {
              filmography = filmCached.filmography;
            } else {
              const [kwFilmo1, kwFilmo2] = await Promise.allSettled([
                getFilmographyByKeyword(cvDetail.name),
                cvDetail.real_name ? getFilmographyByKeyword(cvDetail.real_name) : Promise.resolve([] as FilmographyEntry[]),
              ]);
              filmography = mergeFilmographies(
                kwFilmo1.status === "fulfilled" ? kwFilmo1.value : [],
                kwFilmo2.status === "fulfilled" ? kwFilmo2.value : [],
              );
              FILMOGRAPHY_CACHE.set(`cv:${cvMatch.id}`, { filmography, ts: now });
            }

            const rawDesc = cvDetail.deck || cvDetail.description || "";
            const description = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

            return res.json({
              wikidataId: rawCharId,
              charId: `cv:${cvMatch.id}`,
              name: cvDetail.name,
              description,
              descriptionLang: "en",
              imageUrl: cvDetail.image?.super_url ?? cvDetail.image?.medium_url ?? null,
              filmography,
              source: "comicvine",
              sourceUrl: cvDetail.site_detail_url ?? `https://comicvine.gamespot.com/character/4005-${cvMatch.id}/`,
            });
          }
        }
      } catch {
        // Comic Vine is optional
      }
    }

    // Step 2 — AniList with strict validation
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

        const description = reqLang === "en" ? (alByName.description ?? "") : null;

        return res.json({
          wikidataId: rawCharId,
          charId: alCacheKey,
          name: alByName.name,
          description,
          descriptionLang: "en",
          imageUrl: alByName.imageUrl,
          filmography,
          source: "anilist",
          sourceUrl: `https://anilist.co/character/${alByName.id}`,
        });
      }
    }

    // Step 3 — Return minimal stub (name only, no wrong data)
    return res.json({
      wikidataId: rawCharId,
      charId: rawCharId,
      name: characterName,
      description: "",
      descriptionLang: "en",
      imageUrl: null,
      filmography: [],
      source: "tmdb",
      sourceUrl: undefined,
    });
  }),
);

export default router;
