/**
 * OG (Open Graph) meta-tag endpoints
 * Serve minimal HTML with OG meta tags for social-media link previews.
 * Browsers are immediately redirected to the SPA via <meta http-equiv="refresh">.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { eq, isNull, and, asc } from "drizzle-orm";
import { ticketsTable, usersTable, chainsTable, chainMoviesTable, moviesTable } from "@workspace/db/schema";
import { asyncHandler } from "../middlewares/error-handler";

const router = Router();

const APP_URL = process.env["APP_URL"] ?? "https://ticker-tickets.vercel.app";
const SITE_NAME = "Ticker";
// Use icon-512.png as fallback — og-default.png may not exist in every deployment
const DEFAULT_IMAGE = `${APP_URL}/icon-512.png`;

function renderOgHtml({
  title,
  description,
  image,
  redirectTo,
  browserRedirectTo,
  type = "website",
  bodyContent,
}: {
  title: string;
  description: string;
  image: string;
  redirectTo: string;
  /** URL the browser is sent to after reading OG tags.
   *  Defaults to redirectTo but should include ?_r=1 when this endpoint
   *  is reached via a Vercel rewrite (to break the redirect loop). */
  browserRedirectTo?: string;
  type?: string;
  /** Optional rich text body for SEO — visible to crawlers that index this page directly */
  bodyContent?: string;
}) {
  const redir = browserRedirectTo ?? redirectTo;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:url" content="${esc(redirectTo)}" />
<meta property="og:type" content="${esc(type)}" />
<meta property="og:site_name" content="${esc(SITE_NAME)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<link rel="canonical" href="${esc(redirectTo)}" />
<meta http-equiv="refresh" content="1;url=${esc(redir)}" />
<style>body{font-family:sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#111}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#444;margin:.5rem 0}ul{padding-left:1.2rem;color:#333}a.cta{display:inline-block;margin-top:1rem;background:#111;color:#fff;padding:.6rem 1.2rem;border-radius:8px;text-decoration:none}</style>
</head>
<body>
<script>window.location.replace(${JSON.stringify(redir)});</script>
${bodyContent ?? `<p>Redirecting to <a href="${esc(redir)}">${esc(title)}</a>…</p>`}
</body>
</html>`;
}

const OG_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=60, s-maxage=300",
} as const;

const fallbackOg = (redirectTo: string) =>
  renderOgHtml({ title: SITE_NAME, description: "Every film you watch deserves a Ticket.", image: DEFAULT_IMAGE, redirectTo });

// GET /api/og/ticket/:id
router.get("/ticket/:id", async (req, res) => {
  const id = String(req.params["id"]);
  const redirectTo = `${APP_URL}/ticket/${id}`;
  try {
    const [ticket] = await db
      .select({
        id: ticketsTable.id,
        movieTitle: ticketsTable.movieTitle,
        movieYear: ticketsTable.movieYear,
        posterUrl: ticketsTable.posterUrl,
        cardBackdropUrl: ticketsTable.cardBackdropUrl,
        caption: ticketsTable.caption,
      })
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, id), isNull(ticketsTable.deletedAt)))
      .limit(1);

    if (!ticket) {
      res.set(OG_HEADERS).send(fallbackOg(APP_URL));
      return;
    }

    const titleParts = [ticket.movieTitle];
    if (ticket.movieYear) titleParts.push(`(${ticket.movieYear})`);
    const title = `${titleParts.join(" ")} — ${SITE_NAME}`;
    const description = ticket.caption?.trim() || `ดู ${ticket.movieTitle} บน Ticker`;
    // ใช้ภาพโปสเตอร์/backdrop โดยตรงจาก TMDB CDN (โหลดทันที ไม่ต้องรอ Render generate)
    // export-card.png ต้องการ Render ตื่น → crawler หมดเวลาก่อน → ใช้ static image แทน
    const image =
      (ticket.cardBackdropUrl as string | null) ||
      (ticket.posterUrl as string | null) ||
      DEFAULT_IMAGE;

    res.set(OG_HEADERS).send(renderOgHtml({ title, description, image, redirectTo, browserRedirectTo: `${redirectTo}?_r=1` }));
  } catch {
    // DB unavailable — return safe fallback so middleware doesn't surface a JSON error
    res.set(OG_HEADERS).send(fallbackOg(redirectTo));
  }
});

// GET /api/og/chain/:id
router.get("/chain/:id", async (req, res) => {
  const id = String(req.params["id"]);
  const redirectTo = `${APP_URL}/chains/${id}`;
  try {
    const [chain] = await db
      .select({
        id: chainsTable.id,
        title: chainsTable.title,
        description: chainsTable.description,
        taggedMoviePosterUrl: chainsTable.taggedMoviePosterUrl,
      })
      .from(chainsTable)
      .where(and(eq(chainsTable.id, id), isNull(chainsTable.deletedAt)))
      .limit(1);

    if (!chain) {
      res.set(OG_HEADERS).send(fallbackOg(APP_URL));
      return;
    }

    const title = `${chain.title} — ${SITE_NAME}`;
    const description = chain.description?.trim() || `ร่วมดูหนังใน Chains "${chain.title}" บน Ticker`;

    // Fetch chain movies for image + SEO body content
    const chainMovies = await db
      .select({ posterUrl: chainMoviesTable.posterUrl, imdbId: chainMoviesTable.imdbId, movieTitle: chainMoviesTable.movieTitle, movieYear: chainMoviesTable.movieYear })
      .from(chainMoviesTable)
      .where(eq(chainMoviesTable.chainId, id))
      .orderBy(asc(chainMoviesTable.position))
      .limit(20);

    // Image priority: taggedMoviePosterUrl → chain movie posterUrl → moviesTable lookup → default
    let image: string = (chain.taggedMoviePosterUrl as string | null) || "";
    if (!image) {
      for (const cm of chainMovies) {
        if (cm.posterUrl) { image = cm.posterUrl; break; }
      }
    }
    if (!image) {
      for (const cm of chainMovies.slice(0, 5)) {
        const tmdbId = /^\d+$/.test(cm.imdbId) ? parseInt(cm.imdbId, 10) : NaN;
        if (isNaN(tmdbId)) continue;
        const [mv] = await db
          .select({ posterUrl: moviesTable.posterUrl })
          .from(moviesTable)
          .where(eq(moviesTable.tmdbId, tmdbId))
          .limit(1);
        if (mv?.posterUrl) { image = mv.posterUrl; break; }
      }
    }
    image = image || DEFAULT_IMAGE;

    // Build rich SEO body — visible to crawlers indexing this page directly
    const esc2 = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const movieListHtml = chainMovies.length > 0
      ? `<ul>${chainMovies.map((m) => `<li>${esc2(m.movieTitle)}${m.movieYear ? ` (${esc2(m.movieYear)})` : ""}</li>`).join("")}</ul>`
      : "";
    const bodyContent = `
<h1>${esc2(chain.title)}</h1>
${chain.description ? `<p>${esc2(chain.description)}</p>` : ""}
${movieListHtml ? `<h2>รายการหนังใน Chain นี้</h2>${movieListHtml}` : ""}
<p>สร้างโดย Ticker — แอปบันทึกหนังสำหรับคนรักหนัง</p>
<a class="cta" href="${esc2(redirectTo)}?_r=1">ดู Chain นี้บน Ticker</a>`;

    res.set(OG_HEADERS).send(renderOgHtml({ title, description, image, redirectTo, browserRedirectTo: `${redirectTo}?_r=1`, bodyContent }));
  } catch {
    res.set(OG_HEADERS).send(fallbackOg(redirectTo));
  }
});

// GET /api/og/user/:username
router.get("/user/:username", async (req, res) => {
  const username = String(req.params["username"]);
  const redirectTo = `${APP_URL}/profile/${username}`;
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
        bio: usersTable.bio,
      })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (!user) {
      res.set(OG_HEADERS).send(fallbackOg(APP_URL));
      return;
    }

    const displayName = user.displayName || user.username || "Ticker User";
    const title = `${displayName} (@${user.username}) — ${SITE_NAME}`;
    const description = (user.bio as string | null)?.trim() || `${displayName} บน Ticker`;
    const image = (user.avatarUrl as string | null) || DEFAULT_IMAGE;

    res.set(OG_HEADERS).send(renderOgHtml({ title, description, image, redirectTo, browserRedirectTo: `${redirectTo}?_r=1` }));
  } catch {
    res.set(OG_HEADERS).send(fallbackOg(redirectTo));
  }
});

// GET /api/sitemap.xml — dynamic sitemap: tickets + chains (50 most recent each)
router.get(
  "/sitemap.xml",
  asyncHandler(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const [tickets, chains] = await Promise.all([
      db
        .select({ id: ticketsTable.id, updatedAt: ticketsTable.updatedAt })
        .from(ticketsTable)
        .where(and(isNull(ticketsTable.deletedAt), eq(ticketsTable.isPrivate, false)))
        .orderBy(ticketsTable.updatedAt)
        .limit(1000),
      db
        .select({ id: chainsTable.id, updatedAt: chainsTable.updatedAt })
        .from(chainsTable)
        .where(and(isNull(chainsTable.deletedAt), eq(chainsTable.isPrivate, false)))
        .orderBy(chainsTable.updatedAt)
        .limit(1000),
    ]);

    const staticUrls = ["/", "/search", "/join", "/login", "/terms", "/privacy"];

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    for (const path of staticUrls) {
      lines.push(`  <url><loc>${APP_URL}${path}</loc><changefreq>daily</changefreq><priority>${path === "/" ? "1.0" : "0.7"}</priority></url>`);
    }
    for (const t of tickets) {
      const lastmod = (t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt ?? today)).toISOString().slice(0, 10);
      lines.push(`  <url><loc>${APP_URL}/ticket/${t.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
    }
    for (const c of chains) {
      const lastmod = (c.updatedAt instanceof Date ? c.updatedAt : new Date(c.updatedAt ?? today)).toISOString().slice(0, 10);
      lines.push(`  <url><loc>${APP_URL}/chains/${c.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
    }

    lines.push("</urlset>");

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600, s-maxage=7200");
    res.send(lines.join("\n"));
  }),
);

export default router;
