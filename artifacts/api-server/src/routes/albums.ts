import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { albumsTable, albumTicketsTable, albumMoviesTable, usersTable, ticketsTable, followsTable } from "@workspace/db/schema";
import { eq, and, asc, inArray, isNull } from "drizzle-orm";
import { sanitize } from "../lib/sanitize";
import { nanoid } from "nanoid";

const router: IRouter = Router();

// ── GET /albums?userId= — list albums for a user ──────────────────────────────
router.get("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  const userId = req.query["userId"] as string | undefined;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const [owner] = await db.select({ id: usersTable.id, isPrivate: usersTable.isPrivate })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!owner) { res.status(404).json({ error: "user_not_found" }); return; }

  if (owner.isPrivate && owner.id !== currentUserId) {
    const [follow] = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerId, currentUserId ?? ""), eq(followsTable.followingId, userId)))
      .limit(1);
    if (!follow) {
      res.status(403).json({ error: "forbidden" }); return;
    }
  }

  const isOwner = currentUserId === userId;

  const albums = await db.select().from(albumsTable)
    .where(eq(albumsTable.userId, userId))
    .orderBy(asc(albumsTable.displayOrder), asc(albumsTable.createdAt));

  const result = await Promise.all(albums.map(async album => {
    const atRows = await db.select({ ticketId: albumTicketsTable.ticketId })
      .from(albumTicketsTable)
      .where(eq(albumTicketsTable.albumId, album.id))
      .orderBy(asc(albumTicketsTable.addedAt));

    const amRows = await db.select({ movieId: albumMoviesTable.movieId })
      .from(albumMoviesTable)
      .where(eq(albumMoviesTable.albumId, album.id))
      .orderBy(asc(albumMoviesTable.addedAt));

    const allTicketIds = atRows.map(r => r.ticketId);
    const allMovieIds = amRows.map(r => r.movieId);

    let liveTicketIds = allTicketIds;
    if (allTicketIds.length > 0) {
      const liveRows = await db.select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(and(inArray(ticketsTable.id, allTicketIds), isNull(ticketsTable.deletedAt)));
      liveTicketIds = liveRows.map(r => r.id);
    }

    let visibleTicketIds = liveTicketIds;
    if (!isOwner && liveTicketIds.length > 0) {
      const visibleRows = await db.select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(and(inArray(ticketsTable.id, liveTicketIds), eq(ticketsTable.isPrivate, false)));
      visibleTicketIds = visibleRows.map(r => r.id);
    }

    const count = isOwner ? liveTicketIds.length : visibleTicketIds.length;

    let posters: (string | null)[] = [];
    if (visibleTicketIds.length > 0) {
      const ticketRows = await db.select({ id: ticketsTable.id, posterUrl: ticketsTable.posterUrl })
        .from(ticketsTable)
        .where(inArray(ticketsTable.id, visibleTicketIds.slice(0, 4)));
      posters = ticketRows.map(t => t.posterUrl);
    }

    return {
      id: album.id,
      userId: album.userId,
      title: album.title,
      displayOrder: album.displayOrder,
      createdAt: album.createdAt,
      ticketCount: count,
      posters,
      ticketIds: isOwner ? allTicketIds : visibleTicketIds,
      movieIds: allMovieIds,
    };
  }));

  res.json({ albums: result });
});

// ── POST /albums — create album ───────────────────────────────────────────────
router.post("/", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { title } = req.body;
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const id = nanoid();
  await db.insert(albumsTable).values({
    id,
    userId: currentUserId,
    title: sanitize(String(title).trim()),
  });

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  res.status(201).json({ ...album, ticketCount: 0, posters: [], ticketIds: [], movieIds: [] });
});

// ── PATCH /albums/profile-order — save unified profile grid order ─────────────
router.patch("/profile-order", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { order } = req.body;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order must be an array" });
    return;
  }

  await db.update(usersTable)
    .set({ profileOrder: JSON.stringify(order), updatedAt: new Date() })
    .where(eq(usersTable.id, currentUserId));

  res.json({ ok: true });
});

// ── PATCH /albums/:id — rename ────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id } = req.params;
  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const updates: Partial<typeof albumsTable.$inferInsert> = { updatedAt: new Date() };
  if (req.body.title !== undefined) updates.title = sanitize(String(req.body.title).trim());
  if (req.body.displayOrder !== undefined) updates.displayOrder = Number(req.body.displayOrder);

  await db.update(albumsTable).set(updates).where(eq(albumsTable.id, id));
  const [updated] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  res.json(updated);
});

