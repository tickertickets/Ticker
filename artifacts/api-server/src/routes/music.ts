import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@workspace/db";
import {
  followsTable,
  musicItemsTable,
  musicPlaylistItemsTable,
  musicPlaylistsTable,
  musicSavesTable,
  musicVinylsTable,
  usersTable,
  type MusicEntity,
  type MusicItemSnapshot,
} from "@workspace/db/schema";
import { sanitize } from "../lib/sanitize";
import { getMusicItem, musicCatalogProvider } from "../services/music-catalog.service";

const router: IRouter = Router();
const musicSearchLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Please wait before searching again." },
});
const musicWriteLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session?.userId ?? req.ip ?? "unknown",
  message: { error: "too_many_requests", message: "Please wait before posting again." },
});

const entities = new Set<MusicEntity>(["song", "album", "artist"]);
const countryFor = (req: { query: Record<string, unknown>; header: (name: string) => string | undefined }) => {
  const requested = String(req.query["country"] ?? (req.header("x-ui-lang") === "en" ? "US" : "TH")).toUpperCase();
  return /^[A-Z]{2}$/.test(requested) ? requested : "TH";
};
const validProviderId = (value: unknown): string | null => {
  const id = String(value ?? "");
  return /^\d{1,20}$/.test(id) ? id : null;
};
const parseEntity = (value: unknown): MusicEntity | null => {
  const entity = String(value ?? "");
  return entities.has(entity as MusicEntity) ? entity as MusicEntity : null;
};
async function itemSnapshots(ids: string[], country: string): Promise<MusicItemSnapshot[]> {
  const uniqueIds = [...new Set(ids)];
  const rows = uniqueIds.length
    ? await db.select().from(musicItemsTable)
      .where(and(inArray(musicItemsTable.providerId, uniqueIds), eq(musicItemsTable.entity, "song")))
    : [];
  const byId = new Map(rows.map(row => [row.providerId, row]));
  const missingIds = uniqueIds.filter(id => !byId.has(id));
  if (missingIds.length) {
    const fetched = await Promise.all(missingIds.map(id => getMusicItem(id, "song", country)));
    for (const item of fetched) {
      if (item?.entity === "song") {
        byId.set(item.providerId, item as typeof rows[number]);
      }
    }
  }
  return uniqueIds.map(id => byId.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
    .map(({ providerId, entity, name, artistName, collectionName, artworkUrl, previewUrl, itemUrl, genre, releaseDate, durationMs, trackCount }) => ({
      providerId, entity, name, artistName, collectionName, artworkUrl, previewUrl, itemUrl, genre, releaseDate, durationMs, trackCount,
    }));
}

async function canViewProfile(username: string, viewerId?: string) {
  const [owner] = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    isPrivate: usersTable.isPrivate,
  }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!owner) return { owner: null, allowed: false };
  if (!owner.isPrivate || owner.id === viewerId) return { owner, allowed: true };
  if (!viewerId) return { owner, allowed: false };
  const [follow] = await db.select({ followerId: followsTable.followerId }).from(followsTable)
    .where(and(eq(followsTable.followerId, viewerId), eq(followsTable.followingId, owner.id))).limit(1);
  return { owner, allowed: !!follow };
}

router.get("/search", musicSearchLimiter, async (req, res) => {
  const query = sanitize(String(req.query["q"] ?? "")).slice(0, 100);
  if (query.trim().length < 2) {
    res.status(400).json({ error: "query_too_short" });
    return;
  }
  const requestedEntity = String(req.query["entity"] ?? "song");
  if (requestedEntity !== "all" && !parseEntity(requestedEntity)) {
    res.status(400).json({ error: "invalid_entity" });
    return;
  }
  const limit = Math.max(1, Math.min(25, Number.parseInt(String(req.query["limit"] ?? "20"), 10) || 20));
  const results = await musicCatalogProvider.search(query.trim(), requestedEntity as MusicEntity | "all", countryFor(req), limit);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.json({ results });
});

