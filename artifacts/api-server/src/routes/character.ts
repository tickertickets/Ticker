import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  batchSearchWikipediaCharacters,
  getWikipediaSummary,
  getCharacterMediaLinks,
} from "../lib/wikipedia";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

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
// Best for franchise characters (Iron Man, Batman, Gojo Satoru…)

async function getFilmographyByKeyword(characterName: string): Promise<FilmographyEntry[]> {
  try {
    const kwData = await tmdbFetch<{
      results?: Array<{ id: number; name: string }>;
    }>("/search/keyword", { query: characterName, page: "1" });

    const kwResults = kwData.results ?? [];
    // Find exact or close match keyword
    const nameLower = characterName.toLowerCase();
    const exact = kwResults.find(k => k.name.toLowerCase() === nameLower);
    const close = kwResults.find(k =>
      k.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(k.name.toLowerCase())
    );
    const keyword = exact ?? close;
    if (!keyword) return [];

    const kwId = String(keyword.id);
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
          imdbId: `tmdb:${r.id}`, // movies route accepts tmdb:<id> format
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

// ── Strategy 2: Wikipedia article links → TMDB multi-search ──────────────────
// Fallback for characters whose Wikipedia article links specific media titles

async function enrichTitle(title: string): Promise<FilmographyEntry | null> {
  try {
    const cleanTitle = cleanTitleForSearch(title);
    if (!cleanTitle || cleanTitle.length < 2) return null;

    const isTV =
      /\((tv series|anime|animated series|television series|miniseries|web series)\)$/i.test(title);

    const searchData = await tmdbFetch<{
      results?: Array<{
        id: number;
        media_type?: string;
        title?: string;
        name?: string;
        release_date?: string;
        first_air_date?: string;
        poster_path?: string | null;
        vote_average?: number;
        vote_count?: number;
        genre_ids?: number[];
        popularity?: number;
        adult?: boolean;
      }>;
    }>("/search/multi", {
      query: cleanTitle,
      include_adult: "false",
      page: "1",
    });

    const nameLower = cleanTitle.toLowerCase();
    const candidates = (searchData.results ?? []).filter(r => {
      if (r.adult) return false;
      if (!r.poster_path) return false;
      // Skip people results
      if (r.media_type === "person") return false;
      const rTitle = (r.title ?? r.name ?? "").toLowerCase();
      // Exact or strong prefix/contains match
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

    // Get IMDB / tmdb_tv ID
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

    // Prefer media-disambiguated links first (already sorted by getCharacterMediaLinks)
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

// ── Combined filmography builder ──────────────────────────────────────────────

async function buildFilmography(
  characterName: string,
  pageTitle: string,
): Promise<FilmographyEntry[]> {
  const [kwFilms, wikiFilms] = await Promise.all([
    getFilmographyByKeyword(characterName),
    getFilmographyByWikiLinks(pageTitle),
  ]);

  // Merge: keyword results first (more accurate), then wiki links
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

// ── POST /character/batch-search ──────────────────────────────────────────────
router.post(
  "/batch-search",
  asyncHandler(async (req, res) => {
    const { characters } = req.body as { characters?: string[] };
    if (!Array.isArray(characters) || characters.length === 0) {
      return res.json({ results: [] });
    }
    const results = await batchSearchWikipediaCharacters(characters).catch(() => []);
    res.json({
      results: results.map(r => ({
        name: r.label,
        wikidataId: r.charId,
        label: r.label,
        description: r.description,
        imageUrl: r.imageUrl,
      })),
    });
  }),
);

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────
// :tmdbId can be a numeric TMDB movie ID, "tmdb_tv:123", or "tt…" IMDB ID
router.get(
  "/by-movie/:tmdbId",
  asyncHandler(async (req, res) => {
    const { tmdbId } = req.params as { tmdbId: string };

    let characterNames: string[] = [];
    try {
      if (tmdbId.startsWith("tmdb_tv:")) {
        const tvId = tmdbId.replace("tmdb_tv:", "");
        const credits = await tmdbFetch<{
          cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
        }>(`/tv/${tvId}/aggregate_credits`).catch(() => ({ cast: [] }));
        characterNames = (credits.cast ?? [])
          .map(c => c.roles?.[0]?.character ?? c.character ?? "")
          .filter(n => n.trim().length > 1)
          .slice(0, 15);
      } else if (/^\d+$/.test(tmdbId)) {
        const credits = await tmdbFetch<{
          cast?: Array<{ character?: string }>;
        }>(`/movie/${tmdbId}/credits`).catch(() => ({ cast: [] }));
        characterNames = (credits.cast ?? [])
          .map(c => c.character ?? "")
          .filter(n => n.trim().length > 1)
          .slice(0, 15);
      } else if (/^tt\d+$/.test(tmdbId)) {
        const findData = await tmdbFetch<{
          movie_results?: Array<{ id: number }>;
          tv_results?: Array<{ id: number }>;
        }>(`/find/${encodeURIComponent(tmdbId)}`, { external_source: "imdb_id" }).catch(() => ({}));
        const movieHit = findData.movie_results?.[0];
        const tvHit = findData.tv_results?.[0];
        if (movieHit) {
          const credits = await tmdbFetch<{ cast?: Array<{ character?: string }> }>(
            `/movie/${movieHit.id}/credits`
          ).catch(() => ({ cast: [] }));
          characterNames = (credits.cast ?? [])
            .map(c => c.character ?? "")
            .filter(n => n.trim().length > 1)
            .slice(0, 15);
        } else if (tvHit) {
          const credits = await tmdbFetch<{
            cast?: Array<{ character?: string; roles?: Array<{ character?: string }> }>;
          }>(`/tv/${tvHit.id}/aggregate_credits`).catch(() => ({ cast: [] }));
          characterNames = (credits.cast ?? [])
            .map(c => c.roles?.[0]?.character ?? c.character ?? "")
            .filter(n => n.trim().length > 1)
            .slice(0, 15);
        }
      }
    } catch {
      // ignore, return empty
    }

    if (characterNames.length === 0) return res.json({ results: [] });

    const wikiResults = await batchSearchWikipediaCharacters(characterNames).catch(() => []);
    res.json({
      results: wikiResults.map(r => ({
        name: r.label,
        wikidataId: r.charId,
        label: r.label,
        description: r.description,
        imageUrl: r.imageUrl,
      })),
    });
  }),
);

// ── GET /character/:charId ────────────────────────────────────────────────────
// charId = Wikipedia page title (underscored), e.g. "Iron_Man", "Gojo_Satoru"
router.get(
  "/:charId",
  asyncHandler(async (req, res) => {
    const { charId } = req.params as { charId: string };
    if (!charId || charId.length < 2) {
      return res.status(400).json({ error: "Invalid character ID" });
    }

    const pageTitle = decodeURIComponent(charId).replace(/_/g, " ");
    const characterName = pageTitle.split(" (")[0];

    // Wikipedia image + bio (fast — REST summary, follows redirects)
    const summary = await getWikipediaSummary(pageTitle).catch(() => null);
    if (!summary) {
      return res.status(404).json({ error: "Character not found" });
    }

    // Use canonical title (post-redirect) for parse API — prevents empty link sets
    const canonicalTitle = summary.canonicalTitle;

    // Filmography: TMDB keyword (fast) + Wikipedia links (deeper), run in parallel
    const filmography = await buildFilmography(characterName, canonicalTitle).catch(() => []);

    res.json({
      wikidataId: charId,
      charId,
      name: characterName,
      description: summary.extract.slice(0, 500),
      imageUrl: summary.imageUrl,
      filmography,
    });
  }),
);

export default router;
