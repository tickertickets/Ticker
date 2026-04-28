/**
 * Shared card-face components used by both TicketCard and ShareStoryModal.
 * Kept in a separate file to avoid circular imports.
 *
 * IMPORTANT: All color values must use hex/rgba (never Tailwind color classes)
 * because html2canvas cannot parse oklch() which Tailwind v4 emits for colors.
 * Layout-only classes (flex, inset-0, w-full, etc.) are fine.
 */
import { cn } from "@/lib/utils";
import { Star, Lock, CalendarDays, MapPin } from "lucide-react";
import type { Ticket } from "@workspace/api-client-react";
import { useLang, displayYear, displayDate } from "@/lib/i18n";
import { localizeTicketGenre } from "@/lib/tmdb-genres";

// ── Constants ──────────────────────────────────────────────────────────────────
export const POSTER_BG   = "#ccc9c3";
export const POSTER_DARK = "#1c1c1c";

/** Canonical seed size — all card faces render at this size then are CSS-scaled to fit each surface */
export const CARD_SEED_W = 190;
export const CARD_SEED_H = 285;

/** Single source of truth for @username position on ALL card types (full-size) */
export const CARD_USERNAME_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 8,
  fontSize: 8,
  fontWeight: 600,
  lineHeight: 1,
  margin: 0,
  padding: 0,
};

/** @username position for compact (profile grid) cards */
export const CARD_USERNAME_STYLE_COMPACT: React.CSSProperties = {
  position: "absolute",
  bottom: 6,
  left: 6,
  fontSize: 7,
  fontWeight: 600,
  lineHeight: 1,
  margin: 0,
  padding: 0,
};

// ── Special color config ───────────────────────────────────────────────────────
const SPECIAL_COLOR_CONFIG: Record<string, { color: string; glow: string; label: string }> = {
  pink:    { color: "#ec4899", glow: "0 0 12px 3px rgba(236,72,153,0.55)",  label: "Pink"   },
  bronze:  { color: "#cd7f32", glow: "0 0 12px 3px rgba(205,127,50,0.55)",  label: "Bronze" },
  silver:  { color: "#c0c0c0", glow: "0 0 12px 3px rgba(192,192,192,0.55)", label: "Silver" },
  gold:    { color: "#ffd700", glow: "0 0 16px 4px rgba(255,215,0,0.65)",   label: "Gold"   },
  diamond: { color: "#b9f2ff", glow: "0 0 20px 6px rgba(185,242,255,0.75)", label: "Diamond"},
};

export function getSpecialColorCfg(_specialColor?: string | null) {
  return null;
}

// ── Rating card visual — effects for 4-5 star ratings ────────────────────────
export function getRatingCardStyle(rating?: number | null, ratingType?: string): {
  borderClass: string;
  borderColorHex: string;
  shimmer: string;
  glow: React.CSSProperties;
} {
  const BASE_SHADOW = "var(--ticket-shadow)";
  // Dying star (blackhole) — never gets shimmer regardless of star count
  if (ratingType === "blackhole") {
    return { borderClass: "", borderColorHex: "transparent", shimmer: "", glow: { boxShadow: BASE_SHADOW } };
  }
  return { borderClass: "", borderColorHex: "transparent", shimmer: "", glow: { boxShadow: BASE_SHADOW } };
}

