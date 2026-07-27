/**
 * Universal Hot Score — Ticker ranking engine
 *
 * Formula (industry-standard, adapted from Hacker News + Reddit + Letterboxd):
 *
 *   engagement = log(1+likes)×1 + log(1+comments)×2 + log(1+bonus)×3 + log(1+saves)×1.5
 *   score      = (engagement + 1) / (hours_since_last_activity + 2) ^ gravity
 *
 * Key design decisions:
 *
 *   1. Logarithmic engagement scaling (log1p)
 *      Linear scoring lets one viral post with 1 000 likes score 1 000× more
 *      than a post with 1 like — stale viral content monopolises the feed.
 *      log1p gives diminishing returns: 1 like ≈ 0.7, 10 likes ≈ 2.4,
 *      100 likes ≈ 4.6, 1 000 likes ≈ 6.9. New high-quality posts can
 *      always compete. (Used by Reddit, Hacker News, Medium, Letterboxd.)
 *
 *   2. lastActivityAt instead of createdAt
 *      T = hours since last engagement activity, so a popular old post
 *      "resurfaces" when it receives fresh engagement — matching
 *      Instagram/Twitter resurfacing behaviour.
 *
 *   3. gravity = 1.8  (Hacker News proven value)
 *      Content ages out over ~2-3 days for popular posts.
 *      Posts with zero engagement age out in ~12-24 hours, keeping
 *      the feed fresh. Own/followed posts get a 60-minute freshBoost
 *      to compensate for the higher gravity.
 *
 *   4. Differential engagement weights
 *      likes×1     — low-effort passive approval
 *      saves×1.5   — intent to revisit (Instagram/Pinterest proven: saves
 *                    indicate quality content worth keeping)
 *      comments×2  — active engagement, starts conversation
 *      bonus×3     — unique chain participants (distinct users who joined the chain)
 *                    strongest community signal: real people committing to watch together
 *      (Same weight philosophy as Letterboxd "activity score" convention.)
 *
 * Score examples (gravity=1.8):
 *   0 engagement, just created:       1 / 2^1.8   ≈ 0.29
 *   1 like, 1 h ago:          1.69 / 3^1.8   ≈ 0.24
 *   5 likes, 1 h ago:         2.79 / 3^1.8   ≈ 0.40
 *   5 likes, 6 h ago:         2.79 / 8^1.8   ≈ 0.065
 *   10 likes+2 cmt, 12 h ago: 5.78 / 14^1.8  ≈ 0.040
 *   50 likes+5 cmt, 24 h ago: 7.65 / 26^1.8  ≈ 0.017
 */

const log1p = (n: number) => Math.log(1 + Math.max(0, n));

export const HOT_GRAVITY = 1.8;
export const DIVERSITY_CAP = 2;       // max posts per user per page (feed diversity)
export const AFFINITY_FOLLOWED = 1.0; // no extra multiplier — home feed is democratic (following tab handles followed-only)

export interface HotScoreParams {
  likes:        number;
  comments:     number;
  bonus?:       number;  // chain participants or other community signal
  saves?:       number;  // bookmarks/saves — high-quality intent signal
  lastActivityAt: Date;
}

export function hotScore({
  likes,
  comments,
  bonus  = 0,
  saves  = 0,
  lastActivityAt,
}: HotScoreParams): number {
  const engagement =
    log1p(likes)    * 1.0 +
    log1p(saves)    * 1.5 +
    log1p(comments) * 2.0 +
    log1p(bonus)    * 3.0;
  const ageHours = (Date.now() - lastActivityAt.getTime()) / 3_600_000;
  return (engagement + 1) / Math.pow(ageHours + 2, HOT_GRAVITY);
}

// ── Diversity cap (legacy — used by chains route) ────────────────────────────
//
// Simple hard cap: walk the sorted list and skip any user who has already
// contributed `maxPerUser` posts to the result. Used by chains.ts for its
// own separate chain-feed endpoint. The unified /api/feed route uses the
// more sophisticated applyDiversitySpread instead.

export function applyDiversityCap<T>(
  sorted: T[],
  getUserId: (item: T) => string,
  maxPerUser: number,
  wantCount: number,
): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];
  for (const item of sorted) {
    if (result.length >= wantCount) break;
    const uid = getUserId(item);
    const n = seen.get(uid) ?? 0;
    if (n < maxPerUser) {
      result.push(item);
      seen.set(uid, n + 1);
    }
  }
  return result;
}

