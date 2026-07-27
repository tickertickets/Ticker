/**
 * lib/fandom.ts — Fandom wiki character lookup
 *
 * Steps:
 *  1. searchFandom(charName, movieTitle)
 *     → Fandom cross-wiki suggestion API to find the best article
 *     → MediaWiki extract + thumbnail from the matched wiki
 *
 * Results are cached in-process for CACHE_TTL (4 h).
 */

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

export interface FandomCharResult {
  name: string;
  description: string;
  imageUrl: string | null;
  sourceUrl: string;
}

type CacheEntry = { result: FandomCharResult | null; ts: number };
const cache = new Map<string, CacheEntry>();

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function titleMatchesChar(title: string, charName: string): boolean {
  const t = title.toLowerCase();
  const c = charName.toLowerCase();
  if (t.includes(c)) return true;
  return c.split(/\s+/).filter(w => w.length > 2).some(w => t.includes(w));
}

export async function searchFandom(
  charName: string,
  movieTitle: string,
): Promise<FandomCharResult | null> {
  const cacheKey = `${charName.toLowerCase()}|||${movieTitle.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

  const put = (r: FandomCharResult | null): FandomCharResult | null => {
    cache.set(cacheKey, { result: r, ts: Date.now() });
    return r;
  };

  try {
    const query = `${charName} ${movieTitle}`;
    const suggestUrl =
      `https://services.fandom.com/search-suggestion/suggestions` +
      `?query=${encodeURIComponent(query)}&lang=en`;

    const suggestRes = await fetch(suggestUrl, {
      headers: { "User-Agent": "TickerApp/2.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!suggestRes.ok) return put(null);

    const suggestData = await suggestRes.json() as {
      items?: Array<{ title: string; url: string; thumbnailUrl?: string }>;
    };
    const items = (suggestData.items ?? []).filter(i => i.url?.includes(".fandom.com/wiki/"));
    if (items.length === 0) return put(null);

    const best = items.find(i => titleMatchesChar(i.title, charName)) ?? items[0];
    if (!best?.url) return put(null);

    let wikiDomain: string;
    let articleTitle: string;
    try {
      const u = new URL(best.url);
      wikiDomain = u.hostname;
      articleTitle = decodeURIComponent(u.pathname.replace(/^\/wiki\//, "").replace(/_/g, " "));
    } catch { return put(null); }

    const apiUrl =
      `https://${wikiDomain}/api.php` +
      `?action=query&prop=extracts|pageimages` +
      `&exintro=1&pithumbsize=400&format=json&redirects=1` +
      `&titles=${encodeURIComponent(articleTitle)}`;

    const articleRes = await fetch(apiUrl, {
      headers: { "User-Agent": "TickerApp/2.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!articleRes.ok) return put(null);

    const articleData = await articleRes.json() as {
      query?: {
        pages?: Record<string, {
          title?: string;
          extract?: string;
          thumbnail?: { source?: string };
          missing?: "";
        }>;
      };
    };
    const pages = articleData.query?.pages ?? {};
    const page = Object.values(pages)[0];
    if (!page || "missing" in page) return put(null);

    const rawExtract = page.extract ?? "";
    const description = stripHtml(rawExtract).slice(0, 1200);
    const imageUrl = page.thumbnail?.source ?? best.thumbnailUrl ?? null;

    return put({
      name: page.title ?? charName,
      description,
      imageUrl,
      sourceUrl: best.url,
    });
  } catch {
    return put(null);
  }
}
