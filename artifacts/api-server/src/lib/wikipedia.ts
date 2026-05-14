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

// ── Stop words & category words ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "de",
]);

// Words in article titles that indicate it is about a group/collection, not one character
const CATEGORY_WORDS = new Set([
  "family", "families", "franchise", "universe", "trilogy", "saga",
  "series", "characters", "mythology", "collection", "dynasty", "clan",
  "team", "squad", "group", "gang", "crew",
]);

// ── Fictional character detection ─────────────────────────────────────────────

const FICTIONAL_KEYWORDS = [
  "fictional character", "fictional human", "fictional person", "fictional superhero",
  "character in ", "character from ", "character of ", "character based on",
  "anime character", "manga character", "comic book character", "comic character",
  "superhero", "supervillain", "fictional villain", "fictional hero",
  "protagonist", "antagonist", "television character", "film character",
  "cartoon character", "video game character", "literary character",
  "appeared in ", "first appeared in", "created by", "introduced in",
  "portrayed by", "voiced by", "played by",
];

// Signals the article is about a real person, not a fictional character
const NON_FICTIONAL_SIGNALS = [
  "is an american actor", "is a british actor", "is an english actor",
  "is a thai actor", "is a japanese actor", "is a korean actor",
  "is an actor", "is an actress", "is an australian actor",
  "born in ", "american film", "is a director", "is a filmmaker",
  "is a musician", "is a singer", "is a politician", "is a comedian",
  "is a professional", "is an american rapper", "is an american comedian",
];

function isFictionalExtract(text: string): boolean {
  const lower = text.toLowerCase();
  if (NON_FICTIONAL_SIGNALS.some(kw => lower.includes(kw))) return false;
  return FICTIONAL_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Media disambiguation helpers ──────────────────────────────────────────────

const MEDIA_DISAMBIG_LOWER = [
  "(film)", "(movie)", "(tv series)", "(anime)", "(series)", "(miniseries)",
  "(animated series)", "(animation)", "(tv film)", "(tv movie)", "(web series)",
  "(short film)", "(television film)", "(television series)",
];
function isLikelyMediaLink(title: string): boolean {
  const lower = title.toLowerCase();
  return MEDIA_DISAMBIG_LOWER.some(d => lower.includes(d));
}

const SKIP_PREFIXES = [
  "List of", "Wikipedia:", "Template:", "Category:", "File:", "Help:", "Portal:",
  "Talk:", "User:", "WP:",
];
function shouldSkipLink(title: string): boolean {
  return SKIP_PREFIXES.some(p => title.startsWith(p));
}

// ── Wikipedia search helper ───────────────────────────────────────────────────

async function wikiSearch(
  query: string,
  limit = 8,
): Promise<Array<{ title: string; snippet: string }>> {
  const searchUrl = new URL(WIKI_API);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", query);
  searchUrl.searchParams.set("srnamespace", "0");
  searchUrl.searchParams.set("srlimit", String(limit));
  searchUrl.searchParams.set("srinfo", "");
  searchUrl.searchParams.set("srprop", "snippet");
  searchUrl.searchParams.set("format", "json");

  const resp = await fetch(searchUrl.toString(), {
    signal: AbortSignal.timeout(7_000),
    headers: { "User-Agent": WIKI_UA },
  }).catch(() => null);
  if (!resp?.ok) return [];
  const data = await resp.json() as {
    query?: { search?: Array<{ title: string; snippet: string }> };
  };
  return data.query?.search ?? [];
}

// ── Name-to-title matching ────────────────────────────────────────────────────

/**
 * STRICT matching — used for name-only searches.
 * Single-word names require the title to also be single-word (prevents "Barry" → "Barry Keoghan").
 * Multi-word names: all content words must appear in the title, and the title must not have
 * extra "category" words (family, franchise, universe, etc.).
 */
function nameMatchesTitle(searchName: string, articleTitle: string): boolean {
  const baseTitleRaw = articleTitle.split(" (")[0].toLowerCase().trim();
  const nameL = searchName.toLowerCase().trim();

  if (baseTitleRaw === nameL) return true;

  const nameWords = nameL.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  const titleWords = baseTitleRaw.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));

  if (nameWords.length === 0) return baseTitleRaw === nameL;
  if (nameWords.length === 1) return titleWords.length === 1 && titleWords[0] === nameWords[0];

  const extraTitleWords = titleWords.filter(w => !nameWords.includes(w));
  if (extraTitleWords.some(w => CATEGORY_WORDS.has(w))) return false;

  return nameWords.every(w => titleWords.includes(w));
}

