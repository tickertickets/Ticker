import { pgTable, text, boolean, timestamp, integer, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chainsTable = pgTable("chains", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  descriptionAlign: text("description_align").notNull().default("left"),
  isPrivate: boolean("is_private").notNull().default(false),
  minMovieCount: integer("min_movie_count").notNull().default(2),
  challengeDurationMs: integer("challenge_duration_ms"),
  mode: text("mode").notNull().default("standard"),
  hideComments: boolean("hide_comments").notNull().default(false),
  hideLikes: boolean("hide_likes").notNull().default(false),
  hideChainCount: boolean("hide_chain_count").notNull().default(false),
  chainCount: integer("chain_count").notNull().default(0),
  displayOrder: integer("display_order"),
  descriptionLinks: jsonb("description_links").$type<Array<{ id: string; url: string; platform: string; label?: string }>>().default([]),
  taggedMovieImdbId: text("tagged_movie_imdb_id"),
  taggedMovieTitle: text("tagged_movie_title"),
  taggedMoviePosterUrl: text("tagged_movie_poster_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const chainMoviesTable = pgTable("chain_movies", {
  id: text("id").primaryKey(),
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  imdbId: text("imdb_id").notNull(),
  movieTitle: text("movie_title").notNull(),
  movieYear: text("movie_year"),
  posterUrl: text("poster_url"),
  genre: text("genre"),
  customRankTier: text("custom_rank_tier"),
  tmdbSnapshot: text("tmdb_snapshot"),
  addedByUserId: text("added_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  memoryNote: text("memory_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chainRunsTable = pgTable("chain_runs", {
  id: text("id").primaryKey(),
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("live"),
  totalElapsedMs: integer("total_elapsed_ms").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chainRunItemsTable = pgTable("chain_run_items", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => chainRunsTable.id, { onDelete: "cascade" }),
  chainMovieId: text("chain_movie_id").notNull().references(() => chainMoviesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  elapsedMs: integer("elapsed_ms"),
  ticketId: text("ticket_id"),
  rating: integer("rating"),
  ratingType: text("rating_type"),
  customRankTier: text("custom_rank_tier"),
  memoryNote: text("memory_note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chainHuntFoundMoviesTable = pgTable("chain_hunt_found_movies", {
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  chainMovieId: text("chain_movie_id").notNull().references(() => chainMoviesTable.id, { onDelete: "cascade" }),
  foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.chainId, t.chainMovieId] })]);

export const chainLikesTable = pgTable("chain_likes", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.chainId] })]);

export const chainBookmarksTable = pgTable("chain_bookmarks", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.chainId] })]);

export const chainCommentsTable = pgTable("chain_comments", {
  id: text("id").primaryKey(),
  chainId: text("chain_id").notNull().references(() => chainsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  replyToId: text("reply_to_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChainSchema = createInsertSchema(chainsTable).omit({ createdAt: true, updatedAt: true });
export type InsertChain = z.infer<typeof insertChainSchema>;
export type Chain = typeof chainsTable.$inferSelect;
export type ChainMovie = typeof chainMoviesTable.$inferSelect;
export type ChainRun = typeof chainRunsTable.$inferSelect;
export type ChainRunItem = typeof chainRunItemsTable.$inferSelect;
