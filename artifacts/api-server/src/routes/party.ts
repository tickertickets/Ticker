import { createNotification } from "../services/notify.service";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ticketsTable,
  notificationsTable,
  partyInvitesTable,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { buildTicket, checkAndUpdatePartyColor } from "./tickets";
import { awardXp } from "../services/badge.service";

const router: IRouter = Router();

// ── GET /party/invite/:inviteId — get invite details ─────────────────────────
router.get("/invite/:inviteId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { inviteId } = req.params;

  const [invite] = await db.select().from(partyInvitesTable)
    .where(eq(partyInvitesTable.id, inviteId))
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (invite.inviteeUserId !== currentUserId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  // Get taken seats for this party group
  const partyTickets = await db.select({
    seatNumber: ticketsTable.partySeatNumber,
  }).from(ticketsTable)
    .where(and(
      eq(ticketsTable.partyGroupId, invite.partyGroupId),
      isNull(ticketsTable.deletedAt),
    ));

  const takenSeats = partyTickets.map(t => t.seatNumber).filter(Boolean) as number[];

  // Get accepted invites seats too
  const acceptedInvites = await db.select({ seat: partyInvitesTable.assignedSeat })
    .from(partyInvitesTable)
    .where(and(
      eq(partyInvitesTable.partyGroupId, invite.partyGroupId),
      eq(partyInvitesTable.status, "accepted"),
    ));

  for (const ai of acceptedInvites) {
    if (ai.seat && !takenSeats.includes(ai.seat)) {
      takenSeats.push(ai.seat);
    }
  }

  // Get inviter ticket info
  const [inviterTicket] = await db.select().from(ticketsTable)
    .where(eq(ticketsTable.id, invite.inviterTicketId))
    .limit(1);

  const [inviterUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, invite.inviterUserId))
    .limit(1);

  res.json({
    invite: {
      id: invite.id,
      partyGroupId: invite.partyGroupId,
      status: invite.status,
      assignedSeat: invite.assignedSeat,
    },
    movie: inviterTicket ? {
      movieTitle: inviterTicket.movieTitle,
      movieYear: inviterTicket.movieYear,
      posterUrl: inviterTicket.posterUrl,
      partySize: inviterTicket.partySize,
    } : null,
    inviter: inviterUser ? {
      id: inviterUser.id,
      username: inviterUser.username,
      displayName: inviterUser.displayName,
      avatarUrl: inviterUser.avatarUrl,
    } : null,
    takenSeats,
  });
});

