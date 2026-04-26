// ═══════════════════════════════════════════════════════════════
//  TICKER RANK SYSTEM  v8  (Complete rewrite)
//
//  TIER ใหม่ (ตรงตาม TMDB vote_average):
//    [C]  Common      1.0 – 5.0
//    [U]  Uncommon    5.1 – 6.5
//    [R]  Rare        6.6 – 7.5
//    [SR] Super Rare  7.6 – 8.2
//    [UR] Ultra Rare  8.3 – 10.0
//
//  EFFECT TAGS (1-2 tag บนการ์ด):
//    N   = New       (0-1 ปี)
//    FR  = Franchise
//    FS  = Fan Service
//    LGC = Legacy    (20+ ปี)
//
//  SPECIAL CARDS (ไม่มี Rank ไม่มี Effect — มีแค่ชื่อพิเศษ):
//    LEGENDARY    = UR + LGC  (UR score ≥ 8.3 AND อายุ ≥ 20 ปี)
//    CULT CLASSIC = C  + LGC  (C score ≤ 5.0 AND อายุ ≥ 20 ปี)
//
//  ค่าใน DB enum:
//    common, rare, ultra (SR), legendary (UR), holographic (LEGENDARY special), cult_classic
//
//  Real-time: ค่า rank ไม่ถูก lock — อัปเดตจาก TMDB เสมอ
// ═══════════════════════════════════════════════════════════════

// ── Tier types ──────────────────────────────────────────────────
export type CardTier =
  | "common"       // [C]  1.0–5.0
  | "uncommon"     // [U]  5.1–6.5
  | "rare"         // [R]  6.6–7.5
  | "super_rare"   // [SR] 7.6–8.2
  | "ultra_rare"   // [UR] 8.3–10.0
  | "legendary"    // LEGENDARY special (UR + LGC)
  | "cult_classic";// CULT CLASSIC special (C + LGC)

// Abbreviated display label บนการ์ด
export const TIER_ABBR: Record<CardTier, string> = {
  common:       "C",
  uncommon:     "U",
  rare:         "R",
  super_rare:   "SR",
  ultra_rare:   "UR",
  legendary:    "LEGENDARY",
  cult_classic: "CULT CLASSIC",
};

// Full name สำหรับคลิกแสดงคำอธิบาย
export const TIER_FULL_NAME: Record<CardTier, string> = {
  common:       "Common",
  uncommon:     "Uncommon",
  rare:         "Rare",
  super_rare:   "Super Rare",
  ultra_rare:   "Ultra Rare",
  legendary:    "Legendary",
  cult_classic: "Cult Classic",
};

// DB tier values (enum ใน postgres)
export type DbTier =
  | "common"
  | "rare"
  | "ultra"
  | "legendary"
  | "holographic"
  | "cult_classic";

// ── Effect Tags ──────────────────────────────────────────────────
export type EffectTag = "N" | "FR" | "FS" | "LGC";

export const EFFECT_CONFIG: Record<EffectTag, { label: string; fullName: string; badge: string }> = {
  N:   { label: "N",   fullName: "New",          badge: "bg-orange-950 text-orange-300 border border-orange-500" },
  FR:  { label: "FR",  fullName: "Franchise",    badge: "bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-500" },
  FS:  { label: "FS",  fullName: "Fan Service",  badge: "bg-teal-950 text-teal-300 border border-teal-600" },
  LGC: { label: "LGC", fullName: "Legacy",       badge: "bg-neutral-900 text-amber-300 border border-amber-400" },
};

// ── Score Input ───────────────────────────────────────────────────
export type ScoreInput = {
  tmdbRating: number;
  voteCount: number;
  popularity?: number;
  genreIds?: number[];
  genreNames?: string[];
  year?: number | string | null;
  releaseDate?: string | null;   // "YYYY-MM-DD" from TMDB — enables precise age calculation
  franchiseIds?: number[];   // collection_id from TMDB
};

// ═══════════════════════════════════════════════════════════════
//  SCORE ENGINE
//  Rank ใช้ tmdbRating โดยตรง — ตรงตามเจตนาของผู้ใช้
//  computeWeightedScore เก็บไว้เพื่อ backward compat เท่านั้น
// ═══════════════════════════════════════════════════════════════
export function computeWeightedScore(input: Pick<ScoreInput, "tmdbRating" | "voteCount">): number {
  // ส่งคืน tmdbRating โดยตรง (ไม่ Bayesian) เพื่อให้ rank ตรงกับ TMDB score
  return Math.min(10, Math.max(0, input.tmdbRating));
}

