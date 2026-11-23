import { fetchMoodMovies, dailyStartPage, MOOD_CFG } from "../services/movies.service";
import { sendPushToUsers } from "../services/push.service";
import { db } from "@workspace/db";
import { usersTable, apiCacheTable } from "@workspace/db/schema";
import { timedRecPushFor } from "../lib/notif-i18n";
import { eq } from "drizzle-orm";

// Prefer explicit APP_BASE_URL, then Replit dev domain, then fall back to "/".
// Push notifications require an absolute URL so the OS can open the app.
const _rawBase = process.env["APP_BASE_URL"] ?? "";
const _replitDomain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DEPLOYMENT_URL"] ?? "";
const APP_BASE_URL = _rawBase
  ? (_rawBase.endsWith("/") ? _rawBase : `${_rawBase}/`)
  : _replitDomain
    ? `https://${_replitDomain}/`
    : "/";

// 2 slots only: midnight / noon — in each user's LOCAL time.
type Slot = { hour: 0 | 12; categoryId: string };

const SLOTS: Slot[] = [
  { hour: 0,  categoryId: "2am_deep_talk" },
  { hour: 12, categoryId: "brain_rot" },
];

const DEFAULT_TZ = "Asia/Bangkok";

// ── Fired-keys dedup ──────────────────────────────────────────────────────────
// Tracks which (tz, slot, day, lang) buckets have already fired so we never
// send the same slot to the same audience twice in one day.
const FIRED_KEYS_CACHE_KEY = "timed_rec:fired_keys";
const firedKeys = new Set<string>();
let firedKeysLoaded = false;

async function loadFiredKeys(): Promise<void> {
  if (firedKeysLoaded) return;
  try {
    const [row] = await db
      .select({ data: apiCacheTable.data })
      .from(apiCacheTable)
      .where(eq(apiCacheTable.cacheKey, FIRED_KEYS_CACHE_KEY))
      .limit(1);
    if (row?.data) {
      const arr = row.data as unknown as string[];
      if (Array.isArray(arr)) arr.forEach((k) => firedKeys.add(k));
    }
  } catch { /* non-fatal */ }
  firedKeysLoaded = true;
}

async function persistFiredKeys(): Promise<void> {
  try {
    const arr = [...firedKeys];
    await db
      .insert(apiCacheTable)
      .values({ cacheKey: FIRED_KEYS_CACHE_KEY, data: arr as unknown as Record<string, unknown>, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: apiCacheTable.cacheKey,
        set: { data: arr as unknown as Record<string, unknown>, fetchedAt: new Date() },
      });
  } catch { /* best-effort */ }
}

function trimFiredKeys(): void {
  while (firedKeys.size > 256) {
    const first = firedKeys.values().next().value;
    if (!first) break;
    firedKeys.delete(first);
  }
}

// ── Per-day sent-movie dedup ──────────────────────────────────────────────────
// Stores imdbIds that were already featured in a push today (UTC date key).
// Prevents the same movie appearing in both midnight and noon notifications.
// Key rotates daily so old data is automatically ignored without cleanup.
function sentMoviesCacheKey(utcDate: string): string {
  return `timed_rec:sent_movies:${utcDate}`;
}

async function loadSentMoviesToday(utcDate: string): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const [row] = await db
      .select({ data: apiCacheTable.data })
      .from(apiCacheTable)
      .where(eq(apiCacheTable.cacheKey, sentMoviesCacheKey(utcDate)))
      .limit(1);
    if (row?.data) {
      const arr = row.data as unknown as string[];
      if (Array.isArray(arr)) arr.forEach((id) => set.add(id));
    }
  } catch { /* non-fatal */ }
  return set;
}

async function persistSentMoviesToday(utcDate: string, sent: Set<string>): Promise<void> {
  try {
    const arr = [...sent];
    await db
      .insert(apiCacheTable)
      .values({ cacheKey: sentMoviesCacheKey(utcDate), data: arr as unknown as Record<string, unknown>, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: apiCacheTable.cacheKey,
        set: { data: arr as unknown as Record<string, unknown>, fetchedAt: new Date() },
      });
  } catch { /* best-effort */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tzParts(d: Date, tz: string): { y: string; m: string; day: string; h: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: parts["year"]!, m: parts["month"]!, day: parts["day"]!,
    h: Number(parts["hour"]) % 24,
  };
}

function safeTz(tz: string | null | undefined): string {
  const candidate = (tz ?? "").trim() || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TZ;
  }
}

// FNV-1a 32-bit deterministic hash → index into a list.
function fnv32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// ── Movie picker ──────────────────────────────────────────────────────────────
type PickedMovie = { title: string | null; posterUrl: string | null; imdbId: string | null };

/**
 * Pick one movie for the notification.
 *
 * Priority:
 * 1. Read from the app's own apiCacheTable (same key the mood route writes to)
 *    so the featured movie is always from the list users actually see today.
 * 2. Fall back to a live fetchMoodMovies call on cache miss (e.g. first load of day).
 * 3. Exclude any imdbIds already sent today (cross-slot dedup).
 * 4. Deterministic pick by (date + categoryId) seed so every bucket in the
 *    same slot sees the same movie — no per-user randomness.
 */
