const API_KEY = process.env["COMIC_VINE_API_KEY"] ?? "";
const BASE_URL = "https://comicvine.gamespot.com/api";
const CACHE_TTL = 60 * 60 * 1000;

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
};

type ComicVineSearchResult = {
  results: Array<{
    id: number;
    name: string;
    real_name: string | null;
    aliases: string | null;
    deck: string | null;
    site_detail_url: string | null;
    image: { medium_url: string | null } | null;
    publisher: { name: string } | null;
  }>;
  number_of_page_results: number;
  status_code: number;
};

const characterCache = new Map<string, { data: ComicVineCharacter; ts: number }>();
const searchCache    = new Map<string, { results: ComicVineSearchResult["results"]; ts: number }>();

async function cvFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) throw new Error("COMIC_VINE_API_KEY is not set");
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Ticker/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Comic Vine returned ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

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
    field_list: "id,name,real_name,aliases,deck,site_detail_url,image,publisher",
    limit: String(limit),
  });

  const results = data.results ?? [];
  searchCache.set(cacheKey, { results, ts: Date.now() });
  return results;
}

export async function getComicVineCharacterById(
  characterId: number,
): Promise<ComicVineCharacter | null> {
  const cacheKey = String(characterId);
  const cached = characterCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const data = await cvFetch<{ results: ComicVineCharacter; status_code: number }>(
    `/character/4005-${characterId}/`,
    { field_list: "id,name,real_name,aliases,deck,description,site_detail_url,image,publisher,first_appeared_in_issue" },
  );

  if (data.status_code !== 1) return null;
  characterCache.set(cacheKey, { data: data.results, ts: Date.now() });
  return data.results;
}

/**
 * Check if a character name matches a Comic Vine search result,
 * considering name, real_name, and aliases (newline-separated).
 */
export function cvNameMatches(result: ComicVineSearchResult["results"][0], query: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const q = norm(query);

  if (norm(result.name) === q) return true;
  if (result.real_name && norm(result.real_name) === q) return true;
  if (result.aliases) {
    for (const alias of result.aliases.split("\n")) {
      if (norm(alias.trim()) === q) return true;
    }
  }
  return false;
}
