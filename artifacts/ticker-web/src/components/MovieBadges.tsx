import { TIER_VISUAL, EFFECT_CONFIG } from "@/lib/ranks";
import type { CardTier, EffectTag } from "@/lib/ranks";

// ── Descriptions ──────────────────────────────────────────────────
// Format ทุก badge: 3 บรรทัด
//   บรรทัด 1: ชื่อย่อ Badge
//   บรรทัด 2: คะแนน หรือ เงื่อนไข
//   บรรทัด 3: คำอธิบายสั้น
// ใช้ได้เฉพาะอักขระพิเศษ + - . (จุดเฉพาะทศนิยม)

export const BADGE_DESC_TH: Record<string, string> = {
  common:       "P\n1.0 - 5.0\nหนังต่ำกว่าค่าเฉลี่ย",
  uncommon:     "A\n5.1 - 6.5\nหนังธรรมดาทั่วไป",
  rare:         "G\n6.6 - 7.5\nหนังดี ดูแล้วคุ้ม",
  super_rare:   "EX\n7.6 - 8.2\nหนังเหนือค่าเฉลี่ย",
  ultra_rare:   "MP\n8.3 - 10.0\nหนังคุณภาพระดับเยี่ยม",
  legendary:    "LEGENDARY\nMP + อายุ 20+ ปี\nหนังระดับตำนาน",
  cult_classic: "CULT CLASSIC\nP + อายุ 20+ ปี\nโลกมองข้าม คอหนังจดจำ",
  N:   "N\nออกใหม่ภายใน 1 ปี\nคะแนนยังเปลี่ยนได้",
  FR:  "FR\nหนังมีภาคต่อ\nส่วนหนึ่งของแฟรนไชส์",
  FS:  "FS\nหนังเฉพาะกลุ่มแฟน\nชีวประวัติ ดนตรี สารคดี",
  LGC: "LGC\nอายุ 20+ ปี\nผ่านบททดสอบของเวลา",
};

export const BADGE_DESC_EN: Record<string, string> = {
  common:       "P\n1.0 - 5.0\nBelow average film",
  uncommon:     "A\n5.1 - 6.5\nAverage film",
  rare:         "G\n6.6 - 7.5\nGood and worth watching",
  super_rare:   "EX\n7.6 - 8.2\nClearly above average",
  ultra_rare:   "MP\n8.3 - 10.0\nOutstanding quality film",
  legendary:    "LEGENDARY\nMP + 20+ years old\nA true legend",
  cult_classic: "CULT CLASSIC\nP + 20+ years old\nOverlooked but unforgettable",
  N:   "N\nReleased within 1 year\nScore may still change",
  FR:  "FR\nHas sequels or prequels\nPart of a franchise",
  FS:  "FS\nFor a niche fanbase\nBiopics music documentaries",
  LGC: "LGC\n20+ years old\nStood the test of time",
};

// ── Pixel constants ────────────────────────────────────────────────

type BadgeSize   = "xs" | "sm" | "md";
type BadgeLayout = "row" | "col";

const PX: Record<BadgeSize, {
  side:    number;
  wideH:   number;
  widePad: number;
  font:    number;   // base font for 2-char labels
  radius:  number;
  gap:     number;
}> = {
  xs: { side: 15, wideH: 15, widePad: 5, font: 7,  radius: 3, gap: 4 },
  sm: { side: 18, wideH: 18, widePad: 6, font: 8,  radius: 4, gap: 4 },
  md: { side: 20, wideH: 20, widePad: 8, font: 9,  radius: 5, gap: 4 },
};

// Font size per label length — 3-char labels get 1px smaller so they don't crowd the edges
function labelFont(baseFont: number, label: string): number {
  if (label.length >= 3) return baseFont - 1;
  return baseFont;
}

const PAD = 3; // container padding (px) — same for col + row dark containers

// ── Props ─────────────────────────────────────────────────────────

interface MovieBadgesProps {
  tier:           CardTier;
  effects:        EffectTag[];
  size?:          BadgeSize;
  layout?:        BadgeLayout;
  asButton?:      boolean;
  onRankClick?:   () => void;
  onEffectClick?: (tag: EffectTag) => void;
  /**
   * Unified click handler — receives the badge key and its visual index in the
   * stack (0 = top, 1 = below it, etc.). Use this when the parent needs to
   * position a popup relative to the specific badge that was tapped.
   * Takes precedence over onRankClick / onEffectClick when provided.
   */
  onBadgeClick?:  (key: string, index: number) => void;
  className?:     string;
}

// ── Badge item descriptor ─────────────────────────────────────────

interface BadgeItem {
  key:      string;
  label:    string;
  colorCls: string;
  isWide:   boolean;
  onClick?: () => void;
}

// ── Single badge element ──────────────────────────────────────────

