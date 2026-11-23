/**
 * Vercel Edge Middleware
 * Intercepts social-media crawler requests and returns OG-tag HTML from the API.
 * Regular browser requests pass through unchanged to the SPA.
 */

const API_BASE = "https://ticker-api-server.onrender.com";

const CRAWLER_RE =
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|instagram|line-poker|linebot|line\/|liff|kakaostory|googlebot|bingbot|yandexbot|duckduckbot|applebot|ia_archiver|semrushbot|screaming.frog|wget|curl\/[0-9]/i;

function getOgPath(pathname: string): string | null {
  const ticket  = pathname.match(/^\/ticket\/([a-zA-Z0-9_-]+)/);
  const chain   = pathname.match(/^\/chains\/([a-zA-Z0-9_-]+)/);
  const profile = pathname.match(/^\/profile\/([a-zA-Z0-9_@.\-]+)/);
  if (ticket)  return `/api/og/ticket/${ticket[1]}`;
  if (chain)   return `/api/og/chain/${chain[1]}`;
  if (profile) return `/api/og/user/${profile[1]}`;
  return null;
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const ua = request.headers.get("user-agent") ?? "";
  if (!CRAWLER_RE.test(ua)) return undefined; // pass through

  const url = new URL(request.url);
  const ogPath = getOgPath(url.pathname);
  if (!ogPath) return undefined;

  try {
    const apiRes = await fetch(`${API_BASE}${ogPath}`, {
      headers: { "User-Agent": ua, Accept: "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!apiRes.ok) return undefined; // API error — fall through to SPA
    const html = await apiRes.text();
    // Sanity-check: if it looks like a JSON error, fall through
    if (html.trimStart().startsWith("{")) return undefined;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch {
    return undefined; // fall through on error
  }
}

export const config = {
  matcher: ["/ticket/:path*", "/chains/:path*", "/profile/:path*"],
};
