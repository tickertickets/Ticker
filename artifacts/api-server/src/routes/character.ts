import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import {
  batchSearchCharacters,
  getCharacterFromWikidata,
  getCharacterFilmography,
  type CharacterFilm,
} from "../lib/wikidata";

const router = Router();

// POST /character/batch-search
router.post(
  "/batch-search",
  asyncHandler(async (req, res) => {
    const { characters } = req.body as { characters?: string[] };
    if (!Array.isArray(characters) || characters.length === 0) {
      return res.json({ results: [] });
    }
    const results = await batchSearchCharacters(characters).catch(() => []);
    res.json({ results });
  }),
);

// GET /character/:wikidataId
router.get(
  "/:wikidataId",
  asyncHandler(async (req, res) => {
    const { wikidataId } = req.params as { wikidataId: string };
    if (!/^Q\d+$/.test(wikidataId)) {
      return res.status(400).json({ error: "Invalid Wikidata ID" });
    }

    const [entityInfo, rawFilmography] = await Promise.all([
      getCharacterFromWikidata(wikidataId).catch(() => null),
      getCharacterFilmography(wikidataId).catch(() => [] as Array<{ title: string; year: string | null; imdbId: string | null }>),
    ]);

    if (!entityInfo) {
      return res.status(404).json({ error: "Character not found" });
    }

    // Enrich filmography with TMDB poster/rating data (up to 12 films)
    const toEnrich = rawFilmography.filter(f => f.imdbId).slice(0, 12);

    const filmography: CharacterFilm[] = await Promise.all(
      toEnrich.map(async f => {
        try {
          const findData = await tmdbFetch<{
            movie_results?: Array<{
              id: number;
              title?: string;
              release_date?: string;
              poster_path?: string | null;
              vote_average?: number;
              vote_count?: number;
              genre_ids?: number[];
              popularity?: number;
            }>;
            tv_results?: Array<{
              id: number;
              name?: string;
              first_air_date?: string;
              poster_path?: string | null;
              vote_average?: number;
              vote_count?: number;
              genre_ids?: number[];
              popularity?: number;
            }>;
          }>(`/find/${encodeURIComponent(f.imdbId!)}`, {
            external_source: "imdb_id",
          });

          const movie = findData.movie_results?.find(m => !m.adult);
          const tv = findData.tv_results?.[0];
          if (movie) {
            return {
              title: movie.title ?? f.title,
              year: movie.release_date ? movie.release_date.slice(0, 4) : f.year,
              imdbId: f.imdbId,
              posterUrl: posterUrl(movie.poster_path),
              tmdbRating: movie.vote_average ? String(movie.vote_average.toFixed(1)) : null,
              voteCount: movie.vote_count ?? 0,
              genreIds: movie.genre_ids ?? [],
              popularity: movie.popularity ?? 0,
              franchiseIds: [],
              mediaType: "movie" as const,
            };
          }
          if (tv) {
            return {
              title: tv.name ?? f.title,
              year: tv.first_air_date ? tv.first_air_date.slice(0, 4) : f.year,
              imdbId: f.imdbId,
              posterUrl: posterUrl(tv.poster_path),
              tmdbRating: tv.vote_average ? String(tv.vote_average.toFixed(1)) : null,
              voteCount: tv.vote_count ?? 0,
              genreIds: tv.genre_ids ?? [],
              popularity: tv.popularity ?? 0,
              franchiseIds: [],
              mediaType: "tv" as const,
            };
          }
        } catch {
          // ignore enrichment error
        }
        return {
          title: f.title,
          year: f.year,
          imdbId: f.imdbId,
          posterUrl: null,
          tmdbRating: null,
          voteCount: 0,
          genreIds: [],
          popularity: 0,
          franchiseIds: [],
          mediaType: "movie" as const,
        };
      }),
    );

    res.json({
      wikidataId,
      name: entityInfo.name,
      description: entityInfo.description,
      imageUrl: entityInfo.imageUrl,
      filmography: filmography.filter(f => f.title),
    });
  }),
);

export default router;
