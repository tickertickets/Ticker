import { pgTable, text, boolean, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export const notificationTypeEnum = pgEnum("notification_type", [
  "like",
  "comment",
  "follow",
  "follow_request",
  "tag",
  "ticket_share",
  "party_invite",
  "party_color_unlock",
  "party_color_reverted",
  "memory_request",
  "memory_approved",
  "supporter_approved",
  "page_verified_approved",
  "admin_message",
  "chain_continued",
  "chain_run_started",
]);

export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  ticketId: text("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),
  partyInviteId: text("party_invite_id"),
  partyGroupId: text("party_group_id"),
  chainId: text("chain_id"),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_id_created_at_idx").on(table.userId, table.createdAt),
  index("notifications_user_id_is_read_idx").on(table.userId, table.isRead),
]);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  createdAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
