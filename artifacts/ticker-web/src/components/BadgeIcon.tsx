import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { PopcornBadgeIcon } from "@/components/PopcornBadge";

// ── Badge metadata ────────────────────────────────────────────────────────────

export interface BadgeMeta {
  level: number; name: string; nameTH: string;
  mainColor: string; lightColor: string; darkColor: string;
  outlineColor: string; glowColor: string;
  description: string; descriptionTH: string;
}

const BADGE_META: Record<number, BadgeMeta> = {
  1: {
    // Soft silver-periwinkle — like the gray variant in the ref
    level: 1, name: "Viewer", nameTH: "คนดูหนัง",
    mainColor: "#a8bcd0", lightColor: "#dce8f2", darkColor: "#3c4e60",
    outlineColor: "#1a2840", glowColor: "rgba(168,188,208,0.80)",
    description: "Your first step.", descriptionTH: "ก้าวแรกสู่โลกหนัง",
  },
  2: {
    // Soft warm peach-gold — inviting warm tier
    level: 2, name: "Fan", nameTH: "แฟนหนัง",
    mainColor: "#e8a870", lightColor: "#f8dcc0", darkColor: "#884820",
    outlineColor: "#2c1808", glowColor: "rgba(232,168,112,0.80)",
    description: "Never miss a release.", descriptionTH: "ติดตามหนังไม่พลาด",
  },
  3: {
    // Soft mint-teal — like the teal variant in the ref
    level: 3, name: "Cinephile", nameTH: "ซีเนฟิล",
    mainColor: "#68c8b8", lightColor: "#b8ece4", darkColor: "#206858",
    outlineColor: "#082820", glowColor: "rgba(104,200,184,0.80)",
    description: "In love with film.", descriptionTH: "หลงรักศิลปะภาพยนตร์",
  },
  4: {
    // Soft lavender — dreamy, like lavender/purple variant in the ref
    level: 4, name: "Critic", nameTH: "นักวิจารณ์",
    mainColor: "#b888e0", lightColor: "#e4d0f8", darkColor: "#502880",
    outlineColor: "#1e0840", glowColor: "rgba(184,136,224,0.80)",
    description: "A trusted voice.", descriptionTH: "เสียงที่เชื่อถือได้",
  },
  5: {
    // Holographic pastel rainbow — like the main holographic ticket in the ref
    level: 5, name: "For Supporter", nameTH: "ผู้สนับสนุน",
    mainColor: "#c0b0e8", lightColor: "#eee8ff", darkColor: "#483070",
    outlineColor: "#1c0840", glowColor: "rgba(180,160,230,0.80)",
    description: "A true supporter.", descriptionTH: "ผู้สนับสนุน Ticker",
  },
};

// ── Ticket path ───────────────────────────────────────────────────────────────
// Triangular zigzag teeth (V-notches) on both short sides, mirroring the ref.
// nTeeth = number of V-notches per side. toothD = how deep each notch cuts in.
function ticketPath(W: number, H: number, cR: number, nTeeth: number): string {
  const sideH  = H - 2 * cR;
  const toothH = sideH / nTeeth;          // height of each tooth
  const toothD = toothH * 0.55;           // depth of notch into ticket

  // Right side going DOWN: valley cuts LEFT (inward)
  let rightDown = "";
  for (let i = 0; i < nTeeth; i++) {
    const midY  = cR + (i + 0.5) * toothH; // valley point
    const nextY = cR + (i + 1)   * toothH; // next peak
    rightDown += `L ${W - toothD} ${midY} L ${W} ${nextY} `;
  }

  // Left side going UP: valley cuts RIGHT (inward), perfectly mirroring right
  let leftUp = "";
  for (let i = nTeeth - 1; i >= 0; i--) {
    const midY = cR + (i + 0.5) * toothH;
    const topY = cR + i         * toothH;
    leftUp += `L ${toothD} ${midY} L ${0} ${topY} `;
  }

  return [
    `M ${cR} 0`,
    `L ${W - cR} 0`,
    `Q ${W} 0 ${W} ${cR}`,        // top-right corner
    rightDown.trim(),
    `Q ${W} ${H} ${W - cR} ${H}`, // bottom-right corner
    `L ${cR} ${H}`,
    `Q 0 ${H} 0 ${H - cR}`,       // bottom-left corner
    leftUp.trim(),
    `Q 0 0 ${cR} 0`,               // top-left corner
    "Z",
  ].join(" ");
}

// ── Gold star ─────────────────────────────────────────────────────────────────

