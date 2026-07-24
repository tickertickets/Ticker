import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// Express-session table (connect-pg-simple). Declared so drizzle-kit doesn't
// treat it as a dropped/renamed table during push diffs.
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { withTimezone: false, mode: "date" }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