/**
 * LENIENT matching — used for context-assisted searches (name + movie title).
 * The article title just needs to START with the character name or contain all name words.
 * e.g., charName="Ash", articleTitle="Ash Williams" → true
 *       charName="Satoru Gojo", articleTitle="Gojo Satoru" → true
 */
function nameStartsTitle(charName: string, articleTitle: string): boolean {
  const baseTitleRaw = articleTitle.split(" (")[0].toLowerCase().trim();
  const nameL = charName.toLowerCase().trim();

  if (baseTitleRaw === nameL) return true;
  if (baseTitleRaw.startsWith(nameL + " ")) return true;

  const nameWords = nameL.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  const titleWords = baseTitleRaw.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));

  if (nameWords.length === 0) return false;
  return nameWords.every(w => titleWords.includes(w));
}

// ── Image license helper ──────────────────────────────────────────────────────
// Wikimedia Commons ONLY accepts CC-licensed or Public Domain images.
// A URL containing "/wikipedia/commons/" is always CC-safe.
// URLs from language-specific Wikis ("/wikipedia/en/", etc.) may be fair-use.
export function isCommonsImage(url: string): boolean {
  return url.includes("/wikipedia/commons/");
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
  const rawImage = json.originalimage?.source ?? json.thumbnail?.source ?? null;
  return {
    extract: json.extract,
    imageUrl: rawImage && isCommonsImage(rawImage) ? rawImage : null,
    canonicalTitle: json.title ?? pageTitle,
  };
}

// ── Bio in a given language ────────────────────────────────────────────────────

export async function getWikipediaBioForLang(
  pageTitle: string,
  lang: string,
): Promise<string | null> {
  const normalizedLang = lang.split("-")[0].toLowerCase();

  if (normalizedLang === "en") {
    const s = await getWikipediaSummary(pageTitle);
    return s?.extract?.slice(0, 500) ?? null;
  }
  try {
    const langlinksResp = await fetch(
      `${WIKI_REST}/page/langlinks/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`,
      { signal: AbortSignal.timeout(6_000), headers: { "User-Agent": WIKI_UA } }
    ).catch(() => null);
    if (!langlinksResp?.ok) return null;
    const langlinksData = await langlinksResp.json() as Array<{
      lang: string;
      titles?: { canonical?: string; normalized?: string; display?: string };
    }>;
    const target = langlinksData.find(l => l.lang === normalizedLang);
    if (!target) return null;
    const targetTitle = target.titles?.canonical ?? target.titles?.normalized;
    if (!targetTitle) return null;
    const targetRest = `https://${normalizedLang}.wikipedia.org/api/rest_v1`;
    const targetResp = await fetch(
      `${targetRest}/page/summary/${encodeURIComponent(targetTitle)}`,
      { signal: AbortSignal.timeout(6_000), headers: { "User-Agent": WIKI_UA } }
    ).catch(() => null);
    if (!targetResp?.ok) return null;
    const targetData = await targetResp.json() as { extract?: string; type?: string };
    if (!targetData.extract || targetData.type === "disambiguation") return null;
    return targetData.extract.slice(0, 500);
  } catch {
    return null;
  }
}

// ── Context-aware Wikipedia search ────────────────────────────────────────────
// Searches with "charName movieTitle" context, validates result against charName (lenient)

