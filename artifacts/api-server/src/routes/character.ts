import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  batchSearchWikipediaCharacters,
  getWikipediaSummary,
  getWikipediaBioForLang,
  getCharacterMediaLinks,
} from "../lib/wikipedia";

const router = Router();

// ── In-memory caches ──────────────────────────────────────────────────────────
// Prevents redundant Wikipedia searches on repeat page loads.

type CharResult = {
  name: string;
  wikidataId: string;
  label: string;
  description: string;
  imageUrl: string | null;
  alias: string | null;
};

const BY_MOVIE_CACHE = new Map<string, { results: CharResult[]; ts: number }>();
const FILMOGRAPHY_CACHE = new Map<string, { filmography: FilmographyEntry[]; summary: { extract: string; imageUrl: string | null; canonicalTitle: string } | null; ts: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\s*\(film\)$/i, "")
    .replace(/\s*\(movie\)$/i, "")
    .replace(/\s*\(\d{4}[\s\-]+film\)/i, "")
    .replace(/\s*\(\d{4}[\s\-]+movie\)/i, "")
    .replace(/\s*\(TV series\)$/i, "")
    .replace(/\s*\(television series\)$/i, "")
    .replace(/\s*\(animated series\)$/i, "")
    .replace(/\s*\(anime\)$/i, "")
    .replace(/\s*\(animation\)$/i, "")
    .replace(/\s*\(season \d+\)$/i, "")
    .replace(/\s*\(miniseries\)$/i, "")
    .replace(/\s*\(web series\)$/i, "")
    .replace(/\s*\(TV film\)$/i, "")
    .replace(/\s*\(television film\)$/i, "")
    .replace(/\s*\(short film\)$/i, "")
    .trim();
}

const PORN_KEYWORDS = [
  "porn", "xxx", "adult film", "erotic", "sex film", "nude", "hardcore",
  "softcore", "hentai parody",
];
function isPornParody(title: string): boolean {
  const lower = title.toLowerCase();
  return PORN_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Given a TMDB character string (e.g. "Bruce Wayne / Batman") and the Wikipedia
 * article label (e.g. "Batman"), returns the "other" part(s) of the TMDB string
 * that are NOT already represented by the label. Returns null when no useful alias exists.
 */
function extractAlias(tmdbCharacter: string, wikiLabel: string): string | null {
  // Strip trailing role hints like "(voice)", "(cameo)", "(uncredited)"
  const cleaned = tmdbCharacter.replace(/\s*\([^)]{0,30}\)\s*$/gi, "").trim();
  const parts = cleaned.split(/\s*\/\s*/).map(p => p.trim()).filter(p => p.length > 1);
  if (parts.length <= 1) {
    // Single name — if it's already contained in the wiki label or vice versa, no alias needed
    const p = (parts[0] ?? "").toLowerCase();
    const l = wikiLabel.toLowerCase();
    if (p === l || l.includes(p) || p.includes(l)) return null;
    return parts[0] ?? null;
  }
  // Multiple parts — return any that aren't already captured by the label
  const labelLower = wikiLabel.toLowerCase();
  const aliases = parts.filter(p => {
    const pL = p.toLowerCase();
    return pL !== labelLower && !labelLower.includes(pL) && !pL.includes(labelLower);
  });
  return aliases[0] ?? null;
}

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

// ── Strategy 1: TMDB keyword search ──────────────────────────────────────────

