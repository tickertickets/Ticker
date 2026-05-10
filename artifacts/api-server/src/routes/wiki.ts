import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  wikiItemsTable,
  wikiItemLikesTable,
  wikiItemBookmarksTable,
  wikiItemCommentsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sanitize } from "../lib/sanitize";
import { emitWikiLiked, emitWikiCommentNew, emitWikiCommentDeleted } from "../lib/socket";
import { createNotification } from "../services/notify.service";

const router: IRouter = Router();

// ── Wikidata entertainment entity types (P31 instance-of QIDs) ────────────────
const ENTERTAINMENT_P31 = new Set([
  // Films
  "Q11424","Q202866","Q24862","Q229390","Q506240","Q28869365","Q20667187",
  "Q1361932","Q93204","Q157394","Q130232","Q200092","Q1141470","Q1366112",
  // TV / Streaming
  "Q5398426","Q1569103","Q63952888","Q7987614","Q88264233","Q66117668",
  "Q11070","Q21191270",
  // Animated
  "Q188784","Q4765080","Q220898",
  // Anime / Manga
  "Q1107","Q12136","Q21198342",
  // Fictional characters
  "Q15632617","Q3249551","Q2431196","Q1114461","Q20087604","Q21070568",
  "Q15773347","Q15773317","Q104174004","Q15773050","Q18975069","Q19842644",
  // Fictional places / things / items
  "Q14897293","Q28888","Q60091188","Q60583819","Q18619834","Q59772435",
  "Q728937","Q1229765","Q60584271","Q17537576","Q27968055",
  // Additional fictional location types (schools, cities, countries, orgs)
  "Q1244944","Q3803030","Q12308941","Q17145019","Q15831596","Q618123",
  // Additional fictional character types
  "Q13442814","Q7397","Q20742795","Q15773130","Q15773251",
  // Franchises / universes
  "Q24856","Q60064650","Q15416",
]);

async function wdFetch<T>(url: string, timeoutMs = 5000): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "TickerApp/1.0 (ticker-app)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Wikidata error: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Server-side search cache (5-minute TTL per query) ─────────────────────────
type SearchCacheEntry = { ts: number; items: unknown[] };
const searchCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL = 30 * 60 * 1000;
let searchCacheCleanTimer: ReturnType<typeof setInterval> | null = null;
if (!searchCacheCleanTimer) {
  searchCacheCleanTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (now - v.ts > SEARCH_CACHE_TTL) searchCache.delete(k);
    }
  }, 60_000);
}

// ── In-flight deduplication for search ───────────────────────────────────────
const searchInflight = new Map<string, Promise<unknown[]>>();

function detectLang(q: string): string {
  if (/[\u0E00-\u0E7F]/.test(q)) return "th";
  if (/[\u3040-\u30FF]/.test(q)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(q)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(q)) return "zh";
  return "en";
}

