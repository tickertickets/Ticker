const WIKI_UA = "TickerApp/1.0";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

type Binding = Record<string, { value?: string }>;
type SparqlResponse = { results?: { bindings?: Binding[] } };

async function sparqlQuery(sparql: string): Promise<SparqlResponse | null> {
  const resp = await fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": WIKI_UA,
    },
    body: `query=${encodeURIComponent(sparql)}`,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!resp?.ok) return null;
  return resp.json() as Promise<SparqlResponse>;
}

// ── Awards ────────────────────────────────────────────────────────────────────
export type WikiAwardEntry = { year: string; award_category: string };
export type WikiAwardResult = {
  department: string;
  name: string;
  winners: WikiAwardEntry[];
  nominees: WikiAwardEntry[];
};

function buildAwardsSparql(subjectClause: string): string {
  return `
SELECT DISTINCT ?awardLabel ?orgLabel ?year ?winType WHERE {
  ${subjectClause}
  {
    ?item p:P166 ?stmt .
    ?stmt ps:P166 ?award .
    OPTIONAL { ?stmt pq:P585 ?date . BIND(STR(YEAR(?date)) as ?year) }
    OPTIONAL { ?award wdt:P1027 ?org }
    BIND("winner" as ?winType)
  } UNION {
    ?item p:P1411 ?stmt .
    ?stmt ps:P1411 ?award .
    OPTIONAL { ?stmt pq:P585 ?date . BIND(STR(YEAR(?date)) as ?year) }
    OPTIONAL { ?award wdt:P1027 ?org }
    BIND("nominee" as ?winType)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 100`;
}

function processAwardBindings(bindings: Binding[]): WikiAwardResult[] {
  const orgMap = new Map<string, { winners: WikiAwardEntry[]; nominees: WikiAwardEntry[] }>();
  for (const b of bindings) {
    const awardLabel = b["awardLabel"]?.value ?? "";
    const orgLabel = b["orgLabel"]?.value ?? "Awards";
    const year = b["year"]?.value ?? "";
    const winType = b["winType"]?.value ?? "nominee";
    if (!awardLabel) continue;
    if (!orgMap.has(orgLabel)) orgMap.set(orgLabel, { winners: [], nominees: [] });
    const entry = orgMap.get(orgLabel)!;
    const item: WikiAwardEntry = { year, award_category: awardLabel };
    if (winType === "winner") entry.winners.push(item);
    else entry.nominees.push(item);
  }
  return Array.from(orgMap.entries())
    .filter(([, v]) => v.winners.length > 0 || v.nominees.length > 0)
    .map(([name, { winners, nominees }]) => ({ department: "", name, winners, nominees }));
}

export async function queryAwardsByImdbId(imdbId: string): Promise<WikiAwardResult[]> {
  if (!imdbId.match(/^tt\d+$/)) return [];
  const sparql = buildAwardsSparql(`?item wdt:P345 "${imdbId}" .`);
  const data = await sparqlQuery(sparql).catch(() => null);
  return processAwardBindings(data?.results?.bindings ?? []);
}

export async function queryAwardsByTmdbPersonId(personId: number): Promise<WikiAwardResult[]> {
  const sparql = buildAwardsSparql(`?item wdt:P4985 "${personId}" .`);
  const data = await sparqlQuery(sparql).catch(() => null);
  return processAwardBindings(data?.results?.bindings ?? []);
}

// ── Character search ──────────────────────────────────────────────────────────
const CHARACTER_KEYWORDS = [
  "fictional character", "fictional human", "fictional person",
  "character in", "character from", "character of",
  "anime character", "manga character", "comic book character",
  "superhero", "supervillain", "villain", "protagonist", "antagonist",
  "anime", "manga", "literary character", "television character",
  "film character", "video game character",
];

function isCharacterLike(description: string): boolean {
  const lower = description.toLowerCase();
  return CHARACTER_KEYWORDS.some(kw => lower.includes(kw));
}

/** Clean a raw TMDB character name into searchable variants */
function cleanCharacterNames(raw: string): string[] {
  // Split by "/" to get alternate names (e.g. "Tony Stark / Iron Man")
  const parts = raw.split(/\s*\/\s*/);
  const results: string[] = [];
  for (const part of parts) {
    const name = part
      .replace(/\s*\(voice\)/gi, "")
      .replace(/\s*\[voice\]/gi, "")
      .replace(/\s*\(uncredited\)/gi, "")
      .replace(/\s*\(as\s+[^)]+\)/gi, "")
      .replace(/\s*\([^)]{0,30}\)\s*$/, "") // trailing short parenthetical
      .trim();
    if (name.length < 2) continue;
    results.push(name);
    // Also try East-Asian name reversal (e.g. "Satoru Gojo" → "Gojo Satoru")
    const words = name.split(/\s+/);
    if (words.length === 2) results.push(`${words[1]} ${words[0]}`);
  }
  return [...new Set(results)];
}

async function searchOne(name: string): Promise<{ id: string; label: string; description: string } | null> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", name);
  url.searchParams.set("language", "en");
  url.searchParams.set("type", "item");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5_000),
    headers: { "User-Agent": WIKI_UA },
  }).catch(() => null);
  if (!resp?.ok) return null;

  const data = await resp.json() as {
    search?: Array<{ id: string; label: string; description?: string }>;
  };

  // ← CRITICAL FIX: return the matched item, not always index 0
  const found = (data.search ?? []).find(r => isCharacterLike(r.description ?? ""));
  return found ? { id: found.id, label: found.label, description: found.description ?? "" } : null;
}

async function searchCharacter(name: string): Promise<{ id: string; label: string; description: string } | null> {
  const variants = cleanCharacterNames(name);
  for (const variant of variants) {
    const hit = await searchOne(variant);
    if (hit) return hit;
  }
  return null;
}