// ── POST /party/invite/:inviteId/accept ───────────────────────────────────────
router.post("/invite/:inviteId/accept", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { inviteId } = req.params;
  const { seatNumber, memoryNote, watchedAt, location, rating, ratingType, isPrivate, hideWatchedAt, hideLocation } = req.body;

  if (!seatNumber || Number(seatNumber) < 1) {
    res.status(400).json({ error: "bad_request", message: "seatNumber is required" });
    return;
  }

  const ratingNum = rating != null && rating !== "" ? Number(rating) : null;
  if (ratingNum !== null && (ratingNum < 1 || ratingNum > 5)) {
    res.status(400).json({ error: "bad_request", message: "rating ต้องอยู่ระหว่าง 1-5" });
    return;
  }

  const resolvedRatingType = ratingType === "blackhole" ? "blackhole" : "star";

  const [invite] = await db.select().from(partyInvitesTable)
    .where(eq(partyInvitesTable.id, inviteId))
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (invite.inviteeUserId !== currentUserId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (invite.status !== "pending") {
    res.status(409).json({ error: "already_responded", message: "คุณตอบรับคำเชิญนี้ไปแล้ว" });
    return;
  }

  // Get the inviter's ticket to copy movie details
  const [inviterTicket] = await db.select().from(ticketsTable)
    .where(and(eq(ticketsTable.id, invite.inviterTicketId), isNull(ticketsTable.deletedAt)))
    .limit(1);

  if (!inviterTicket) {
    res.status(404).json({ error: "not_found", message: "การ์ดต้นฉบับถูกลบไปแล้ว" });
    return;
  }

  const partyGroupId = invite.partyGroupId;
  const partySize = inviterTicket.partySize!;
  const seatNum = Math.floor(Number(seatNumber));

  // Validate seat is within range
  if (seatNum < 1 || seatNum > partySize) {
    res.status(400).json({ error: "bad_request", message: "seatNumber ไม่อยู่ในช่วงที่กำหนด" });
    return;
  }

  // Check seat is not already taken
  const [seatTaken] = await db.select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(
      eq(ticketsTable.partyGroupId, partyGroupId),
      eq(ticketsTable.partySeatNumber, seatNum),
      isNull(ticketsTable.deletedAt),
    ))
    .limit(1);

  if (seatTaken) {
    res.status(409).json({ error: "seat_taken", message: "เลขที่นี้ถูกเลือกไปแล้ว" });
    return;
  }

  // Check the accepting user doesn't already have this movie
  const [dupCheck] = await db.select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(
      eq(ticketsTable.userId, currentUserId),
      eq(ticketsTable.imdbId, inviterTicket.imdbId),
      isNull(ticketsTable.deletedAt),
    ))
    .limit(1);

  if (dupCheck) {
    res.status(409).json({ error: "duplicate_movie", message: "คุณโพสต์หนังเรื่องนี้ไปแล้ว" });
    return;
  }

  // Create the ticket for this user
  const newTicketId = nanoid();
  const cleanNote = memoryNote ? sanitize(String(memoryNote).trim()) : null;
  const cleanLocation = location ? sanitize(String(location).trim()) : null;

  await db.insert(ticketsTable).values({
    id: newTicketId,
    userId: currentUserId,
    imdbId: inviterTicket.imdbId,
    movieTitle: inviterTicket.movieTitle,
    movieYear: inviterTicket.movieYear,
    posterUrl: inviterTicket.posterUrl,
    genre: inviterTicket.genre,
    template: inviterTicket.template,
    memoryNote: cleanNote,
    watchedAt: watchedAt || null,
    location: cleanLocation,
    isPrivate: isPrivate ?? false,
    hideWatchedAt: hideWatchedAt ?? false,
    hideLocation: hideLocation ?? false,
    rating: ratingNum != null ? String(ratingNum) : null,
    ratingType: resolvedRatingType,
    rankTier: inviterTicket.rankTier,
    currentRankTier: inviterTicket.currentRankTier,
    popularityScore: inviterTicket.popularityScore,
    tmdbSnapshot: inviterTicket.tmdbSnapshot,
    partyGroupId,
    partySeatNumber: seatNum,
    partySize,
    specialColor: null,
  });

  // Update the invite record
  await db.update(partyInvitesTable).set({
    status: "accepted",
    assignedSeat: seatNum,
    updatedAt: new Date(),
  }).where(eq(partyInvitesTable.id, inviteId));

  // Mark the party invite notification as read for the invitee (current user)
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.userId, currentUserId),
      eq(notificationsTable.partyInviteId, inviteId),
    ));

  // Notify the inviter
  await createNotification({
    id: nanoid(),
    userId: invite.inviterUserId,
    fromUserId: currentUserId,
    type: "party_invite",
    ticketId: newTicketId,
    partyInviteId: inviteId,
    partyGroupId,
    message: `ตอบรับคำเชิญปาร์ตี้ "${inviterTicket.movieTitle}" และเลือกที่นั่ง #${seatNum}`,
    isRead: false,
  });

  // Check if all invitees have now accepted → unlock special color
  await checkAndUpdatePartyColor(partyGroupId, partySize, currentUserId);

  // Badge XP: inviter gets party_accept XP when someone accepts their invite
  // sourceId = inviteId ensures exactly one XP event per accepted invite
  if (invite.inviterUserId !== currentUserId) {
    awardXp(invite.inviterUserId, "party_accept", `party_accept:${inviteId}`, currentUserId).catch(() => {});
  }

  const [created] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, newTicketId)).limit(1);
  const result = await buildTicket(created!, currentUserId);
  res.status(201).json({ ticket: result });
});

// ── POST /party/invite/:inviteId/decline ──────────────────────────────────────
router.post("/invite/:inviteId/decline", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { inviteId } = req.params;

  const [invite] = await db.select().from(partyInvitesTable)
    .where(eq(partyInvitesTable.id, inviteId))
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (invite.inviteeUserId !== currentUserId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (invite.status !== "pending") {
    res.status(409).json({ error: "already_responded" });
    return;
  }

  await db.update(partyInvitesTable).set({
    status: "declined",
    updatedAt: new Date(),
  }).where(eq(partyInvitesTable.id, inviteId));

  res.json({ success: true });
});

// ── GET /party/group/:partyGroupId — party group info ────────────────────────
router.get("/group/:partyGroupId", async (req, res) => {
  const currentUserId = req.session?.userId;
  const { partyGroupId } = req.params;

  const partyTickets = await db.select({ ticket: ticketsTable, user: usersTable })
    .from(ticketsTable)
    .innerJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
    .where(and(eq(ticketsTable.partyGroupId, partyGroupId), isNull(ticketsTable.deletedAt)));

  if (partyTickets.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Check visibility: must be in the party or public
  const isMember = partyTickets.some(p => p.ticket.userId === currentUserId);

  const invites = await db.select().from(partyInvitesTable)
    .where(eq(partyInvitesTable.partyGroupId, partyGroupId));

  const pendingCount = invites.filter(i => i.status === "pending").length;
  const partySize = partyTickets[0]?.ticket.partySize ?? 0;
  const specialColor = partyTickets[0]?.ticket.specialColor ?? null;

  res.json({
    partyGroupId,
    partySize,
    specialColor,
    pendingCount,
    members: partyTickets
      .sort((a, b) => (a.ticket.partySeatNumber ?? 0) - (b.ticket.partySeatNumber ?? 0))
      .map(p => ({
        userId: p.user.id,
        username: p.user.username!,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        seatNumber: p.ticket.partySeatNumber!,
        ticketId: p.ticket.id,
      })),
  });
});

export default router;
