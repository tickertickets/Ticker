/**
 * Rank Service — movie quality scoring and tier computation.
 *
 * Implements the Bayesian Reliability Adjustment and the v8 Rank System
 * that determines what "tier" (common → holographic) a movie earns.
 * Previously this logic was embedded directly inside routes/tickets.ts.
 *
 * No I/O — pure functions only. Easy to unit-test.
 */

export type RankTier =
  | "common"
  | "rare"
  | "ultra"
  | "legendary"
  | "holographic"
  | "cult_classic";

export type SpecialColor = "pink" | "bronze" | "silver" | "gold" | "diamond";

// ── Bayesian Reliability Adjustment ──────────────────────────────────────────
//
// We pull the raw TMDB vote_average toward a global prior mean to
// prevent movies with very few votes from dominating the rankings.

const PRIOR_MEAN = 6.5;
const PRIOR_WEIGHT = 500;

export function weightedScore(rating: number, votes: number): number {
  const adjusted =
    (PRIOR_WEIGHT * PRIOR_MEAN + votes * rating) / (PRIOR_WEIGHT + votes);
  return Math.min(10, Math.max(0, adjusted));
}

// ── Rank Tier Computation (v8) ────────────────────────────────────────────────
//
// Maps a weighted score + optional release year to one of the tier strings
// that are stored in the DB and displayed on ticket cards.

export function computeRankTier(score: number, releaseYear: number | null): RankTier {
  const age =
    releaseYear !== null ? new Date().getFullYear() - releaseYear : null;
  const isLegacyAge = age !== null && age >= 20;

  if (score >= 8.3) {
    return isLegacyAge ? "holographic" : "legendary";
  }
  if (score >= 7.6) return "ultra";
  if (score >= 6.6) return "rare";
  if (score >= 5.1) return "common";
  if (isLegacyAge) return "cult_classic";
  return "common";
}

// ── Party Special Color ───────────────────────────────────────────────────────
//
// Determines the foil color awarded when all party members accept their invite.

export function getSpecialColorForSize(size: number): SpecialColor | null {
  if (size >= 10) return "diamond";
  if (size >= 7) return "gold";
  if (size >= 5) return "silver";
  if (size >= 3) return "bronze";
  if (size >= 2) return "pink";
  return null;
}

export const COLOR_NAMES: Record<string, string> = {
  bronze: "บรอนซ์",
  silver: "ซิลเวอร์",
  gold: "โกลด์",
  diamond: "ไดมอนด์",
};

export const VALID_CUSTOM_TIERS = [
  "common",
  "rare",
  "ultra",
  "legendary",
  "holographic",
  "cult_classic",
] as const;

export type ValidCustomTier = (typeof VALID_CUSTOM_TIERS)[number];

export function isValidCustomTier(value: unknown): value is ValidCustomTier {
  return (VALID_CUSTOM_TIERS as readonly unknown[]).includes(value);
}
