/**
 * Server-side card renderer.
 *
 * Replaces the previous client-side html2canvas pipeline (which produced
 * inconsistent results on iOS due to WebKit rasterizer bugs) with a fully
 * deterministic Satori → SVG → PNG pipeline that runs on the API server.
 *
 * Output: a single PNG buffer containing both the front and back faces of
 * the card, side-by-side, exactly matching the layout in
 * `artifacts/ticker-web/src/components/CardFaceComponents.tsx`.
 *
 * The card is rendered at a 3× pixel density so the user-saved image stays
 * sharp on high-DPI screens / story uploads.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import React, { type JSX } from "react";

// ── Layout constants ─────────────────────────────────────────────────────────
// Match the SEED constants in ShareStoryModal.tsx so Satori output is
// pixel-equivalent (after the 3× scale) to the previous html2canvas output.
const SEED_W = 190;
const SEED_H = 285;
const GAP_W = 16;
const PAD_W = 20;
const SCALE = 3;

const PNG_W = (SEED_W * 2 + GAP_W + PAD_W * 2) * SCALE; // 1308
const PNG_H = (SEED_H + PAD_W * 2) * SCALE; //  975

// ── Theme constants (mirror CardFaceComponents.tsx) ─────────────────────────
const POSTER_BG = "#ccc9c3";
const POSTER_DARK = "#1c1c1c";

// ── Font loader (cached) ────────────────────────────────────────────────────
type SatoriFont = {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
};

let cachedFonts: SatoriFont[] | null = null;
const requireFromHere = createRequire(import.meta.url);

async function loadFontFile(pkg: string, file: string): Promise<Buffer> {
  // Resolve through node's resolver so pnpm hoisting / monorepo layout works
  // regardless of where the bundle is executed from.
  const pkgRoot = path.dirname(requireFromHere.resolve(`${pkg}/package.json`));
  return readFile(path.join(pkgRoot, "files", file));
}

export async function loadCardFonts(): Promise<SatoriFont[]> {
  if (cachedFonts) return cachedFonts;

  const [
    dmSans400,
    dmSans400Italic,
    dmSans700,
    dmSans900,
    spaceGrotesk700,
    notoThai400,
    notoThai700,
    notoThai900,
  ] = await Promise.all([
    loadFontFile("@fontsource/dm-sans", "dm-sans-latin-400-normal.woff"),
    loadFontFile("@fontsource/dm-sans", "dm-sans-latin-400-italic.woff"),
    loadFontFile("@fontsource/dm-sans", "dm-sans-latin-700-normal.woff"),
    loadFontFile("@fontsource/dm-sans", "dm-sans-latin-900-normal.woff"),
    loadFontFile(
      "@fontsource/space-grotesk",
      "space-grotesk-latin-700-normal.woff",
    ),
    loadFontFile(
      "@fontsource/noto-sans-thai",
      "noto-sans-thai-thai-400-normal.woff",
    ),
    loadFontFile(
      "@fontsource/noto-sans-thai",
      "noto-sans-thai-thai-700-normal.woff",
    ),
    loadFontFile(
      "@fontsource/noto-sans-thai",
      "noto-sans-thai-thai-900-normal.woff",
    ),
  ]);

  // @fontsource/noto-sans-thai ships only `normal` style (no real italic).
  // We register the same data ALSO under style: "italic" so Satori has a
  // glyph source when fontStyle: "italic" is requested on Thai text — without
  // this, italic Thai falls through to DM Sans (which has no Thai glyphs)
  // and the characters render as tofu / get dropped. Satori does not support
  // CSS transform so visual slanting is achieved through fontStyle only.
  cachedFonts = [
    { name: "DM Sans", data: dmSans400, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmSans400Italic, weight: 400, style: "italic" },
    { name: "DM Sans", data: dmSans700, weight: 700, style: "normal" },
    { name: "DM Sans", data: dmSans900, weight: 900, style: "normal" },
    {
      name: "Space Grotesk",
      data: spaceGrotesk700,
      weight: 700,
      style: "normal",
    },
    { name: "Noto Sans Thai", data: notoThai400, weight: 400, style: "normal" },
    { name: "Noto Sans Thai", data: notoThai400, weight: 400, style: "italic" },
    { name: "Noto Sans Thai", data: notoThai700, weight: 700, style: "normal" },
    { name: "Noto Sans Thai", data: notoThai700, weight: 700, style: "italic" },
    { name: "Noto Sans Thai", data: notoThai900, weight: 900, style: "normal" },
    { name: "Noto Sans Thai", data: notoThai900, weight: 900, style: "italic" },
  ];
  return cachedFonts;
}

// ── Image fetching (cached) ─────────────────────────────────────────────────
// Satori needs images as data URLs (or absolute http(s) URLs that it can
// fetch itself, but inline data URLs are deterministic and faster).
const imageCache = new Map<string, string | null>();

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url) ?? null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (TickerCardRenderer)" },
    });
    if (!res.ok) {
      imageCache.set(url, null);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUrl = `data:${contentType};base64,${buf.toString("base64")}`;
    imageCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    imageCache.set(url, null);
    return null;
  }
}

// ── Localization helpers (mirror artifacts/ticker-web/src/lib/i18n.tsx) ─────
type Lang = "th" | "en";

function displayYear(year: number | string | null | undefined, lang: Lang): string {
  if (year == null || year === "") return "";
  const y = typeof year === "string" ? parseInt(year, 10) : year;
  if (!y || Number.isNaN(y)) return String(year);
  return lang === "th" ? String(y + 543) : String(y);
}

function displayDate(d: string | Date | null | undefined, lang: Lang): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const locale = lang === "th" ? "th-TH-u-ca-buddhist" : "en-US";
  return date.toLocaleDateString(locale, { month: "short", year: "numeric" });
}

const STR = {
  th: {
    privateMemory: "ความทรงจำส่วนตัว",
    noMemoryYet: "ยังไม่มีความทรงจำ",
  },
  en: {
    privateMemory: "Private memory",
    noMemoryYet: "No memory yet",
  },
} as const;

// ── Genre localization (mirrors artifacts/ticker-web/src/lib/tmdb-genres.ts) ─
type GenreLabel = { th: string; en: string };

const MOVIE_GENRES: Record<number, GenreLabel> = {
  28:    { en: "Action",          th: "แอ็คชัน" },
  12:    { en: "Adventure",       th: "ผจญภัย" },
  16:    { en: "Animation",       th: "แอนิเมชัน" },
  35:    { en: "Comedy",          th: "ตลก" },
  80:    { en: "Crime",           th: "อาชญากรรม" },
  99:    { en: "Documentary",     th: "สารคดี" },
  18:    { en: "Drama",           th: "ดราม่า" },
  10751: { en: "Family",          th: "ครอบครัว" },
  14:    { en: "Fantasy",         th: "แฟนตาซี" },
  36:    { en: "History",         th: "ประวัติศาสตร์" },
  27:    { en: "Horror",          th: "สยองขวัญ" },
  10402: { en: "Music",           th: "เพลง" },
  9648:  { en: "Mystery",         th: "ลึกลับ" },
  10749: { en: "Romance",         th: "โรแมนติก" },
  878:   { en: "Science Fiction", th: "นิยายวิทยาศาสตร์" },
  10770: { en: "TV Movie",        th: "ภาพยนตร์โทรทัศน์" },
  53:    { en: "Thriller",        th: "ระทึกขวัญ" },
  10752: { en: "War",             th: "สงคราม" },
  37:    { en: "Western",         th: "ตะวันตก" },
};

const TV_GENRES: Record<number, GenreLabel> = {
  10759: { en: "Action & Adventure", th: "แอ็คชั่น & ผจญภัย" },
  16:    { en: "Animation",          th: "แอนิเมชัน" },
  35:    { en: "Comedy",             th: "ตลก" },
  80:    { en: "Crime",              th: "อาชญากรรม" },
  99:    { en: "Documentary",        th: "สารคดี" },
  18:    { en: "Drama",              th: "ดราม่า" },
  10751: { en: "Family",             th: "ครอบครัว" },
  10762: { en: "Kids",               th: "เด็ก" },
  9648:  { en: "Mystery",            th: "ลึกลับ" },
  10763: { en: "News",               th: "ข่าว" },
  10764: { en: "Reality",            th: "เรียลลิตี้" },
  10765: { en: "Sci-Fi & Fantasy",   th: "นิยายวิทยาศาสตร์ & แฟนตาซี" },
  10766: { en: "Soap",               th: "ละครชุด" },
  10767: { en: "Talk",               th: "รายการสนทนา" },
  10768: { en: "War & Politics",     th: "สงคราม & การเมือง" },
  37:    { en: "Western",            th: "ตะวันตก" },
};

function translateGenreName(name: string, lang: Lang): string | null {
  const n = name.toLowerCase();
  for (const map of [MOVIE_GENRES, TV_GENRES]) {
    for (const id in map) {
      const e = map[id as unknown as number];
      if (e.en.toLowerCase() === n || e.th === name) return e[lang];
    }
  }
  return null;
}

function localizeTicketGenre(ticket: RenderableTicket, lang: Lang): string {
  const isTv = typeof ticket.imdbId === "string" && ticket.imdbId.startsWith("tmdb_tv:");

  // Prefer TMDB genre IDs (language-independent) over the legacy `genre` string.
  const liveIds = ticket.movieLiveSnapshot?.genreIds ?? null;
  const snapIds = (() => {
    const raw = ticket.tmdbSnapshot;
    if (!raw) return null;
    if (typeof raw === "object" && raw !== null && "genreIds" in raw) {
      const v = (raw as { genreIds?: unknown }).genreIds;
      return Array.isArray(v) ? (v as number[]) : null;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as { genreIds?: number[] };
        return Array.isArray(parsed.genreIds) ? parsed.genreIds : null;
      } catch { return null; }
    }
    return null;
  })();

  const ids = liveIds ?? snapIds ?? [];
  if (ids.length > 0) {
    const map = isTv ? TV_GENRES : MOVIE_GENRES;
    const labels: string[] = [];
    for (const id of ids) {
      const entry = map[id] ?? MOVIE_GENRES[id] ?? TV_GENRES[id];
      if (entry) labels.push(entry[lang]);
    }
    if (labels.length > 0) return labels.join(", ");
  }

  // Legacy fallback — translate stored genre string parts.
  const stored = (ticket.genre ?? "").trim();
  if (!stored) return "";
  const parts = stored.split(/[,/]| & /).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => translateGenreName(p, lang) ?? p).join(", ");
}

// ── Ticket shape (subset we need) ───────────────────────────────────────────
export type RenderableTicket = {
  movieTitle: string;
  movieYear?: number | string | null;
  posterUrl?: string | null;
  genre?: string | null;
  rating?: number | null;
  watchedAt?: string | Date | null;
  location?: string | null;
  memoryNote?: string | null;
  user?: { username?: string | null } | null;

  // Extended fields stored on the ticket row (some are not in the public
  // generated Ticket type but are present at runtime via raw DB fields).
  cardTheme?: string | null;
  cardBackdropUrl?: string | null;
  cardBackdropOffsetX?: number | null;
  ratingType?: string | null;
  isPrivateMemory?: boolean | null;
  partySeatNumber?: number | null;

  // TMDB context used to localize the genre label client-/server-side.
  imdbId?: string | null;
  tmdbSnapshot?: { genreIds?: number[] | null } | string | null;
  movieLiveSnapshot?: { genreIds?: number[] | null } | null;
};

// ── Star icon (used for both empty-state and filled rating row) ─────────────
function StarPolygon({
  size,
  filled,
}: {
  size: number;
  filled: boolean;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill={filled ? "#fbbf24" : "#6b7280"}
      />
    </svg>
  );
}

function RatingBadge({
  rating,
  ratingType,
  size,
}: {
  rating: number;
  ratingType?: string | null;
  size: number;
}): JSX.Element {
  const filled = Math.min(Math.max(0, Math.round(rating)), 5);
  const filledColor = ratingType === "blackhole" ? "#22c55e" : "#fbbf24";
  const emptyColor = "#6b7280";
  const gap = size * 0.2;
  return (
    <div style={{ display: "flex", gap }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block" }}
        >
          <polygon
            points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
            fill={i <= filled ? filledColor : emptyColor}
          />
        </svg>
      ))}
    </div>
  );
}

// Inline lucide-style icons (Satori needs SVG, not the React lucide imports).
function LockIcon({ size, color }: { size: number; color: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CalendarIcon({ size, color }: { size: number; color: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </svg>
  );
}

function MapPinIcon({ size, color }: { size: number; color: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

// ── Front face: Classic ─────────────────────────────────────────────────────
function ClassicFront({
  ticket,
  imageDataUrl,
  lang,
}: {
  ticket: RenderableTicket;
  imageDataUrl: string | null;
  lang: Lang;
}): JSX.Element {
  const W = SEED_W * SCALE;
  const H = SEED_H * SCALE;
  const ratingType = ticket.ratingType ?? "star";
  const titleColor = "#ffffff";
  const username = ticket.user?.username ?? null;

  return (
    <div
      style={{
        position: "relative",
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        background: "#18181b",
        borderRadius: 12 * SCALE,
        overflow: "hidden",
      }}
    >
      {imageDataUrl ? (
        <img
          src={imageDataUrl}
          alt=""
          width={W}
          height={H}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            background: "#27272a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <StarPolygon size={32 * SCALE} filled={false} />
        </div>
      )}

      {/* gradient overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: H,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 55%)",
        }}
      />

      {/* rating badge */}
      {ticket.rating != null && (
        <div
          style={{
            position: "absolute",
            top: 8 * SCALE,
            right: 8 * SCALE,
            display: "flex",
          }}
        >
          <RatingBadge
            rating={ticket.rating}
            ratingType={ratingType}
            size={16 * SCALE}
          />
        </div>
      )}

      {/* bottom title block */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingLeft: 8 * SCALE,
          paddingRight: 8 * SCALE,
          paddingBottom: 24 * SCALE,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {(() => {
          const genreLabel = localizeTicketGenre(ticket, lang);
          if (!genreLabel) return null;
          return (
            <div
              style={{
                fontSize: 7 * SCALE,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color:
                  ticket.rating != null && ticket.rating >= 4
                    ? "#f59e0b"
                    : "rgba(255,255,255,0.55)",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontFamily: "DM Sans, Noto Sans Thai",
              }}
            >
              {genreLabel}
            </div>
          );
        })()}

        <div
          style={{
            fontSize: 13 * SCALE,
            fontWeight: 700,
            color: titleColor,
            lineHeight: 1.35,
            marginTop: 1 * SCALE,
            fontFamily: "Space Grotesk, DM Sans, Noto Sans Thai",
            overflow: "hidden",
            display: "block",
            // Single-line truncation: Satori supports lineClamp.
            lineClamp: 1,
          }}
        >
          {ticket.movieTitle}
        </div>

        {ticket.movieYear ? (
          <div
            style={{
              fontSize: 10 * SCALE,
              color: "rgba(255,255,255,0.55)",
              marginTop: 2 * SCALE,
              fontFamily: "DM Sans, Noto Sans Thai",
            }}
          >
            {displayYear(ticket.movieYear, lang)}
          </div>
        ) : null}
      </div>

      {/* @username pinned bottom-left */}
      {username ? (
        <div
          style={{
            position: "absolute",
            bottom: 12 * SCALE,
            left: 8 * SCALE,
            fontSize: 8 * SCALE,
            fontWeight: 600,
            lineHeight: 1,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "DM Sans, Noto Sans Thai",
          }}
        >
          {`@${username}`}
        </div>
      ) : null}
    </div>
  );
}

