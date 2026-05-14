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

export type AniListCharDetail = {
  id: number;
  name: string;
  imageUrl: string | null;
  description: string | null;
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
        characters(sort: FAVOURITES_DESC, page: 1, perPage: 20) {
          nodes {
            id
            name { full }
            image { medium }
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
          image?: { medium?: string };
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
      imageUrl: n.image?.medium ?? null,
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
      }
    }
  `;

  const data = await gql<{
    Character?: {
      id: number;
      name?: { full?: string };
      image?: { large?: string };
      description?: string;
    };
  }>(query, { id });

  const c = data?.Character;
  const detail: AniListCharDetail | null = c ? {
    id: c.id,
    name: c.name?.full ?? "",
    imageUrl: c.image?.large ?? null,
    description: c.description ? stripHtml(c.description) : null,
  } : null;

  charDetailCache.set(id, { detail, ts: Date.now() });
  return detail;
}
