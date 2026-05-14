import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import { getAniListCharacters, getAniListCharacterById } from "../lib/anilist";

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

function matchAniListChar(
  tmdbName: string,
  anilistChars: Array<{ id: number; name: string; imageUrl: string | null; description: string | null }>,
): { id: number; name: string; imageUrl: string | null; description: string | null } | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const tmdbNorm = normalize(tmdbName);
  const tmdbWords = tmdbNorm.split(/\s+/).filter(w => w.length > 1);

  for (const ac of anilistChars) {
    if (normalize(ac.name) === tmdbNorm) return ac;
  }
  for (const ac of anilistChars) {
    const alWords = normalize(ac.name).split(/\s+/).filter(w => w.length > 1);
    const overlap = tmdbWords.filter(w => alWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(tmdbWords.length, alWords.length)) return ac;
  }
  if (tmdbWords.length === 2) {
    const reversed = `${tmdbWords[1]} ${tmdbWords[0]}`;
    for (const ac of anilistChars) {
      if (normalize(ac.name) === reversed) return ac;
    }
  }
  return null;
}

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

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────

router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    const { tmdbId } = req.params as { tmdbId: string };

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
            return { name: raw.split("/")[0].trim() };
          })
          .filter(e => e.name.length > 1)
          .slice(0, 15);

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
          .map(c => ({ name: (c.character ?? "").split("/")[0].trim() }))
          .filter(e => e.name.length > 1)
          .slice(0, 15);

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
              genres?: Array<{ id: number }>;
            }>(`/movie/${movieHit.id}`).catch((): MovieInfoShape => ({})),
          ]);
          movieTitle = movieInfo.title ?? "";
          originalLanguage = movieInfo.original_language ?? "";
          genreIds = (movieInfo.genres ?? []).map((g: { id: number }) => g.id);
          characterEntries = (credits.cast ?? [])
            .map(c => ({ name: (c.character ?? "").split("/")[0].trim() }))
            .filter(e => e.name.length > 1)
            .slice(0, 15);
        } else if (tvHit) {
          const [credits, tvInfo] = await Promise.all([
            tmdbFetch<{
              cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
            }>(`/tv/${tvHit.id}/aggregate_credits`).catch(() => ({ cast: [] })),
            tmdbFetch<{
              name?: string; original_language?: string;
              genres?: Array<{ id: number }>;
            }>(`/tv/${tvHit.id}`).catch((): TvInfoShape => ({})),
          ]);
          movieTitle = tvInfo.name ?? "";
          originalLanguage = tvInfo.original_language ?? "";
          genreIds = (tvInfo.genres ?? []).map((g: { id: number }) => g.id);
          characterEntries = (credits.cast ?? [])
            .map(c => {
              const raw = c.roles?.[0]?.character ?? c.character ?? "";
              return { name: raw.split("/")[0].trim() };
            })
            .filter(e => e.name.length > 1)
            .slice(0, 15);
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
    const rawCharId = req.params["charId"] as string;
    if (!rawCharId || rawCharId.length < 1) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const now = Date.now();

    // AniList character
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
        filmography = await getFilmographyByKeyword(charDetail.name).catch(() => []);
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

    // TMDB-only: treat charId as character name
    const characterName = decodeURIComponent(rawCharId);
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
