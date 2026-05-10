import { pgTable, text, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const wikiItemsTable = pgTable("wiki_items", {
  id: text("id").primaryKey(),
  wikiPageId: text("wiki_page_id").notNull().unique(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  thumbnailUrl: text("thumbnail_url"),
  url: text("url").notNull(),
  lang: text("lang").notNull().default("en"),
  category: text("category").notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wiki_items_wiki_page_id_idx").on(t.wikiPageId),
  index("wiki_items_category_idx").on(t.category),
]);

export const wikiItemLikesTable = pgTable("wiki_item_likes", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  wikiItemId: text("wiki_item_id").notNull().references(() => wikiItemsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.wikiItemId] }),
  index("wiki_item_likes_wiki_item_id_idx").on(t.wikiItemId),
]);

export const wikiItemBookmarksTable = pgTable("wiki_item_bookmarks", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  wikiItemId: text("wiki_item_id").notNull().references(() => wikiItemsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.wikiItemId] }),
  index("wiki_item_bookmarks_wiki_item_id_idx").on(t.wikiItemId),
]);

export const wikiItemCommentsTable = pgTable("wiki_item_comments", {
  id: text("id").primaryKey(),
  wikiItemId: text("wiki_item_id").notNull().references(() => wikiItemsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  replyToId: text("reply_to_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wiki_item_comments_wiki_item_id_idx").on(t.wikiItemId),
]);

export type WikiItem = typeof wikiItemsTable.$inferSelect;
export type WikiItemLike = typeof wikiItemLikesTable.$inferSelect;
export type WikiItemBookmark = typeof wikiItemBookmarksTable.$inferSelect;
export type WikiItemComment = typeof wikiItemCommentsTable.$inferSelect;