// ── DELETE /albums/:id ────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id } = req.params;
  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await db.delete(albumsTable).where(eq(albumsTable.id, id));
  res.json({ ok: true });
});

// ── GET /albums/:id/tickets — list tickets in album ───────────────────────────
router.get("/:id/tickets", async (req, res) => {
  const currentUserId = req.session?.userId;
  const { id } = req.params;

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }

  const [owner] = await db.select({ id: usersTable.id, isPrivate: usersTable.isPrivate })
    .from(usersTable).where(eq(usersTable.id, album.userId)).limit(1);

  if (owner?.isPrivate && owner.id !== currentUserId) {
    const [follow] = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerId, currentUserId ?? ""), eq(followsTable.followingId, album.userId)))
      .limit(1);
    if (!follow) {
      res.status(403).json({ error: "forbidden" }); return;
    }
  }

  const atRows = await db.select({ ticketId: albumTicketsTable.ticketId })
    .from(albumTicketsTable)
    .where(eq(albumTicketsTable.albumId, id))
    .orderBy(asc(albumTicketsTable.addedAt));

  const ticketIds = atRows.map(r => r.ticketId);
  if (ticketIds.length === 0) {
    res.json({ tickets: [] }); return;
  }

  const isOwner = currentUserId === album.userId;

  const tickets = await db.select().from(ticketsTable)
    .where(
      isOwner
        ? and(inArray(ticketsTable.id, ticketIds), isNull(ticketsTable.deletedAt))
        : and(inArray(ticketsTable.id, ticketIds), isNull(ticketsTable.deletedAt), eq(ticketsTable.isPrivate, false))
    )
    .orderBy(asc(ticketsTable.createdAt));

  const { buildTicket } = await import("./tickets");
  const result = await Promise.all(tickets.map(t => buildTicket(t, currentUserId)));
  res.json({ tickets: result });
});

// ── POST /albums/:id/tickets — add ticket to album ────────────────────────────
router.post("/:id/tickets", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id } = req.params;
  const { ticketId } = req.body;
  if (!ticketId) { res.status(400).json({ error: "ticketId required" }); return; }

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const [ticket] = await db.select({ id: ticketsTable.id, userId: ticketsTable.userId })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.deletedAt)))
    .limit(1);
  if (!ticket) { res.status(404).json({ error: "ticket_not_found" }); return; }
  if (ticket.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const [existing] = await db.select().from(albumTicketsTable)
    .where(eq(albumTicketsTable.ticketId, ticketId))
    .limit(1);
  if (existing) {
    if (existing.albumId === id) {
      res.json({ ok: true }); return;
    }
    await db.delete(albumTicketsTable)
      .where(eq(albumTicketsTable.ticketId, ticketId));
  }

  await db.insert(albumTicketsTable).values({ albumId: id, ticketId });
  res.status(201).json({ ok: true });
});

// ── DELETE /albums/:id/tickets/:ticketId — remove ticket from album ───────────
router.delete("/:id/tickets/:ticketId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id, ticketId } = req.params;
  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await db.delete(albumTicketsTable)
    .where(and(eq(albumTicketsTable.albumId, id), eq(albumTicketsTable.ticketId, ticketId)));
  res.json({ ok: true });
});

// ── POST /albums/:id/movies — add movie to album ──────────────────────────────
router.post("/:id/movies", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id } = req.params;
  const { movieId } = req.body;
  if (!movieId) { res.status(400).json({ error: "movieId required" }); return; }

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  const [existing] = await db.select().from(albumMoviesTable)
    .where(eq(albumMoviesTable.movieId, movieId))
    .limit(1);
  if (existing) {
    if (existing.albumId === id) {
      res.json({ ok: true }); return;
    }
    await db.delete(albumMoviesTable).where(eq(albumMoviesTable.movieId, movieId));
  }

  await db.insert(albumMoviesTable).values({ albumId: id, movieId });
  res.status(201).json({ ok: true });
});

// ── DELETE /albums/:id/movies/:movieId — remove movie from album ──────────────
router.delete("/:id/movies/:movieId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { id, movieId } = req.params;
  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, id)).limit(1);
  if (!album) { res.status(404).json({ error: "not_found" }); return; }
  if (album.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }

  await db.delete(albumMoviesTable)
    .where(and(eq(albumMoviesTable.albumId, id), eq(albumMoviesTable.movieId, movieId)));
  res.json({ ok: true });
});

export default router;
