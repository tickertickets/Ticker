import { pgTable, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notifSubscriptionsTable = pgTable("notif_subscriptions", {
  subscriberId: text("subscriber_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.subscriberId, table.targetUserId] }),
  index("notif_sub_subscriber_idx").on(table.subscriberId),
  index("notif_sub_target_idx").on(table.targetUserId),
]);
