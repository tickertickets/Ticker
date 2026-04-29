/**
 * Universal Hot Score — industry-standard engagement ranking
 *
 * Based on the Hacker News / Reddit "hot" formula, adapted for social platforms:
 *
 *   score = (engagement + 1) / (last_activity_hours + 2) ^ gravity
 *
 * Properties:
 *  - New posts with zero engagement start with score ~0.20 and decay over time.
 *  - High-engagement posts stay visible longer.
 *  - A fresh like/comment on an old post refreshes its "last_activity_hours",
 *    causing it to surface back up — exactly like Instagram / Reddit behaviour.
 *  - gravity = 1.8 gives a strong recency bias (content "expires" in ~days).
 *
 * Engagement weights:
 *   likes      × 1  — passive approval
 *   comments   × 2  — intent signal, starts a conversation
 *   bonus      × 3  — e.g. chain participants (strong community signal)
 */

export const HOT_GRAVITY = 1.8;

export interface HotScoreParams {
  likes: number;
  comments: number;
  bonus?: number;
  lastActivityAt: Date;
}

export function hotScore({ likes, comments, bonus = 0, lastActivityAt }: HotScoreParams): number {
  const engagement = likes * 1 + comments * 2 + bonus * 3;
  const ageHours   = (Date.now() - lastActivityAt.getTime()) / 3_600_000;
  return (engagement + 1) / Math.pow(ageHours + 2, HOT_GRAVITY);
}

// ── Shared boost helpers (used by /api/feed, /api/tickets, /api/chains) ──────
//
// Design rationale (matches Instagram/Reddit behaviour):
//   • Fresh boost ONLY — posts < 60 min old by users in `followedSet` get a
//     decaying multiplier (15× at t=0 → 1× at t=60min).
//   • After the fresh window, every post competes equally on hotScore alone,
//     regardless of who you follow. This keeps the feed fair.
//   • No permanent affinity multiplier (was 2× before — removed for fairness).

export const FRESH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

// Kept for backward compatibility / call-sites that reference these names.
// They now both return 1.0 — affinity is no longer applied as a permanent
// multiplier; only the fresh boost gives followed users an edge.
export const AFFINITY_FOLLOWED = 1.0;
export const AFFINITY_DISCOVERY = 1.0;

export function makeAffinity(_followedSet: Set<string> | null) {
  return () => 1.0;
}

export function makeFreshBoost(followedSet: Set<string> | null) {
  if (!followedSet || followedSet.size === 0) return () => 1.0;
  return (userId: string, createdAt: Date): number => {
    if (!followedSet.has(userId)) return 1.0;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs >= FRESH_WINDOW_MS) return 1.0;
    const t = ageMs / FRESH_WINDOW_MS;
    return 1.0 + 14.0 * (1 - t); // 15× at t=0, linearly down to 1× at t=1
  };
}