async function getFilmographyByKeyword(characterName: string): Promise<FilmographyEntry[]> {
  try {
    const kwData = await tmdbFetch<{
      results?: Array<{ id: number; name: string }>;
    }>("/search/keyword", { query: characterName, page: "1" });

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
      }>("/discover/movie", {
        with_keywords: kwId,
        sort_by: "vote_count.desc",
        include_adult: "false",
        page: "1",
      }),
      tmdbFetch<{
        results?: Array<{
          id: number; name?: string; first_air_date?: string;
          poster_path?: string | null; vote_average?: number;
          vote_count?: number; genre_ids?: number[]; popularity?: number;
          adult?: boolean;
        }>;
      }>("/discover/tv", {
        with_keywords: kwId,
        sort_by: "vote_count.desc",
        include_adult: "false",
        page: "1",
      }),
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

// ── Strategy 2: Wikipedia article links → TMDB ───────────────────────────────

async function enrichTitle(title: string): Promise<FilmographyEntry | null> {
  try {
    const cleanTitle = cleanTitleForSearch(title);
    if (!cleanTitle || cleanTitle.length < 2) return null;

    const isTV =
      /\((tv series|anime|animated series|television series|miniseries|web series)\)$/i.test(title);

    const searchData = await tmdbFetch<{
      results?: Array<{
        id: number; media_type?: string; title?: string; name?: string;
        release_date?: string; first_air_date?: string;
        poster_path?: string | null; vote_average?: number;
        vote_count?: number; genre_ids?: number[]; popularity?: number; adult?: boolean;
      }>;
    }>("/search/multi", { query: cleanTitle, include_adult: "false", page: "1" });

    const nameLower = cleanTitle.toLowerCase();
    const candidates = (searchData.results ?? []).filter(r => {
      if (r.adult) return false;
      if (!r.poster_path) return false;
      if (r.media_type === "person") return false;
      const rTitle = (r.title ?? r.name ?? "").toLowerCase();
      return (
        rTitle === nameLower ||
        rTitle.startsWith(nameLower) ||
        nameLower.startsWith(rTitle) ||
        rTitle.includes(nameLower) ||
        nameLower.includes(rTitle)
      );
    });

    const r = candidates[0];
    if (!r) return null;
    if (isPornParody(r.title ?? r.name ?? "")) return null;

    const isMovie = r.media_type === "movie" || (r.media_type !== "tv" && !!r.title && !isTV);

    let linkId: string | null = null;
    try {
      const ext = await tmdbFetch<{ imdb_id?: string | null }>(
        `/${isMovie ? "movie" : "tv"}/${r.id}/external_ids`
      );
      linkId = isMovie && ext.imdb_id ? ext.imdb_id : `tmdb_tv:${r.id}`;
    } catch {
      linkId = isMovie ? null : `tmdb_tv:${r.id}`;
    }

    return {
      title: r.title ?? r.name ?? cleanTitle,
      year: (r.release_date ?? r.first_air_date ?? "").slice(0, 4) || null,
      imdbId: linkId,
      posterUrl: posterUrl(r.poster_path),
      tmdbRating: r.vote_average != null ? String(r.vote_average.toFixed(1)) : null,
      voteCount: r.vote_count ?? 0,
      genreIds: r.genre_ids ?? [],
      popularity: r.popularity ?? 0,
      franchiseIds: [],
      mediaType: isMovie ? "movie" : "tv",
    };
  } catch {
    return null;
  }
}

async function getFilmographyByWikiLinks(pageTitle: string): Promise<FilmographyEntry[]> {
  try {
    const rawLinks = await getCharacterMediaLinks(pageTitle);
    if (rawLinks.length === 0) return [];

    const toSearch = rawLinks.slice(0, 30);
    const CONCURRENCY = 4;
    const results: FilmographyEntry[] = [];

    for (let i = 0; i < toSearch.length; i += CONCURRENCY) {
      const batch = toSearch.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(t => enrichTitle(t).catch(() => null))
      );
      results.push(...batchResults.filter((f): f is FilmographyEntry => f !== null));
    }

    return results.filter(f => f.voteCount > 0);
  } catch {
    return [];
  }
}

