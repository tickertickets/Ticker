import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const USERNAME_CHANGE_COOLDOWN_DAYS = 7;

export const usernameChangesTable = pgTable("username_changes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  oldUsername: text("old_username").notNull(),
  newUsername: text("new_username").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UsernameChange = typeof usernameChangesTable.$inferSelect;
