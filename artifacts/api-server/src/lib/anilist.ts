const ANILIST_API = "https://graphql.anilist.co";
const ANILIST_UA = "TickerApp/1.0";

const CACHE_TTL = 24 * 60 * 60 * 1000;
const mediaInfoCache = new Map<string, { info: AniListMediaInfo | null; ts: number }>();
const mediaIdCharCache = new Map<number, { chars: AniListChar[]; ts: number }>();
const charDetailCache = new Map<number, { detail: AniListCharDetail | null; ts: number }>();
const charNameCache = new Map<string, { detail: AniListCharDetail | null; ts: number }>();

export type AniListChar = {
  id: number;
  name: string;
  alternativeNames: string[];
  imageUrl: string | null;
  description: string | null;
};

export type AniListMediaInfo = {
  mediaId: number;
  titleEnglish: string | null;
  titleRomaji: string | null;
  chars: AniListChar[];
};

export type AniListMedia = {
  id: number;
  type: "ANIME" | "MANGA";
  format: string | null;
  titleRomaji: string | null;
  titleEnglish: string | null;
  coverImage: string | null;
  averageScore: number | null;
  popularity: number;
  startYear: number | null;
};

export type AniListCharDetail = {
  id: number;
  name: string;
  alternativeNames: string[];
  imageUrl: string | null;
  description: string | null;
  structuredInfo: Array<{ key: string; value: string }>;
  media: AniListMedia[];
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const resp = await fetch(ANILIST_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": ANILIST_UA,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    });
    if (resp.status === 429) return null;
    if (!resp.ok) return null;
    const json = await resp.json() as { data?: T; errors?: unknown[] };
    return json.data ?? null;
  } catch {
    return null;
  }
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/~![\s\S]*?!~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 3000);
}

/**
 * Parse AniList description into structured key-value pairs and clean bio text.
 * Handles both __Key:__ and **Key:** formats.
 * Returns {info: [{key, value}], bio: string} where bio is the clean narrative text.
 */
export function parseAniListDescription(raw: string): {
  info: Array<{ key: string; value: string }>;
  bio: string;
} {
  if (!raw || !raw.trim()) return { info: [], bio: "" };

  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const info: Array<{ key: string; value: string }> = [];
  const pattern = /(?:__([^_\n]+):__|\*\*([^*\n]+):\*\*)\s*/g;
  const positions: Array<{ key: string; start: number; contentStart: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(cleaned)) !== null) {
    const key = (m[1] ?? m[2] ?? "").trim();
    if (key) positions.push({ key, start: m.index, contentStart: m.index + m[0].length });
  }

  if (positions.length === 0) {
    const bio = cleaned
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/\*/g, "")
      .trim();
    return { info: [], bio };
  }

  const preBio = cleaned.slice(0, positions[0]!.start)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();

  let detectedBio = "";

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const nextStart = i + 1 < positions.length ? positions[i + 1]!.start : cleaned.length;
    let rawVal = cleaned.slice(pos.contentStart, nextStart)
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .trim();

    const firstNl = rawVal.indexOf("\n");
    if (firstNl > 0) {
      const lineRemainder = rawVal.slice(firstNl).trim();
      rawVal = rawVal.slice(0, firstNl).trim();
      if (lineRemainder && !detectedBio) {
        detectedBio = lineRemainder;
      }
    } else if (rawVal.length > 100) {
      // Long value that runs into bio text — find natural break
      // Look for a period followed by a space and uppercase letter (sentence end)
      const sentenceBreak = rawVal.search(/\.\s+[A-Z]/);
      if (sentenceBreak > 5) {
        const remainder = rawVal.slice(sentenceBreak + 2).trim();
        rawVal = rawVal.slice(0, sentenceBreak + 1).trim();
        if (remainder && !detectedBio) {
          detectedBio = remainder;
        }
      } else {
        // No sentence break — split on first comma if it keeps value short
        const commaIdx = rawVal.indexOf(",");
        if (commaIdx > 0 && commaIdx < 60) {
          const remainder = rawVal.slice(commaIdx + 1).trim();
          if (remainder.length > 60 && !detectedBio) {
            detectedBio = remainder;
            rawVal = rawVal.slice(0, commaIdx).trim();
          }
        }
      }
    }

    if (pos.key && rawVal) info.push({ key: pos.key, value: rawVal });
  }

  // Collect any remaining text after the last key
  const allBioParts = [preBio, detectedBio].filter(Boolean);
  const bio = allBioParts.join(" ").trim();

  return { info, bio };
}

function buildAlternativeNames(nameObj: { full?: string; alternative?: string[]; native?: string | null } | undefined): string[] {
  if (!nameObj) return [];
  const alts: string[] = [];
  for (const a of nameObj.alternative ?? []) {
    if (a && a.trim()) alts.push(a.trim());
  }
  if (nameObj.native && nameObj.native.trim()) alts.push(nameObj.native.trim());
  return alts;
}

