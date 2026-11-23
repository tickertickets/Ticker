import type { Lang } from "@/lib/i18n";

type GenreLabel = { th: string; en: string };

const MOVIE_GENRES: Record<number, GenreLabel> = {
  28:    { en: "Action",          th: "แอ็คชัน" },
  12:    { en: "Adventure",       th: "ผจญภัย" },
  16:    { en: "Animation",       th: "แอนิเมชัน" },
  35:    { en: "Comedy",          th: "ตลก" },
  80:    { en: "Crime",           th: "อาชญากรรม" },
  99:    { en: "Documentary",     th: "สารคดี" },
  18:    { en: "Drama",           th: "ดราม่า" },
  10751: { en: "Family",          th: "ครอบครัว" },
  14:    { en: "Fantasy",         th: "แฟนตาซี" },
  36:    { en: "History",         th: "ประวัติศาสตร์" },
  27:    { en: "Horror",          th: "สยองขวัญ" },
  10402: { en: "Music",           th: "เพลง" },
  9648:  { en: "Mystery",         th: "ลึกลับ" },
  10749: { en: "Romance",         th: "โรแมนติก" },
  878:   { en: "Science Fiction", th: "นิยายวิทยาศาสตร์" },
  10770: { en: "TV Movie",        th: "ภาพยนตร์โทรทัศน์" },
  53:    { en: "Thriller",        th: "ระทึกขวัญ" },
  10752: { en: "War",             th: "สงคราม" },
  37:    { en: "Western",         th: "ตะวันตก" },
};

const TV_GENRES: Record<number, GenreLabel> = {
  10759: { en: "Action & Adventure",       th: "แอ็คชั่น & ผจญภัย" },
  16:    { en: "Animation",                th: "แอนิเมชัน" },
  35:    { en: "Comedy",                   th: "ตลก" },
  80:    { en: "Crime",                    th: "อาชญากรรม" },
  99:    { en: "Documentary",              th: "สารคดี" },
  18:    { en: "Drama",                    th: "ดราม่า" },
  10751: { en: "Family",                   th: "ครอบครัว" },
  10762: { en: "Kids",                     th: "เด็ก" },
  9648:  { en: "Mystery",                  th: "ลึกลับ" },
  10763: { en: "News",                     th: "ข่าว" },
  10764: { en: "Reality",                  th: "เรียลลิตี้" },
  10765: { en: "Sci-Fi & Fantasy",         th: "นิยายวิทยาศาสตร์ & แฟนตาซี" },
  10766: { en: "Soap",                     th: "ละครชุด" },
  10767: { en: "Talk",                     th: "รายการสนทนา" },
  10768: { en: "War & Politics",           th: "สงคราม & การเมือง" },
  37:    { en: "Western",                  th: "ตะวันตก" },
};

export function localizeGenreIds(
  ids: number[] | null | undefined,
  isTv: boolean,
  lang: Lang,
): string[] {
  if (!ids || ids.length === 0) return [];
  const map = isTv ? TV_GENRES : MOVIE_GENRES;
  const out: string[] = [];
  for (const id of ids) {
    const entry = map[id] ?? MOVIE_GENRES[id] ?? TV_GENRES[id];
    if (entry) out.push(entry[lang]);
  }
  return out;
}

/**
 * Localize a movie/TV ticket's genre for display in the viewer's UI language.
 * Prefers TMDB genre IDs (language-independent) when available; falls back to
 * the stored `genre` string (which is in the post creator's language).
 */
export function localizeTicketGenre(
  ticket: { genre?: string | null; imdbId?: string | null; tmdbSnapshot?: unknown },
  lang: Lang,
): string {
  const isTv = typeof ticket.imdbId === "string" && ticket.imdbId.startsWith("tmdb_tv:");
  const t = ticket as unknown as Record<string, unknown>;

  // tmdbSnapshot may be a JSON string (DB column) or a parsed object.
  let snap: { genreIds?: number[] } | null = null;
  const raw = t["tmdbSnapshot"];
  if (raw && typeof raw === "object") {
    snap = raw as { genreIds?: number[] };
  } else if (typeof raw === "string") {
    try { snap = JSON.parse(raw) as { genreIds?: number[] }; } catch { snap = null; }
  }

  const live = t["movieLiveSnapshot"] as { genreIds?: number[] | null } | null | undefined;
  const ids = live?.genreIds ?? snap?.genreIds ?? [];
  const labels = localizeGenreIds(ids, isTv, lang);
  if (labels.length > 0) return labels.join(", ");

  // Fallback: reverse-lookup the stored genre string (which may be in either
  // language and may contain multiple comma-separated values) so that legacy
  // tickets without genreIds still respect the viewer's UI language.
  const stored = (ticket.genre ?? "").trim();
  if (!stored) return "";
  const parts = stored.split(/[,/]| & /).map(s => s.trim()).filter(Boolean);
  const out = parts.map(p => translateGenreName(p, lang) ?? p);
  return out.join(", ");
}

function translateGenreName(name: string, lang: Lang): string | null {
  const n = name.toLowerCase();
  for (const map of [MOVIE_GENRES, TV_GENRES]) {
    for (const id in map) {
      const e = map[id as unknown as number];
      if (e.en.toLowerCase() === n || e.th === name) return e[lang];
    }
  }
  return null;
}
