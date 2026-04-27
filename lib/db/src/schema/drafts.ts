import { pgTable, serial, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const draftsTable = pgTable(
  "drafts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    key: text("key").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("drafts_user_type_key_uniq").on(t.userId, t.type, t.key)],
);