// ── RankStarIcon — 4-level evolving cosmic star icons ─────────────────────────
// Rank 1: simple 4-pointed lavender diamond (plain, no effects)
// Rank 2: 5-pointed indigo/violet star with soft glow layer
// Rank 3: 6-pointed gold star with ring halo + rose accent sparkles
// Rank 4: 8-pointed cosmic star — purple + teal + gold constellation
// IMPORTANT: only hex/rgba — no Tailwind color classes (html2canvas compat)
export function RankStarIcon({ rank, className = "w-7 h-7" }: { rank: 1 | 2 | 3 | 4; className?: string }) {
  const STAR5 = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26";
  const STAR6 = "12,2 14.8,7.2 20.7,7 17.5,12 20.7,17 14.8,16.8 12,22 9.2,16.8 3.3,17 6.5,12 3.3,7 9.2,7.2";
  const STAR8 = "12,2 13.9,7.4 19.1,4.9 16.6,10.1 22,12 16.6,13.9 19.1,19.1 13.9,16.6 12,22 10.1,16.6 4.9,19.1 7.4,13.9 2,12 7.4,10.1 4.9,4.9 10.1,7.4";

  if (rank === 1) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none">
        {/* Simple 4-pointed diamond — soft lavender, no effects */}
        <polygon points="12,2.5 14.1,9.9 21.5,12 14.1,14.1 12,21.5 9.9,14.1 2.5,12 9.9,9.9" fill="#c4b5fd" />
      </svg>
    );
  }

  if (rank === 2) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none">
        {/* Outer soft glow */}
        <polygon points={STAR5} fill="#818cf8" opacity="0.28" transform="translate(12,12) scale(1.18) translate(-12,-12)" />
        {/* Main 5-pointed indigo star */}
        <polygon points={STAR5} fill="#818cf8" />
        {/* Bright inner highlight */}
        <polygon points={STAR5} fill="#e0e7ff" opacity="0.28" transform="translate(12,12) scale(0.52) translate(-12,-12)" />
        {/* Small 4-pt sparkle top-right */}
        <polygon points="21,3 21.3,4.7 23,4 21.3,3.3" fill="#c7d2fe" opacity="0.9" />
      </svg>
    );
  }

  if (rank === 3) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none">
        {/* Ring halo */}
        <circle cx="12" cy="12" r="10.5" stroke="#f59e0b" strokeWidth="0.7" opacity="0.65" />
        {/* Glow layer */}
        <polygon points={STAR6} fill="#f59e0b" opacity="0.25" transform="translate(12,12) scale(1.15) translate(-12,-12)" />
        {/* Main 6-pointed gold star */}
        <polygon points={STAR6} fill="#fbbf24" />
        {/* Bright inner center */}
        <circle cx="12" cy="12" r="3" fill="#fde68a" opacity="0.55" />
        {/* Rose dot accents */}
        <circle cx="3.5"  cy="12" r="1.1"  fill="#fb7185" opacity="0.9" />
        <circle cx="20.5" cy="12" r="0.85" fill="#fb7185" opacity="0.85" />
        {/* Gold 4-pt sparkles */}
        <polygon points="21.5,3.5 21.8,5 23.3,4.5 21.8,4" fill="#fde68a" opacity="0.9" />
        <polygon points="2.5,19.5 2.8,21 4.3,20.5 2.8,20"  fill="#fde68a" opacity="0.8" />
      </svg>
    );
  }

  // Rank 4 — 8-pointed cosmic multi-color
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none">
      {/* Far deep purple glow */}
      <polygon points={STAR8} fill="#7c3aed" opacity="0.2" transform="translate(12,12) scale(1.28) translate(-12,-12)" />
      {/* Teal accent (rotated 22.5°) */}
      <polygon points={STAR8} fill="#2dd4bf" opacity="0.18" transform="translate(12,12) rotate(22.5) scale(1.1) translate(-12,-12)" />
      {/* Main 8-pointed purple star */}
      <polygon points={STAR8} fill="#a855f7" />
      {/* Gold center core */}
      <circle cx="12" cy="12" r="2.8" fill="#fbbf24" opacity="0.78" />
      {/* Gold 4-pt constellation sparkle — top-right */}
      <polygon points="21,2 21.35,3.65 23,4 21.35,4.35 21,6 20.65,4.35 19,4 20.65,3.65" fill="#fbbf24" />
      {/* Teal mini sparkle — bottom-left */}
      <polygon points="3,18 3.3,19.3 4.6,19 3.3,18.7" fill="#2dd4bf" />
      {/* Dot accents */}
      <circle cx="20"   cy="19"   r="0.9"  fill="#f0abfc" />
      <circle cx="4.5"  cy="5.5"  r="0.75" fill="#f0abfc" />
      <circle cx="22"   cy="13"   r="0.65" fill="#2dd4bf" />
      <circle cx="13.5" cy="22.5" r="0.6"  fill="#fbbf24" />
    </svg>
  );
}

