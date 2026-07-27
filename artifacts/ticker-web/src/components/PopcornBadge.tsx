import { useQuery } from "@tanstack/react-query";

// ── Gold star (matches BadgeIcon ticket stars) ───────────────────────────────

function GoldStar({ cx, cy, ro, gradId }: { cx: number; cy: number; ro: number; gradId: string }) {
  const ri = ro * 0.42;
  const outerPts: [number, number][] = [];
  const shinePts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? ro : ri;
    outerPts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    if (i % 2 === 0) {
      shinePts.push([cx + ro * 0.55 * Math.cos(a), cy + ro * 0.55 * Math.sin(a)]);
    } else {
      shinePts.push([cx + ri * 0.8 * Math.cos(a), cy + ri * 0.8 * Math.sin(a)]);
    }
  }
  const poly = outerPts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const shine = shinePts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <g>
      <polygon
        points={poly}
        fill={`url(#${gradId})`}
        stroke="rgba(100,40,0,0.78)"
        strokeWidth={ro * 0.10}
        strokeLinejoin="round"
      />
      <polygon points={shine} fill="rgba(255,255,220,0.32)" />
    </g>
  );
}

// ── Core popcorn-bucket drawing ──────────────────────────────────────────────

interface DrawProps {
  W: number;        // bucket top width (rim)
  H: number;        // bucket body height (rim → bottom)
  VW: number; VH: number;
  rot: number;
  uid: string;
  showLabel: boolean;
}

