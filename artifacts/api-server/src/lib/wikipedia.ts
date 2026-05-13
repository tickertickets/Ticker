const WIKI_UA = "TickerApp/1.0";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";

// ── Name variant generation ────────────────────────────────────────────────────

export function getNameVariants(name: string): string[] {
  const clean = name
    .replace(/\s*\(voice\)/gi, "")
    .replace(/\s*\[voice\]/gi, "")
    .replace(/\s*\(uncredited\)/gi, "")
    .replace(/\s*\(as\s+[^)]+\)/gi, "")
    .replace(/\s*\([^)]{0,40}\)\s*$/, "")
    .trim();

  const parts = clean.split(/\s*\/\s*/);
  const results: string[] = [];

  for (const part of parts) {
    const p = part.trim();
    if (p.length < 2) continue;
    results.push(p);
    const words = p.split(/\s+/);
    if (words.length === 2) {
      results.push(`${words[1]} ${words[0]}`);
    }
    if (words.length === 3) {
      results.push(`${words[2]} ${words[0]} ${words[1]}`);
      results.push(`${words[1]} ${words[2]} ${words[0]}`);
    }
  }
  return [...new Set(results)].filter(r => r.length >= 2);
}

// ── Fictional character detection ─────────────────────────────────────────────

const FICTIONAL_KEYWORDS = [
  "fictional character", "fictional human", "fictional person", "fictional superhero",
  "character in ", "character from ", "character of ", "character based on",
  "anime character", "manga character", "comic book character", "comic character",
  "superhero", "supervillain", "fictional villain", "fictional hero",
  "protagonist", "antagonist", "television character", "film character",
  "cartoon character", "video game character", "literary character",
  "appeared in ", "first appeared in", "created by", "introduced in",
];

