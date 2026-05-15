import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import { getAniListCharacters, getAniListCharacterById, getAniListCharacterByName, type AniListMedia } from "../lib/anilist";

const router = Router();

// ── In-memory caches ──────────────────────────────────────────────────────────
type CharResult = {
  name: string;
  wikidataId: string;
  description: string;
  imageUrl: string | null;
  alias: string | null;
  source: "anilist" | "tmdb";
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

function isAnime(originalLanguage: string, genreIds: number[]): boolean {
  return originalLanguage === "ja" && genreIds.includes(16);
}

/**
 * Strip role/acting suffixes from TMDB character names so AniList matching works.
 * Examples: "Yuji Itadori (voice)" → "Yuji Itadori"
 *           "Tony Stark / Iron Man" → "Tony Stark" (already handled by split("/"))
 *           "Bruce Wayne (uncredited)" → "Bruce Wayne"
 */
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

function matchAniListChar(
  tmdbName: string,
  anilistChars: Array<{ id: number; name: string; imageUrl: string | null; description: string | null }>,
): { id: number; name: string; imageUrl: string | null; description: string | null } | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm = normalize(tmdbName);
  const tmdbRomaji = normalizeRomaji(tmdbName);
  const tmdbWords = tmdbNorm.split(/\s+/).filter(w => w.length > 1);
  const tmdbRomajiWords = tmdbRomaji.split(/\s+/).filter(w => w.length > 1);

  // Pass 1: exact match
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
  // Pass 4: word-overlap after romaji normalization (catches Yuuji vs Yuji, Gojou vs Gojo)
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
  return null;
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

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────

router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    // Handle Vercel double-encoding: `tmdb_tv:xxx` → `tmdb_tv%3Axxx`, `tmdb:xxx` → `tmdb%3Axxx`
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
        // Format used by filmography entries: "tmdb:641934"
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

    let anilistChars: Array<{ id: number; name: string; imageUrl: string | null; description: string | null }> = [];
    const anime = isAnime(originalLanguage, genreIds);
    if (anime && movieTitle) {
      anilistChars = await getAniListCharacters(movieTitle).catch(() => []);
    }

    const results: CharResult[] = characterEntries.map(entry => {
      const alMatch = anime ? matchAniListChar(entry.name, anilistChars) : null;
      return {
        name: entry.name,
        wikidataId: alMatch ? `al:${alMatch.id}` : entry.name,
        description: alMatch?.description ?? "",
        imageUrl: alMatch?.imageUrl ?? null,
        alias: null,
        source: alMatch ? "anilist" : "tmdb",
      };
    });

    BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() });
    return res.json({ results });
  }),
);

// ── GET /character/:charId ─────────────────────────────────────────────────────

router.get(
  "/:charId",
  asyncHandler(async (req, res) => {
    // Express decodes URL params once. Vercel's rewrite proxy may double-encode `:`
    // so `al:126635` becomes `al%3A126635` by the time Express sees it.
    // We decode one extra time to normalise this.
    let rawCharId = req.params["charId"] as string;
    if (rawCharId.toLowerCase().startsWith("al%3a")) {
      rawCharId = "al:" + rawCharId.slice(5);
    } else if (rawCharId.includes("%")) {
      try { rawCharId = decodeURIComponent(rawCharId); } catch { /* keep as-is */ }
    }
    if (!rawCharId || rawCharId.length < 1) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const now = Date.now();

    // ── AniList character ──────────────────────────────────────────────────────
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
        // Build filmography from AniList media appearances + TMDB keyword fallback
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
      });
    }

    // ── TMDB-only: treat charId as character name ──────────────────────────────
    // First try AniList character search by name (covers anime chars not in top-50)
    const characterName = decodeURIComponent(rawCharId);
    const alByName = await getAniListCharacterByName(characterName).catch(() => null);

    if (alByName) {
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
      });
    }

    const filmCached = FILMOGRAPHY_CACHE.get(rawCharId);
    let filmography: FilmographyEntry[] = [];
    if (filmCached && now - filmCached.ts < CACHE_TTL) {
      filmography = filmCached.filmography;
    } else {
      filmography = await getFilmographyByKeyword(characterName).catch(() => []);
      FILMOGRAPHY_CACHE.set(rawCharId, { filmography, ts: now });
    }

    return res.json({
      wikidataId: rawCharId,
      charId: rawCharId,
      name: characterName,
      description: "",
      imageUrl: null,
      filmography,
      source: "tmdb",
    });
  }),
);

export default router;