async function pickFeaturedMovie(
  categoryId: string,
  parts: { y: string; m: string; day: string },
  lang: "th" | "en",
  alreadySentToday: Set<string>,
): Promise<PickedMovie> {
  const empty: PickedMovie = { title: null, posterUrl: null, imdbId: null };
  try {
    const cfg = MOOD_CFG[categoryId];
    if (!cfg) return empty;

    const today = `${parts.y}-${parts.m}-${parts.day}`;
    // Match the exact cache key written by the mood route handler.
    const tmdbLang = lang === "th" ? "th-TH" : "en-US";
    const appCacheKey = `mood-${categoryId}-main-${tmdbLang}-${today}`;

    type MovieEntry = { title?: string | null; posterUrl?: string | null; imdbId?: string | null };
    let movies: MovieEntry[] = [];

    // 1. Try reading from the app's daily category cache.
    try {
      const [row] = await db
        .select({ data: apiCacheTable.data })
        .from(apiCacheTable)
        .where(eq(apiCacheTable.cacheKey, appCacheKey))
        .limit(1);
      if (row?.data) {
        const cached = row.data as { movies?: MovieEntry[] };
        if (Array.isArray(cached.movies)) {
          movies = cached.movies.filter((m) => m.posterUrl);
        }
      }
    } catch { /* fall through to live fetch */ }

    // 2. Cache miss → fetch live (same rotation the route would use).
    if (movies.length === 0) {
      const startPage = dailyStartPage(categoryId);
      const result = await fetchMoodMovies(cfg, cfg.urlA, 1, startPage, tmdbLang);
      movies = (result.movies ?? []).filter((m) => m.posterUrl) as MovieEntry[];
    }

    if (movies.length === 0) return empty;

    // 3. Prefer movies not yet sent today; fall back to full pool if exhausted.
    const fresh = movies.filter((m) => !m.imdbId || !alreadySentToday.has(m.imdbId));
    const pool = fresh.length > 0 ? fresh : movies;

    // 4. Deterministic pick — same movie chosen for every bucket in this slot.
    const idx = fnv32(`${today}-${categoryId}`) % pool.length;
    const top = pool[idx];
    return {
      title: top?.title ?? null,
      posterUrl: top?.posterUrl ?? null,
      imdbId: top?.imdbId ?? null,
    };
  } catch {
    return empty;
  }
}

// ── Main tick ─────────────────────────────────────────────────────────────────

async function maybeRunTick(now: Date): Promise<void> {
  await loadFiredKeys();

  // UTC date string used as the rotation key for sent-movie dedup.
  const utcToday = now.toISOString().slice(0, 10);
  const sentMoviesToday = await loadSentMoviesToday(utcToday);

  let rows: { id: string; lang: string | null; tz: string | null }[];
  try {
    rows = await db.select({
      id: usersTable.id,
      lang: usersTable.preferredLang,
      tz: usersTable.timezone,
    }).from(usersTable);
  } catch (err) {
    console.warn("[timedRec] user query failed:", err);
    return;
  }

  // Group users by (timezone, lang) → one push send per bucket.
  const buckets = new Map<string, { tz: string; lang: "th" | "en"; ids: string[] }>();
  for (const r of rows) {
    const tz = safeTz(r.tz);
    const lang: "th" | "en" = r.lang === "th" ? "th" : "en";
    const key = `${tz}|${lang}`;
    const existing = buckets.get(key);
    if (existing) existing.ids.push(r.id);
    else buckets.set(key, { tz, lang, ids: [r.id] });
  }

  // Cache picked movie per (categoryId, date, lang) within a tick run so we
  // don't re-query the DB / TMDB once per bucket for the same slot.
  const featuredCache = new Map<string, PickedMovie>();

  let anyFired = false;
  let sentMoviesUpdated = false;

  for (const { tz, lang, ids } of buckets.values()) {
    const parts = tzParts(now, tz);
    const slot = SLOTS.find((s) => s.hour === parts.h);
    if (!slot) continue;

    // Bucket-level dedup: fire at most once per (tz, slot, day, lang).
    const firedKey = `tz:${tz}|${parts.y}-${parts.m}-${parts.day}|h${parts.h}|${lang}`;
    if (firedKeys.has(firedKey)) continue;
    firedKeys.add(firedKey);
    trimFiredKeys();
    anyFired = true;

    // Pick the featured movie (reads from app cache, skips already-sent today).
    const featCacheKey = `${slot.categoryId}|${parts.y}-${parts.m}-${parts.day}|${lang}`;
    let featured = featuredCache.get(featCacheKey);
    if (!featured) {
      featured = await pickFeaturedMovie(slot.categoryId, parts, lang, sentMoviesToday);
      featuredCache.set(featCacheKey, featured);
      // Register the movie as sent for today (cross-slot dedup).
      if (featured.imdbId) {
        sentMoviesToday.add(featured.imdbId);
        sentMoviesUpdated = true;
      }
    }

    const { title, body } = timedRecPushFor({
      lang,
      hour: slot.hour,
      featuredMovie: featured.title,
    });
    try {
      await sendPushToUsers(ids, {
        title, body,
        url: `${APP_BASE_URL}search?cat=${encodeURIComponent(slot.categoryId)}`,
        icon: featured.posterUrl ?? undefined,
        tag: `timed_rec:${slot.categoryId}`,
      });
      console.log(
        `[timedRec] tz=${tz} lang=${lang} slot=${slot.categoryId} hour=${parts.h} users=${ids.length} movie=${featured.imdbId ?? "unknown"}`,
      );
    } catch (err) {
      console.warn(`[timedRec] sendPush failed for tz=${tz}:`, err);
    }
  }

  if (anyFired) await persistFiredKeys();
  if (sentMoviesUpdated) await persistSentMoviesToday(utcToday, sentMoviesToday);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function scheduleTimedRecommendation(): void {
  const tick = () => { maybeRunTick(new Date()).catch(() => {}); };

  // Initial check 2 minutes after boot.
  setTimeout(tick, 2 * 60 * 1000);

  // Then every hour, aligned to the top of the hour.
  const now = new Date();
  const msToNextHour =
    (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 + 5_000;
  setTimeout(() => {
    tick();
    setInterval(tick, 60 * 60 * 1000).unref();
  }, msToNextHour).unref();
}