router.get("/lookup/:entity/:id", musicSearchLimiter, async (req, res) => {
  const entity = parseEntity(req.params["entity"]);
  const providerId = validProviderId(req.params["id"]);
  if (!entity || !providerId) {
    res.status(400).json({ error: "invalid_music_item" });
    return;
  }
  const item = await getMusicItem(providerId, entity, countryFor(req));
  if (!item) {
    res.status(404).json({ error: "music_item_not_found" });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json({ item });
});

router.get("/trending", async (req, res) => {
  const entity = parseEntity(req.query["entity"]) ?? "song";
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [vinyls, saved] = await Promise.all([
    entity === "song"
      ? db.select({
          trackId: musicVinylsTable.trackId,
          itemSnapshot: musicVinylsTable.itemSnapshot,
          createdAt: musicVinylsTable.createdAt,
        }).from(musicVinylsTable)
          .where(and(isNull(musicVinylsTable.deletedAt), eq(musicVinylsTable.isPrivate, false), gte(musicVinylsTable.createdAt, since)))
          .orderBy(desc(musicVinylsTable.createdAt)).limit(800)
      : Promise.resolve([]),
    db.select({
      providerId: musicSavesTable.providerId,
      itemSnapshot: musicSavesTable.itemSnapshot,
      createdAt: musicSavesTable.createdAt,
    }).from(musicSavesTable)
      .where(and(eq(musicSavesTable.entity, entity), gte(musicSavesTable.createdAt, since)))
      .orderBy(desc(musicSavesTable.createdAt)).limit(1200),
  ]);
  const counts = new Map<string, { item: MusicItemSnapshot; score: number; lastAt: number }>();
  const add = (providerId: string, item: MusicItemSnapshot, timestamp: Date, weight: number) => {
    const current = counts.get(providerId);
    const score = weight / (1 + Math.max(0, (Date.now() - timestamp.getTime()) / 86_400_000));
    if (current) {
      current.score += score;
      current.lastAt = Math.max(current.lastAt, timestamp.getTime());
    } else counts.set(providerId, { item, score, lastAt: timestamp.getTime() });
  };
  for (const row of vinyls) add(row.trackId, row.itemSnapshot, row.createdAt, 2);
  for (const row of saved) add(row.providerId, row.itemSnapshot, row.createdAt, 1);
  const results = [...counts.values()].sort((a, b) => b.score - a.score || b.lastAt - a.lastAt)
    .slice(0, 30).map(row => row.item);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ results, source: "ticker_activity", windowDays: 30 });
});