// ── Diversity spread — cooldown-based author interleaving (industry standard) ──
//
// At each slot, picks the highest-scoring eligible candidate — i.e. a candidate
// whose author hasn't appeared in the last `minGap` positions AND hasn't yet
// hit the per-author hard cap.
//
//   minGap = max(2, floor(targetSize / maxPerUser))
//
// This guarantees the same author's allowed posts sit at least minGap slots
// apart — a natural spread without any forced alternating pattern.
//
// This is the approach used by Instagram, Twitter/X, TikTok, and LinkedIn.
//
// Graceful degradation: if the pool has too few distinct authors the cooldown
// is relaxed (Pass 2) while the hard cap is still enforced, so we never return
// fewer items than the content allows.
//
// targetSize controls how many items to produce (used both for slicing and
// for computing minGap).

export function applyDiversitySpread<T>(
  sorted: T[],                    // pre-sorted by score desc (highest first)
  getUserId: (item: T) => string,
  maxPerUser: number,
  targetSize: number,
): T[] {
  const minGap = Math.max(2, Math.floor(targetSize / maxPerUser));

  const result: T[]                  = [];
  const pool    = [...sorted];       // working copy — preserves score order
  const lastPos = new Map<string, number>(); // userId → last placed position
  const placed  = new Map<string, number>(); // userId → total placed count

  while (result.length < targetSize && pool.length > 0) {
    const pos = result.length;
    let picked = false;

    // Pass 1: ideal path — respect both cooldown AND hard cap
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]!;
      const uid  = getUserId(item);
      const last = lastPos.get(uid) ?? -Infinity;
      const n    = placed.get(uid) ?? 0;
      if (pos - last >= minGap && n < maxPerUser) {
        result.push(item);
        pool.splice(i, 1);
        lastPos.set(uid, pos);
        placed.set(uid, n + 1);
        picked = true;
        break;
      }
    }

    if (picked) continue;

    // Pass 2: relax cooldown — only the hard cap matters (thin pool)
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]!;
      const uid  = getUserId(item);
      const n    = placed.get(uid) ?? 0;
      if (n < maxPerUser) {
        result.push(item);
        pool.splice(i, 1);
        lastPos.set(uid, pos);
        placed.set(uid, n + 1);
        picked = true;
        break;
      }
    }

    if (!picked) break; // all remaining items are over the hard cap
  }

  return result;
}

// ── Content-type interleaving ──────────────────────────────────────────────────
//
// Prevents long runs of the same content type (e.g. 10 Tickets in a row when
// Chains exist, or vice versa).  Applied AFTER author diversity spread so that
// score ordering is disturbed as little as possible.
//
// Algorithm: greedy slot-fill with a type cooldown.
//   • Walk through positions in order.
//   • At each position, if the current run of one type has reached `maxRun`,
//     pick the highest-scoring item of the OTHER type from the remaining pool.
//   • If no other type is available (pool is mono-typed), relax and take the
//     best available item — we never return fewer items than the content allows.
//
// maxRun = 2 mirrors the per-author cap: the same principle (no user or content
// type dominates consecutive slots) used by Instagram, TikTok, and LinkedIn.

export function applyContentTypeInterleave<T>(
  items: T[],
  getType: (item: T) => string,
  maxRun = 2,
): T[] {
  if (items.length === 0) return items;

  const result: T[] = [];
  const pool = [...items]; // pool is already sorted by score best-first
  let runType: string | null = null;
  let runLen = 0;

  while (pool.length > 0) {
    let pickedIdx = -1;

    if (runLen >= maxRun && runType !== null) {
      // Must pick a different type to break the run
      for (let i = 0; i < pool.length; i++) {
        if (getType(pool[i]!) !== runType) {
          pickedIdx = i;
          break;
        }
      }
      // Graceful degradation: if only one type remains, fall through to index 0
    }

    if (pickedIdx === -1) {
      pickedIdx = 0; // best available (pool is score-ordered)
    }

    const item = pool[pickedIdx]!;
    const type = getType(item);

    if (type === runType) {
      runLen++;
    } else {
      runType = type;
      runLen = 1;
    }

    result.push(item);
    pool.splice(pickedIdx, 1);
  }

  return result;
}