const CHARS_QUERY = `
  query ($title: String) {
    Media(search: $title, type: ANIME) {
      id
      title { english romaji }
      characters(sort: FAVOURITES_DESC, page: 1, perPage: 50) {
        nodes {
          id
          name { full alternative native }
          image { large }
          description(asHtml: false)
        }
      }
    }
  }
`;

const CHARS_BY_ID_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { english romaji }
      characters(sort: FAVOURITES_DESC, page: 1, perPage: 80) {
        nodes {
          id
          name { full alternative native }
          image { large }
          description(asHtml: false)
        }
      }
    }
  }
`;

function parseCharNodes(
  nodes: Array<{
    id: number;
    name?: { full?: string; alternative?: string[]; native?: string | null };
    image?: { large?: string };
    description?: string;
  }> | undefined,
): AniListChar[] {
  return (nodes ?? [])
    .filter(n => n.id && n.name?.full)
    .map(n => ({
      id: n.id,
      name: n.name!.full!,
      alternativeNames: buildAlternativeNames(n.name),
      imageUrl: n.image?.large ?? null,
      description: n.description ? stripHtml(n.description) : null,
    }));
}

/**
 * Fetch the AniList Media for a title and return its ID + character list.
 * This is the primary entry-point for the by-movie route.
 */
export async function getAniListMediaWithChars(title: string): Promise<AniListMediaInfo | null> {
  const cacheKey = title.toLowerCase().trim();
  const cached = mediaInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.info;

  const data = await gql<{
    Media?: {
      id: number;
      title?: { english?: string | null; romaji?: string | null };
      characters?: {
        nodes?: Array<{
          id: number;
          name?: { full?: string; alternative?: string[]; native?: string | null };
          image?: { large?: string };
          description?: string;
        }>;
      };
    };
  }>(CHARS_QUERY, { title });

  if (!data?.Media?.id) {
    mediaInfoCache.set(cacheKey, { info: null, ts: Date.now() });
    return null;
  }

  const info: AniListMediaInfo = {
    mediaId: data.Media.id,
    titleEnglish: data.Media.title?.english ?? null,
    titleRomaji: data.Media.title?.romaji ?? null,
    chars: parseCharNodes(data.Media.characters?.nodes),
  };

  mediaInfoCache.set(cacheKey, { info, ts: Date.now() });
  return info;
}

/** Kept for backward compat — returns char list only (no media ID). */
export async function getAniListCharacters(title: string): Promise<AniListChar[]> {
  const info = await getAniListMediaWithChars(title);
  return info?.chars ?? [];
}

/**
 * Fetch characters for a specific AniList media ID.
 * Used by the `alm:` detail handler to validate chars within the exact anime.
 */
export async function getAniListCharactersByMediaId(mediaId: number): Promise<AniListChar[]> {
  const cached = mediaIdCharCache.get(mediaId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.chars;

  const data = await gql<{
    Media?: {
      id: number;
      characters?: {
        nodes?: Array<{
          id: number;
          name?: { full?: string; alternative?: string[]; native?: string | null };
          image?: { large?: string };
          description?: string;
        }>;
      };
    };
  }>(CHARS_BY_ID_QUERY, { id: mediaId });

  const chars = parseCharNodes(data?.Media?.characters?.nodes);
  mediaIdCharCache.set(mediaId, { chars, ts: Date.now() });
  return chars;
}

export type AniListRelation = {
  id: number;
  relationType: string;
  format: string | null;
  titleRomaji: string | null;
  titleEnglish: string | null;
  coverImage: string | null;
  startYear: number | null;
  averageScore: number | null;
  popularity: number;
};

const relationsCache = new Map<string, { rels: AniListRelation[]; ts: number }>();

export async function getAniListRelations(title: string): Promise<AniListRelation[]> {
  const cached = relationsCache.get(title);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rels;

  const query = `
    query ($title: String) {
      Media(search: $title, type: ANIME) {
        relations {
          edges {
            relationType
            node {
              id
              type
              format
              title { romaji english }
              coverImage { large }
              startDate { year }
              averageScore
              popularity
            }
          }
        }
      }
    }
  `;

  const data = await gql<{
    Media?: {
      relations?: {
        edges?: Array<{
          relationType?: string;
          node?: {
            id: number;
            type?: string;
            format?: string | null;
            title?: { romaji?: string; english?: string | null };
            coverImage?: { large?: string };
            startDate?: { year?: number | null };
            averageScore?: number | null;
            popularity?: number;
          };
        }>;
      };
    };
  }>(query, { title });

  const KEEP_TYPES = new Set(["PREQUEL", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "PARENT", "ALTERNATIVE", "SUMMARY"]);

  const rels: AniListRelation[] = (data?.Media?.relations?.edges ?? [])
    .filter(e => KEEP_TYPES.has(e.relationType ?? "") && e.node?.type === "ANIME" && e.node?.id)
    .map(e => ({
      id: e.node!.id,
      relationType: e.relationType ?? "",
      format: e.node!.format ?? null,
      titleRomaji: e.node!.title?.romaji ?? null,
      titleEnglish: e.node!.title?.english ?? null,
      coverImage: e.node!.coverImage?.large ?? null,
      startYear: e.node!.startDate?.year ?? null,
      averageScore: e.node!.averageScore ?? null,
      popularity: e.node!.popularity ?? 0,
    }));

  relationsCache.set(title, { rels, ts: Date.now() });
  return rels;
}

export async function getAniListCharacterByName(name: string): Promise<AniListCharDetail | null> {
  const cacheKey = name.toLowerCase().trim();
  const cached = charNameCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.detail;

  const query = `
    query ($search: String) {
      Character(search: $search) {
        id
        name { full alternative native }
        image { large }
        description(asHtml: false)
        media(sort: POPULARITY_DESC, perPage: 20, page: 1) {
          nodes {
            id
            type
            format
            title { romaji english }
            coverImage { large medium }
            averageScore
            popularity
            startDate { year }
          }
        }
      }
    }
  `;

  const data = await gql<{
    Character?: {
      id: number;
      name?: { full?: string; alternative?: string[]; native?: string | null };
      image?: { large?: string };
      description?: string;
      media?: {
        nodes?: Array<{
          id: number;
          type?: string;
          format?: string | null;
          title?: { romaji?: string; english?: string | null };
          coverImage?: { large?: string; medium?: string };
          averageScore?: number | null;
          popularity?: number;
          startDate?: { year?: number | null };
        }>;
      };
    };
  }>(query, { search: name });

  const c = data?.Character;
  if (!c) {
    charNameCache.set(cacheKey, { detail: null, ts: Date.now() });
    return null;
  }

  const rawDesc = c.description ? stripHtml(c.description) : null;
  const { info: structuredInfo, bio } = rawDesc ? parseAniListDescription(rawDesc) : { info: [], bio: "" };

  const media: AniListMedia[] = (c.media?.nodes ?? [])
    .filter(m => m.id && (m.type === "ANIME" || m.type === "MANGA"))
    .map(m => ({
      id: m.id,
      type: (m.type ?? "ANIME") as "ANIME" | "MANGA",
      format: m.format ?? null,
      titleRomaji: m.title?.romaji ?? null,
      titleEnglish: m.title?.english ?? null,
      coverImage: m.coverImage?.large ?? m.coverImage?.medium ?? null,
      averageScore: m.averageScore ?? null,
      popularity: m.popularity ?? 0,
      startYear: m.startDate?.year ?? null,
    }));

  const detail: AniListCharDetail = {
    id: c.id,
    name: c.name?.full ?? name,
    alternativeNames: buildAlternativeNames(c.name),
    imageUrl: c.image?.large ?? null,
    description: bio,
    structuredInfo,
    media,
  };

  charNameCache.set(cacheKey, { detail, ts: Date.now() });
  charDetailCache.set(c.id, { detail, ts: Date.now() });
  return detail;
}

export async function getAniListCharacterById(id: number): Promise<AniListCharDetail | null> {
  const cached = charDetailCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.detail;

  const query = `
    query ($id: Int) {
      Character(id: $id) {
        id
        name { full alternative native }
        image { large }
        description(asHtml: false)
        media(sort: POPULARITY_DESC, perPage: 25, page: 1) {
          nodes {
            id
            type
            format
            title { romaji english }
            coverImage { large medium }
            averageScore
            popularity
            startDate { year }
          }
        }
      }
    }
  `;

  const data = await gql<{
    Character?: {
      id: number;
      name?: { full?: string; alternative?: string[]; native?: string | null };
      image?: { large?: string };
      description?: string;
      media?: {
        nodes?: Array<{
          id: number;
          type?: string;
          format?: string | null;
          title?: { romaji?: string; english?: string | null };
          coverImage?: { large?: string; medium?: string };
          averageScore?: number | null;
          popularity?: number;
          startDate?: { year?: number | null };
        }>;
      };
    };
  }>(query, { id });

  const c = data?.Character;
  if (!c) {
    charDetailCache.set(id, { detail: null, ts: Date.now() });
    return null;
  }

  const rawDesc = c.description ? stripHtml(c.description) : null;
  const { info: structuredInfo, bio } = rawDesc ? parseAniListDescription(rawDesc) : { info: [], bio: "" };

  const media: AniListMedia[] = (c.media?.nodes ?? [])
    .filter(m => m.id && (m.type === "ANIME" || m.type === "MANGA"))
    .map(m => ({
      id: m.id,
      type: (m.type ?? "ANIME") as "ANIME" | "MANGA",
      format: m.format ?? null,
      titleRomaji: m.title?.romaji ?? null,
      titleEnglish: m.title?.english ?? null,
      coverImage: m.coverImage?.large ?? m.coverImage?.medium ?? null,
      averageScore: m.averageScore ?? null,
      popularity: m.popularity ?? 0,
      startYear: m.startDate?.year ?? null,
    }));

  const detail: AniListCharDetail = {
    id: c.id,
    name: c.name?.full ?? "",
    alternativeNames: buildAlternativeNames(c.name),
    imageUrl: c.image?.large ?? null,
    description: bio,
    structuredInfo,
    media,
  };

  charDetailCache.set(id, { detail, ts: Date.now() });
  return detail;
}