router.get("/feed", async (req, res) => {
  const kind = String(req.query["kind"] ?? "all");
  if (!["all", "vinyl", "playlist"].includes(kind)) {
    res.status(400).json({ error: "invalid_feed_kind" });
    return;
  }
  const limit = Math.max(1, Math.min(40, Number.parseInt(String(req.query["limit"] ?? "24"), 10) || 24));
  const [vinylRows, playlistRows] = await Promise.all([
    kind !== "playlist"
      ? db.select({ post: musicVinylsTable, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
        .from(musicVinylsTable).innerJoin(usersTable, eq(musicVinylsTable.userId, usersTable.id))
        .where(and(isNull(musicVinylsTable.deletedAt), eq(musicVinylsTable.isPrivate, false)))
        .orderBy(desc(musicVinylsTable.createdAt)).limit(limit)
      : Promise.resolve([]),
    kind !== "vinyl"
      ? db.select({ playlist: musicPlaylistsTable, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
        .from(musicPlaylistsTable).innerJoin(usersTable, eq(musicPlaylistsTable.userId, usersTable.id))
        .where(and(isNull(musicPlaylistsTable.deletedAt), eq(musicPlaylistsTable.isPrivate, false)))
        .orderBy(desc(musicPlaylistsTable.createdAt)).limit(limit)
      : Promise.resolve([]),
  ]);
  const items = [
    ...vinylRows.map(row => ({ type: "vinyl" as const, post: row.post, user: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl } })),
    ...playlistRows.map(row => ({ type: "playlist" as const, post: row.playlist, user: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl } })),
  ].sort((a, b) => b.post.createdAt.getTime() - a.post.createdAt.getTime()).slice(0, limit);
  res.json({ items });
});

router.get("/profile/:username", async (req, res) => {
  const username = sanitize(String(req.params["username"] ?? "")).slice(0, 40);
  const { owner, allowed } = await canViewProfile(username, req.session?.userId);
  if (!owner) { res.status(404).json({ error: "user_not_found" }); return; }
  if (!allowed) { res.status(403).json({ error: "forbidden" }); return; }
  const ownProfile = owner.id === req.session?.userId;
  const [vinyls, playlists, saves] = await Promise.all([
    db.select({ post: musicVinylsTable, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
      .from(musicVinylsTable).innerJoin(usersTable, eq(musicVinylsTable.userId, usersTable.id))
      .where(and(eq(musicVinylsTable.userId, owner.id), isNull(musicVinylsTable.deletedAt), ownProfile ? undefined : eq(musicVinylsTable.isPrivate, false)))
      .orderBy(desc(musicVinylsTable.createdAt)).limit(100),
    db.select({ playlist: musicPlaylistsTable })
      .from(musicPlaylistsTable)
      .where(and(eq(musicPlaylistsTable.userId, owner.id), isNull(musicPlaylistsTable.deletedAt), ownProfile ? undefined : eq(musicPlaylistsTable.isPrivate, false)))
      .orderBy(desc(musicPlaylistsTable.createdAt)).limit(100),
    ownProfile
      ? db.select().from(musicSavesTable).where(eq(musicSavesTable.userId, owner.id)).orderBy(desc(musicSavesTable.createdAt)).limit(200)
      : Promise.resolve([]),
  ]);
  const playlistItems = await Promise.all(playlists.map(async ({ playlist }) => ({
    ...playlist,
    tracks: await db.select().from(musicPlaylistItemsTable)
      .where(eq(musicPlaylistItemsTable.playlistId, playlist.id))
      .orderBy(asc(musicPlaylistItemsTable.position)).limit(100),
  })));
  res.json({
    counts: {
      vinyls: vinyls.length,
      playlists: playlists.length,
      savedSongs: saves.filter(item => item.entity === "song").length,
      savedAlbums: saves.filter(item => item.entity === "album").length,
      savedArtists: saves.filter(item => item.entity === "artist").length,
    },
    vinyls: vinyls.map(({ post, ...user }) => ({ ...post, user })),
    playlists: playlistItems,
    saves,
  });
});

router.get("/vinyls/:id", async (req, res) => {
  const [row] = await db.select({
    post: musicVinylsTable,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
  }).from(musicVinylsTable).innerJoin(usersTable, eq(musicVinylsTable.userId, usersTable.id))
    .where(and(eq(musicVinylsTable.id, String(req.params["id"])), isNull(musicVinylsTable.deletedAt))).limit(1);
  if (!row) { res.status(404).json({ error: "vinyl_not_found" }); return; }
  if (row.post.isPrivate && row.post.userId !== req.session?.userId) {
    const { allowed } = await canViewProfile(row.username ?? "", req.session?.userId);
    if (!allowed) { res.status(403).json({ error: "forbidden" }); return; }
  }
  res.json({ ...row.post, user: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl } });
});

router.get("/playlists/:id", async (req, res) => {
  const [row] = await db.select({
    playlist: musicPlaylistsTable,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatarUrl,
  }).from(musicPlaylistsTable).innerJoin(usersTable, eq(musicPlaylistsTable.userId, usersTable.id))
    .where(and(eq(musicPlaylistsTable.id, String(req.params["id"])), isNull(musicPlaylistsTable.deletedAt))).limit(1);
  if (!row) { res.status(404).json({ error: "playlist_not_found" }); return; }
  if (row.playlist.isPrivate && row.playlist.userId !== req.session?.userId) {
    const { allowed } = await canViewProfile(row.username ?? "", req.session?.userId);
    if (!allowed) { res.status(403).json({ error: "forbidden" }); return; }
  }
  const tracks = await db.select().from(musicPlaylistItemsTable)
    .where(eq(musicPlaylistItemsTable.playlistId, row.playlist.id))
    .orderBy(asc(musicPlaylistItemsTable.position));
  res.json({
    ...row.playlist,
    tracks,
    user: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl },
  });
});

router.post("/vinyls", musicWriteLimiter, async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const trackId = validProviderId(req.body?.trackId);
  const ratingValue = req.body?.rating == null || req.body.rating === "" ? null : Number(req.body.rating);
  const shape = req.body?.shape === "square" ? "square" : req.body?.shape === "vinyl" ? "vinyl" : null;
  if (!trackId || !shape || (ratingValue != null && (!Number.isFinite(ratingValue) || ratingValue < 0 || ratingValue > 5))) {
    res.status(400).json({ error: "invalid_vinyl" });
    return;
  }
  const item = await getMusicItem(trackId, "song", countryFor(req));
  if (!item) { res.status(404).json({ error: "music_item_not_found" }); return; }
  const [post] = await db.insert(musicVinylsTable).values({
    id: nanoid(),
    userId,
    trackId,
    itemSnapshot: item,
    rating: ratingValue == null ? null : String(Math.round(ratingValue * 10) / 10),
    caption: sanitize(String(req.body?.caption ?? "")).slice(0, 2000),
    shape,
    isPrivate: Boolean(req.body?.isPrivate),
  }).returning();
  res.status(201).json({ post });
});

router.post("/playlists", musicWriteLimiter, async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const title = sanitize(String(req.body?.title ?? "")).trim().slice(0, 100);
  const description = sanitize(String(req.body?.description ?? "")).slice(0, 2000);
  const ids = Array.isArray(req.body?.trackIds)
    ? req.body.trackIds.slice(0, 50).map(validProviderId).filter((id: string | null): id is string => id !== null)
    : [];
  if (!title || ids.length === 0 || ids.length !== new Set(ids).size) {
    res.status(400).json({ error: "invalid_playlist", message: "A playlist needs a title and unique songs." });
    return;
  }
  const items = await itemSnapshots(ids, countryFor(req));
  if (items.length !== ids.length || items.some(item => item.entity !== "song")) {
    res.status(400).json({ error: "invalid_playlist_tracks" });
    return;
  }
  const playlistId = nanoid();
  const now = new Date();
  const coverUrl = items[0]?.artworkUrl ?? null;
  const playlist = await db.transaction(async tx => {
    const [created] = await tx.insert(musicPlaylistsTable).values({
      id: playlistId,
      userId,
      title,
      description,
      coverUrl,
      isPrivate: Boolean(req.body?.isPrivate),
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(musicPlaylistItemsTable).values(items.map((item, position) => ({
      playlistId,
      trackId: item.providerId,
      itemSnapshot: item,
      position,
    })));
    return created;
  });
  res.status(201).json({ playlist, tracks: items });
});

router.post("/saves", musicWriteLimiter, async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const entity = parseEntity(req.body?.entity);
  const providerId = validProviderId(req.body?.providerId);
  if (!entity || !providerId) { res.status(400).json({ error: "invalid_music_item" }); return; }
  const item = await getMusicItem(providerId, entity, countryFor(req));
  if (!item) { res.status(404).json({ error: "music_item_not_found" }); return; }
  const [saved] = await db.insert(musicSavesTable).values({
    userId, providerId, entity, itemSnapshot: item,
  }).onConflictDoUpdate({
    target: [musicSavesTable.userId, musicSavesTable.providerId, musicSavesTable.entity],
    set: { itemSnapshot: item },
  }).returning();
  res.status(201).json({ saved });
});

router.delete("/saves/:entity/:id", async (req, res) => {
  const userId = req.session?.userId;
  const entity = parseEntity(req.params["entity"]);
  const providerId = validProviderId(req.params["id"]);
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!entity || !providerId) { res.status(400).json({ error: "invalid_music_item" }); return; }
  await db.delete(musicSavesTable).where(and(
    eq(musicSavesTable.userId, userId),
    eq(musicSavesTable.providerId, providerId),
    eq(musicSavesTable.entity, entity),
  ));
  res.json({ success: true });
});

export default router;
