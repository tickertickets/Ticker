import { pgTable, text, integer, numeric, jsonb, timestamp, primaryKey, index, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type MusicEntity = "song" | "album" | "artist";
export type MusicItemSnapshot = {
  providerId: string;
  entity: MusicEntity;
  name: string;
  artistName?: string | null;
  collectionName?: string | null;
  artworkUrl?: string | null;
  previewUrl?: string | null;
  itemUrl?: string | null;
  genre?: string | null;
  releaseDate?: string | null;
  durationMs?: number | null;
  trackCount?: number | null;
};

export const musicItemsTable = pgTable("music_items", {
  providerId: text("provider_id").notNull(),
  entity: text("entity").$type<MusicEntity>().notNull(),
  name: text("name").notNull(),
  artistName: text("artist_name"),
  collectionName: text("collection_name"),
  artworkUrl: text("artwork_url"),
  previewUrl: text("preview_url"),
  itemUrl: text("item_url"),
  genre: text("genre"),
  releaseDate: text("release_date"),
  durationMs: integer("duration_ms"),
  trackCount: integer("track_count"),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.providerId, table.entity] }),
  index("music_items_entity_fetched_idx").on(table.entity, table.fetchedAt),
]);

export const musicVinylsTable = pgTable("music_vinyls", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull(),
  itemSnapshot: jsonb("item_snapshot").$type<MusicItemSnapshot>().notNull(),
  rating: numeric("rating", { precision: 2, scale: 1 }),
  ratingType: text("rating_type").notNull().default("star"),
  hideRating: boolean("hide_rating").notNull().default(false),
  caption: text("caption").notNull().default(""),
  shape: text("shape").notNull().default("vinyl"),
  isPrivate: boolean("is_private").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
}, table => [
  index("music_vinyls_user_created_idx").on(table.userId, table.createdAt),
  index("music_vinyls_created_idx").on(table.createdAt),
]);

export const musicPlaylistsTable = pgTable("music_playlists", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  coverUrl: text("cover_url"),
  isPrivate: boolean("is_private").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("music_playlists_user_created_idx").on(table.userId, table.createdAt),
  index("music_playlists_created_idx").on(table.createdAt),
]);

export const musicPlaylistItemsTable = pgTable("music_playlist_items", {
  playlistId: text("playlist_id").notNull().references(() => musicPlaylistsTable.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull(),
  itemSnapshot: jsonb("item_snapshot").$type<MusicItemSnapshot>().notNull(),
  position: integer("position").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.playlistId, table.trackId] }),
  index("music_playlist_items_order_idx").on(table.playlistId, table.position),
]);

export const musicSavesTable = pgTable("music_saves", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  entity: text("entity").$type<MusicEntity>().notNull(),
  itemSnapshot: jsonb("item_snapshot").$type<MusicItemSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.providerId, table.entity] }),
  index("music_saves_item_idx").on(table.entity, table.providerId),
]);

export const musicPlaylistSavesTable = pgTable("music_playlist_saves", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  playlistId: text("playlist_id").notNull().references(() => musicPlaylistsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<"listened">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.playlistId] }),
  index("music_playlist_saves_user_status_idx").on(table.userId, table.status, table.createdAt),
]);
