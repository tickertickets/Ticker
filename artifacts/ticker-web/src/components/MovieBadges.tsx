import { TIER_VISUAL, EFFECT_CONFIG } from "@/lib/ranks";
import type { CardTier, EffectTag } from "@/lib/ranks";

// ── Descriptions ──────────────────────────────────────────────────

export const BADGE_DESC_TH: Record<string, string> = {
  legendary:    "LEGENDARY\nMP + อายุ 20+ ปี\nระดับตำนาน ผ่านการพิสูจน์จากเวลา",
  cult_classic: "CULT CLASSIC\nP + อายุ 20+ ปี\nโลกมองข้าม แต่คอหนังไม่มีวันลืม",
  ultra_rare:   "Masterpiece · 8.3–10.0\nหนังคุณภาพสูงสุด ได้รับการยอมรับอย่างล้นหลาม",
  super_rare:   "Excellent · 7.6–8.2\nหนังดีมาก เหนือค่าเฉลี่ยอย่างชัดเจน",
  rare:         "Good · 6.6–7.5\nหนังดี คุณภาพแน่นอน ดูแล้วไม่เสียดาย",
  uncommon:     "Average · 5.1–6.5\nหนังธรรมดา ไม่แย่ แต่ไม่โดดเด่น",
  common:       "Poor · 1.0–5.0\nหนังทั่วไป ต่ำกว่าค่าเฉลี่ย",
  N:   "New · ออกใหม่ภายใน 1 ปี\nคะแนนยังอาจเปลี่ยนแปลงได้",
  FR:  "Franchise · ภาพยนตร์ในแฟรนไชส์ต่อเนื่อง",
  FS:  "Fan Service · ชีวประวัติ, หนังดนตรี\nหรือสารคดีสำหรับกลุ่มแฟนโดยเฉพาะ",
  LGC: "Legacy · อายุ 20+ ปี",
};

export const BADGE_DESC_EN: Record<string, string> = {
  legendary:    "LEGENDARY\nMP + 20+ years old\nProven by time — a true legend",
  cult_classic: "CULT CLASSIC\nP + 20+ years old\nOverlooked, but never forgotten",
  ultra_rare:   "Masterpiece · 8.3–10.0\nOutstanding film with exceptional acclaim",
  super_rare:   "Excellent · 7.6–8.2\nClearly above average — very strong",
  rare:         "Good · 6.6–7.5\nSolid film, well worth your time",
  uncommon:     "Average · 5.1–6.5\nAverage — nothing remarkable",
  common:       "Poor · 1.0–5.0\nBelow-average film",
  N:   "New · Released within the past year\nScore may still change",
  FR:  "Franchise · Part of a continuing franchise",
  FS:  "Fan Service · Biopics, music films,\nor niche documentaries",
  LGC: "Legacy · 20+ years old",
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
  className,
}: MovieBadgesProps) {
  const tv        = TIER_VISUAL[tier];
  const isSpecial = tier === "legendary" || tier === "cult_classic";
  const px        = PX[size];

  // Badge order: N first → tier → FR / FS / LGC
  const hasN    = !isSpecial && effects.includes("N");
  const otherFx = !isSpecial ? effects.filter((t) => t !== "N") : [];

  const items: BadgeItem[] = [
    ...(hasN ? [{
      key: "N", label: EFFECT_CONFIG.N.label, colorCls: EFFECT_CONFIG.N.badge,
      isWide: false,
      onClick: onEffectClick ? () => onEffectClick("N") : undefined,
    }] : []),
    {
      key: tier, label: tv.abbr, colorCls: tv.badge,
      isWide: isSpecial,
      onClick: onRankClick,
    },
    ...otherFx.map((tag) => ({
      key: tag, label: EFFECT_CONFIG[tag].label, colorCls: EFFECT_CONFIG[tag].badge,
      isWide: false,
      onClick: onEffectClick ? () => onEffectClick(tag) : undefined,
    })),
  ];

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