function commonsThumbUrl(filename: string, width = 400): string {
  const name = filename.replace(/ /g, "_");
  const hash = createHash("md5").update(name).digest("hex");
  const encoded = encodeURIComponent(name);
  // SVG files need ".png" appended to the thumb filename
  const isSvg = name.toLowerCase().endsWith(".svg");
  const thumbName = isSvg ? `${encoded}.png` : encoded;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash.slice(0, 2)}/${encoded}/${width}px-${thumbName}`;
}

// ── Fast description-based classification (no Wikidata needed) ───────────────
function classifyDescription(desc: string): { category: string; isFiction: boolean } {
  const d = desc.toLowerCase();

  // === Block disambiguation pages immediately ===
  if (/\b(disambiguation|topics referred to|may refer to|several (terms|meanings|uses)|multiple meanings)\b/.test(d)) return { category: "other", isFiction: false };

  // === Characters ===
  if (/fictional character|comic.?book character|film character|tv character|anime character|manga character|video game character/.test(d)) return { category: "character", isFiction: true };
  if (/\bcharacter (in|from|of) (the |a |an )/.test(d)) return { category: "character", isFiction: true };
  if (/fictional (human|person|being|creature|animal|monster|kaiju|titan|beast|giant|spirit|demon|deity|god|goddess|hero|villain|anti.?hero|protagonist|antagonist|wizard|witch|superhero|supervillain|robot|android|alien|elf|dwarf|hobbit|jedi|sith|ninja|pirate|vampire|werewolf|mutant|cyborg|ghost|mage|warrior|dragon|yokai|oni|specter|phantom|wraith)/.test(d)) return { category: "character", isFiction: true };
  if (/\b(kaiju|kaijuu|daikaiju)\b/.test(d)) return { category: "character", isFiction: true };
  if (/\b(iconic monster|giant monster|sea monster|movie monster|film monster)\b/.test(d)) return { category: "character", isFiction: true };
  if (/appearing in (the |a |an )?(american |japanese |korean |chinese |british )?(comic|film|movie|show|series|anime|manga|novel|game|franchise)/.test(d)) return { category: "character", isFiction: true };
  if (/\b(supervillain|superhero)\b/.test(d)) return { category: "character", isFiction: true };
  if (/\b(character|villain|hero|protagonist|antagonist|sidekick|mascot)\b.*\b(in|from|of|within)\b.*(film|movie|series|show|anime|manga|comic|game|novel|franchise|universe|saga)/i.test(d)) return { category: "character", isFiction: true };
  if (/\b(appears|appeared|appearing)\b.*(film|movie|series|show|anime|manga|comic|game)/i.test(d)) return { category: "character", isFiction: true };
  if (/\b(marvel|dc comics|pixar|disney|studio ghibli|dreamworks|warner bros animation)\b.*(character|hero|villain|superhero)/i.test(d)) return { category: "character", isFiction: true };
  if (/\b(video game character|game character|playable character|npc|protagonist of the)\b/i.test(d)) return { category: "character", isFiction: true };

  // === Fictional Locations ===
  if (/fictional (place|location|world|realm|planet|kingdom|town|village|city|school|castle|land|country|continent|island|dimension|universe|setting|territory|region|district|neighborhood|area)/.test(d)) return { category: "location", isFiction: true };

  // === Fictional Items ===
  if (/fictional (weapon|sword|shield|armor|armour|staff|wand|artifact|artefact|object|item|tool|device|crystal|ring|relic|lightsaber|gauntlet|spellbook|talisman|amulet|gem|stone)/.test(d)) return { category: "item", isFiction: true };

  // === Movies ===
  if (/\b\d{4} .*(film|animated film|feature film|short film)\b/.test(d) && !/television series/.test(d)) return { category: "movie", isFiction: true };
  if (/\b(animated film|feature film|short film|action film|horror film|superhero film|science fiction film|comedy film|drama film|thriller film|animated feature)\b/.test(d) && !/television series/.test(d)) return { category: "movie", isFiction: true };
  if (/\b\d{4}\b.*(film|movie)\b/.test(d) && !/television series/.test(d)) return { category: "movie", isFiction: true };
  if (/\b(film|movie)\b.*\b\d{4}\b/.test(d) && !/television series/.test(d)) return { category: "movie", isFiction: true };
  if (/\bdirected by\b/.test(d) && /\b(film|movie|animation|anime)\b/.test(d)) return { category: "movie", isFiction: true };

  // === Series / TV / Anime / Manga ===
  if (/\b(television series|tv series|web series|streaming series|anime series|manga series|animated series|animated tv series|shonen manga|seinen manga|shounen manga|josei manga|web manga|light novel series|manhwa series|manhua series|ova series|ona series)\b/.test(d)) return { category: "series", isFiction: true };
  if (/\b(sitcom|animated sitcom|animated comedy series|animated comedy)\b/.test(d)) return { category: "series", isFiction: true };
  if (/\b(american|japanese|korean|british|australian|canadian) (animated series|animated show|animated film|anime series|sitcom|drama series|fantasy series|sci.?fi series)\b/.test(d)) return { category: "series", isFiction: true };
  if (/\b(netflix|hulu|hbo|amazon prime|disney\+|crunchyroll|funimation) (original|series|show|anime|film)\b/.test(d)) return { category: "series", isFiction: true };
  if (/^(anime|manga)$/.test(d.trim())) return { category: "series", isFiction: true };
  if (/\b(season \d|episode \d|aired on|premiered on|first aired|first episode)\b/.test(d)) return { category: "series", isFiction: true };
  if (/\b(manga|manhwa|manhua|webtoon|light novel)\b/.test(d)) {
    // Block only if description is clearly ABOUT a real-world creator (e.g. "manga artist", "manhwa author")
    // but NOT when describing a work (e.g. "manga series written and illustrated by X")
    const isAboutCreator = /\b(manga|manhwa|manhua|webtoon) (artist|author|writer|creator|cartoonist)\b/.test(d)
      && !/\b(series|franchise|adaptation|chapter|volume|written and illustrated|story|anthology)\b/.test(d);
    if (!isAboutCreator) return { category: "series", isFiction: true };
  }

  // === Franchises / Universes ===
  if (/\b(media franchise|film franchise|anime franchise|cinematic universe|film series|comic book series)\b/.test(d)) return { category: "series", isFiction: true };

  // Generic fiction signal
  if (/\bfictional\b/.test(d)) return { category: "character", isFiction: true };

  // === Video Games ===
  if (/\b(video game|role-playing game|rpg|action-adventure game|action game|puzzle game|fighting game|platform game)\b/.test(d)) return { category: "other", isFiction: true };
  if (/\b(developed by|published by)\b.*(game|studio|games|entertainment)\b/.test(d)) return { category: "other", isFiction: true };

  // === Thai-language descriptions — strict: require explicit entertainment keywords ===
  const hasThai = /[\u0E00-\u0E7F]{3,}/.test(d);
  if (hasThai) {
    if (/ตัวละคร|นิยาย|ภาพยนตร์|อนิเมะ|มังงะ|การ์ตูน|วิดีโอเกม|ซีรีส์|อนิเมชั่น|เกม/.test(d)) {
      return { category: "other", isFiction: true };
    }
    return { category: "other", isFiction: false };
  }

  // === Japanese-language descriptions ===
  const hasJapanese = /[\u3040-\u30FF]/.test(d);
  if (hasJapanese) {
    if (/キャラクター|漫画|アニメ|映画|小説|怪獣|ヒーロー|フィクション|架空|テレビ|ゲーム|アニメーション|コミック|ドラマ|ライトノベル|ウェブ漫画/.test(d)) {
      return { category: "other", isFiction: true };
    }
    return { category: "other", isFiction: false };
  }

  // === Korean-language descriptions ===
  const hasKorean = /[\uAC00-\uD7AF]{2,}/.test(d);
  if (hasKorean) {
    if (/캐릭터|만화|애니메이션|애니|게임|영화|소설|드라마|웹툰|히어로|가상/.test(d)) {
      return { category: "other", isFiction: true };
    }
    return { category: "other", isFiction: false };
  }

  // === Chinese-language descriptions ===
  const hasChinese = /[\u4E00-\u9FFF]{3,}/.test(d);
  if (hasChinese) {
    if (/角色|漫画|动漫|游戏|电影|小说|动画|虚构|漫畫|動漫|遊戲|劇集|卡通/.test(d)) {
      return { category: "other", isFiction: true };
    }
    return { category: "other", isFiction: false };
  }

  // === Default: only block when there are clear real-world signals ===
  // Explicit real-world professions / roles that are never fictional entities
  const isRealWorldPerson =
    /\b(politician|senator|congressman|member of parliament|prime minister|president|governor|mayor|minister|diplomat|ambassador|chancellor)\b/.test(d) ||
    /\b(physicist|chemist|biologist|astronomer|mathematician|geologist|neuroscientist|archaeologist|anthropologist|economist|sociologist)\b/.test(d) ||
    /\b(footballer|soccer player|basketball player|tennis player|golfer|baseball player|olympic athlete|sprinter|marathon runner|swimmer|gymnast)\b/.test(d) ||
    /\b(pop star|rock band|boy band|girl group|rapper|hip.?hop artist|country singer|classical musician|jazz musician|record label)\b/.test(d) ||
    /\b(municipality|prefecture|province|administrative region|borough|township|hamlet|unincorporated community)\b/.test(d) ||
    /\b(born in \d{4}|died in \d{4}|\b\d{4}[–\-]\d{4}\b|b\.\s*\d{4}|d\.\s*\d{4})\b/.test(d);
  if (isRealWorldPerson) return { category: "other", isFiction: false };
  // Anything else not explicitly matched but not clearly real-world: pass through
  // (better to show a borderline item than to block legitimate entertainment content)
  return { category: "other", isFiction: true };
}

function inferCategory(p31ids: string[], description: string): string {
  const text = description.toLowerCase();
  const hasP31 = (ids: string[]) => ids.some(id => p31ids.includes(id));

  if (hasP31(["Q15632617","Q3249551","Q2431196","Q1114461","Q20087604","Q21070568","Q15773347","Q15773317","Q104174004","Q15773050","Q18975069","Q19842644"])) return "character";
  if (hasP31(["Q60583819","Q18619834","Q59772435","Q728937","Q1229765","Q60584271"])) return "item";
  if (hasP31(["Q28888","Q60091188","Q14897293","Q17537576","Q27968055"])) return "location";
  if (hasP31(["Q11424","Q202866","Q24862","Q229390","Q506240","Q28869365","Q20667187","Q1361932","Q93204","Q157394","Q130232","Q200092","Q1141470","Q1366112"])) return "movie";
  if (hasP31(["Q5398426","Q1569103","Q63952888","Q7987614","Q88264233","Q66117668","Q11070","Q188784","Q4765080","Q220898","Q1107","Q12136","Q21198342"])) return "series";
  if (hasP31(["Q24856","Q60064650","Q15416"])) return "movie";

  if (/\b(fictional (human|person|character|being|creature|animal|robot|alien|deity|god|goddess|wizard|witch|elf|dwarf|hobbit|jedi|sith|ninja|pirate|vampire|werewolf|demon|hero|villain)|comic.?book character|superhero|supervillain|film character|anime character|manga character|tv character)\b/.test(text)) return "character";
  if (/\b(fictional (place|location|world|realm|planet|kingdom|town|village|school|castle|land|country|continent|island|forest|ocean|sea|dimension|universe)|mythical (place|realm|land))\b/.test(text)) return "location";
  if (/\b(fictional (weapon|sword|shield|armor|staff|wand|artifact|object|item|tool|device|technology|vehicle|crystal|stone|ring|relic|spellbook|lightsaber)|magic (item|weapon|sword|artifact)|magical artifact)\b/.test(text)) return "item";
  if (/\b(film|feature film|animated film|documentary film|short film|motion picture)\b/.test(text) && !/\btelevision series\b/.test(text)) return "movie";
  if (/\b(television series|tv series|web series|streaming series|anime series|anime\b|manga\b|manga series|cartoon|animated series|animated tv series)\b/.test(text)) return "series";
  if (/\b(franchise|media franchise|cinematic universe|film series|book series|comic series)\b/.test(text)) return "other";
  if (/\bfictional\b/.test(text)) return "character";
  if (/\b(film\b|movie\b)\b/.test(text)) return "movie";
  if (/\b(series\b|television\b|anime\b|manga\b)\b/.test(text)) return "series";
  return "other";
}

type WdEntityData = {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Array<{ mainsnak: { datavalue?: { value?: unknown } } }>>;
  sitelinks?: Record<string, { title: string }>;
};

type EntityInfo = { p31ids: string[]; p18: string | null; sitelinkEnTitle: string | null };

async function fetchEntityBatch(qids: string[]): Promise<Map<string, EntityInfo>> {
  const result = new Map<string, EntityInfo>();
  if (qids.length === 0) return result;
  const BATCH = 50;
  await Promise.all(
    Array.from({ length: Math.ceil(qids.length / BATCH) }, (_, i) =>
      qids.slice(i * BATCH, (i + 1) * BATCH)
    ).map(async batch => {
      try {
        const url = new URL("https://www.wikidata.org/w/api.php");
        url.searchParams.set("action", "wbgetentities");
        url.searchParams.set("ids", batch.join("|"));
        url.searchParams.set("props", "claims|sitelinks");
        url.searchParams.set("sitefilter", "enwiki");
        url.searchParams.set("format", "json");
        url.searchParams.set("origin", "*");
        const data = await wdFetch<{ entities?: Record<string, WdEntityData> }>(url.toString());
        for (const [qid, ent] of Object.entries(data.entities ?? {})) {
          const p31ids = (ent.claims?.["P31"] ?? [])
            .map(c => {
              const v = c.mainsnak?.datavalue?.value;
              return v && typeof v === "object" && "id" in v ? (v as { id: string }).id : null;
            })
            .filter((id): id is string => id !== null);
          const p18Raw = ent.claims?.["P18"]?.[0]?.mainsnak?.datavalue?.value;
          const p18 = (p18Raw && typeof p18Raw === "string") ? p18Raw : null;
          const sitelinkEnTitle = ent.sitelinks?.["enwiki"]?.title ?? null;
          result.set(qid, { p31ids, p18, sitelinkEnTitle });
        }
      } catch { /* ignore per-batch errors */ }
    })
  );
  return result;
}

async function getEngagement(itemId: string, userId?: string) {
  const [likeRow] = await db.select({ n: count() }).from(wikiItemLikesTable)
    .where(eq(wikiItemLikesTable.wikiItemId, itemId)).catch(() => [{ n: 0 }]);
  const [commentRow] = await db.select({ n: count() }).from(wikiItemCommentsTable)
    .where(eq(wikiItemCommentsTable.wikiItemId, itemId)).catch(() => [{ n: 0 }]);
  let isLiked = false;
  let isBookmarked = false;
  if (userId) {
    const [lr] = await db.select().from(wikiItemLikesTable)
      .where(and(eq(wikiItemLikesTable.userId, userId), eq(wikiItemLikesTable.wikiItemId, itemId)))
      .limit(1).catch(() => [null]);
    isLiked = !!lr;
    const [br] = await db.select().from(wikiItemBookmarksTable)
      .where(and(eq(wikiItemBookmarksTable.userId, userId), eq(wikiItemBookmarksTable.wikiItemId, itemId)))
      .limit(1).catch(() => [null]);
    isBookmarked = !!br;
  }
  return { likeCount: Number(likeRow?.n ?? 0), commentCount: Number(commentRow?.n ?? 0), isLiked, isBookmarked };
}

// ── GET /wiki/recent ──────────────────────────────────────────────────────────
router.get("/recent", async (req, res) => {
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const pageSize = 10;
  try {
    const allItems = await fetchPopularFictionItems();
    const start = (page - 1) * pageSize;
    const pageItems = allItems.slice(start, start + pageSize);
    res.json({ items: pageItems, hasMore: start + pageSize < allItems.length, page });
  } catch (err) {
    console.error("[wiki] recent error:", err);
    res.json({ items: [], hasMore: false, page });
  }
});

// ── Popular fiction items via Wikipedia pageviews ─────────────────────────────

type PopularFictionItem = {
  wikiPageId: string;
  title: string;
  excerpt: string | null;
  thumbnailUrl: string | null;
  url: string;
  lang: string;
  category: string;
};

let popularCache: { date: string; items: PopularFictionItem[] } | null = null;
let popularFetching = false;
let popularFetchPromise: Promise<PopularFictionItem[]> | null = null;

const SKIP_ARTICLES = /^(Main_Page|Special:|Wikipedia:|WP:|Portal:|File:|Template:|Help:|Category:|Talk:|User:|MediaWiki:)/;

async function fetchPopularFictionItems(): Promise<PopularFictionItem[]> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (popularCache && popularCache.date === todayUtc) return popularCache.items;
  if (popularFetching && popularFetchPromise) return popularFetchPromise;

  popularFetching = true;
  popularFetchPromise = (async (): Promise<PopularFictionItem[]> => {
    try {
      const yd = new Date(Date.now() - 86_400_000);
      const yr = yd.getUTCFullYear();
      const mo = String(yd.getUTCMonth() + 1).padStart(2, "0");
      const dy = String(yd.getUTCDate()).padStart(2, "0");
      const pvUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${yr}/${mo}/${dy}`;

      const pvData = await wdFetch<{ items?: Array<{ articles?: Array<{ article: string; views: number }> }> }>(pvUrl)
        .catch(() => ({ items: [] }));

      const topArticles = (pvData.items?.[0]?.articles ?? [])
        .filter(a => !SKIP_ARTICLES.test(a.article))
        .slice(0, 1000)
        .map(a => a.article);

      if (topArticles.length === 0) return popularCache?.items ?? [];

      const BATCH = 50;
      const wpInfoMap = new Map<string, { qid: string | null; thumb: string | null; extract: string }>();

      await Promise.all(
        Array.from({ length: Math.ceil(topArticles.length / BATCH) }, (_, i) =>
          topArticles.slice(i * BATCH, (i + 1) * BATCH)
        ).map(async batch => {
          try {
            const ppUrl = new URL("https://en.wikipedia.org/w/api.php");
            ppUrl.searchParams.set("action", "query");
            ppUrl.searchParams.set("titles", batch.join("|"));
            ppUrl.searchParams.set("prop", "pageprops|pageimages|extracts");
            ppUrl.searchParams.set("ppprop", "wikibase_item");
            ppUrl.searchParams.set("pithumbsize", "300");
            ppUrl.searchParams.set("pilicense", "any");
            ppUrl.searchParams.set("exintro", "1");
            ppUrl.searchParams.set("explaintext", "1");
            ppUrl.searchParams.set("exsentences", "2");
            ppUrl.searchParams.set("format", "json");
            ppUrl.searchParams.set("origin", "*");
            const ppData = await wdFetch<{
              query?: { pages?: Record<string, { title?: string; pageprops?: { wikibase_item?: string }; thumbnail?: { source: string }; extract?: string }> };
            }>(ppUrl.toString()).catch(() => ({}));
            for (const page of Object.values(ppData.query?.pages ?? {})) {
              if (page.title) {
                wpInfoMap.set(page.title, {
                  qid: page.pageprops?.wikibase_item ?? null,
                  thumb: page.thumbnail?.source ?? null,
                  extract: (page.extract ?? "").slice(0, 300),
                });
              }
            }
          } catch { /* ignore */ }
        })
      );

      const qidToTitle = new Map<string, string>();
      for (const [title, info] of wpInfoMap) {
        if (info.qid) qidToTitle.set(info.qid, title);
      }
      const allQids = [...qidToTitle.keys()];
      if (allQids.length === 0) return popularCache?.items ?? [];

      const entityMap = new Map<string, WdEntityData>();
      await Promise.all(
        Array.from({ length: Math.ceil(allQids.length / BATCH) }, (_, i) =>
          allQids.slice(i * BATCH, (i + 1) * BATCH)
        ).map(async batch => {
          try {
            const entUrl = new URL("https://www.wikidata.org/w/api.php");
            entUrl.searchParams.set("action", "wbgetentities");
            entUrl.searchParams.set("ids", batch.join("|"));
            entUrl.searchParams.set("props", "labels|descriptions|claims");
            entUrl.searchParams.set("languages", "en");
            entUrl.searchParams.set("format", "json");
            entUrl.searchParams.set("origin", "*");
            const entData = await wdFetch<{ entities?: Record<string, WdEntityData> }>(entUrl.toString()).catch(() => ({}));
            for (const [qid, ent] of Object.entries(entData.entities ?? {})) {
              entityMap.set(qid, ent);
            }
          } catch { /* ignore */ }
        })
      );

      const results: PopularFictionItem[] = [];
      for (const qid of allQids) {
        const entity = entityMap.get(qid);
        if (!entity) continue;

        const p31ids = (entity.claims?.["P31"] ?? [])
          .map(claim => {
            const val = claim.mainsnak?.datavalue?.value;
            if (val && typeof val === "object" && "id" in val) return (val as { id: string }).id;
            return null;
          }).filter((id): id is string => id !== null);

        const description = entity.descriptions?.["en"]?.value ?? "";
        const category = inferCategory(p31ids, description);
        if (category !== "character" && category !== "item" && category !== "location") continue;

        const title = entity.labels?.["en"]?.value;
        if (!title) continue;

        const wpTitle = qidToTitle.get(qid)!;
        const wpInfo = wpInfoMap.get(wpTitle);

        let thumbnailUrl: string | null = wpInfo?.thumb ?? null;
        if (!thumbnailUrl) {
          const p18Val = entity.claims?.["P18"]?.[0]?.mainsnak?.datavalue?.value;
          if (p18Val && typeof p18Val === "string") thumbnailUrl = commonsThumbUrl(p18Val, 300);
        }

        results.push({
          wikiPageId: `wd:${qid}`,
          title,
          excerpt: wpInfo?.extract || description || null,
          thumbnailUrl,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(wpTitle)}`,
          lang: "en",
          category,
        });
      }

      popularCache = { date: todayUtc, items: results };
      return results;
    } finally {
      popularFetching = false;
      popularFetchPromise = null;
    }
  })();

  return popularFetchPromise;
}

// ── GET /wiki/popular ─────────────────────────────────────────────────────────
router.get("/popular", async (req, res) => {
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const pageSize = 10;
  try {
    const allItems = await fetchPopularFictionItems();
    const start = (page - 1) * pageSize;
    res.json({ items: allItems.slice(start, start + pageSize), hasMore: start + pageSize < allItems.length, page });
  } catch (err) {
    console.error("[wiki] popular error:", err);
    res.json({ items: [], hasMore: false, page });
  }
});

// ── GET /wiki/bookmarks ───────────────────────────────────────────────────────
router.get("/bookmarks", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const items = await db
      .select({
        id: wikiItemsTable.id,
        wikiPageId: wikiItemsTable.wikiPageId,
        title: wikiItemsTable.title,
        excerpt: wikiItemsTable.excerpt,
        thumbnailUrl: wikiItemsTable.thumbnailUrl,
        url: wikiItemsTable.url,
        lang: wikiItemsTable.lang,
        category: wikiItemsTable.category,
      })
      .from(wikiItemBookmarksTable)
      .innerJoin(wikiItemsTable, eq(wikiItemsTable.id, wikiItemBookmarksTable.wikiItemId))
      .where(eq(wikiItemBookmarksTable.userId, currentUserId))
      .orderBy(desc(wikiItemBookmarksTable.createdAt))
      .catch(() => []);
    res.json({ items });
  } catch (err) {
    console.error("[wiki] bookmarks error:", err);
    res.json({ items: [] });
  }
});

// ── GET /wiki/search ─────────────────────────────────────────────────────────
// Searches Wikipedia + Wikidata and filters to fiction-only using P31 batch check.
// Only returns wd:* IDs — real-world items are blocked by requiring P31 match.
router.get("/search", async (req, res) => {
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (!q) { res.json({ items: [] }); return; }
  const limit = Math.min(Number(req.query["limit"]) || 12, 20);
  const lang = detectLang(q);
  const cacheKey = `${lang}:${q.toLowerCase()}`;

  // Serve from cache if fresh
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    res.json({ items: cached.items.slice(0, limit) });
    return;
  }

  // Deduplicate in-flight requests for the same query
  const inflight = searchInflight.get(cacheKey);
  if (inflight) {
    try {
      const items = await inflight;
      res.json({ items: items.slice(0, limit) });
    } catch {
      res.json({ items: [] });
    }
    return;
  }

  const doSearch = async (): Promise<unknown[]> => {
    // ── Step 1: Wikipedia REST search in parallel per language (~200ms) ────────
    const searchLangs = lang === "en" ? ["en"] : [lang, "en"];
    type WpRestPage = { key: string; title: string; description?: string; thumbnail?: { url: string } };

    const restResults = await Promise.all(
      searchLangs.map(async (sl): Promise<(WpRestPage & { sl: string })[]> => {
        try {
          const url = `https://${sl}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=20`;
          const data = await wdFetch<{ pages?: WpRestPage[] }>(url, 4000);
          return (data.pages ?? []).map(p => ({ ...p, sl }));
        } catch { return []; }
      })
    );

    // Merge + deduplicate by sl:key
    const seenKeys = new Set<string>();
    const allPages: (WpRestPage & { sl: string })[] = [];
    for (const pages of restResults) {
      for (const p of pages) {
        const k = `${p.sl}:${p.key}`;
        if (!seenKeys.has(k)) { seenKeys.add(k); allPages.push(p); }
      }
    }
    if (allPages.length === 0) return [];

    // ── Step 2: Wikipedia pageprops batch per language (QID + HD thumb + extract) ──
    const titlesByLang = new Map<string, string[]>();
    for (const p of allPages) {
      const arr = titlesByLang.get(p.sl) ?? [];
      arr.push(p.title);
      titlesByLang.set(p.sl, arr);
    }

    type WpPageDetail = { title?: string; thumbnail?: { source: string }; pageprops?: { wikibase_item?: string }; extract?: string };
    const qidMap = new Map<string, string>();
    const wpThumbMap = new Map<string, string>();
    const extractMap = new Map<string, string>();

    await Promise.all(Array.from(titlesByLang.entries()).map(async ([sl, titles]) => {
      try {
        const url = new URL(`https://${sl}.wikipedia.org/w/api.php`);
        url.searchParams.set("action", "query");
        url.searchParams.set("titles", titles.join("|"));
        url.searchParams.set("prop", "pageprops|pageimages|extracts");
        url.searchParams.set("ppprop", "wikibase_item");
        url.searchParams.set("pithumbsize", "400");
        url.searchParams.set("pilicense", "any");
        url.searchParams.set("exintro", "1");
        url.searchParams.set("explaintext", "1");
        url.searchParams.set("exsentences", "3");
        url.searchParams.set("format", "json");
        url.searchParams.set("origin", "*");
        const data = await wdFetch<{ query?: { pages?: Record<string, WpPageDetail> } }>(url.toString(), 4000);
        for (const page of Object.values(data.query?.pages ?? {})) {
          if (!page.title) continue;
          const k = `${sl}:${page.title}`;
          if (page.pageprops?.wikibase_item) qidMap.set(k, page.pageprops.wikibase_item);
          if (page.thumbnail?.source) wpThumbMap.set(k, page.thumbnail.source);
          if (page.extract) extractMap.set(k, page.extract.slice(0, 500));
        }
      } catch { /* ignore */ }
    }));

    // ── Step 3: Build results using description classification (no Wikidata batch) ──
    const seenQids = new Set<string>();
    const results: {
      wikiPageId: string; title: string; excerpt: string;
      thumbnailUrl: string | null; url: string; lang: string; category: string;
    }[] = [];

    for (const page of allPages) {
      if (results.length >= 15) break;
      const k = `${page.sl}:${page.title}`;
      const qid = qidMap.get(k);
      const wikiPageId = qid ? `wd:${qid}` : `wp:${page.sl}:${page.key}`;
      if (seenQids.has(wikiPageId)) continue;

      const descText = page.description ?? "";
      const extractText = extractMap.get(k) ?? "";
      // Use extract as fallback when REST description is missing (common on non-English Wikipedias)
      const classifyText = descText || extractText.slice(0, 300);
      const { category, isFiction } = classifyDescription(classifyText);
      if (!isFiction) continue;

      seenQids.add(wikiPageId);
      // Prefer high-res pageimages thumb; fall back to REST thumbnail (both are direct URLs)
      const thumbnailUrl = wpThumbMap.get(k) || page.thumbnail?.url || null;
      const excerpt = extractText || descText || "";

      results.push({
        wikiPageId,
        title: page.title,
        excerpt,
        thumbnailUrl,
        url: `https://${page.sl}.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
        lang: page.sl,
        category,
      });
    }

    // ── Step 4: Persist to DB (fire-and-forget) ───────────────────────────────
    void (async () => {
      for (const r of results) {
        try {
          const [existing] = await db.select({ id: wikiItemsTable.id })
            .from(wikiItemsTable).where(eq(wikiItemsTable.wikiPageId, r.wikiPageId)).limit(1);
          if (!existing) {
            await db.insert(wikiItemsTable).values({
              id: nanoid(),
              wikiPageId: r.wikiPageId,
              title: r.title,
              excerpt: r.excerpt || null,
              thumbnailUrl: r.thumbnailUrl,
              url: r.url,
              lang: r.lang,
              category: r.category,
            }).onConflictDoNothing();
          }
        } catch { /* ignore */ }
      }
    })();

    return results.map(r => ({
      pageId: r.wikiPageId,
      wikiPageId: r.wikiPageId,
      title: r.title,
      excerpt: r.excerpt,
      thumbnailUrl: r.thumbnailUrl,
      url: r.url,
      lang: r.lang,
      category: r.category,
    }));
  };

  const promise = doSearch().then(items => {
    searchCache.set(cacheKey, { ts: Date.now(), items });
    searchInflight.delete(cacheKey);
    return items;
  }).catch(err => {
    searchInflight.delete(cacheKey);
    throw err;
  });
  searchInflight.set(cacheKey, promise);

  try {
    const items = await promise;
    res.json({ items: items.slice(0, limit) });
  } catch (err) {
    console.error("[wiki] search error:", err);
    // Return stale cache if available rather than empty
    const stale = searchCache.get(cacheKey);
    res.json({ items: stale ? stale.items.slice(0, limit) : [] });
  }
});

// ── GET /wiki/:wikiPageId — detail with ?lang=en|th&thumb=URL ─────────────────
// thumb=URL is a client-provided fallback thumbnail (from search results).
router.get("/:wikiPageId", async (req, res) => {
  const currentUserId = req.session?.userId;
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const requestedLang = typeof req.query["lang"] === "string" ? req.query["lang"].trim() : "en";
  const thumbFallback = typeof req.query["thumb"] === "string" ? req.query["thumb"].trim() : null;

  if (!wikiPageId.startsWith("wd:")) {
    // Legacy wp:* items — try DB lookup only
    const [item] = await db.select().from(wikiItemsTable)
      .where(eq(wikiItemsTable.wikiPageId, wikiPageId))
      .limit(1).catch(() => [null]);
    if (!item) { res.status(404).json({ error: "not_found" }); return; }
    const engagement = await getEngagement(item.id, currentUserId);
    res.json({ item, ...engagement });
    return;
  }

  const wikidataId = wikiPageId.slice(3);
  const lang = requestedLang || "en";

  // Check DB cache
  let [item] = await db.select().from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId))
    .limit(1).catch(() => [null]);

  if (!item || item.lang !== lang) {
    try {
      const entUrl = new URL("https://www.wikidata.org/w/api.php");
      entUrl.searchParams.set("action", "wbgetentities");
      entUrl.searchParams.set("ids", wikidataId);
      entUrl.searchParams.set("props", "labels|descriptions|claims|sitelinks");
      entUrl.searchParams.set("languages", `${lang}|en`);
      entUrl.searchParams.set("sitefilter", `${lang}wiki|enwiki`);
      entUrl.searchParams.set("format", "json");
      entUrl.searchParams.set("origin", "*");

      const entData = await wdFetch<{
        entities?: Record<string, {
          labels?: Record<string, { value: string }>;
          descriptions?: Record<string, { value: string }>;
          claims?: Record<string, Array<{ mainsnak: { datavalue?: { value?: unknown } } }>>;
          sitelinks?: Record<string, { title: string }>;
        }>;
      }>(entUrl.toString());

      const entity = entData.entities?.[wikidataId];
      if (!entity) {
        // Entity not found — serve from DB cache if possible, else 404
        if (item) {
          const engagement = await getEngagement(item.id, currentUserId);
          res.json({ item, ...engagement });
          return;
        }
        res.status(404).json({ error: "not_found" });
        return;
      }

      const title = entity.labels?.[lang]?.value ?? entity.labels?.["en"]?.value ?? wikidataId;
      const description = entity.descriptions?.[lang]?.value ?? entity.descriptions?.["en"]?.value ?? "";

      // Thumbnail priority:
      // 1. Wikipedia pageimages (fetched below) — most reliable
      // 2. Existing DB thumbnail (preserved across refetches)
      // 3. Wikidata P18 (Commons URL — sometimes broken)
      // 4. Client-provided thumb fallback from search results
      let thumbnailUrl: string | null = item?.thumbnailUrl ?? null;

      const p31ids = (entity.claims?.["P31"] ?? [])
        .map(claim => {
          const val = claim.mainsnak?.datavalue?.value;
          if (val && typeof val === "object" && "id" in val) return (val as { id: string }).id;
          return null;
        }).filter((id): id is string => id !== null);

      let excerpt: string | null = null;
      let wikiUrl = `https://www.wikidata.org/wiki/${wikidataId}`;

      const sl = entity.sitelinks?.[`${lang}wiki`] ?? entity.sitelinks?.["enwiki"];
      const wikiLang = entity.sitelinks?.[`${lang}wiki`] ? lang : "en";

      if (sl?.title) {
        try {
          const wpUrl = new URL(`https://${wikiLang}.wikipedia.org/w/api.php`);
          wpUrl.searchParams.set("action", "query");
          wpUrl.searchParams.set("titles", sl.title);
          wpUrl.searchParams.set("prop", "extracts|pageimages|info");
          wpUrl.searchParams.set("exintro", "1");
          wpUrl.searchParams.set("explaintext", "1");
          wpUrl.searchParams.set("pithumbsize", "600");
          wpUrl.searchParams.set("inprop", "url");
          wpUrl.searchParams.set("format", "json");
          wpUrl.searchParams.set("origin", "*");

          const wpData = await wdFetch<{
            query?: { pages?: Record<string, { extract?: string; thumbnail?: { source: string }; fullurl?: string }> };
          }>(wpUrl.toString());

          const page = Object.values(wpData.query?.pages ?? {})[0];
          if (page) {
            excerpt = (page.extract ?? "").slice(0, 10000) || description || null;
            // Wikipedia thumbnail is always preferred (direct URL, never broken)
            if (page.thumbnail?.source) thumbnailUrl = page.thumbnail.source;
            if (page.fullurl) wikiUrl = page.fullurl;
          }
        } catch { /* ignore — use fallbacks below */ }
      }

      // Apply fallback chain if no thumbnail from Wikipedia pageimages
      if (!thumbnailUrl) {
        const p18Val = entity.claims?.["P18"]?.[0]?.mainsnak?.datavalue?.value;
        if (p18Val && typeof p18Val === "string") thumbnailUrl = commonsThumbUrl(p18Val, 600);
      }
      if (!thumbnailUrl && thumbFallback) thumbnailUrl = thumbFallback;

      if (!excerpt) excerpt = description || null;

      const category = inferCategory(p31ids, description);
      const newData = { title, excerpt, thumbnailUrl, url: wikiUrl, lang, category };

      if (item) {
        if (lang === "en") {
          await db.update(wikiItemsTable).set(newData).where(eq(wikiItemsTable.id, item.id)).catch(() => {});
        }
        item = { ...item, ...newData } as typeof item;
      } else {
        const newItem = { id: nanoid(), wikiPageId, ...newData };
        if (lang === "en") {
          await db.insert(wikiItemsTable).values(newItem).onConflictDoNothing().catch(() => {});
        }
        item = newItem as typeof item;
      }
    } catch (err) {
      console.error("[wiki] detail fetch error:", err);
      if (!item) { res.status(404).json({ error: "not_found" }); return; }
    }
  }

  const engagement = await getEngagement(item!.id, currentUserId);
  res.json({ item, ...engagement });
});