// ── Helper ───────────────────────────────────────────────────────
export function getMovieAge(year: number | string | null | undefined): number | null {
  if (!year) return null;
  const y = typeof year === "string" ? parseInt(year) : year;
  if (isNaN(y)) return null;
  return new Date().getFullYear() - y;
}

// ── ตรวจสอบ Franchise — ใช้ TMDB collection_id เท่านั้น (แม่นยำที่สุด)
//  genre heuristic ถูกเอาออก เพราะทำให้ standalone เช่น Interstellar ได้ FR ผิดๆ
//  FR จะแสดงเฉพาะเมื่อมี franchiseIds (belongs_to_collection.id จาก TMDB detail)
export function isFranchiseMovie(input: Pick<ScoreInput, "genreIds" | "franchiseIds" | "voteCount" | "popularity">): boolean {
  return !!(input.franchiseIds && input.franchiseIds.length > 0);
}

// ── Fan Service detection — ชีวประวัติ, ศิลปิน, สารคดีเบื้องหลัง, Music ──────
//  FS คือ niche content ที่กลุ่มแฟนคลับรักเฉพาะทาง ไม่แมส
//  ครอบคลุม: สารคดี (99), Music/concert (10402), History/biography (36)
const FAN_SERVICE_GENRE_IDS = new Set([
  99,    // Documentary — making-of, behind-the-scenes, สารคดีชีวประวัติ
  10402, // Music — concert film, music documentary, หนังเกี่ยวกับศิลปิน
  36,    // History — historical biography, ชีวประวัติบุคคลสำคัญ
]);

export function isFanService(input: Pick<ScoreInput, "genreIds" | "voteCount" | "popularity" | "franchiseIds">): boolean {
  // ถ้าเป็น franchise อยู่แล้ว → ไม่ใช่ fan service
  if (input.franchiseIds && input.franchiseIds.length > 0) return false;
  const genreIds = input.genreIds ?? [];
  return genreIds.some(id => FAN_SERVICE_GENRE_IDS.has(id));
}

// ═══════════════════════════════════════════════════════════════
//  TIER COMPUTATION — ใช้ tmdbRating โดยตรงตามเกณฑ์
// ═══════════════════════════════════════════════════════════════
export function scoreToBaseTier(score: number): Exclude<CardTier, "legendary" | "cult_classic"> {
  if (score >= 8.3) return "ultra_rare";
  if (score >= 7.6) return "super_rare";
  if (score >= 6.6) return "rare";
  if (score >= 5.1) return "uncommon";
  return "common";
}

export function computeCardTier(input: ScoreInput): CardTier {
  // ใช้ tmdbRating โดยตรง (ไม่ผ่าน Bayesian)
  const score = input.tmdbRating;
  const baseTier = scoreToBaseTier(score);
  const age = getMovieAge(input.year);
  const isLegacyAge = age !== null && age >= 20;

  // LEGENDARY: Ultra Rare + อายุ ≥ 20 ปี
  if (baseTier === "ultra_rare" && isLegacyAge) return "legendary";

  // CULT CLASSIC: Common + อายุ ≥ 20 ปี
  if (baseTier === "common" && isLegacyAge) return "cult_classic";

  return baseTier;
}

// ── Backward compat export ───────────────────────────────────────
export function computeMovieRankFromInput(input: ScoreInput): CardTier {
  return computeCardTier(input);
}

// ═══════════════════════════════════════════════════════════════
//  EFFECT TAGS — ไม่จำกัดจำนวน ถ้าตรงเงื่อนไขทั้งหมดก็แสดง
//  (ยกเว้น LEGENDARY / CULT CLASSIC ไม่มี tag ใดๆ)
// ═══════════════════════════════════════════════════════════════
export function computeEffectTags(input: ScoreInput, tier: CardTier): EffectTag[] {
  // LEGENDARY / CULT CLASSIC ไม่มี tags
  if (tier === "legendary" || tier === "cult_classic") return [];

  const tags: EffectTag[] = [];
  const age = getMovieAge(input.year);

  // N = New (ออกมาใน 0-1 ปีที่ผ่านมา) — จะหายไปเองเมื่อครบ 1 ปีพอดี
  // ถ้ามี releaseDate ใช้ day-precise calculation (TMDB "YYYY-MM-DD")
  // ถ้าไม่มีให้ fallback เป็น year-only (age <= 1) เพื่อไม่ regression กับ ticket cards เก่า
  const isNew = input.releaseDate
    ? (Date.now() - new Date(input.releaseDate).getTime()) < 365.25 * 24 * 60 * 60 * 1000
    : (age !== null && age <= 1);
  if (isNew) tags.push("N");

  // LGC = Legacy (20+ ปี) — ไม่ถึง LEGENDARY/CULT เพราะ tier ไม่ตรงเงื่อนไข
  if (age !== null && age >= 20) tags.push("LGC");

  // FR = Franchise — ตรวจก่อน FS เสมอ (priority สูงกว่า)
  if (isFranchiseMovie(input)) tags.push("FR");

  // FS = Fan Service — เฉพาะถ้าไม่ใช่ franchise
  if (!tags.includes("FR") && isFanService(input)) tags.push("FS");

  return tags;
}

