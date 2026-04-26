/**
 * Badge Routes
 *
 * GET   /badges/me                  — get my badge status + XP breakdown
 * POST  /badges/claim               — claim Lv1 badge for the first time
 * POST  /badges/evolve              — evolve to next level (requires 100 XP)
 * POST  /badges/toggle-visibility   — toggle badge hidden/visible
 * GET   /badges/user/:id            — get any user's badge (public, level only)
 */

import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import {
  getBadgeStatus,
  claimFirstBadge,
  evolveBadge,
  toggleBadgeVisibility,
  togglePageBadgeVisibility,
  setDisplayBadgeLevel,
  setActiveBadge,
  BADGE_META,
  BADGE_MAX_LEVEL,
  XP_PER_LEVEL,
  XP_PER_ACTION,
  DAILY_XP_CAP,
} from "../services/badge.service";
import { db } from "@workspace/db";
import { userBadgeTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../middlewares/error-handler";
import { UnauthorizedError, NotFoundError } from "../lib/errors";

const router: IRouter = Router();

// Rate limit: claim/evolve max 10/hour per user
const badgeMutationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? "anon",
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limited", message: "Too many badge actions. Try again later." },
});

// ── GET /badges/me ─────────────────────────────────────────────────────────────
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    const badge = await getBadgeStatus(userId);

    if (!badge || badge.level === 0) {
      res.json({
        level: 0,
        xpCurrent: 0,
        xpFromPosts: 0,
        xpFromTags: 0,
        xpFromParty: 0,
        xpRequired: XP_PER_LEVEL,
        progress: 0,
        canEvolve: false,
        atMaxLevel: false,
        claimed: false,
        meta: null,
        rules: buildRules(),
      });
      return;
    }

    const isSupporterApproved = badge.isSupporterApproved ?? false;
    const isPageVerified = badge.isPageVerified ?? false;
    const atMaxLevel = badge.level >= BADGE_MAX_LEVEL;
    const progress = atMaxLevel
      ? 100
      : Math.min(100, Math.floor((badge.xpCurrent / XP_PER_LEVEL) * 100));

    res.json({
      level: badge.level,
      isSupporterApproved,
      isPageVerified,
      xpCurrent: badge.xpCurrent,
      xpFromPosts: badge.xpFromPosts,
      xpFromTags: badge.xpFromTags,
      xpFromParty: badge.xpFromParty,
      xpRequired: XP_PER_LEVEL,
      progress,
      canEvolve: !atMaxLevel && badge.xpCurrent >= XP_PER_LEVEL,
      atMaxLevel,
      claimed: true,
      badgeHidden: badge.badgeHidden ?? false,
      pageBadgeHidden: badge.pageBadgeHidden ?? false,
      displayLevel: badge.displayLevel ?? null,
      claimedAt: badge.claimedAt,
      meta: BADGE_META[badge.level] ?? null,
      rules: buildRules(),
    });
  }),
);

// ── GET /badges/user/:userId ──────────────────────────────────────────────────
router.get(
  "/user/:userId",
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const badge = await getBadgeStatus(userId);

    if (!badge || (badge.level === 0 && !badge.isPageVerified)) {
      res.json({ level: 0, meta: null, isPageVerified: false });
      return;
    }

    const isPageVerified = badge.isPageVerified ?? false;
    const pageBadgeHidden = badge.pageBadgeHidden ?? false;
    const isSupporterApproved = badge.isSupporterApproved ?? false;
    const effectiveMaxLevel = isSupporterApproved ? 5 : badge.level;

    // displayLevel overrides if set; otherwise show effective max, respecting badgeHidden
    const shownLevel = badge.displayLevel != null
      ? badge.displayLevel
      : badge.badgeHidden ? 0 : effectiveMaxLevel;

    res.json({
      level: shownLevel,
      meta: shownLevel > 0 ? (BADGE_META[shownLevel] ?? null) : null,
      isPageVerified: isPageVerified && !pageBadgeHidden,
    });
  }),
);