function DrawPopcorn({ W, H, VW, VH, rot, uid, showLabel }: DrawProps) {
  const taper = W * 0.16; // bottom narrower than top
  const ox = (VW - W) / 2;
  // Reserve top space for popcorn that peeks above the rim
  const overflow = H * 0.30;
  const oy = (VH - H - overflow) / 2 + overflow;
  // Match Badge ตั๋ว: ticket uses Math.max(0.8, W*0.030) with W=40 → ~1.2.
  // Popcorn W=28, so use a higher multiplier to land at the same ~1.2 absolute.
  const sw = Math.max(1.1, W * 0.042);

  // Bucket trapezoid — rim at y=0, bottom at y=H
  const x0 = 0, x1 = W;
  const y0 = 0, y1 = H;
  const bottomCurve = H * 0.05;
  const bucketPath = [
    `M ${x0} ${y0}`,
    `L ${x1} ${y0}`,
    `L ${x1 - taper} ${y1}`,
    `Q ${W / 2} ${y1 + bottomCurve} ${x0 + taper} ${y1}`,
    "Z",
  ].join(" ");

  // Vertical red stripes (5 bands, half-coverage, follow taper)
  const stripes = 5;
  const stripeBand = W / stripes;
  const stripeWidth = stripeBand * 0.5;
  const k = 1 - taper / W;

  // Popcorn (gold stars) — stars whose centers straddle the rim line.
  // The bottom halves are CLIPPED by the bucket so each star looks like
  // a real popcorn piece poking out of the bucket.
  const starR = Math.min(H * 0.20, W * 0.22);
  type S = { x: number; y: number; r: number };
  // y is in absolute units; rim is y=0, positive = inside bucket interior
  const backRow: S[] = [
    { x: W * 0.24, y: -H * 0.08, r: starR * 0.85 },
    { x: W * 0.50, y: -H * 0.18, r: starR * 1.00 }, // tallest, center back
    { x: W * 0.76, y: -H * 0.08, r: starR * 0.85 },
  ];
  const frontRow: S[] = [
    { x: W * 0.10, y:  H * 0.02, r: starR * 0.85 },
    { x: W * 0.34, y: -H * 0.04, r: starR * 0.95 },
    { x: W * 0.66, y: -H * 0.04, r: starR * 0.95 },
    { x: W * 0.90, y:  H * 0.02, r: starR * 0.80 },
  ];

  // Oval label on the bucket
  const labelCx = W / 2 - taper * 0.04;
  const labelCy = H * 0.46;
  const labelRx = W * 0.34;
  const labelRy = H * 0.18;

  return (
    <g transform={`translate(${ox} ${oy}) rotate(${rot} ${W / 2} ${H / 2})`}>
      <defs>
        {/* Cream background of the bucket (white with warm tint) */}
        <linearGradient id={`${uid}wht`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#fff7e6" />
          <stop offset="100%" stopColor="#f3e2c0" />
        </linearGradient>

        {/* Red stripes */}
        <linearGradient id={`${uid}red`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ff4d4d" />
          <stop offset="55%" stopColor="#e02424" />
          <stop offset="100%" stopColor="#a91515" />
        </linearGradient>

        {/* Star gold (matches ticket badge) */}
        <linearGradient id={`${uid}sg`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#fff8b0" />
          <stop offset="40%" stopColor="#ffd600" />
          <stop offset="100%" stopColor="#e65100" />
        </linearGradient>

        {/* Slightly darker gold for back-row depth */}
        <linearGradient id={`${uid}sg2`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#ffe680" />
          <stop offset="40%" stopColor="#f0a800" />
          <stop offset="100%" stopColor="#b34500" />
        </linearGradient>

        {/* Cream label */}
        <linearGradient id={`${uid}lbl`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fff6c2" />
          <stop offset="100%" stopColor="#f5d97b" />
        </linearGradient>

        {/* Outer red glow */}
        <filter id={`${uid}glow`} x="-70%" y="-70%" width="240%" height="240%">
          <feDropShadow dx="0" dy="0" stdDeviation={W * 0.05} floodColor="#ef4444" floodOpacity="0.55" />
        </filter>

        {/* Clip stripes inside the bucket */}
        <clipPath id={`${uid}clip`}>
          <path d={bucketPath} />
        </clipPath>

        {/* Inner shadow at rim — gives stars a pocket */}
        <linearGradient id={`${uid}shd`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.40)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>

        {/* Star clip — only the portion ABOVE the rim line is visible.
            The lower part is cut off by the bucket lip → stars look
            like popcorn pieces sticking out of the bucket. */}
        <clipPath id={`${uid}sclip`}>
          <rect x={-W} y={-H * 2} width={W * 3} height={H * 2} />
        </clipPath>
      </defs>

      {/* Outer glow */}
      <path d={bucketPath} fill="#ef4444" opacity="0.22" filter={`url(#${uid}glow)`} />

      {/* Bucket body (cream) */}
      <path d={bucketPath} fill={`url(#${uid}wht)`} />

      {/* Vertical red stripes, clipped to bucket trapezoid */}
      <g clipPath={`url(#${uid}clip)`}>
        {Array.from({ length: stripes }).map((_, i) => {
          const cx = stripeBand * (i + 0.5);
          const topX = cx - stripeWidth / 2;
          const topX2 = cx + stripeWidth / 2;
          const botCx = W / 2 + (cx - W / 2) * k;
          const botX = botCx - (stripeWidth / 2) * k;
          const botX2 = botCx + (stripeWidth / 2) * k;
          return (
            <path
              key={i}
              d={`M ${topX} ${y0} L ${topX2} ${y0} L ${botX2} ${y1 + bottomCurve} L ${botX} ${y1 + bottomCurve} Z`}
              fill={`url(#${uid}red)`}
            />
          );
        })}

        {/* Inner shadow strip just below the rim — gives popcorn depth */}
        <rect x={0} y={0} width={W} height={H * 0.18} fill={`url(#${uid}shd)`} />
      </g>

      {/* Bucket outline (over stripes) */}
      <path
        d={bucketPath}
        fill="none"
        stroke="var(--badge-outline-color)"
        strokeWidth={sw}
        strokeLinejoin="round"
      />

      {/* Oval label */}
      <ellipse
        cx={labelCx}
        cy={labelCy}
        rx={labelRx}
        ry={labelRy}
        fill={`url(#${uid}lbl)`}
        stroke="#b91c1c"
        strokeWidth={sw * 0.65}
      />
      {showLabel && (
        <text
          x={labelCx}
          y={labelCy + H * 0.015}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontWeight="900"
          fontSize={H * 0.16}
          fill="#b91c1c"
          letterSpacing="-0.3"
        >
          Ticker
        </text>
      )}

      {/* Popcorn pile — clipped by the bucket rim so the bottom of each star
          is hidden, making it look like a real popcorn piece in the bucket. */}
      <g clipPath={`url(#${uid}sclip)`}>
        {backRow.map((s, i) => (
          <GoldStar key={`b${i}`} cx={s.x} cy={s.y} ro={s.r} gradId={`${uid}sg2`} />
        ))}
        {frontRow.map((s, i) => (
          <GoldStar key={`f${i}`} cx={s.x} cy={s.y} ro={s.r} gradId={`${uid}sg`} />
        ))}
      </g>
    </g>
  );
}

// ── Inline (flat) popcorn icon — used next to usernames ──────────────────────

interface PopcornBadgeIconProps {
  size?: number;
  flat?: boolean;
  className?: string;
  title?: string;
}

export function PopcornBadgeIcon({ size = 14, flat = true, className = "", title }: PopcornBadgeIconProps) {
  // Bucket dimensions:
  //  • flat mode → keep the bucket's NATURAL aspect (taller than wide). We tighten
  //    the viewBox snug around bucket + popped kernels so renderH = pixel height
  //    of the bucket — visually matching a Badge ตั๋ว of the same `size` prop
  //    without stretching.  Ticket renders at ~73 % of its viewBox height; we
  //    aim for the bucket to render at ~71 % of its viewBox height (30/42).
  //  • tilted (carousel) mode → original generous viewBox for the dramatic angle.
  const W = 28;
  const H = 30;
  const VW = flat ? 30 : 56;
  const VH = flat ? 42 : 64;

  // In flat mode, treat `size` as line height; preserve aspect ratio
  const renderH = size;
  const renderW = flat ? Math.round(size * (VW / VH)) : size;
  const showLabel = size >= 40;

  return (
    <svg
      width={renderW}
      height={renderH}
      viewBox={`0 0 ${VW} ${VH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block flex-shrink-0 ${className}`}
      aria-label={title ?? "Verified Page"}
      overflow="visible"
    >
      <title>{title ?? "Verified Page"}</title>
      <DrawPopcorn
        W={W} H={H} VW={VW} VH={VH}
        rot={flat ? 0 : 32}
        uid={`pc${flat ? "f" : "t"}`}
        showLabel={showLabel}
      />
    </svg>
  );
}

// ── Large popcorn (badge collection card) ────────────────────────────────────

export function PopcornLarge() {
  const W = 150, H = 162;
  const VW = 240, VH = 230;
  return (
    <svg
      width={VW} height={VH}
      viewBox={`0 0 ${VW} ${VH}`}
      fill="none" xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
    >
      <DrawPopcorn W={W} H={H} VW={VW} VH={VH} rot={32} uid="pclg" showLabel />
    </svg>
  );
}

// ── Hook variant — fetches verification state and renders nothing if not set ─

export function PopcornBadge({
  userId,
  size = 14,
  flat = true,
  className = "",
}: {
  userId: string;
  size?: number;
  flat?: boolean;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["badge-user", userId],
    queryFn: async () => {
      const res = await fetch(`/api/badges/user/${userId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ level: number; isPageVerified?: boolean }>;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
  });
  if (!data?.isPageVerified) return null;
  return <PopcornBadgeIcon size={size} flat={flat} className={className} />;
}
