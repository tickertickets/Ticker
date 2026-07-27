import { pgTable, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const movieFollowsTable = pgTable("movie_follows", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tmdbId: integer("tmdb_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.tmdbId] }),
  index("movie_follows_tmdb_id_idx").on(table.tmdbId),
]);

export type MovieFollow = typeof movieFollowsTable.$inferSelect;
