import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export const partyInviteStatusEnum = pgEnum("party_invite_status", [
  "pending",
  "accepted",
  "declined",
]);

export const partyInvitesTable = pgTable("party_invites", {
  id: text("id").primaryKey(),
  partyGroupId: text("party_group_id").notNull(),
  inviterUserId: text("inviter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  inviterTicketId: text("inviter_ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  inviteeUserId: text("invitee_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: partyInviteStatusEnum("status").notNull().default("pending"),
  assignedSeat: integer("assigned_seat"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPartyInviteSchema = createInsertSchema(partyInvitesTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertPartyInvite = z.infer<typeof insertPartyInviteSchema>;
export type PartyInvite = typeof partyInvitesTable.$inferSelect;