async function buildFilmography(
  characterName: string,
  pageTitle: string,
): Promise<FilmographyEntry[]> {
  const [kwFilms, wikiFilms] = await Promise.all([
    getFilmographyByKeyword(characterName),
    getFilmographyByWikiLinks(pageTitle),
  ]);

  const seen = new Set<string>();
  const merged: FilmographyEntry[] = [];

  for (const f of [...kwFilms, ...wikiFilms]) {
    if (!f.title) continue;
    const key = f.imdbId ?? `${f.title}-${f.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }

  return merged
    .filter(f => f.voteCount > 0)
    .sort((a, b) => b.voteCount - a.voteCount)
    .slice(0, 30);
}

// ── Fetch movie title from TMDB for disambiguation ────────────────────────────

async function fetchMovieTitle(tmdbId: string): Promise<string> {
  try {
    if (tmdbId.startsWith("tmdb_tv:")) {
      const id = tmdbId.replace("tmdb_tv:", "");
      const d = await tmdbFetch<{ name?: string }>(`/tv/${id}`);
      return d.name ?? "";
    }
    if (/^\d+$/.test(tmdbId)) {
      const d = await tmdbFetch<{ title?: string }>(`/movie/${tmdbId}`);
      return d.title ?? "";
    }
    if (/^tt\d+$/.test(tmdbId)) {
      const find = await tmdbFetch<{
        movie_results?: Array<{ id: number; title?: string }>;
        tv_results?: Array<{ id: number; name?: string }>;
      }>(`/find/${encodeURIComponent(tmdbId)}`, { external_source: "imdb_id" });
      return (
        find.movie_results?.[0]?.title ??
        find.tv_results?.[0]?.name ??
        ""
      );
    }
  } catch {}
  return "";
}

// ── POST /character/batch-search ──────────────────────────────────────────────
router.post(
  "/batch-search",
  asyncHandler(async (req, res) => {
    const { characters, movieTitle } = req.body as {
      characters?: string[];
      movieTitle?: string;
    };
    if (!Array.isArray(characters) || characters.length === 0) {
      return res.json({ results: [] });
    }
    const results = await batchSearchWikipediaCharacters(
      characters,
      movieTitle ?? undefined,
    ).catch(() => []);
    res.json({
      results: results.map(r => ({
        name: r.label,
        wikidataId: r.charId,
        label: r.label,
        description: r.description,
        imageUrl: r.imageUrl,
        alias: null,
      })),
    });
  }),
);

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────
router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    const { tmdbId } = req.params as { tmdbId: string };

    // Serve from cache if fresh
    const cached = BY_MOVIE_CACHE.get(tmdbId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json({ results: cached.results });
    }

    // Fetch character names AND movie title concurrently
    let characterEntries: Array<{ name: string; tmdbChar: string }> = [];
    let movieTitle = "";

    try {
      if (tmdbId.startsWith("tmdb_tv:")) {
        const tvId = tmdbId.replace("tmdb_tv:", "");
        const [credits, tvInfo] = await Promise.all([
          tmdbFetch<{
            cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
          }>(`/tv/${tvId}/aggregate_credits`).catch(() => ({ cast: [] })),
          tmdbFetch<{ name?: string }>(`/tv/${tvId}`).catch(() => ({})),
        ]);
        movieTitle = tvInfo.name ?? "";
        characterEntries = (credits.cast ?? [])
          .map(c => {
            const raw = c.roles?.[0]?.character ?? c.character ?? "";
            return { name: raw.split("/")[0].trim(), tmdbChar: raw };
          })
          .filter(e => e.name.length > 1)
          .slice(0, 15);
      } else if (/^\d+$/.test(tmdbId)) {
        const [credits, movieInfo] = await Promise.all([
          tmdbFetch<{ cast?: Array<{ character?: string }> }>(
            `/movie/${tmdbId}/credits`
          ).catch(() => ({ cast: [] })),
          tmdbFetch<{ title?: string }>(`/movie/${tmdbId}`).catch(() => ({})),
        ]);
        movieTitle = movieInfo.title ?? "";
        characterEntries = (credits.cast ?? [])
          .map(c => {
            const raw = c.character ?? "";
            return { name: raw.split("/")[0].trim(), tmdbChar: raw };
          })
          .filter(e => e.name.length > 1)
          .slice(0, 15);
      } else if (/^tt\d+$/.test(tmdbId)) {
        const findData = await tmdbFetch<{
          movie_results?: Array<{ id: number }>;
          tv_results?: Array<{ id: number }>;
        }>(`/find/${encodeURIComponent(tmdbId)}`, { external_source: "imdb_id" }).catch(() => ({}));
        const movieHit = findData.movie_results?.[0];
        const tvHit = findData.tv_results?.[0];

        if (movieHit) {
          const [credits, movieInfo] = await Promise.all([
            tmdbFetch<{ cast?: Array<{ character?: string }> }>(
              `/movie/${movieHit.id}/credits`
            ).catch(() => ({ cast: [] })),
            tmdbFetch<{ title?: string }>(`/movie/${movieHit.id}`).catch(() => ({})),
          ]);
          movieTitle = movieInfo.title ?? "";
          characterEntries = (credits.cast ?? [])
            .map(c => {
              const raw = c.character ?? "";
              return { name: raw.split("/")[0].trim(), tmdbChar: raw };
            })
            .filter(e => e.name.length > 1)
            .slice(0, 15);
        } else if (tvHit) {
          const [credits, tvInfo] = await Promise.all([
            tmdbFetch<{
              cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
            }>(`/tv/${tvHit.id}/aggregate_credits`).catch(() => ({ cast: [] })),
            tmdbFetch<{ name?: string }>(`/tv/${tvHit.id}`).catch(() => ({})),
          ]);
          movieTitle = tvInfo.name ?? "";
          characterEntries = (credits.cast ?? [])
            .map(c => {
              const raw = c.roles?.[0]?.character ?? c.character ?? "";
              return { name: raw.split("/")[0].trim(), tmdbChar: raw };
            })
            .filter(e => e.name.length > 1)
            .slice(0, 15);
        }
      }
    } catch {
      // ignore
    }

    if (characterEntries.length === 0) {
      const empty: CharResult[] = [];
      BY_MOVIE_CACHE.set(tmdbId, { results: empty, ts: Date.now() });
      return res.json({ results: empty });
    }

    // Map from cleaned name → original TMDB character string (for alias)
    const tmdbCharMap = new Map(characterEntries.map(e => [e.name, e.tmdbChar]));
    const charNames = characterEntries.map(e => e.name);

    const wikiResults = await batchSearchWikipediaCharacters(charNames, movieTitle).catch(() => []);

    const results: CharResult[] = wikiResults.map(r => {
      // Find which TMDB character string produced this result
      // (match by searching for the character name or its variants)
      const matchedTmdbChar = charNames.find(cn => {
        const cnL = cn.toLowerCase();
        const labelL = r.label.toLowerCase();
        return labelL.includes(cnL) || cnL.includes(labelL) || labelL === cnL;
      });
      const tmdbChar = matchedTmdbChar ? (tmdbCharMap.get(matchedTmdbChar) ?? "") : "";
      const alias = tmdbChar ? extractAlias(tmdbChar, r.label) : null;

      return {
        name: r.label,
        wikidataId: r.charId,
        label: r.label,
        description: r.description,
        imageUrl: r.imageUrl,
        alias,
      };
    });

    BY_MOVIE_CACHE.set(tmdbId, { results, ts: Date.now() });
    res.json({ results });
  }),
);

// ── GET /character/:charId ────────────────────────────────────────────────────
router.get(
  "/:charId",
  asyncHandler(async (req, res) => {
    const { charId } = req.params as { charId: string };
    if (!charId || charId.length < 2) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const pageTitle = decodeURIComponent(charId).replace(/_/g, " ");
    const characterName = pageTitle.split(" (")[0];
    const rawLang = (req.query.lang as string) ?? "en";
    const lang = rawLang.split("-")[0].toLowerCase() || "en";

    // Serve filmography + summary from cache if available, then layer bio on top
    const filmCached = FILMOGRAPHY_CACHE.get(charId);
    const now = Date.now();
    let summary: { extract: string; imageUrl: string | null; canonicalTitle: string } | null = null;
    let filmography: FilmographyEntry[] = [];

    if (filmCached && now - filmCached.ts < CACHE_TTL) {
      summary = filmCached.summary;
      filmography = filmCached.filmography;
    } else {
      summary = await getWikipediaSummary(pageTitle).catch(() => null);
      if (!summary) {
        return res.status(404).json({ error: "Character not found" });
      }
      filmography = await buildFilmography(characterName, summary.canonicalTitle).catch(() => []);
      FILMOGRAPHY_CACHE.set(charId, { filmography, summary, ts: now });
    }

    if (!summary) {
      return res.status(404).json({ error: "Character not found" });
    }

    // Fetch bio in requested language (fast, parallel-safe)
    const langBio = lang !== "en"
      ? await getWikipediaBioForLang(summary.canonicalTitle, lang).catch(() => null)
      : null;

    const description = (lang !== "en" && langBio)
      ? langBio
      : summary.extract.slice(0, 500);

    res.json({
      wikidataId: charId,
      charId,
      name: characterName,
      description,
      imageUrl: summary.imageUrl,
      filmography,
    });
  }),
);

export default router;