// ── Front face: Poster ──────────────────────────────────────────────────────
function PosterFront({
  ticket,
  imageDataUrl,
  lang,
}: {
  ticket: RenderableTicket;
  imageDataUrl: string | null;
  lang: Lang;
}): JSX.Element {
  const W = SEED_W * SCALE;
  const H = SEED_H * SCALE;
  const ratingType = ticket.ratingType ?? "star";
  const offsetX = ticket.cardBackdropOffsetX ?? 50;
  const username = ticket.user?.username ?? null;

  // Image area is a square sitting at the top with 5px padding on the sides
  // and top, matching the original CSS aspect-ratio: 1/1 + padding: 5px 5px 0.
  const imgPad = 5 * SCALE;
  const imgSize = W - imgPad * 2;

  return (
    <div
      style={{
        position: "relative",
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        background: POSTER_BG,
        overflow: "hidden",
      }}
    >
      {/* Image area */}
      <div
        style={{
          width: W,
          paddingLeft: imgPad,
          paddingRight: imgPad,
          paddingTop: imgPad,
          display: "flex",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            width: imgSize,
            height: imgSize,
            overflow: "hidden",
            display: "flex",
          }}
        >
          {imageDataUrl ? (
            <img
              src={imageDataUrl}
              alt=""
              width={imgSize}
              height={imgSize}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: imgSize,
                height: imgSize,
                objectFit: "cover",
                objectPosition: `${offsetX}% center`,
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: imgSize,
                height: imgSize,
                background: "#b8b4ae",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StarPolygon size={20 * SCALE} filled={false} />
            </div>
          )}

          {ticket.rating != null ? (
            <div
              style={{
                position: "absolute",
                top: 3 * SCALE,
                right: 3 * SCALE,
                display: "flex",
              }}
            >
              <RatingBadge
                rating={ticket.rating}
                ratingType={ratingType}
                size={16 * SCALE}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Title block */}
      <div
        style={{
          paddingLeft: 8 * SCALE,
          paddingRight: 8 * SCALE,
          paddingTop: 5 * SCALE,
          paddingBottom: 24 * SCALE,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11.5 * SCALE,
            fontWeight: 900,
            textTransform: "uppercase",
            // CSS spec: -0.01em ≈ -0.115px relative to a 11.5px font.
            // The PNG is 3× scaled, so the value must scale too: -0.115 * SCALE.
            letterSpacing: -0.115 * SCALE,
            lineHeight: 1.45,
            color: POSTER_DARK,
            display: "block",
            overflow: "hidden",
            fontFamily: "DM Sans, Noto Sans Thai",
            lineClamp: 2,
          }}
        >
          {ticket.movieTitle}
        </div>
        {ticket.movieYear ? (
          <div
            style={{
              fontSize: 8 * SCALE,
              fontWeight: 700,
              color: POSTER_DARK,
              opacity: 0.58,
              letterSpacing: 0.16,
              marginTop: 2 * SCALE,
              fontFamily: "DM Sans, Noto Sans Thai",
            }}
          >
            {displayYear(ticket.movieYear, lang)}
          </div>
        ) : null}
      </div>

      {username ? (
        <div
          style={{
            position: "absolute",
            bottom: 12 * SCALE,
            left: 8 * SCALE,
            fontSize: 8 * SCALE,
            fontWeight: 600,
            lineHeight: 1,
            color: POSTER_DARK,
            opacity: 0.38,
            fontFamily: "DM Sans, Noto Sans Thai",
          }}
        >
          {`@${username}`}
        </div>
      ) : null}
    </div>
  );
}

// ── Card back face ──────────────────────────────────────────────────────────
function CardBack({
  ticket,
  lang,
}: {
  ticket: RenderableTicket;
  lang: Lang;
}): JSX.Element {
  const W = SEED_W * SCALE;
  const H = SEED_H * SCALE;
  const isPoster = ticket.cardTheme === "poster";
  const t = STR[lang];

  const memoryColor = isPoster ? "rgba(28,28,28,0.6)" : "#71717a";
  const metaIconColor = isPoster ? "rgba(28,28,28,0.35)" : "#d4d4d8";
  const metaTextColor = isPoster ? "rgba(28,28,28,0.55)" : "#a1a1aa";
  const viewBorder = isPoster ? "rgba(28,28,28,0.12)" : "#e4e4e7";
  const viewColor = isPoster ? "rgba(28,28,28,0.45)" : "#71717a";
  const lockColor = isPoster ? "rgba(28,28,28,0.4)" : "#d4d4d8";
  const emptyColor = isPoster ? "rgba(28,28,28,0.8)" : "#d4d4d8";

  const pad = 12 * SCALE;
  const innerW = W - pad * 2;

  // Footer occupies the full width of the card; its top-border doubles as the
  // separator under the date/location block.
  const footerH = (9 + 9 + 11) * SCALE; // padding + line height
  const partySeat = ticket.partySeatNumber;

  // Decide what goes in the memory area
  const hasMemory = !!ticket.memoryNote;
  const showLocked = ticket.isPrivateMemory && !hasMemory;

  return (
    <div
      style={{
        position: "relative",
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        background: isPoster ? POSTER_BG : "#ffffff",
        overflow: "hidden",
        // Border follows the card's rounded corners (borderRadius clips it cleanly).
        // Using real border properties instead of inset box-shadow because Satori
        // does not support inset shadows — it would throw a 500 error.
        borderRadius: isPoster ? 0 : 12 * SCALE,
        borderWidth: isPoster ? 2 : 3,
        borderStyle: "solid",
        borderColor: isPoster ? "rgba(0,0,0,0.18)" : "#e4e4e7",
      }}
    >
      {/* party seat badge */}
      {partySeat ? (
        <div
          style={{
            position: "absolute",
            top: 8 * SCALE,
            right: 8 * SCALE,
            width: 20 * SCALE,
            height: 20 * SCALE,
            borderRadius: 10 * SCALE,
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 9 * SCALE,
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "DM Sans, Noto Sans Thai",
          }}
        >
          {partySeat}
        </div>
      ) : null}

      {/* Memory area */}
      <div
        style={{
          paddingLeft: pad,
          paddingRight: pad,
          paddingTop: pad,
          width: W,
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: showLocked || !hasMemory ? "center" : "stretch",
          justifyContent: showLocked || !hasMemory ? "center" : "flex-start",
          overflow: "hidden",
        }}
      >
        {showLocked ? (
          <>
            <LockIcon size={20 * SCALE} color={lockColor} />
            <div
              style={{
                fontSize: 10 * SCALE,
                fontStyle: "italic",
                color: metaTextColor,
                marginTop: 4 * SCALE,
                textAlign: "center",
                fontFamily: "DM Sans, Noto Sans Thai",
              }}
            >
              {t.privateMemory}
            </div>
          </>
        ) : hasMemory ? (
          <div style={{ width: innerW, overflow: "hidden" }}>
            <div
              style={{
                fontSize: 11 * SCALE,
                fontWeight: 400,
                lineHeight: 1.625,
                fontStyle: "italic",
                color: memoryColor,
                fontFamily: "DM Sans, Noto Sans Thai",
                display: "block",
                lineClamp: 6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "break-word",

              }}
            >
              {`"${ticket.memoryNote}"`}
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 10 * SCALE,
              fontStyle: "italic",
              color: emptyColor,
              fontFamily: "DM Sans, Noto Sans Thai",
            }}
          >
            {t.noMemoryYet}
          </div>
        )}
      </div>

      {/* Date / Location */}
      <div
        style={{
          paddingLeft: pad,
          paddingRight: pad,
          paddingBottom: 8 * SCALE,
          display: "flex",
          flexDirection: "column",
          gap: 4 * SCALE,
          flexShrink: 0,
        }}
      >
        {ticket.watchedAt ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4 * SCALE,
            }}
          >
            <CalendarIcon size={12 * SCALE} color={metaIconColor} />
            <div
              style={{
                fontSize: 10 * SCALE,
                color: metaTextColor,
                fontFamily: "DM Sans, Noto Sans Thai",
              }}
            >
              {displayDate(ticket.watchedAt, lang)}
            </div>
          </div>
        ) : null}
        {ticket.location ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4 * SCALE,
            }}
          >
            <MapPinIcon size={12 * SCALE} color={metaIconColor} />
            <div
              style={{
                fontSize: 10 * SCALE,
                color: metaTextColor,
                fontFamily: "DM Sans, Noto Sans Thai",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                maxWidth: innerW - 12 * SCALE - 4 * SCALE,
              }}
            >
              {ticket.location}
            </div>
          </div>
        ) : null}
      </div>

      {/* Ticker footer */}
      <div
        style={{
          width: W,
          height: footerH,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11 * SCALE,
          fontWeight: 700,
          color: viewColor,
          borderTopWidth: 1,
          borderTopStyle: "solid",
          borderTopColor: viewBorder,
          fontFamily: "Space Grotesk, DM Sans",
          flexShrink: 0,
        }}
      >
        Ticker
      </div>
    </div>
  );
}