function GoldStar({ cx, cy, ro, bodyGrad }: {
  cx: number; cy: number; ro: number; bodyGrad: string;
}) {
  const ri = ro * 0.42;
  const outerPts: [number, number][] = [];
  const shinePts: [number, number][] = [];

  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? ro : ri;
    outerPts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    // Upper-left shine: use 60% of outer radius for outer points, full inner
    if (i % 2 === 0) {
      shinePts.push([cx + ro * 0.55 * Math.cos(a), cy + ro * 0.55 * Math.sin(a)]);
    } else {
      shinePts.push([cx + ri * 0.8 * Math.cos(a), cy + ri * 0.8 * Math.sin(a)]);
    }
  }

  const poly      = outerPts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const shinePoly = shinePts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <g>
      {/* Body */}
      <polygon points={poly} fill={`url(#${bodyGrad})`}
        stroke="rgba(100,40,0,0.7)" strokeWidth={ro * 0.10} strokeLinejoin="round" />
      {/* Upper-left face shine */}
      <polygon points={shinePoly} fill="rgba(255,255,220,0.28)" />
    </g>
  );
}

// ── Stars row — size scales with count ───────────────────────────────────────

function StarsRow({
  count, cx, cy, availW, availH, bodyGrad,
}: {
  count: number; cx: number; cy: number;
  availW: number; availH: number; bodyGrad: string;
}) {
  const gapFrac = 0.35;
  const D       = (availW * 0.80) / (count + Math.max(0, count - 1) * gapFrac);
  const ro      = Math.min(D, availH * 0.82) / 2;
  const gap     = ro * 2 * (1 + gapFrac);
  const startX  = cx - ((count - 1) * gap) / 2;

  return (
    <g>
      {Array.from({ length: count }).map((_, i) => (
        <GoldStar key={i} cx={startX + i * gap} cy={cy} ro={ro} bodyGrad={bodyGrad} />
      ))}
    </g>
  );
}

// ── Rainbow gradient stops ────────────────────────────────────────────────────

// Soft pastel holographic — matches the Diamond Stream Ticket holo ref
function RainbowStops() {
  return (
    <>
      <stop offset="0%"   stopColor="#f0c8e0" />
      <stop offset="20%"  stopColor="#c8b8f0" />
      <stop offset="40%"  stopColor="#a0d0f4" />
      <stop offset="60%"  stopColor="#98e8d8" />
      <stop offset="80%"  stopColor="#f0e898" />
      <stop offset="100%" stopColor="#f4c8a8" />
    </>
  );
}

// ── Core ticket drawing function ──────────────────────────────────────────────

interface DrawProps {
  level: number;
  W: number; H: number; cR: number; nBumps: number;
  VW: number; VH: number; rot: number;
  uid: string;
}