// ── POST /badges/active ───────────────────────────────────────────────────────
// Single source of truth for which badge a user displays publicly.
// Body: { kind: "none" | "ticket" | "popcorn", level?: number }
router.post(
  "/active",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    const kind = String(req.body?.kind ?? "");
    if (kind !== "none" && kind !== "ticket" && kind !== "popcorn") {
      res.status(400).json({ error: "invalid_kind", message: 'kind must be "none" | "ticket" | "popcorn"' });
      return;
    }

    try {
      const active = kind === "ticket"
        ? { kind: "ticket" as const, level: Number(req.body?.level ?? 0) }
        : kind === "popcorn"
          ? { kind: "popcorn" as const }
          : { kind: "none" as const };
      const badge = await setActiveBadge(userId, active);
      res.json({
        success: true,
        displayLevel: badge.displayLevel ?? 0,
        pageBadgeHidden: badge.pageBadgeHidden ?? true,
      });
    } catch (err: any) {
      if (err.message === "no_lv_badge") {
        res.status(400).json({ error: "no_lv_badge", message: "User has no Lv badge to display." });
        return;
      }
      if (err.message === "not_verified") {
        res.status(400).json({ error: "not_verified", message: "User is not page-verified." });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /badges/set-display ──────────────────────────────────────────────────
router.post(
  "/set-display",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    const level = Number(req.body?.level ?? 0);
    if (isNaN(level) || level < 0 || level > 5) {
      res.status(400).json({ error: "invalid_level", message: "level must be 0–5" });
      return;
    }

    const badge = await setDisplayBadgeLevel(userId, level);
    res.json({ success: true, displayLevel: badge.displayLevel ?? null });
  }),
);

// ── POST /badges/toggle-visibility ────────────────────────────────────────────
router.post(
  "/toggle-visibility",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    const badge = await toggleBadgeVisibility(userId);
    res.json({ success: true, badgeHidden: badge.badgeHidden });
  }),
);

// ── POST /badges/toggle-page-visibility ───────────────────────────────────────
router.post(
  "/toggle-page-visibility",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    try {
      const badge = await togglePageBadgeVisibility(userId);
      res.json({ success: true, pageBadgeHidden: badge.pageBadgeHidden });
    } catch (err: any) {
      if (err.message === "not_verified") {
        res.status(400).json({ error: "not_verified", message: "Page badge not verified." });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /badges/claim ────────────────────────────────────────────────────────
router.post(
  "/claim",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    try {
      const badge = await claimFirstBadge(userId);
      res.json({
        success: true,
        level: badge.level,
        meta: BADGE_META[badge.level],
      });
    } catch (err: any) {
      if (err.message === "already_claimed") {
        res.status(409).json({ error: "already_claimed", message: "Badge already claimed." });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /badges/evolve ───────────────────────────────────────────────────────
router.post(
  "/evolve",
  badgeMutationLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    try {
      const badge = await evolveBadge(userId);
      res.json({
        success: true,
        level: badge.level,
        meta: BADGE_META[badge.level],
      });
    } catch (err: any) {
      const code = err.message;
      const messages: Record<string, string> = {
        no_badge: "You need to claim your first badge first.",
        max_level: "You have already reached the maximum badge level!",
        insufficient_xp: `You need ${XP_PER_LEVEL} XP to evolve.`,
      };
      if (messages[code]) {
        res.status(400).json({ error: code, message: messages[code] });
        return;
      }
      throw err;
    }
  }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRules() {
  return {
    xpRequired: XP_PER_LEVEL,
    sources: [
      {
        action: "post_ticket",
        label: "โพสต์ Ticket",
        xpPerAction: XP_PER_ACTION.post_ticket,
        dailyCap: DAILY_XP_CAP.post_ticket,
      },
      {
        action: "post_chain",
        label: "โพสต์ Chain",
        xpPerAction: XP_PER_ACTION.post_chain,
        dailyCap: DAILY_XP_CAP.post_chain,
      },
      {
        action: "tag_friend",
        label: "Tag เพื่อน (ต่อโพสต์)",
        xpPerAction: XP_PER_ACTION.tag_friend,
        dailyCap: DAILY_XP_CAP.tag_friend,
      },
      {
        action: "party_accept",
        label: "เพื่อนยอมรับปาร์ตี้",
        xpPerAction: XP_PER_ACTION.party_accept,
        dailyCap: DAILY_XP_CAP.party_accept,
      },
    ],
  };
}

export default router;
