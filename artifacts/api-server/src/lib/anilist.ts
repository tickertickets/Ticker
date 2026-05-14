const ANILIST_API = "https://graphql.anilist.co";
const ANILIST_UA = "TickerApp/1.0";

const CACHE_TTL = 24 * 60 * 60 * 1000;
const mediaCharCache = new Map<string, { chars: AniListChar[]; ts: number }>();
const charDetailCache = new Map<number, { detail: AniListCharDetail | null; ts: number }>();

export type AniListChar = {
  id: number;
  name: string;
  imageUrl: string | null;
  description: string | null;
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
  imageUrl: string | null;
  description: string | null;
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
    .replace(/\n{3,}/g, "\n\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 500);
}

export async function getAniListCharacters(title: string): Promise<AniListChar[]> {
  const cached = mediaCharCache.get(title);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.chars;

  const query = `
    query ($title: String) {
      Media(search: $title, type: ANIME) {
        characters(sort: FAVOURITES_DESC, page: 1, perPage: 25) {
          nodes {
            id
            name { full }
            image { large }
            description(asHtml: false)
          }
        }
      }
    }
  `;

  const data = await gql<{
    Media?: {
      characters?: {
        nodes?: Array<{
          id: number;
          name?: { full?: string };
          image?: { large?: string };
          description?: string;
        }>;
      };
    };
  }>(query, { title });

  const chars: AniListChar[] = (data?.Media?.characters?.nodes ?? [])
    .filter(n => n.id && n.name?.full)
    .map(n => ({
      id: n.id,
      name: n.name!.full!,
      imageUrl: n.image?.large ?? null,
      description: n.description ? stripHtml(n.description) : null,
    }));

  mediaCharCache.set(title, { chars, ts: Date.now() });
  return chars;
}

export async function getAniListCharacterById(id: number): Promise<AniListCharDetail | null> {
  const cached = charDetailCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.detail;

  const query = `
    query ($id: Int) {
      Character(id: $id) {
        id
        name { full }
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
      name?: { full?: string };
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
    imageUrl: c.image?.large ?? null,
    description: c.description ? stripHtml(c.description) : null,
    media,
  };

  charDetailCache.set(id, { detail, ts: Date.now() });
  return detail;
}
