import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent cache for character-by-movie results.
 * Keyed by tmdbId (the movie/TV identifier used by the by-movie endpoint).
 * Survives server restarts — avoids re-hitting the Comic Vine / AniList APIs
 * on every cold start.
 */
export const characterCacheTable = pgTable("character_cache", {
  tmdbId: text("tmdb_id").primaryKey(),
  results: jsonb("results").notNull().$type<unknown[]>(),
  cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
});