// ── Top-level layout (front + back side by side) ────────────────────────────
function CardSheet({
  ticket,
  imageDataUrl,
  lang,
}: {
  ticket: RenderableTicket;
  imageDataUrl: string | null;
  lang: Lang;
}): JSX.Element {
  const isPoster = ticket.cardTheme === "poster";
  const radius = isPoster ? 0 : 12 * SCALE;

  const cardWrap: React.CSSProperties = {
    width: SEED_W * SCALE,
    height: SEED_H * SCALE,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: radius,
    display: "flex",
    position: "relative",
  };

  return (
    <div
      style={{
        width: PNG_W,
        height: PNG_H,
        padding: PAD_W * SCALE,
        display: "flex",
        flexDirection: "row",
        gap: GAP_W * SCALE,
        alignItems: "flex-start",
        background: "rgba(0,0,0,0)",
      }}
    >
      <div style={cardWrap}>
        {isPoster ? (
          <PosterFront ticket={ticket} imageDataUrl={imageDataUrl} lang={lang} />
        ) : (
          <ClassicFront ticket={ticket} imageDataUrl={imageDataUrl} lang={lang} />
        )}
      </div>
      <div style={cardWrap}>
        <CardBack ticket={ticket} lang={lang} />
      </div>
    </div>
  );
}

// ── Public render entry point ───────────────────────────────────────────────
export async function renderTicketCardPng(
  ticket: RenderableTicket,
  opts: { lang?: Lang } = {},
): Promise<Buffer> {
  const lang: Lang = opts.lang === "th" ? "th" : "en";

  // Pick the correct image source (poster cards use cardBackdropUrl when set)
  const isPoster = ticket.cardTheme === "poster";
  const rawImageUrl = isPoster
    ? ticket.cardBackdropUrl ?? ticket.posterUrl ?? null
    : ticket.posterUrl ?? null;

  const [fonts, imageDataUrl] = await Promise.all([
    loadCardFonts(),
    rawImageUrl ? fetchImageAsDataUrl(rawImageUrl) : Promise.resolve(null),
  ]);


  const svg = await satori(
    <CardSheet ticket={ticket} imageDataUrl={imageDataUrl} lang={lang} />,
    {
      width: PNG_W,
      height: PNG_H,
      fonts,
    },
  );

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: PNG_W },
    background: "rgba(0, 0, 0, 0)",
  })
    .render()
    .asPng();

  return Buffer.from(png);
}
