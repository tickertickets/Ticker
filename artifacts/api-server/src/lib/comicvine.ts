const API_KEY = process.env["COMIC_VINE_API_KEY"] ?? "";
const BASE_URL = "https://comicvine.gamespot.com/api";
const CACHE_TTL = 60 * 60 * 1000;

export type VolumeCredit = {
  id: number;
  name: string;
};

export type ComicVineCharacter = {
  id: number;
  name: string;
  real_name: string | null;
  aliases: string | null;
  deck: string | null;
  description: string | null;
  site_detail_url: string | null;
  image: { medium_url: string | null; super_url: string | null } | null;
  publisher: { name: string } | null;
  first_appeared_in_issue: { name: string; issue_number: string } | null;
  volume_credits?: VolumeCredit[];
};

export type ComicVineVolume = {
  id: number;
  name: string;
  publisher: { name: string } | null;
  count_of_issues: number;
};

type ComicVineSearchResult = {
  results: Array<{
    id: number;
    name: string;
    real_name: string | null;
    aliases: string | null;
    deck: string | null;
    site_detail_url: string | null;
    image: { medium_url: string | null; super_url: string | null } | null;
    publisher: { name: string } | null;
    volume_credits?: VolumeCredit[];
  }>;
  number_of_page_results: number;
  status_code: number;
};

type ComicVineVolumeSearchResult = {
  results: ComicVineVolume[];
  status_code: number;
};

type ComicVineVolumeDetail = {
  results: {
    characters: Array<{ id: number; name: string; site_detail_url?: string }>;
  };
  status_code: number;
};

const characterCache    = new Map<string, { data: ComicVineCharacter; ts: number }>();
const searchCache       = new Map<string, { results: ComicVineSearchResult["results"]; ts: number }>();
const volumeSearchCache = new Map<string, { results: ComicVineVolume[]; ts: number }>();
const volumeCharCache   = new Map<number, { chars: Array<{ id: number; name: string }>; ts: number }>();

async function cvFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) throw new Error("COMIC_VINE_API_KEY is not set");
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Ticker/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Comic Vine returned ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

/**
 * Search Comic Vine characters by name.
 * Includes volume_credits so we can validate franchise context without an extra fetch.
 */
export async function searchComicVineCharacters(
  query: string,
  limit = 5,
): Promise<ComicVineSearchResult["results"]> {
  const cacheKey = `${query.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.results;

  const data = await cvFetch<ComicVineSearchResult>("/search/", {
    query,
    resources: "character",
    field_list: "id,name,real_name,aliases,deck,site_detail_url,image,publisher,volume_credits",
    limit: String(limit),
  });

  const results = data.results ?? [];
  searchCache.set(cacheKey, { results, ts: Date.now() });
  return results;
}

/**
 * Search Comic Vine for comic volumes (series) by title.
 */
export async function searchComicVineVolumes(
  query: string,
  limit = 10,
): Promise<ComicVineVolume[]> {
  const cacheKey = `vol:${query.toLowerCase()}:${limit}`;
  const cached = volumeSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.results;

  const data = await cvFetch<ComicVineVolumeSearchResult>("/search/", {
    query,
    resources: "volume",
    field_list: "id,name,publisher,count_of_issues",
    limit: String(limit),
  });

  const results = data.results ?? [];
  volumeSearchCache.set(cacheKey, { results, ts: Date.now() });
  return results;
}

/**
 * Get the character list for a given CV volume ID.
 */
export async function getCvVolumeCharacters(
  volumeId: number,
): Promise<Array<{ id: number; name: string }>> {
  const cached = volumeCharCache.get(volumeId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.chars;

  const data = await cvFetch<ComicVineVolumeDetail>(`/volume/4050-${volumeId}/`, {
    field_list: "characters",
  });

  if (data.status_code !== 1) return [];
  const chars = (data.results.characters ?? []).map(c => ({ id: c.id, name: c.name }));
  volumeCharCache.set(volumeId, { chars, ts: Date.now() });
  return chars;
}

/**
 * Get full Comic Vine character detail by ID.
 * Includes volume_credits for franchise validation.
 */
export async function getComicVineCharacterById(
  characterId: number,
): Promise<ComicVineCharacter | null> {
  const cacheKey = String(characterId);
  const cached = characterCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const data = await cvFetch<{ results: ComicVineCharacter; status_code: number }>(
    `/character/4005-${characterId}/`,
    { field_list: "id,name,real_name,aliases,deck,description,site_detail_url,image,publisher,first_appeared_in_issue,volume_credits" },
  );

  if (data.status_code !== 1) return null;
  characterCache.set(cacheKey, { data: data.results, ts: Date.now() });
  return data.results;
}

/**
 * Clean Comic Vine HTML description to plain text.
 * Removes HTML tags, markdown, and extra whitespace.
 */
export function cleanCvDescription(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 2000);
}

/**
 * Check if a character name matches a Comic Vine result.
 * Handles: exact name, real_name, aliases, and "The X" = "X" equivalence.
 */
export function cvNameMatches(
  result: { id: number; name: string; real_name?: string | null; aliases?: string | null },
  query: string,
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const stripThe = (s: string) => norm(s).replace(/^the\s+/, "").trim();

  const q       = norm(query);
  const qStrip  = stripThe(query);

  const matches = (name: string) => {
    const n = norm(name);
    const s = stripThe(name);
    return n === q || s === qStrip || n === qStrip || s === q;
  };

  if (matches(result.name)) return true;
  if ("real_name" in result && result.real_name && matches(result.real_name)) return true;
  if ("aliases" in result && result.aliases) {
    for (const alias of result.aliases.split("\n")) {
      if (matches(alias.trim())) return true;
    }
  }
  return false;
}
