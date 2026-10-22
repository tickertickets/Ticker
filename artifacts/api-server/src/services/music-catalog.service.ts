import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { apiCacheTable, musicItemsTable, type MusicEntity, type MusicItemSnapshot } from "@workspace/db/schema";

export type MusicProviderEntity = MusicEntity | "all";
export type MusicCatalogItem = MusicItemSnapshot & {
  raw?: Record<string, unknown>;
};

/**
 * The catalog interface isolates the app from its current provider. Replacing
 * iTunes later only requires an implementation of this interface and a provider
 * name change; saved posts keep their provider IDs and metadata snapshots.
 */
export interface MusicCatalogProvider {
  search(query: string, entity: MusicProviderEntity, country: string, limit: number): Promise<MusicCatalogItem[]>;
  lookup(providerId: string, entity: MusicEntity, country: string): Promise<MusicCatalogItem | null>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<unknown>>();
const providerRequestStarts: number[] = [];
let providerRequestsWaiting = 0;

async function waitForProviderSlot() {
  if (providerRequestsWaiting >= 500) {
    throw new Error("Music catalog is busy; please retry shortly.");
  }
  providerRequestsWaiting += 1;
  try {
    while (true) {
      const now = Date.now();
      while (providerRequestStarts.length && now - providerRequestStarts[0]! >= 1_000) {
        providerRequestStarts.shift();
      }
      if (providerRequestStarts.length < 20) {
        providerRequestStarts.push(now);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(10, 1_000 - (now - providerRequestStarts[0]!))));
    }
  } finally {
    providerRequestsWaiting -= 1;
  }
}

function iTunesEntity(entity: MusicProviderEntity) {
  if (entity === "artist") return "musicArtist";
  if (entity === "album") return "album";
  return "song";
}

function normalizeResult(row: Record<string, unknown>, entity: MusicEntity): MusicCatalogItem | null {
  const id = row["trackId"] ?? row["collectionId"] ?? row["artistId"];
  const name = entity === "song"
    ? row["trackName"]
    : entity === "album"
      ? row["collectionName"]
      : row["artistName"];
  if (id == null || typeof name !== "string" || !name.trim()) return null;
  const artwork = typeof row["artworkUrl100"] === "string"
    ? row["artworkUrl100"].replace(/\d+x\d+bb/, "1000x1000bb")
    : null;
  return {
    providerId: String(id),
    entity,
    name: name.trim(),
    artistName: typeof row["artistName"] === "string" ? row["artistName"] : null,
    collectionName: typeof row["collectionName"] === "string" ? row["collectionName"] : null,
    artworkUrl: artwork,
    previewUrl: typeof row["previewUrl"] === "string" ? row["previewUrl"] : null,
    itemUrl: typeof row["trackViewUrl"] === "string"
      ? row["trackViewUrl"]
      : typeof row["collectionViewUrl"] === "string"
        ? row["collectionViewUrl"]
        : typeof row["artistLinkUrl"] === "string"
          ? row["artistLinkUrl"]
          : null,
    genre: typeof row["primaryGenreName"] === "string" ? row["primaryGenreName"] : null,
    releaseDate: typeof row["releaseDate"] === "string" ? row["releaseDate"] : null,
    durationMs: typeof row["trackTimeMillis"] === "number" ? row["trackTimeMillis"] : null,
    trackCount: typeof row["trackCount"] === "number" ? row["trackCount"] : null,
    raw: row,
  };
}

async function cached<T>(key: string, ttlMs: number): Promise<T | null> {
  const [row] = await db.select({ data: apiCacheTable.data, fetchedAt: apiCacheTable.fetchedAt })
    .from(apiCacheTable).where(eq(apiCacheTable.cacheKey, key)).limit(1);
  if (!row || Date.now() - row.fetchedAt.getTime() > ttlMs) return null;
  return row.data as T;
}

async function cache<T>(key: string, data: T) {
  await db.insert(apiCacheTable)
    .values({ cacheKey: key, data: data as Record<string, unknown>, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: apiCacheTable.cacheKey,
      set: { data: data as Record<string, unknown>, fetchedAt: new Date() },
    });
}