// ── Ranked-list pagination (with optional infinite recycling) ─────────────────
//
// Slices a fully ranked (scored + diversity-spread + interleaved) list at
// `offset`. When `recycle` is true and the offset runs past the end of the
// list, it wraps back to the start instead of ending — the caller re-runs
// the whole ranking query fresh on every request (time decay keeps moving),
// so a "recycled" page is still genuinely re-ranked, not a frozen repeat.
// This is how algorithmic "for you" feeds (TikTok, Instagram Explore) avoid
// ever hard-stopping once a user runs out of genuinely new candidates.
//
// Follow-graph-scoped feeds (e.g. "Following") should pass `recycle: false`:
// running out of unseen posts from people you follow is a real, expected end
// state — same as X's Following tab — not something to paper over with
// repeats.
export function paginateRanked<T>(
  ranked: T[],
  offset: number,
  limit: number,
  recycle: boolean,
): { page: T[]; hasMore: boolean; nextCursor: string | null; recycled: boolean } {
  const total = ranked.length;
  if (total === 0) {
    return { page: [], hasMore: false, nextCursor: null, recycled: false };
  }

  if (offset < total) {
    // Still within the real, never-yet-served ranked list. May be a partial
    // page (fewer than `limit` items) if this is the last stretch of real
    // content — that's fine, it's the natural end of genuinely new content,
    // not padded with repeats.
    const page = ranked.slice(offset, offset + limit);
    const hasMore = recycle ? true : offset + limit < total;
    return {
      page,
      hasMore,
      nextCursor: hasMore ? String(offset + limit) : null,
      recycled: false,
    };
  }

  if (!recycle) {
    return { page: [], hasMore: false, nextCursor: null, recycled: false };
  }

  // Past the end of real content at least once — wrap the offset and keep
  // serving full pages indefinitely.
  const start = offset % total;
  const page: T[] = [];
  for (let i = 0; i < limit; i++) page.push(ranked[(start + i) % total] as T);
  return { page, hasMore: true, nextCursor: String(offset + limit), recycled: true };
}

// ── Fresh-post boost ──────────────────────────────────────────────────────────
//
// Posts < 60 min old by a user you follow (or your own posts) get a temporary
// score multiplier: 15× at t=0, decaying linearly to 1× at t=60 min.
//
// After the window expires, all posts compete purely on hotScore — if they
// gained real engagement during the boost window they stay up on merit.
//
// In explore/discover contexts (no personalisation), pass `followedSet = null`
// to boost only own posts, keeping the ranking fair for all users.
//
// The boost compensates for higher gravity (1.8): without it, a fresh post
// from someone you follow would drop below older posts within minutes.

export const FRESH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
export const FRESH_BOOST_MAX = 15;              // 15× at t=0

// ── Genre / Interest-graph affinity ──────────────────────────────────────────
//
// Lightweight interest profile built from the genres of content a user has
// previously engaged with (own tickets × 1, liked tickets × 1, bookmarked × 2).
// The resulting map is normalised so the most-engaged genre scores 1.0.
//
// makeGenreBoost returns a per-item multiplier from 1.0 (no affinity) up to
// 1.4 (full affinity — GENRE_BOOST_MAX additive ceiling above 1.0).
//
// Design principle: genre signal supplements social / engagement signals —
// it never overrides them. Cap of 1.4× is intentional (Instagram's topic
// affinity works the same way: reinforce good content in preferred genres,
// don't bury content from non-preferred ones).

export const GENRE_BOOST_MAX = 0.4; // additive ceiling — max multiplier is 1.4×

/** Build a frequency map from an array of genre strings (may be comma-separated). */
export function computeGenreAffinity(genres: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of genres) {
    if (!g) continue;
    // Genres stored as e.g. "Action, Drama" — split and trim
    for (const part of g.split(",").map((s) => s.trim()).filter(Boolean)) {
      map.set(part, (map.get(part) ?? 0) + 1);
    }
  }
  return map;
}

/** Returns a function that maps a post's genre string → score multiplier (1.0–1.4). */
export function makeGenreBoost(
  affinityMap: Map<string, number>,
): (genre: string | null | undefined) => number {
  if (affinityMap.size === 0) return () => 1.0;
  const maxCount = Math.max(...affinityMap.values());
  if (maxCount === 0) return () => 1.0;
  return (genre: string | null | undefined): number => {
    if (!genre) return 1.0;
    let best = 0;
    for (const part of genre.split(",").map((s) => s.trim())) {
      best = Math.max(best, (affinityMap.get(part) ?? 0) / maxCount);
    }
    return 1.0 + best * GENRE_BOOST_MAX;
  };
}

export function makeFreshBoost(
  followedSet: Set<string> | null,
  currentUserId?: string | null,
) {
  return (userId: string, createdAt: Date): number => {
    const isOwn      = !!currentUserId && userId === currentUserId;
    const isFollowed = !!followedSet && followedSet.has(userId);
    if (!isOwn && !isFollowed) return 1.0;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs >= FRESH_WINDOW_MS) return 1.0;
    const t = ageMs / FRESH_WINDOW_MS; // 0 = just posted, 1 = expired
    return 1.0 + (FRESH_BOOST_MAX - 1) * (1 - t); // 15× → 1×
  };
}
