import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Enums ──────────────────────────────────────────────────────────────────────

export const badgeLevelEnum = pgEnum("badge_level", [
  "1",
  "2",
  "3",
  "4",
  "5",
]);

export const badgeXpActionEnum = pgEnum("badge_xp_action", [
  "post_ticket",
  "post_chain",
  "tag_friend",
  "party_accept",
]);

export const supporterRequestStatusEnum = pgEnum("supporter_request_status", [
  "pending",
  "approved",
  "rejected",
]);

// ── user_badge — one row per user, tracks current progress ────────────────────

export const userBadgeTable = pgTable("user_badge", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(0),
  xpCurrent: integer("xp_current").notNull().default(0),
  xpFromPosts: integer("xp_from_posts").notNull().default(0),
  xpFromTags: integer("xp_from_tags").notNull().default(0),
  xpFromParty: integer("xp_from_party").notNull().default(0),
  badgeHidden: boolean("badge_hidden").notNull().default(false),
  displayLevel: integer("display_level"),
  isSupporterApproved: boolean("is_supporter_approved").notNull().default(false),
  isPageVerified: boolean("is_page_verified").notNull().default(false),
  pageBadgeHidden: boolean("page_badge_hidden").notNull().default(false),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── badge_xp_log — immutable audit log of every XP event ─────────────────────

export const badgeXpLogTable = pgTable("badge_xp_log", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  action: badgeXpActionEnum("action").notNull(),
  xpAwarded: integer("xp_awarded").notNull(),
  sourceId: text("source_id").notNull(),
  sourceUserId: text("source_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("badge_xp_log_user_id_idx").on(table.userId),
  index("badge_xp_log_user_action_date_idx").on(table.userId, table.action, table.createdAt),
  uniqueIndex("badge_xp_log_source_unique_idx").on(table.userId, table.action, table.sourceId),
]);

// ── supporter_requests — donation-based Lv5 badge requests ───────────────────

export const supporterRequestsTable = pgTable("supporter_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  slipImagePath: text("slip_image_path"),
  status: supporterRequestStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("supporter_requests_user_id_idx").on(table.userId),
  index("supporter_requests_status_idx").on(table.status),
]);

export type UserBadge = typeof userBadgeTable.$inferSelect;
export type BadgeXpLog = typeof badgeXpLogTable.$inferSelect;
export type SupporterRequest = typeof supporterRequestsTable.$inferSelect;

// ── page_verification_requests — popcorn bucket "verified page" badge ────────

export const pageVerificationRequestsTable = pgTable("page_verification_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  proofImagePath: text("proof_image_path"),
  pageName: text("page_name").notNull(),
  pageUrl: text("page_url"),
  status: supporterRequestStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("page_verify_requests_user_id_idx").on(table.userId),
  index("page_verify_requests_status_idx").on(table.status),
]);

export type PageVerificationRequest = typeof pageVerificationRequestsTable.$inferSelect;