function DrawTicket({ level, W, H, cR, nBumps, VW, VH, rot, uid }: DrawProps) {
  const meta      = BADGE_META[level];
  if (!meta) return null;
  const isRainbow = level === 5;

  const path  = ticketPath(W, H, cR, nBumps);
  const ox    = (VW - W) / 2;
  const oy    = (VH - H) / 2;
  const sw    = Math.max(0.8, W * 0.030); // outline stroke width

  // Star placement: center of ticket, avoiding bumped edges
  const bR       = (H - 2 * cR) / (2 * nBumps);
  const padX     = cR + bR * 0.5;
  const starAvailW = W - 2 * padX;
  const starAvailH = H * 0.60;

  return (
    <g transform={`translate(${ox} ${oy}) rotate(${rot} ${W / 2} ${H / 2})`}>
      <defs>
        {/* Body fill — soft 2-stop diagonal, light → main */}
        {isRainbow ? (
          <linearGradient id={`${uid}bg`} x1="0%" y1="0%" x2="100%" y2="100%">
            <RainbowStops />
          </linearGradient>
        ) : (
          <linearGradient id={`${uid}bg`} x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%"   stopColor={meta.lightColor} />
            <stop offset="100%" stopColor={meta.mainColor} />
          </linearGradient>
        )}

        {/* Top-left shine — large soft white glow like the ref */}
        <radialGradient id={`${uid}sh`} cx="25%" cy="25%" r="55%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.55)" />
          <stop offset="50%"  stopColor="rgba(255,255,255,0.12)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.00)" />
        </radialGradient>

        {/* Star gold gradient */}
        <linearGradient id={`${uid}sg`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%"   stopColor="#fff8b0" />
          <stop offset="40%"  stopColor="#ffd600" />
          <stop offset="100%" stopColor="#e65100" />
        </linearGradient>

        {/* Outer glow — no offset, colored halo */}
        <filter id={`${uid}glow`} x="-70%" y="-70%" width="240%" height="240%">
          <feDropShadow dx="0" dy="0"
            stdDeviation={W * 0.055}
            floodColor={meta.mainColor} floodOpacity="0.85" />
        </filter>
      </defs>

      {/* Colored outer glow */}
      <path d={path} fill={meta.mainColor} opacity="0.25" filter={`url(#${uid}glow)`} />

      {/* Ticket body */}
      <path d={path} fill={`url(#${uid}bg)`} />

      {/* Thick cartoon outline — theme-aware: dark in light mode, white in dark mode */}
      <path d={path} fill="none"
        stroke="var(--badge-outline-color)" strokeWidth={sw}
        strokeLinejoin="round" />

      {/* Top-left shine */}
      <path d={path} fill={`url(#${uid}sh)`} />

      {/* Stars */}
      <StarsRow
        count={level} cx={W / 2} cy={H / 2}
        availW={starAvailW} availH={starAvailH}
        bodyGrad={`${uid}sg`}
      />
    </g>
  );
}

// ── Small inline ticket ───────────────────────────────────────────────────────

// flat=true → horizontal (rot=0), used for inline display next to names
function TicketShape({ level, size = 16, flat = false }: { level: number; size?: number; flat?: boolean }) {
  const W = 40, H = 22, cR = 3.5, nBumps = 4;
  // flat: tight viewbox around ticket; tilted: extra room for rotation
  const VW = flat ? 48 : 58, VH = flat ? 30 : 58;
  // In flat mode, treat `size` as the rendered HEIGHT so it matches sibling
  // icons (e.g. VerifiedBadge is 14×14 → ticket height = 14 to align).
  const renderH = size;
  const renderW = flat ? Math.round(size * (VW / VH)) : size;

  return (
    <svg
      width={renderW} height={renderH}
      viewBox={`0 0 ${VW} ${VH}`}
      fill="none" xmlns="http://www.w3.org/2000/svg"
      className="inline-block flex-shrink-0"
      aria-label={`Badge Level ${level}`}
      overflow="visible"
    >
      <DrawTicket
        level={level} W={W} H={H} cR={cR} nBumps={nBumps}
        VW={VW} VH={VH} rot={flat ? 0 : -16} uid={`si${level}${flat ? "f" : ""}`}
      />
    </svg>
  );
}

// ── Large ticket (settings carousel) ─────────────────────────────────────────

function TicketLarge({ level }: { level: number }) {
  const W = 198, H = 108, cR = 12, nBumps = 4;
  const VW = 258, VH = 188;

  return (
    <svg
      width={VW} height={VH}
      viewBox={`0 0 ${VW} ${VH}`}
      fill="none" xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
    >
      <DrawTicket
        level={level} W={W} H={H} cR={cR} nBumps={nBumps}
        VW={VW} VH={VH} rot={-14} uid={`lg${level}`}
      />
    </svg>
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

// nudge: vertical pixel offset (positive = down, negative = up) applied only in flat mode.
// Default 1 nudges the badge down 1px for better inline text alignment.
interface BadgeIconProps { userId: string; size?: number; flat?: boolean; nudge?: number; className?: string; }

export function BadgeIcon({ userId, size = 14, flat = true, nudge = 0, className }: BadgeIconProps) {
  const { data } = useQuery({
    queryKey: ["badge-user", userId],
    queryFn: async () => {
      const res = await fetch(`/api/badges/user/${userId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ level: number; meta: BadgeMeta | null; isPageVerified?: boolean }>;
    },
    // Short staleTime + focus refetch so eye-toggle changes propagate to
    // other viewers in near-realtime (next render cycle on tab focus, or
    // ≤ 30 s while idle).
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    enabled: !!userId,
  });
  const level = data?.level ?? 0;
  const verified = data?.isPageVerified ?? false;
  if (!level && !verified) return null;
  // XOR: Popcorn IS a badge — never display alongside the Ticket badge.
  // Server enforces mutual exclusion via display toggles; if both somehow
  // come through, popcorn (page verification) takes precedence.
  //
  // Optical sizing: the popcorn artwork only fills ~71 % of its viewBox
  // (height 30 / 42), so at the same nominal `size` it reads MUCH smaller
  // than the Ticket shape (which fills ~73 % of its width).  Scale it up so
  // the bucket reads at the same visual weight next to a username.
  const POPCORN_OPTICAL_SCALE = 1.2;
  const renderSize = verified ? size * POPCORN_OPTICAL_SCALE : size;
  // Popcorn's tight viewBox places its visual center slightly below geometric
  // center (popped kernels reserve top padding). Lift it ~9 % of its render
  // size so it sits at the same optical baseline as a Ticket badge.
  const effectiveNudge = verified ? nudge - renderSize * 0.09 : nudge;
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={flat ? { transform: `translateY(${effectiveNudge}px)` } : undefined}
      aria-label={verified ? "Verified Page" : `Badge Level ${level}`}
    >
      {verified
        ? <PopcornBadgeIcon size={renderSize} flat={flat} />
        : <TicketShape level={level} size={size} flat={flat} />}
    </span>
  );
}

interface BadgeIconStaticProps { level: number; size?: number; flat?: boolean; nudge?: number; className?: string; }

export function BadgeIconStatic({ level, size = 14, flat = true, nudge = 0, className }: BadgeIconStaticProps) {
  if (!level) return null;
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={flat ? { transform: `translateY(${nudge}px)` } : undefined}
      aria-label={`Badge Level ${level}`}
    >
      <TicketShape level={level} size={size} flat={flat} />
    </span>
  );
}

export { TicketLarge };