// ── RatingBadge — filled stars row (1-5) ─────────────────────────────────────
// html2canvas-safe: only inline SVG, no Tailwind color classes
// ratingType="blackhole" → black (dying star) filled stars, no shimmer on card
export function RatingBadge({
  rating,
  ratingType,
  iconClass: _iconClass,
  fontSize: _fontSize,
  size = 12,
}: {
  rating: number;
  ratingType?: string;
  iconClass?: string;
  fontSize?: number;
  size?: number;
}) {
  const filled = Math.min(Math.max(0, Math.round(rating)), 5);
  const gap = size * 0.2;
  const filledColor = ratingType === "blackhole" ? "#22c55e" : "#fbbf24";
  return (
    <div style={{ display: "flex", gap, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= filled ? filledColor : "#6b7280"} xmlns="http://www.w3.org/2000/svg">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </div>
  );
}

// ── PosterMetaRow (used inside PosterCardFront) ────────────────────────────────
export function PosterMetaRow({ label, value, clamp = 1 }: { label: string; value: string; clamp?: number }) {
  return (
    <div style={{ display: "flex", gap: 4, minWidth: 0 }}>
      <span style={{ width: 46, flexShrink: 0, fontSize: 6.5, color: POSTER_DARK, opacity: 0.55, lineHeight: 1.35 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 6.5,
          fontWeight: 700,
          textTransform: "uppercase",
          color: POSTER_DARK,
          lineHeight: 1.35,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: clamp,
          WebkitBoxOrient: "vertical",
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── PosterCardFront ────────────────────────────────────────────────────────────
export function PosterCardFront({
  ticket,
  style,
  imageSrc: imageSrcOverride,
  borderColorHex,
  compact,
  className,
}: {
  ticket: Ticket;
  style?: React.CSSProperties;
  imageSrc?: string | null;
  borderColorHex?: string;
  compact?: boolean;
  className?: string;
}) {
  const t           = (ticket as unknown) as Record<string, unknown>;
  const backdropUrl = imageSrcOverride !== undefined ? imageSrcOverride : (t["cardBackdropUrl"] as string | null | undefined);
  const offsetX     = (t["cardBackdropOffsetX"] as number | null | undefined) ?? 50;
  const ratingType  = (t["ratingType"] as string | undefined) ?? "star";
  const { lang }    = useLang();

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden flex flex-col", className)}
      style={{
        background: POSTER_BG,
        borderRadius: 0,
        ...style,
      }}
    >
      <div className="flex-shrink-0 w-full" style={{ padding: "5px 5px 0" }}>
        <div
          className="relative overflow-hidden w-full"
          style={{ aspectRatio: "1 / 1", outline: "0.5px solid rgba(0,0,0,0.2)" }}
        >
          {backdropUrl ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url("${backdropUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: `${offsetX}% center`,
                backgroundRepeat: "no-repeat",
              }}
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-1"
              style={{ background: "#b8b4ae" }}
            >
              <Star className="w-5 h-5" style={{ color: POSTER_DARK, opacity: 0.35 }} />
            </div>
          )}
          {ticket.rating != null && (
            <div style={{ position: "absolute", top: compact ? 1 : 3, right: compact ? 1 : 3 }}>
              <RatingBadge rating={ticket.rating} ratingType={ratingType} size={16} />
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex flex-col" style={{ padding: compact ? "4px 6px 18px" : "5px 8px 24px" }}>
        <div
          style={{
            fontSize: compact ? 9 : 11.5,
            fontWeight: 900,
            textTransform: "uppercase",
            color: POSTER_DARK,
            letterSpacing: "-0.01em",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: compact ? 1 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {ticket.movieTitle}
        </div>
        {ticket.movieYear && (
          <div
            style={{
              fontSize: compact ? 6.5 : 8,
              fontWeight: 700,
              color: POSTER_DARK,
              opacity: 0.58,
              letterSpacing: "0.02em",
              marginTop: 2,
            }}
          >
            {displayYear(ticket.movieYear, lang)}
          </div>
        )}
      </div>
      {ticket.user?.username && (
        <p style={{ ...(compact ? CARD_USERNAME_STYLE_COMPACT : CARD_USERNAME_STYLE), color: POSTER_DARK, opacity: 0.38 }}>
          @{ticket.user.username}
        </p>
      )}
    </div>
  );
}

// ── ClassicCardFront — capture-safe, matches FeedCard classic front ────────────
// All colors are explicit hex/rgba — no Tailwind color classes — for html2canvas compatibility.
export function ClassicCardFront({
  ticket,
  imageSrc,
}: {
  ticket: Ticket;
  imageSrc: string | null;
}) {
  const t = (ticket as unknown) as Record<string, unknown>;
  const ratingType    = (t["ratingType"] as string | undefined) ?? "star";
  const specialColor  = t["specialColor"] as string | null | undefined;
  const specialColorCfg = getSpecialColorCfg(specialColor);
  const partySeat     = t["partySeatNumber"] as number | null | undefined;
  const ratingStyle   = getRatingCardStyle(ticket.rating, ratingType);
  const { lang }      = useLang();
  const genreLabel    = localizeTicketGenre(ticket, lang);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        borderRadius: "inherit",
        background: "#18181b",
        ...(specialColorCfg ? { boxShadow: specialColorCfg.glow } : ratingStyle.glow),
      }}
    >
      {imageSrc ? (
        <img src={imageSrc} alt={ticket.movieTitle ?? ""} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "#27272a" }}
        >
          <Star className="w-8 h-8" style={{ color: "#52525b" }} />
        </div>
      )}

      {/* gradient overlay — matches create-ticket preview exactly */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%, transparent 100%)" }}
      />

      {ticket.rating != null && (
        <div className="absolute top-2 right-2">
          <RatingBadge rating={ticket.rating} ratingType={ratingType} size={16} />
        </div>
      )}

      {specialColorCfg && (
        <div className="absolute top-0 inset-x-0 h-0.5 z-10" style={{ background: specialColorCfg.color }} />
      )}

      <div className="absolute inset-x-0 bottom-0 px-2 pb-6">
        {genreLabel && (
          <p
            className="text-[7px] uppercase tracking-widest font-semibold"
            style={{
              color: ticket.rating && ticket.rating >= 4 ? "#f59e0b" : "rgba(255,255,255,0.55)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {genreLabel}
          </p>
        )}
        <p
          className="font-display font-bold mt-px"
          style={{
            fontSize: 13,
            color: "#ffffff",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            lineHeight: 1.35,
          }}
        >
          {ticket.movieTitle}
        </p>
        {ticket.movieYear && (
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
            {displayYear(ticket.movieYear, lang)}
          </p>
        )}
      </div>
      {ticket.user?.username && (
        <p style={{ ...CARD_USERNAME_STYLE, color: "rgba(255,255,255,0.5)" }}>
          @{ticket.user.username}
        </p>
      )}
    </div>
  );
}

// ── CardBackFace — capture-safe card back ─────────────────────────────────────
// All colors are explicit hex/rgba — no Tailwind color classes — for html2canvas compatibility.
// Structure mirrors FeedCard back exactly: single p-3 container, View button inside.
export function CardBackFace({ ticket }: { ticket: Ticket }) {
  const { t, lang } = useLang();
  const td = (ticket as unknown) as Record<string, unknown>;
  const isPoster        = (td["cardTheme"] as string | undefined) === "poster";
  const isPrivateMemory = td["isPrivateMemory"] as boolean | undefined;
  const partySeat       = td["partySeatNumber"] as number | null | undefined;
  const specialColor    = td["specialColor"] as string | null | undefined;
  const specialColorCfg = getSpecialColorCfg(specialColor);

  // Colors match light-mode CSS variables (hardcoded for html2canvas compat)
  const memoryColor   = isPoster ? "rgba(28,28,28,0.6)"  : "#71717a";
  const metaIconColor = isPoster ? "rgba(28,28,28,0.35)" : "#d4d4d8";
  const metaTextColor = isPoster ? "rgba(28,28,28,0.55)" : "#a1a1aa";
  const viewBorder    = isPoster ? "rgba(28,28,28,0.12)" : "#e4e4e7";
  const viewColor     = isPoster ? "rgba(28,28,28,0.45)" : "#71717a";
  const lockColor     = isPoster ? "rgba(28,28,28,0.4)"  : "#d4d4d8";
  const emptyColor    = isPoster ? "rgba(28,28,28,0.8)"  : "#d4d4d8";

  return (
    <div
      className="absolute inset-0 overflow-hidden p-3 flex flex-col"
      style={{
        borderRadius: "inherit",
        background: isPoster ? POSTER_BG : "#ffffff",
        border: isPoster ? "none" : "1px solid #e4e4e7",
        boxShadow: isPoster ? "0 0 0 0.5px rgba(0,0,0,0.18)" : undefined,
      }}
    >
      {partySeat && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 20,
            height: 20,
            borderRadius: "50%",
            // Center the digit using line-height = box height instead of
            // flex/align-items. html2canvas + foreignObjectRendering can
            // mis-align flex baselines when exporting to PNG, causing the
            // number to drift upward in saved images. Setting lineHeight
            // equal to the height pins the glyph to the vertical center
            // identically in both the live DOM and the captured canvas.
            textAlign: "center",
            lineHeight: "20px",
            fontSize: 9,
            fontWeight: 900,
            zIndex: 10,
            padding: 0,
            ...(specialColorCfg
              ? { background: specialColorCfg.color, color: "#000" }
              : { background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }),
          }}
        >
          {partySeat}
        </div>
      )}

      {/* Memory note */}
      {isPrivateMemory && !ticket.memoryNote ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <Lock className="w-5 h-5" style={{ color: lockColor }} />
          <p style={{ fontSize: 10, fontStyle: "italic", textAlign: "center", color: metaTextColor }}>{t.privateMemory}</p>
        </div>
      ) : ticket.memoryNote ? (
        <p className="flex-1" style={{ fontSize: 11, lineHeight: 1.625, fontStyle: "italic", color: memoryColor, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", overflow: "hidden" }}>
          "{ticket.memoryNote}"
        </p>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ fontSize: 10, fontStyle: "italic", textAlign: "center", whiteSpace: "nowrap", color: emptyColor }}>{t.noMemoryYet}</p>
        </div>
      )}

      {/* Date / Location */}
      <div className="mt-auto mb-2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ticket.watchedAt && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <CalendarDays style={{ width: 12, height: 12, flexShrink: 0, color: metaIconColor }} />
            <span style={{ fontSize: 10, color: metaTextColor }}>
              {displayDate(ticket.watchedAt, lang, { month: "short", year: "numeric" })}
            </span>
          </div>
        )}
        {ticket.location && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin style={{ width: 12, height: 12, flexShrink: 0, color: metaIconColor }} />
            <span style={{ fontSize: 10, color: metaTextColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.location}</span>
          </div>
        )}
      </div>

      {/* Ticker footer — brand signature for saved/captured card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: 9,
          paddingBottom: 9,
          fontSize: 11,
          fontWeight: 700,
          borderTop: `1px solid ${viewBorder}`,
          color: viewColor,
          marginLeft: -12,
          marginRight: -12,
          marginBottom: -12,
        }}
      >
        Ticker
      </div>
    </div>
  );
}