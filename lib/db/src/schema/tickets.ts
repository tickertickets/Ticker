import { pgTable, text, boolean, timestamp, date, numeric, pgEnum, integer, jsonb, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ticketTemplateEnum = pgEnum("ticket_template", ["classic", "holographic", "retro"]);
export const ratingTypeEnum = pgEnum("rating_type", ["star", "blackhole"]);

export const rankTierEnum = pgEnum("rank_tier", [
  "common",       // C  1.0–5.0  and  U  5.1–6.5 (distinguished by score in snapshot)
  "rare",         // R  6.6–7.5
  "ultra",        // SR 7.6–8.2
  "legendary",    // UR 8.3–10.0
  "holographic",  // LEGENDARY special (UR + LGC)
  "cult_classic", // CULT CLASSIC special (C + LGC)
]);

export const specialColorEnum = pgEnum("special_color", [
  "bronze",   // 2 members fully accepted
  "silver",   // 4 members fully accepted
  "gold",     // 6 members fully accepted
  "diamond",  // 10 members fully accepted
]);

export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  imdbId: text("imdb_id").notNull(),
  movieTitle: text("movie_title").notNull(),
  movieYear: text("movie_year"),
  posterUrl: text("poster_url"),
  genre: text("genre"),
  template: ticketTemplateEnum("template").notNull().default("classic"),
  memoryNote: text("memory_note"),
  caption: text("caption"),
  watchedAt: date("watched_at"),
  location: text("location"),
  isPrivate: boolean("is_private").notNull().default(false),
  hideWatchedAt: boolean("hide_watched_at").notNull().default(false),
  hideLocation: boolean("hide_location").notNull().default(false),
  hideLikes: boolean("hide_likes").notNull().default(false),
  hideComments: boolean("hide_comments").notNull().default(false),
  rating: numeric("rating", { precision: 3, scale: 1 }),
  ratingType: ratingTypeEnum("rating_type").notNull().default("star"),
  isPrivateMemory: boolean("is_private_memory").notNull().default(false),
  isSpoiler: boolean("is_spoiler").notNull().default(false),
  rankTier: rankTierEnum("rank_tier").notNull().default("common"),
  currentRankTier: rankTierEnum("current_rank_tier").notNull().default("common"),
  popularityScore: integer("popularity_score").notNull().default(0),
  tmdbSnapshot: text("tmdb_snapshot"),
  // Party mode fields
  partyGroupId: text("party_group_id"),
  partySeatNumber: integer("party_seat_number"),
  partySize: integer("party_size"),
  specialColor: specialColorEnum("special_color"),
  customRankTier: text("custom_rank_tier"),
  rankLocked: boolean("rank_locked").notNull().default(false),
  captionAlign: text("caption_align").default("left"),
  // Poster card theme fields
  cardTheme: text("card_theme").default("classic"),
  cardBackdropUrl: text("card_backdrop_url"),
  cardBackdropOffsetX: integer("card_backdrop_offset_x").default(50),
  cardRuntime: text("card_runtime"),
  cardDirector: text("card_director"),
  cardProducer: text("card_producer"),
  cardActors: text("card_actors"),
  clipUrl: text("clip_url"),
  episodeLabel: text("episode_label"),
  displayOrder: integer("display_order"),
  cardData: jsonb("card_data").$type<Record<string, unknown>>(),
  captionLinks: jsonb("caption_links").$type<Array<{ id: string; url: string; platform: string; label?: string }>>().default([]),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tickets_user_id_created_at_idx").on(table.userId, table.createdAt),
  index("tickets_created_at_idx").on(table.createdAt),
  index("tickets_user_id_imdb_id_idx").on(table.userId, table.imdbId),
  index("tickets_party_group_id_idx").on(table.partyGroupId),
]);

export const ticketTagsTable = pgTable("ticket_tags", {
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
});

export const ticketTagRatingsTable = pgTable("ticket_tag_ratings", {
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rating: numeric("rating", { precision: 3, scale: 1 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ticket_tag_ratings_ticket_user_uniq").on(table.ticketId, table.userId),
]);

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