async function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = task().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function requestITunes(url: URL): Promise<Record<string, unknown>[]> {
  await waitForProviderSlot();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Ticker-Music/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Music catalog returned ${response.status}`);
  const body = await response.json() as { results?: unknown };
  if (!Array.isArray(body.results)) throw new Error("Music catalog returned an invalid response");
  return body.results.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

class ITunesCatalog implements MusicCatalogProvider {
  async search(query: string, entity: MusicProviderEntity, country: string, limit: number) {
    const types: MusicEntity[] = entity === "all" ? ["song", "album", "artist"] : [entity];
    const key = `music:itunes:search:v1:${country}:${types.join(",")}:${query.toLocaleLowerCase()}:${limit}`;
    const fromCache = await cached<MusicCatalogItem[]>(key, CACHE_TTL_MS);
    if (fromCache) return fromCache;
    return singleFlight(key, async () => {
      const batches = await Promise.all(types.map(async type => {
        const url = new URL("https://itunes.apple.com/search");
        url.searchParams.set("term", query);
        url.searchParams.set("media", "music");
        url.searchParams.set("entity", iTunesEntity(type));
        url.searchParams.set("country", country);
        url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 25))));
        return (await requestITunes(url))
          .map(row => normalizeResult(row, type))
          .filter((item): item is MusicCatalogItem => item !== null);
      }));
      const results = entity === "all"
        ? Array.from({ length: limit }, (_, index) => batches.map(batch => batch[index]).filter((item): item is MusicCatalogItem => !!item))
          .flat()
          .slice(0, limit)
        : (batches[0] ?? []).slice(0, limit);
      void rememberCatalogItems(results).catch(error => {
        console.error("[music-catalog] Could not persist fetched items:", error);
      });
      await cache(key, results);
      return results;
    });
  }

  async lookup(providerId: string, entity: MusicEntity, country: string) {
    const key = `music:itunes:lookup:v1:${country}:${entity}:${providerId}`;
    const fromCache = await cached<MusicCatalogItem | null>(key, DETAIL_TTL_MS);
    if (fromCache) return fromCache;
    return singleFlight(key, async () => {
      const url = new URL("https://itunes.apple.com/lookup");
      url.searchParams.set("id", providerId);
      url.searchParams.set("country", country);
      if (entity === "artist") url.searchParams.set("entity", "musicArtist");
      const rawItems = await requestITunes(url);
      const match = rawItems.find(row => String(row["trackId"] ?? row["collectionId"] ?? row["artistId"]) === providerId);
      const item = match ? normalizeResult(match, entity) : null;
      if (item) await rememberCatalogItems([item]);
      await cache(key, item);
      return item;
    });
  }
}

export const musicCatalogProvider: MusicCatalogProvider = new ITunesCatalog();

export async function rememberCatalogItems(items: MusicCatalogItem[]) {
  if (items.length === 0) return;
  const now = new Date();
  await db.transaction(async tx => {
    for (const item of items) {
      const { raw = {}, ...fields } = item;
      await tx.insert(musicItemsTable).values({ ...fields, raw, fetchedAt: now })
        .onConflictDoUpdate({
          target: [musicItemsTable.providerId, musicItemsTable.entity],
          set: { ...fields, raw, fetchedAt: now },
        });
    }
  });
}

export async function getMusicItem(providerId: string, entity: MusicEntity, country = "TH") {
  const [row] = await db.select().from(musicItemsTable)
    .where(and(eq(musicItemsTable.providerId, providerId), eq(musicItemsTable.entity, entity)))
    .limit(1);
  if (row && Date.now() - row.fetchedAt.getTime() < DETAIL_TTL_MS) {
    const { raw, fetchedAt: _fetchedAt, ...item } = row;
    return { ...item, raw } as MusicCatalogItem;
  }
  const fresh = await musicCatalogProvider.lookup(providerId, entity, country);
  if (!fresh) return null;
  return fresh;
}