// ── Map CardTier → DB tier enum ──────────────────────────────────
export function cardTierToDb(tier: CardTier): DbTier {
  const map: Record<CardTier, DbTier> = {
    common:       "common",
    uncommon:     "common",   // U ใช้ "common" ใน DB, แยกโดย score
    rare:         "rare",
    super_rare:   "ultra",
    ultra_rare:   "legendary",
    legendary:    "holographic",
    cult_classic: "cult_classic",
  };
  return map[tier];
}

// ── Map DB tier + score → CardTier (reconstruct บน frontend) ─────
export function dbTierToCard(dbTier: DbTier, tmdbScore?: number): CardTier {
  switch (dbTier) {
    case "holographic":  return "legendary";
    case "cult_classic": return "cult_classic";
    case "legendary":    return "ultra_rare";
    case "ultra":        return "super_rare";
    case "rare":         return "rare";
    case "common":
      // ถ้ามี score ให้แยก C/U ได้แม่นขึ้น
      if (tmdbScore !== undefined && tmdbScore >= 5.1) return "uncommon";
      return "common";
    default:             return "common";
  }
}

// ═══════════════════════════════════════════════════════════════
//  VISUAL CONFIG — Single source of truth
// ═══════════════════════════════════════════════════════════════
export type TierVisual = {
  abbr: string;        // C / U / R / SR / UR / LEGENDARY / CULT CLASSIC
  fullName: string;    // Common / Uncommon / etc.
  badge: string;       // Tailwind classes for rank badge
  cardBg: string;      // card background gradient class
  borderClass: string; // border color class
  glowClass: string;   // CSS shimmer/glow class
  accentColor: string; // hex for star/dot accent
  shimmer: string;     // shimmer CSS class
};

export const TIER_VISUAL: Record<CardTier, TierVisual> = {
  common: {
    abbr:        "C",
    fullName:    "Common",
    badge:       "bg-zinc-800 text-zinc-400 border border-zinc-600",
    cardBg:      "card-bg-common",
    borderClass: "border-zinc-700",
    glowClass:   "",
    accentColor: "#71717a",
    shimmer:     "",
  },
  uncommon: {
    abbr:        "U",
    fullName:    "Uncommon",
    badge:       "bg-slate-800 text-slate-300 border border-slate-500",
    cardBg:      "card-bg-uncommon",
    borderClass: "border-slate-500",
    glowClass:   "ticket-shimmer-silver",
    accentColor: "#94a3b8",
    shimmer:     "ticket-shimmer-silver",
  },
  rare: {
    abbr:        "R",
    fullName:    "Rare",
    badge:       "bg-emerald-950 text-emerald-300 border border-emerald-600",
    cardBg:      "card-bg-rare",
    borderClass: "border-emerald-700",
    glowClass:   "ticket-shimmer-silver",
    accentColor: "#34d399",
    shimmer:     "ticket-shimmer-silver",
  },
  super_rare: {
    abbr:        "SR",
    fullName:    "Super Rare",
    badge:       "bg-blue-950 text-blue-300 border border-blue-500",
    cardBg:      "card-bg-super-rare",
    borderClass: "border-blue-600",
    glowClass:   "ticket-shimmer-silver",
    accentColor: "#60a5fa",
    shimmer:     "ticket-shimmer-silver",
  },
  ultra_rare: {
    abbr:        "UR",
    fullName:    "Ultra Rare",
    badge:       "bg-purple-950 text-violet-300 border border-purple-500",
    cardBg:      "card-bg-ultra-rare",
    borderClass: "border-purple-600",
    glowClass:   "ticket-shimmer-silver",
    accentColor: "#a78bfa",
    shimmer:     "ticket-shimmer-silver",
  },
  legendary: {
    abbr:        "LEGENDARY",
    fullName:    "Legendary",
    badge:       "bg-neutral-900 text-amber-300 border border-amber-400 badge-tier-secret",
    cardBg:      "card-bg-legendary",
    borderClass: "border-amber-500",
    glowClass:   "ticket-shimmer-silver",
    accentColor: "#f59e0b",
    shimmer:     "ticket-shimmer-silver",
  },
  cult_classic: {
    abbr:        "CULT CLASSIC",
    fullName:    "Cult Classic",
    badge:       "bg-red-950 text-rose-300 border border-red-500",
    cardBg:      "card-bg-cult",
    borderClass: "border-red-700",
    glowClass:   "",
    accentColor: "#f43f5e",
    shimmer:     "",
  },
};