async function searchWikipediaWithContext(
  charName: string,
  contextQuery: string,
): Promise<{
  pageTitle: string;
  label: string;
  imageUrl: string | null;
  extract: string;
} | null> {
  const results = await wikiSearch(contextQuery, 6).catch(() => []);

  for (const result of results) {
    if (shouldSkipLink(result.title)) continue;
    // Validate: article title must loosely contain the character name
    if (!nameStartsTitle(charName, result.title)) continue;

    const summary = await getWikipediaSummary(result.title).catch(() => null);
    if (!summary?.extract) continue;
    // Reject if signals a real person
    if (NON_FICTIONAL_SIGNALS.some(kw => summary.extract.toLowerCase().includes(kw))) continue;

    return {
      pageTitle: result.title,
      label: result.title.replace(/_/g, " ").split(" (")[0],
      imageUrl: summary.imageUrl,
      extract: summary.extract,
    };
  }
  return null;
}

// ── Standard single-character search ──────────────────────────────────────────

async function searchWikipediaVariant(name: string): Promise<{
  pageTitle: string;
  label: string;
  imageUrl: string | null;
  extract: string;
} | null> {
  const results = await wikiSearch(name, 8).catch(() => []);
  if (results.length === 0) return null;

  // Pass 1: Strict name match + fictional keywords
  for (const result of results) {
    if (shouldSkipLink(result.title)) continue;
    if (!nameMatchesTitle(name, result.title)) continue;

    const snippetFictional = isFictionalExtract(result.snippet);
    const summary = await getWikipediaSummary(result.title).catch(() => null);
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

  // Pass 2: Exact base-title match (no keyword required, but no real-person signals)
  for (const result of results.slice(0, 3)) {
    if (shouldSkipLink(result.title)) continue;
    const base = result.title.split(" (")[0].toLowerCase();
    const nameLower = name.toLowerCase();
    if (base !== nameLower) continue;

    const summary = await getWikipediaSummary(result.title).catch(() => null);
    if (!summary?.extract) continue;
    if (NON_FICTIONAL_SIGNALS.some(kw => summary.extract.toLowerCase().includes(kw))) continue;
    return {
      pageTitle: result.title,
      label: result.title.replace(/_/g, " ").split(" (")[0],
      imageUrl: summary.imageUrl,
      extract: summary.extract,
    };
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

/**
 * Search for a single fictional character on Wikipedia.
 * When `movieTitle` is provided, tries context-assisted search first
 * (e.g., "Ash Evil Dead") so generic names like "Ash" resolve to
 * "Ash Williams" instead of "Ash (residue)".
 */
export async function searchWikipediaCharacter(
  name: string,
  movieTitle?: string,
): Promise<WikiCharacterMatch | null> {
  // Strategy 1: Context-assisted search (when movie title is available)
  if (movieTitle) {
    const cleanMovie = movieTitle.replace(/\s*\(\d{4}.*\)/, "").trim();
    const movieShort = cleanMovie.split(/\s+/).slice(0, 4).join(" ");

    const contextQueries = [
      `${name} ${movieShort}`,
      `${name} character ${movieShort}`,
    ];

    for (const query of contextQueries) {
      const hit = await searchWikipediaWithContext(name, query).catch(() => null);
      if (hit) {
        return {
          charId: hit.pageTitle.replace(/ /g, "_"),
          label: hit.label,
          description: hit.extract.slice(0, 350),
          imageUrl: hit.imageUrl,
        };
      }
    }
  }

  // Strategy 2: Name variants with strict matching
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

export async function batchSearchWikipediaCharacters(
  names: string[],
  movieTitle?: string,
): Promise<WikiCharacterMatch[]> {
  const limited = names.slice(0, 15).filter(n => n?.trim().length > 1);
  const results = await Promise.all(
    limited.map(name => searchWikipediaCharacter(name, movieTitle).catch(() => null))
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
  url.searchParams.set("redirects", "1");
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

  const mediaLinks = all.filter(t => isLikelyMediaLink(t));
  const otherLinks = all.filter(t => !isLikelyMediaLink(t) && t.length >= 3);

  return [...mediaLinks, ...otherLinks].slice(0, 70);
}

// ── Awards (stub) ─────────────────────────────────────────────────────────────

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
