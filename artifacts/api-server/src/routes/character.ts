import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  batchSearchWikipediaCharacters,
  searchWikipediaCharacter,
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
  "softcore", "hentai parody", "parody film",
];
function isPornParody(title: string, genres: number[]): boolean {
  const lower = title.toLowerCase();
  if (PORN_KEYWORDS.some(kw => lower.includes(kw))) return true;
  // TMDB genre 10749 = Romance, but we check adult flag instead
  return false;
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

async function enrichTitle(title: string): Promise<FilmographyEntry | null> {
  try {
    const cleanTitle = cleanTitleForSearch(title);
    const isTV =
      title.toLowerCase().includes("(tv series)") ||
      title.toLowerCase().includes("(anime)") ||
      title.toLowerCase().includes("(animated series)") ||
      title.toLowerCase().includes("(television series)") ||
      title.toLowerCase().includes("(miniseries)") ||
      title.toLowerCase().includes("(web series)");

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

    const candidates = (searchData.results ?? []).filter(r => {
      if (r.adult) return false;
      if (!r.poster_path) return false;
      const rTitle = (r.title ?? r.name ?? "").toLowerCase();
      const searchLower = cleanTitle.toLowerCase();
      return (
        rTitle === searchLower ||
        rTitle.startsWith(searchLower) ||
        searchLower.startsWith(rTitle) ||
        rTitle.includes(searchLower) ||
        searchLower.includes(rTitle)
      );
    });

    const r = candidates[0];
    if (!r) return null;

    const isMovie = r.media_type === "movie" || (r.media_type !== "tv" && !!r.title && !isTV);

    if (isPornParody(r.title ?? r.name ?? "", r.genre_ids ?? [])) return null;

    // Get IMDB ID from external_ids — used for movie-detail navigation
    let linkId: string | null = null;
    try {
      const ext = await tmdbFetch<{ imdb_id?: string | null }>(
        `/${isMovie ? "movie" : "tv"}/${r.id}/external_ids`
      );
      if (isMovie && ext.imdb_id) {
        linkId = ext.imdb_id;
      } else {
        linkId = `tmdb_tv:${r.id}`;
      }
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

// ── POST /character/batch-search ──────────────────────────────────────────────
// Frontend sends character names from TMDB credits → Wikipedia lookup → return cards
router.post(
  "/batch-search",
  asyncHandler(async (req, res) => {
    const { characters } = req.body as { characters?: string[] };
    if (!Array.isArray(characters) || characters.length === 0) {
      return res.json({ results: [] });
    }
    const results = await batchSearchWikipediaCharacters(characters).catch(() => []);
    // Return in shape compatible with frontend CharacterMatch type
    res.json({
      results: results.map(r => ({
        name: r.label,
        wikidataId: r.charId, // charId used as the universal ID (Wikipedia page title)
        label: r.label,
        description: r.description,
        imageUrl: r.imageUrl,
      })),
    });
  }),
);

// ── GET /character/by-movie/:tmdbId ───────────────────────────────────────────
// Fetch credits from TMDB for a movie/show → Wikipedia batch search
// :tmdbId can be a numeric TMDB movie ID, "tmdb_tv:123", or "tt..." IMDB ID
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
        // IMDB ID — find the TMDB ID first
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

    // Get Wikipedia image + bio
    const summary = await getWikipediaSummary(pageTitle).catch(() => null);
    if (!summary) {
      return res.status(404).json({ error: "Character not found" });
    }

    // Get article links for filmography
    const rawLinks = await getCharacterMediaLinks(pageTitle).catch(() => [] as string[]);

    // Enrich up to 50 links with TMDB data (with concurrency limit)
    const toSearch = rawLinks.slice(0, 50);
    const CONCURRENCY = 5;
    const filmResults: FilmographyEntry[] = [];

    for (let i = 0; i < toSearch.length; i += CONCURRENCY) {
      const batch = toSearch.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(t => enrichTitle(t).catch(() => null)));
      filmResults.push(...batchResults.filter((f): f is FilmographyEntry => f !== null));
    }

    // Deduplicate + sort by vote count descending
    const seen = new Set<string>();
    const filmography = filmResults
      .filter(f => {
        if (!f.title || f.voteCount < 1) return false;
        const key = f.imdbId ?? `${f.title}-${f.year}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, 30);

    const displayName = pageTitle.split(" (")[0];

    res.json({
      wikidataId: charId, // kept for frontend compatibility
      charId,
      name: displayName,
      description: summary.extract.slice(0, 500),
      imageUrl: summary.imageUrl,
      filmography,
    });
  }),
);

export default router;
