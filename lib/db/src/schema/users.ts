import { pgTable, text, boolean, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  username: text("username").unique(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  birthdate: date("birthdate"),
  emailVerified: boolean("email_verified").notNull().default(false),
  isOnboarded: boolean("is_onboarded").notNull().default(false),
  isPrivate: boolean("is_private").notNull().default(false),
  agreedToTermsAt: timestamp("agreed_to_terms_at", { withTimezone: true }),
  profileOrder: text("profile_order"),
  preferredLang: text("preferred_lang").notNull().default("en"),
  timezone: text("timezone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