function BadgeEl({
  item,
  px,
  asButton,
  style,
}: {
  item:     BadgeItem;
  px:       typeof PX[BadgeSize];
  asButton: boolean;
  style:    React.CSSProperties;
}) {
  const fontSize = item.isWide ? px.font : labelFont(px.font, item.label);

  const baseStyle: React.CSSProperties = item.isWide
    ? {
        display:          "inline-flex",
        alignItems:       "center",
        justifyContent:   "center",
        height:           px.wideH,
        paddingLeft:      px.widePad,
        paddingRight:     px.widePad,
        borderRadius:     px.radius,
        fontSize,
        lineHeight:       "1",
        fontWeight:       900,
        letterSpacing:    "0.06em",
        whiteSpace:       "nowrap",
        overflow:         "hidden",
        userSelect:       "none",
        WebkitUserSelect: "none",
        ...style,
      }
    : {
        display:          "inline-flex",
        alignItems:       "center",
        justifyContent:   "center",
        width:            px.side,
        height:           px.side,
        borderRadius:     px.radius,
        fontSize,
        lineHeight:       "1",
        fontWeight:       900,
        letterSpacing:    "0.02em",
        overflow:         "hidden",
        userSelect:       "none",
        WebkitUserSelect: "none",
        ...style,
      };

  if (asButton && item.onClick) {
    return (
      <button
        type="button"
        className={item.colorCls}
        style={{ ...baseStyle, cursor: "pointer" }}
        onClick={item.onClick}
      >
        {item.label}
      </button>
    );
  }
  return (
    <span className={item.colorCls} style={baseStyle}>
      {item.label}
    </span>
  );
}

// ── MovieBadges ───────────────────────────────────────────────────

export function MovieBadges({
  tier,
  effects,
  size      = "sm",
  layout    = "col",
  asButton  = false,
  onRankClick,
  onEffectClick,
  onBadgeClick,
  className,
}: MovieBadgesProps) {
  const tv        = TIER_VISUAL[tier];
  const isSpecial = tier === "legendary" || tier === "cult_classic";
  const px        = PX[size];

  // Badge order: N first → tier → FR / FS / LGC
  const hasN    = !isSpecial && effects.includes("N");
  const otherFx = !isSpecial ? effects.filter((t) => t !== "N") : [];

  // Build raw key list first so we can compute each badge's visual index up-front
  const keys: string[] = [
    ...(hasN ? ["N"] : []),
    tier,
    ...otherFx,
  ];

  // Resolve onClick for a given key+index — onBadgeClick wins when provided
  const clickFor = (key: string, idx: number): (() => void) | undefined => {
    if (onBadgeClick) return () => onBadgeClick(key, idx);
    if (key === tier && onRankClick) return onRankClick;
    if (key !== tier && onEffectClick) return () => onEffectClick(key as EffectTag);
    return undefined;
  };

  const items: BadgeItem[] = keys.map((key, idx) => {
    if (key === tier) {
      return {
        key, label: tv.abbr, colorCls: tv.badge,
        isWide:  isSpecial,
        onClick: clickFor(key, idx),
      };
    }
    const cfg = EFFECT_CONFIG[key as EffectTag];
    return {
      key, label: cfg.label, colorCls: cfg.badge,
      isWide:  false,
      onClick: clickFor(key, idx),
    };
  });

  // ── Special (Legendary / Cult Classic) in col layout — wide badge + dark container ──
  // display:flex avoids inline formatting-context (no strut / line-height gap),
  // so the top spacing matches the col-layout dark container exactly.
  // Row layout falls through to the row handler below so the wide badge renders
  // inline inside the shared row dark container (not stretched full-width).
  if (isSpecial && layout === "col") {
    const item = items[0];
    return (
      <div
        className={className}
        style={{
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          padding:         PAD,
          backgroundColor: "rgba(0,0,0,0.55)",
          borderRadius:    px.radius + PAD,
        }}
      >
        <BadgeEl
          key={item.key}
          item={item}
          px={px}
          asButton={asButton}
          style={{}}
        />
      </div>
    );
  }

  // ── Column layout ──────────────────────────────────────────────────────────
  // Dark container + absolute positioning ensures gap is always a consistent
  // dark color regardless of poster background (no optical illusion).
  if (layout === "col") {
    const n      = items.length;
    const totalH = n * px.side + Math.max(0, n - 1) * px.gap;
    const totalW = px.side;

    return (
      <div
        className={className}
        style={{
          position:        "relative",
          width:           totalW + PAD * 2,
          height:          totalH + PAD * 2,
          backgroundColor: "rgba(0,0,0,0.55)",
          borderRadius:    px.radius + PAD,
        }}
      >
        {items.map((item, i) => (
          <BadgeEl
            key={item.key}
            item={item}
            px={px}
            asButton={asButton}
            style={{
              position: "absolute",
              top:      PAD + i * (px.side + px.gap),
              right:    PAD,
            }}
          />
        ))}
      </div>
    );
  }

  // ── Row layout — horizontal, with same dark container ─────────────────────
  return (
    <div
      className={className}
      style={{
        display:         "inline-flex",
        flexWrap:        "wrap",
        alignItems:      "center",
        gap:             px.gap,
        backgroundColor: "rgba(0,0,0,0.55)",
        borderRadius:    px.radius + PAD,
        padding:         PAD,
      }}
    >
      {items.map((item) => (
        <BadgeEl
          key={item.key}
          item={item}
          px={px}
          asButton={asButton}
          style={{}}
        />
      ))}
    </div>
  );
}
