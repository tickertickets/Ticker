import { fetchMoodMovies, dailyStartPage, MOOD_CFG } from "../services/movies.service";
import { sendPushToUsers } from "../services/push.service";
import { db } from "@workspace/db";
import { usersTable, apiCacheTable } from "@workspace/db/schema";
import { timedRecPushFor } from "../lib/notif-i18n";
import { eq } from "drizzle-orm";

const APP_BASE_URL = process.env["APP_BASE_URL"] ?? "/";

// 2 slots only: midnight / noon — in each user's LOCAL time.
type Slot = { hour: 0 | 12; categoryId: string };

const SLOTS: Slot[] = [
  { hour: 0,  categoryId: "2am_deep_talk" },
  { hour: 12, categoryId: "marvel_dc" },
];

const DEFAULT_TZ = "Asia/Bangkok";

// DB cache key for the fired-keys set. Stored as a JSON array in apiCacheTable.
// Using the DB instead of /tmp means the dedup state survives server restarts
// and redeployments, so duplicate pushes are never sent.
const FIRED_KEYS_CACHE_KEY = "timed_rec:fired_keys";

// In-memory mirror — loaded from DB at startup, written back on every change.
// Avoids a DB round-trip per bucket while still surviving restarts.
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
  } catch {
    // Non-fatal — start with empty set if DB is unavailable
  }
  firedKeysLoaded = true;
}

async function persistFiredKeys(): Promise<void> {
  try {
    const arr = [...firedKeys];
    await db
      .insert(apiCacheTable)
      .values({
        cacheKey: FIRED_KEYS_CACHE_KEY,
        data: arr as unknown as Record<string, unknown>,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: apiCacheTable.cacheKey,
        set: {
          data: arr as unknown as Record<string, unknown>,
          fetchedAt: new Date(),
        },
      });
  } catch {
    // Best-effort — a write failure means we might resend a push after restart,
    // but that is far better than accumulating state in volatile /tmp.
  }
}

function trimFiredKeys(): void {
  while (firedKeys.size > 256) {
    const first = firedKeys.values().next().value;
    if (!first) break;
    firedKeys.delete(first);
  }
}

// Convert a UTC instant to wall-clock parts in the given IANA timezone.
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

async function pickFeaturedMovie(
  categoryId: string,
  parts: { y: string; m: string; day: string; h: number },
): Promise<{ title: string | null; posterUrl: string | null }> {
  try {
    const cfg = MOOD_CFG[categoryId];
    if (!cfg) return { title: null, posterUrl: null };
    // Use the same daily startPage rotation as the category route so the
    // notification poster comes from the actual list shown in the app that day.
    const startPage = dailyStartPage(categoryId);
    const result = await fetchMoodMovies(cfg, cfg.urlA, 1, startPage, "th-TH");
    const movies = (result.movies ?? []).filter((m) => m.posterUrl);
    if (movies.length === 0) return { title: null, posterUrl: null };
    // Pick deterministically by date so the same movie is chosen all hour long.
    const seed = `${parts.y}-${parts.m}-${parts.day}-${categoryId}`;
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const top = movies[h % movies.length];
    return {
      title: top?.title ?? null,
      posterUrl: top?.posterUrl ?? null,
    };
  } catch {
    return { title: null, posterUrl: null };
  }
}

async function maybeRunTick(now: Date): Promise<void> {
  // Ensure fired-keys are loaded from DB before the first tick.
  await loadFiredKeys();

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

  // Group users by (timezone, lang) so we send one push per bucket.
  // Key shape: `${tz}|${lang}`
  const buckets = new Map<string, { tz: string; lang: "th" | "en"; ids: string[] }>();
  for (const r of rows) {
    const tz = safeTz(r.tz);
    const lang: "th" | "en" = r.lang === "th" ? "th" : "en";
    const key = `${tz}|${lang}`;
    const existing = buckets.get(key);
    if (existing) existing.ids.push(r.id);
    else buckets.set(key, { tz, lang, ids: [r.id] });
  }

  // Cache featured movie per (slot, day-in-tz) so we don't refetch within the same hour.
  const featuredCache = new Map<string, { title: string | null; posterUrl: string | null }>();

  let anyFired = false;

  for (const { tz, lang, ids } of buckets.values()) {
    const parts = tzParts(now, tz);
    const slot = SLOTS.find((s) => s.hour === parts.h);
    if (!slot) continue;

    // Dedupe per (tz, slot, day, lang) so each user receives at most one push per slot.
    const firedKey = `tz:${tz}|${parts.y}-${parts.m}-${parts.day}|h${parts.h}|${lang}`;
    if (firedKeys.has(firedKey)) continue;
    firedKeys.add(firedKey);
    trimFiredKeys();
    anyFired = true;

    const featCacheKey = `${slot.categoryId}|${parts.y}-${parts.m}-${parts.day}|${parts.h}`;
    let featured = featuredCache.get(featCacheKey);
    if (!featured) {
      featured = await pickFeaturedMovie(slot.categoryId, parts);
      featuredCache.set(featCacheKey, featured);
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
        `[timedRec] tz=${tz} lang=${lang} slot=${slot.categoryId} hour=${parts.h} users=${ids.length}`,
      );
    } catch (err) {
      console.warn(`[timedRec] sendPush failed for tz=${tz}:`, err);
    }
  }

  // Persist the updated set back to DB only when we actually fired something.
  if (anyFired) {
    await persistFiredKeys();
  }
}

export function scheduleTimedRecommendation(): void {
  const tick = () => {
    maybeRunTick(new Date()).catch(() => {});
  };

  // Initial check 2 minutes after boot
  setTimeout(tick, 2 * 60 * 1000);

  // Then check every hour, aligned to the top of the hour
  const now = new Date();
  const msToNextHour =
    (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 + 5_000;
  setTimeout(() => {
    tick();
    setInterval(tick, 60 * 60 * 1000).unref();
  }, msToNextHour).unref();
}