// ── POST /wiki/:wikiPageId/like ───────────────────────────────────────────────
router.post("/:wikiPageId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.status(404).json({ error: "not_found" }); return; }
  await db.insert(wikiItemLikesTable).values({ userId: currentUserId, wikiItemId: item.id }).onConflictDoNothing().catch(() => {});
  const [countRow] = await db.select({ n: count() }).from(wikiItemLikesTable).where(eq(wikiItemLikesTable.wikiItemId, item.id)).catch(() => [{ n: 0 }]);
  emitWikiLiked(wikiPageId, Number(countRow?.n ?? 0));
  res.json({ success: true });
});

// ── DELETE /wiki/:wikiPageId/like ─────────────────────────────────────────────
router.delete("/:wikiPageId/like", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.status(404).json({ error: "not_found" }); return; }
  await db.delete(wikiItemLikesTable)
    .where(and(eq(wikiItemLikesTable.userId, currentUserId), eq(wikiItemLikesTable.wikiItemId, item.id))).catch(() => {});
  const [countRow] = await db.select({ n: count() }).from(wikiItemLikesTable).where(eq(wikiItemLikesTable.wikiItemId, item.id)).catch(() => [{ n: 0 }]);
  emitWikiLiked(wikiPageId, Number(countRow?.n ?? 0));
  res.json({ success: true });
});

