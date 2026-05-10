import { pgTable, text, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export const albumsTable = pgTable("albums", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  displayOrder: integer("display_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const albumTicketsTable = pgTable("album_tickets", {
  albumId: text("album_id").notNull().references(() => albumsTable.id, { onDelete: "cascade" }),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("album_tickets_ticket_unique").on(t.ticketId),
]);

export const albumMoviesTable = pgTable("album_movies", {
  albumId: text("album_id").notNull().references(() => albumsTable.id, { onDelete: "cascade" }),
  movieId: text("movie_id").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("album_movies_movie_unique").on(t.movieId),
]);

export type Album = typeof albumsTable.$inferSelect;
export type AlbumTicket = typeof albumTicketsTable.$inferSelect;
export type AlbumMovie = typeof albumMoviesTable.$inferSelect;
