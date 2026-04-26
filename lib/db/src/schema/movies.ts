import { pgTable, integer, text, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent TMDB movie/TV cache.
 *
 * Keyed by tmdb_id + media_type. All TMDB data flows through the backend
 * tmdb-client, which writes to this table on first fetch and reuses cached
 * rows for subsequent requests (TTL controlled by TMDB_CACHE_TTL in the
 * movies service).
 *
 * Architecture rule: frontend NEVER calls TMDB directly. The backend checks
 * this table first and only hits the TMDB API when the row is missing or stale.
 */
export const moviesTable = pgTable("movies", {
  tmdbId: integer("tmdb_id").primaryKey(),
  mediaType: text("media_type").notNull().default("movie"),
  title: text("title").notNull(),
  posterUrl: text("poster_url"),
  backdropUrl: text("backdrop_url"),
  overview: text("overview"),
  releaseDate: text("release_date"),
  voteAverage: numeric("vote_average", { precision: 4, scale: 2 }),
  voteCount: integer("vote_count"),
  popularity: numeric("popularity", { precision: 12, scale: 4 }),
  genreIds: jsonb("genre_ids").$type<number[]>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Generic key/value cache for list-level TMDB responses (e.g. trending page 1,
 * upcoming feed). Replaces the module-level in-memory caches in movies.ts,
 * which are lost on every serverless cold start.
 *
 * cache_key examples:
 *   "trending-p1"   → /movies/trending?page=1
 *   "upcoming-feed" → /movies/upcoming-feed
 *
 * Consumers check fetched_at against their TTL before deciding whether to
 * refresh from TMDB.
 */
export const apiCacheTable = pgTable("api_cache", {
  cacheKey: text("cache_key").primaryKey(),
  data: jsonb("data").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Movie = typeof moviesTable.$inferSelect;
export type InsertMovie = typeof moviesTable.$inferInsert;
export type ApiCache = typeof apiCacheTable.$inferSelect;
