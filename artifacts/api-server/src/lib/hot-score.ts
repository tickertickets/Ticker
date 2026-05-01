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
 *      bonus×3     — chain participants (strong community/participatory signal)
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
export const DIVERSITY_CAP = 3;       // max posts per user per page (feed diversity)
export const AFFINITY_FOLLOWED = 2.0; // permanent score multiplier for followed users in home feed

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

// ── Diversity cap ─────────────────────────────────────────────────────────────
//
// Prevents a single viral user from monopolising the feed.
// Walk the hotScore-sorted list and skip any user who has already
// contributed `maxPerUser` posts to the result set.
//
// Applied AFTER sorting so the best posts from each user always win;
// we only limit how many slots one user can occupy per page.
// (Used by Twitter, Instagram, Reddit — typical value: 2-3 per page.)

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