// ── POST /wiki/:wikiPageId/bookmark ──────────────────────────────────────────
router.post("/:wikiPageId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.status(404).json({ error: "not_found" }); return; }
  await db.insert(wikiItemBookmarksTable).values({ userId: currentUserId, wikiItemId: item.id }).onConflictDoNothing().catch(() => {});
  res.json({ success: true });
});

// ── DELETE /wiki/:wikiPageId/bookmark ────────────────────────────────────────
router.delete("/:wikiPageId/bookmark", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.status(404).json({ error: "not_found" }); return; }
  await db.delete(wikiItemBookmarksTable)
    .where(and(eq(wikiItemBookmarksTable.userId, currentUserId), eq(wikiItemBookmarksTable.wikiItemId, item.id))).catch(() => {});
  res.json({ success: true });
});

// ── GET /wiki/:wikiPageId/comments ────────────────────────────────────────────
router.get("/:wikiPageId/comments", async (req, res) => {
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.json({ comments: [] }); return; }
  const comments = await db
    .select({
      id: wikiItemCommentsTable.id,
      content: wikiItemCommentsTable.content,
      createdAt: wikiItemCommentsTable.createdAt,
      userId: wikiItemCommentsTable.userId,
      replyToId: wikiItemCommentsTable.replyToId,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(wikiItemCommentsTable)
    .leftJoin(usersTable, eq(wikiItemCommentsTable.userId, usersTable.id))
    .where(eq(wikiItemCommentsTable.wikiItemId, item.id))
    .orderBy(desc(wikiItemCommentsTable.createdAt))
    .limit(100)
    .catch(() => []);
  res.json({ comments });
});

// ── POST /wiki/:wikiPageId/comments ──────────────────────────────────────────
router.post("/:wikiPageId/comments", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const wikiPageId = decodeURIComponent(String(req.params["wikiPageId"]));
  const { content, replyToId } = req.body;
  if (!content || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content_required" }); return;
  }
  const [item] = await db.select({ id: wikiItemsTable.id }).from(wikiItemsTable)
    .where(eq(wikiItemsTable.wikiPageId, wikiPageId)).limit(1).catch(() => [null]);
  if (!item) { res.status(404).json({ error: "not_found" }); return; }
  const id = nanoid();
  const sanitized = sanitize(content.trim());
  const validReplyToId = replyToId && typeof replyToId === "string" ? replyToId : null;
  await db.insert(wikiItemCommentsTable).values({ id, wikiItemId: item.id, userId: currentUserId, content: sanitized, replyToId: validReplyToId });
  const [user] = await db.select({ username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1).catch(() => [null]);
  emitWikiCommentNew(wikiPageId);

  // Notify parent comment author when this is a reply (best-effort)
  if (validReplyToId) {
    try {
      const [parentComment] = await db.select({ userId: wikiItemCommentsTable.userId })
        .from(wikiItemCommentsTable).where(eq(wikiItemCommentsTable.id, validReplyToId)).limit(1);
      const parentAuthorId = parentComment?.userId;
      if (parentAuthorId && parentAuthorId !== currentUserId) {
        await createNotification({
          id: nanoid(),
          userId: parentAuthorId,
          fromUserId: currentUserId,
          type: "wiki_comment_reply",
          message: wikiPageId,
          isRead: false,
        });
      }
    } catch { /* best-effort */ }
  }

  res.json({ id, content: sanitized, createdAt: new Date().toISOString(), userId: currentUserId, replyToId: validReplyToId, username: user?.username ?? null, displayName: user?.displayName ?? null, avatarUrl: user?.avatarUrl ?? null });
});

// ── DELETE /wiki/:wikiPageId/comments/:commentId ──────────────────────────────
router.delete("/:wikiPageId/comments/:commentId", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { commentId } = req.params;
  const [comment] = await db.select().from(wikiItemCommentsTable)
    .where(eq(wikiItemCommentsTable.id, commentId)).limit(1).catch(() => [null]);
  if (!comment) { res.status(404).json({ error: "not_found" }); return; }
  if (comment.userId !== currentUserId) { res.status(403).json({ error: "forbidden" }); return; }
  await db.delete(wikiItemCommentsTable).where(eq(wikiItemCommentsTable.id, commentId)).catch(() => {});
  const wikiPageIdForEmit = decodeURIComponent(String(req.params["wikiPageId"]));
  emitWikiCommentDeleted(wikiPageIdForEmit);
  res.json({ success: true });
});

export default router;
