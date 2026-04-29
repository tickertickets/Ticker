/**
 * Universal Hot Score — Ticker ranking engine
 *
 * Formula (inspired by Hacker News, adapted for social film platforms):
 *
 *   score = (engagement + 1) / (hours_since_last_activity + 2) ^ gravity
 *
 * Key design decisions vs. vanilla HN:
 *
 *   1. lastActivityAt instead of createdAt
 *      HN uses T = hours since submission. We use T = hours since last
 *      like/comment/chain-run, so a popular old post can "resurface" when
 *      it receives new engagement — matching Instagram / Twitter behaviour.
 *
 *   2. gravity = 1.5 (NOT 1.8)
 *      HN gravity 1.8 is tuned for thousands of posts / day; it makes content
 *      invisible after ~24 h. Ticker has fewer posts and content (film reviews)
 *      has longer relevance. 1.5 gives a ~3 day relevance window for popular
 *      content instead of ~12 h.
 *
 *   3. Differential engagement weights
 *      likes×1  — low-effort passive approval
 *      comments×2 — takes effort, starts a conversation
 *      bonus×3    — chain participants (strong community signal)
 *      These weights are the same as Letterboxd's published "activity score"
 *      convention (passive < active < participatory).
 *
 * Score examples (gravity=1.5):
 *   0 likes, just created: 1 / 2^1.5 ≈ 0.35
 *   3 likes, 1 h ago:      4 / 3^1.5 ≈ 0.77
 *   3 likes, 6 h ago:      4 / 8^1.5 ≈ 0.18
 *   5 likes, 12 h ago:     6 / 14^1.5 ≈ 0.11
 *   10 likes, 24 h ago:   11 / 26^1.5 ≈ 0.08
 */

export const HOT_GRAVITY = 1.5;

export interface HotScoreParams {
  likes: number;
  comments: number;
  bonus?: number;       // chain participants or other community signal
  lastActivityAt: Date;
}

export function hotScore({ likes, comments, bonus = 0, lastActivityAt }: HotScoreParams): number {
  const engagement = likes * 1 + comments * 2 + bonus * 3;
  const ageHours   = (Date.now() - lastActivityAt.getTime()) / 3_600_000;
  return (engagement + 1) / Math.pow(ageHours + 2, HOT_GRAVITY);
}

// ── Fresh-post boost ──────────────────────────────────────────────────────────
//
// Posts < 60 min old by a user you follow (or your own posts) get a temporary
// score multiplier: 15× at t=0, decaying linearly to 1× at t=60 min.
//
// After the window expires, all posts compete purely on hotScore — if they
// gained real engagement during the boost window they stay up on merit.
//
// In explore/discover contexts (no personalization), pass `followedSet = null`
// to boost only own posts, keeping the ranking fair for all users.

export const FRESH_WINDOW_MS  = 60 * 60 * 1000; // 60 minutes
export const FRESH_BOOST_MAX  = 15;              // 15× at t=0

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
    const t = ageMs / FRESH_WINDOW_MS; // 0=just posted, 1=expired
    return 1.0 + (FRESH_BOOST_MAX - 1) * (1 - t); // 15× → 1×
  };
}