async function batchGetImages(ids: string[]): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {};
  const sparql = `SELECT ?item ?image WHERE { VALUES ?item { ${ids.map(id => `wd:${id}`).join(" ")} } OPTIONAL { ?item wdt:P18 ?image } }`;
  const data = await sparqlQuery(sparql).catch(() => null);
  const result: Record<string, string | null> = Object.fromEntries(ids.map(id => [id, null]));
  for (const b of (data?.results?.bindings ?? [])) {
    const raw = String(b["item"]?.value ?? "");
    const id = raw.replace("http://www.wikidata.org/entity/", "");
    const img = b["image"]?.value ? String(b["image"].value) + "?width=185" : null;
    if (id && img) result[id] = img;
  }
  return result;
}

export type CharacterMatch = {
  name: string;
  wikidataId: string;
  label: string;
  description: string;
  imageUrl: string | null;
};

export async function batchSearchCharacters(names: string[]): Promise<CharacterMatch[]> {
  const limited = names.slice(0, 20).filter(n => n && n.trim().length > 1);
  const searches = await Promise.all(limited.map(async name => {
    const found = await searchCharacter(name).catch(() => null);
    return { name, found };
  }));
  const hits = searches.filter(s => s.found !== null) as Array<{ name: string; found: { id: string; label: string; description: string } }>;
  if (hits.length === 0) return [];
  const images = await batchGetImages(hits.map(h => h.found.id));
  return hits.map(h => ({
    name: h.name,
    wikidataId: h.found.id,
    label: h.found.label,
    description: h.found.description,
    imageUrl: images[h.found.id] ?? null,
  }));
}

// ── Character detail ──────────────────────────────────────────────────────────
export type CharacterFilm = {
  title: string;
  year: string | null;
  imdbId: string | null;
  posterUrl: string | null;
  tmdbRating: string | null;
  voteCount: number;
  genreIds: number[];
  popularity: number;
  franchiseIds: number[];
  mediaType: "movie" | "tv";
};

export type CharacterDetail = {
  wikidataId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  filmography: CharacterFilm[];
};

export async function getCharacterFromWikidata(wikidataId: string): Promise<{
  name: string;
  description: string;
  imageUrl: string | null;
} | null> {
  const resp = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
    { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": WIKI_UA } }
  ).catch(() => null);
  if (!resp?.ok) return null;

  const data = await resp.json() as {
    entities?: Record<string, {
      labels?: Record<string, { value: string }>;
      descriptions?: Record<string, { value: string }>;
      claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
    }>;
  };
  const entity = data.entities?.[wikidataId];
  if (!entity) return null;

  const name = entity.labels?.["en"]?.value ?? wikidataId;
  const description = entity.descriptions?.["en"]?.value ?? "";
  const p18 = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const imageUrl = p18
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(p18).replace(/ /g, "_"))}?width=400`
    : null;

  return { name, description, imageUrl };
}

export async function getCharactersByMovieImdb(imdbId: string): Promise<CharacterMatch[]> {
  const sparql = `
SELECT DISTINCT ?char ?charLabel ?image WHERE {
  ?work wdt:P345 "${imdbId}" .
  ?work wdt:P674 ?char .
  OPTIONAL { ?char wdt:P18 ?image }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 20`;
  const data = await sparqlQuery(sparql).catch(() => null);
  const bindings = data?.results?.bindings ?? [];
  const results: CharacterMatch[] = [];
  const seen = new Set<string>();
  for (const b of bindings) {
    const rawId = String(b["char"]?.value ?? "");
    const id = rawId.replace("http://www.wikidata.org/entity/", "");
    if (!id.startsWith("Q") || seen.has(id)) continue;
    seen.add(id);
    const label = String(b["charLabel"]?.value ?? "");
    if (!label || label.startsWith("Q")) continue;
    const imageRaw = b["image"]?.value ? String(b["image"].value) : null;
    const imageUrl = imageRaw ? imageRaw + "?width=185" : null;
    results.push({ name: label, wikidataId: id, label, description: "", imageUrl });
  }
  return results;
}

export async function getCharacterFilmography(wikidataId: string): Promise<Array<{ title: string; year: string | null; imdbId: string | null }>> {
  const sparql = `
SELECT DISTINCT ?workLabel ?imdbId ?year WHERE {
  { ?work wdt:P161 wd:${wikidataId} } UNION { ?work wdt:P674 wd:${wikidataId} }
  ?work wdt:P345 ?imdbId .
  OPTIONAL { ?work wdt:P577 ?date . BIND(STR(YEAR(?date)) as ?year) }
  FILTER NOT EXISTS { ?work wdt:P136 wd:Q29168811 }
  FILTER NOT EXISTS { ?work wdt:P31  wd:Q29168811 }
  FILTER NOT EXISTS { ?work wdt:P136 wd:Q22092344 }
  FILTER NOT EXISTS { ?work wdt:P31  wd:Q22092344 }
  FILTER NOT EXISTS { ?work wdt:P136 wd:Q1361932 }
  FILTER NOT EXISTS { ?work wdt:P31  wd:Q1361932 }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 50`;
  const data = await sparqlQuery(sparql).catch(() => null);
  const seen = new Set<string>();
  return (data?.results?.bindings ?? [])
    .map(b => ({
      title: String(b["workLabel"]?.value ?? ""),
      year: b["year"]?.value ? String(b["year"].value) : null,
      imdbId: b["imdbId"]?.value ? String(b["imdbId"].value) : null,
    }))
    .filter(f => {
      if (!f.title || f.title.startsWith("Q")) return false;
      const key = f.imdbId ?? f.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