// ── Helper: รับ DB tier + score → TierVisual ──────────────────────
// NOTE: ตรวจ DbTier ก่อนเสมอ เพราะ "legendary" ใน DB = UR ไม่ใช่ LEGENDARY special
export function getCardVisual(dbTier: string | null | undefined, tmdbScore?: number): TierVisual & { tier: CardTier } {
  const validDbTiers: DbTier[] = ["common", "rare", "ultra", "legendary", "holographic", "cult_classic"];
  // CardTier ที่ไม่มีใน DbTier (safe fallback สำหรับ legacy data)
  const cardOnlyTiers: CardTier[] = ["uncommon", "super_rare", "ultra_rare"];

  // ตรวจ DB tiers ก่อนเสมอ — ป้องกัน "legendary" (DB=UR) ถูกตีความเป็น LEGENDARY special
  if (dbTier && validDbTiers.includes(dbTier as DbTier)) {
    const tier = dbTierToCard(dbTier as DbTier, tmdbScore);
    return { ...TIER_VISUAL[tier], tier };
  }

  // Fallback: CardTier ที่ไม่มีใน DB (uncommon, super_rare, ultra_rare — legacy / in-memory เท่านั้น)
  if (dbTier && cardOnlyTiers.includes(dbTier as CardTier)) {
    const tier = dbTier as CardTier;
    return { ...TIER_VISUAL[tier], tier };
  }

  return { ...TIER_VISUAL.common, tier: "common" };
}

// ── Backward compat: getTicketTierVisual ──────────────────────────
export function getTicketTierVisual(tier: string | null | undefined, tmdbScore?: number) {
  const v = getCardVisual(tier, tmdbScore);
  return {
    ...v,
    label:     v.abbr,
    badge:     v.badge,
    shadow:    "",
    movieTier: v.tier,
  };
}

// ── Backward compat exports ───────────────────────────────────────
/** @deprecated ใช้ TIER_VISUAL แทน */
export type MovieRankTier = CardTier;
/** @deprecated ใช้ computeCardTier แทน */
export function computeMovieRank(score: number, input?: Pick<ScoreInput, "voteCount" | "year">): CardTier {
  if (!input) return scoreToBaseTier(score);
  return computeCardTier({ tmdbRating: score, voteCount: input.voteCount ?? 0, year: input.year });
}
// computeWeightedScore already exported above (no re-export needed)
/** @deprecated ใช้ computeEffectTags แทน */
export type CardAttribute = EffectTag;
/** @deprecated ใช้ computeEffectTags แทน */
export function computeAttributes(input: ScoreInput & { rank: CardTier; weightedScore: number }): EffectTag[] {
  return computeEffectTags(input, input.rank);
}
/** @deprecated ใช้ EFFECT_CONFIG แทน */
export const ATTRIBUTE_CONFIG = EFFECT_CONFIG;

/** @deprecated ใช้ TIER_VISUAL แทน */
export const MOVIE_RANK_CONFIG = Object.fromEntries(
  Object.entries(TIER_VISUAL).map(([k, v]) => [k, {
    label: v.abbr,
    badge: v.badge,
    shadow: "",
    shimmer: v.shimmer,
  }])
) as Record<CardTier, { label: string; badge: string; shadow: string; shimmer: string }>;

/** @deprecated ใช้ TIER_VISUAL แทน */
export const MOVIE_RANK_CARD_CONFIG = MOVIE_RANK_CONFIG;

/** @deprecated */
export const MOVIE_TIER_VISUAL = Object.fromEntries(
  Object.entries(TIER_VISUAL).map(([k, v]) => [k, {
    label: v.abbr,
    badge: v.badge,
    shadow: "",
    shimmer: v.shimmer,
  }])
) as Record<CardTier, { label: string; badge: string; shadow: string; shimmer: string }>;
