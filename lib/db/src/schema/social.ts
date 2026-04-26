import { pgTable, text, boolean, timestamp, pgEnum, index, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";
import { chainsTable } from "./chains";

export const memoryAccessStatusEnum = pgEnum("memory_access_status", ["pending", "approved", "denied"]);

export const memoryAccessRequestsTable = pgTable("memory_access_requests", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  requesterId: text("requester_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: memoryAccessStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const followsTable = pgTable("follows", {
  followerId: text("follower_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  followingId: text("following_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("follows_follower_id_idx").on(table.followerId),
  index("follows_following_id_idx").on(table.followingId),
]);

export const followRequestsTable = pgTable("follow_requests", {
  id: text("id").primaryKey(),
  fromUserId: text("from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  toUserId: text("to_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const likesTable = pgTable("likes", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  reactionType: text("reaction_type").notNull().default("heart"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("likes_ticket_id_idx").on(table.ticketId),
  index("likes_user_id_idx").on(table.userId),
]);

export const REACTION_TYPES = ["heart", "fire", "lightning", "sparkle", "popcorn"] as const;
export type ReactionTypeName = (typeof REACTION_TYPES)[number];
export const REACTION_POINTS: Record<ReactionTypeName, number> = {
  heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5,
};

export const ticketReactionsTable = pgTable("ticket_reactions", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  reactionType: text("reaction_type").notNull(),
  count: integer("count").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.ticketId, table.reactionType] }),
  index("ticket_reactions_ticket_id_idx").on(table.ticketId),
  index("ticket_reactions_user_id_idx").on(table.userId),
]);

export const commentsTable = pgTable("comments", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("comments_ticket_id_created_at_idx").on(table.ticketId, table.createdAt),
]);

export const bookmarksTable = pgTable("bookmarks", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bookmarks_user_id_idx").on(table.userId),
  index("bookmarks_ticket_id_idx").on(table.ticketId),
]);

export const reportReasonEnum = pgEnum("report_reason", ["spam", "inappropriate", "harassment", "other"]);

export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ticketId: text("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),
  chainId: text("chain_id").references(() => chainsTable.id, { onDelete: "cascade" }),
  reportedUserId: text("reported_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  reason: reportReasonEnum("reason").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const movieLikesTable = pgTable("movie_likes", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  movieId: text("movie_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const movieCommentsTable = pgTable("movie_comments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  movieId: text("movie_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const movieBookmarksTable = pgTable("movie_bookmarks", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  movieId: text("movie_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