function isFictionalExtract(text: string): boolean {
  const lower = text.toLowerCase();
  return FICTIONAL_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Media link detection ───────────────────────────────────────────────────────

const MEDIA_DISAMBIG_LOWER = [
  "(film)", "(movie)", "(tv series)", "(anime)", "(series)", "(miniseries)",
  "(animated series)", "(animation)", "(tv film)", "(tv movie)", "(web series)",
  "(short film)", "(television film)", "(television series)",
];

function isLikelyMediaLink(title: string): boolean {
  const lower = title.toLowerCase();
  return MEDIA_DISAMBIG_LOWER.some(d => lower.includes(d));
}

// Skip Wikipedia articles that are clearly not media titles
const SKIP_PREFIXES = [
  "List of", "Wikipedia:", "Template:", "Category:", "File:", "Help:", "Portal:",
  "Talk:", "User:", "WP:",
];
function shouldSkipLink(title: string): boolean {
  return SKIP_PREFIXES.some(p => title.startsWith(p));
}

// ── Wikipedia summary API ──────────────────────────────────────────────────────

export async function getWikipediaSummary(pageTitle: string): Promise<{
  extract: string;
  imageUrl: string | null;
  canonicalTitle: string;
} | null> {
  const resp = await fetch(
    `${WIKI_REST}/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`,
    { signal: AbortSignal.timeout(7_000), headers: { "User-Agent": WIKI_UA } }
  ).catch(() => null);
  if (!resp?.ok) return null;
  const json = await resp.json() as {
    title?: string;
    extract?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    type?: string;
  };
  if (!json.extract || json.type === "disambiguation") return null;
  return {
    extract: json.extract,
    imageUrl: json.originalimage?.source ?? json.thumbnail?.source ?? null,
    // REST API resolves redirects; canonical title is the resolved page title
    canonicalTitle: json.title ?? pageTitle,
  };
}

// ── Single character search ────────────────────────────────────────────────────

async function searchWikipediaVariant(name: string): Promise<{
  pageTitle: string;
  label: string;
  imageUrl: string | null;
  extract: string;
} | null> {
  const searchUrl = new URL(WIKI_API);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", name);
  searchUrl.searchParams.set("srnamespace", "0");
  searchUrl.searchParams.set("srlimit", "6");
  searchUrl.searchParams.set("srinfo", "");
  searchUrl.searchParams.set("srprop", "snippet");
  searchUrl.searchParams.set("format", "json");

  const resp = await fetch(searchUrl.toString(), {
    signal: AbortSignal.timeout(7_000),
    headers: { "User-Agent": WIKI_UA },
  }).catch(() => null);
  if (!resp?.ok) return null;

  const data = await resp.json() as {
    query?: { search?: Array<{ title: string; snippet: string }> };
  };
  const results = data.query?.search ?? [];
  if (results.length === 0) return null;

  for (const result of results) {
    if (shouldSkipLink(result.title)) continue;
    const snippetFictional = isFictionalExtract(result.snippet);
    const summary = await getWikipediaSummary(result.title);
    if (!summary?.extract) continue;
    const extractFictional = isFictionalExtract(summary.extract);
    if (snippetFictional || extractFictional) {
      return {
        pageTitle: result.title,
        label: result.title.replace(/_/g, " ").split(" (")[0],
        imageUrl: summary.imageUrl,
        extract: summary.extract,
      };
    }
  }

  // Fallback: top result whose base title closely matches the search name
  for (const result of results.slice(0, 2)) {
    if (shouldSkipLink(result.title)) continue;
    const base = result.title.split(" (")[0].toLowerCase();
    const nameLower = name.toLowerCase();
    if (base === nameLower || base.replace(",", "").trim() === nameLower) {
      const summary = await getWikipediaSummary(result.title);
      if (summary?.extract) {
        return {
          pageTitle: result.title,
          label: result.title.replace(/_/g, " ").split(" (")[0],
          imageUrl: summary.imageUrl,
          extract: summary.extract,
        };
      }
    }
  }
  return null;
}

// ── Public types ───────────────────────────────────────────────────────────────

export type WikiCharacterMatch = {
  charId: string;
  label: string;
  description: string;
  imageUrl: string | null;
};

// ── Exported search functions ──────────────────────────────────────────────────

export async function searchWikipediaCharacter(name: string): Promise<WikiCharacterMatch | null> {
  const variants = getNameVariants(name);
  for (const variant of variants) {
    const hit = await searchWikipediaVariant(variant).catch(() => null);
    if (hit) {
      return {
        charId: hit.pageTitle.replace(/ /g, "_"),
        label: hit.label,
        description: hit.extract.slice(0, 350),
        imageUrl: hit.imageUrl,
      };
    }
  }
  return null;
}

export async function batchSearchWikipediaCharacters(names: string[]): Promise<WikiCharacterMatch[]> {
  const limited = names.slice(0, 15).filter(n => n?.trim().length > 1);
  const results = await Promise.all(
    limited.map(name => searchWikipediaCharacter(name).catch(() => null))
  );
  const seen = new Set<string>();
  return results
    .filter((r): r is WikiCharacterMatch => r !== null)
    .filter(r => {
      if (seen.has(r.charId)) return false;
      seen.add(r.charId);
      return true;
    });
}

// ── Article media links (for filmography) ─────────────────────────────────────

export async function getCharacterMediaLinks(pageTitle: string): Promise<string[]> {
  const url = new URL(WIKI_API);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", pageTitle.replace(/_/g, " "));
  url.searchParams.set("prop", "links");
  url.searchParams.set("redirects", "1"); // follow redirects (e.g. Gojo_Satoru → Satoru_Gojo)
  url.searchParams.set("format", "json");

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(9_000),
    headers: { "User-Agent": WIKI_UA },
  }).catch(() => null);
  if (!resp?.ok) return [];

  const data = await resp.json() as {
    parse?: { links?: Array<{ ns: number; "*": string; exists?: string }> };
  };

  const all = (data.parse?.links ?? [])
    .filter(l => l.ns === 0 && l.exists !== undefined && !shouldSkipLink(l["*"]))
    .map(l => l["*"]);

  // Media-disambiguated links first (more reliable), then other article links
  const mediaLinks = all.filter(t => isLikelyMediaLink(t));
  const otherLinks = all.filter(t => !isLikelyMediaLink(t) && t.length >= 3);

  return [...mediaLinks, ...otherLinks].slice(0, 70);
}

// ── Awards via Wikipedia API (replaces Wikidata SPARQL awards) ────────────────

export type WikiAwardEntry = { year: string; award_category: string };
export type WikiAwardResult = {
  department: string;
  name: string;
  winners: WikiAwardEntry[];
  nominees: WikiAwardEntry[];
};

export async function queryAwardsByImdbId(_imdbId: string): Promise<WikiAwardResult[]> {
  return [];
}

export async function queryAwardsByTmdbPersonId(_personId: number): Promise<WikiAwardResult[]> {
  return [];
}
