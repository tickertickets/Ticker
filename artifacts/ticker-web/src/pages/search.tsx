/**
 * search.tsx — หน้าค้นหา + หมวดหมู่ภาพยนตร์
 *
 * Scroll strategy: CSS display toggle per category
 * - แต่ละหมวด (trending, now_playing, ...) มี scrollable div ของตัวเอง
 * - ซ่อน/แสดงด้วย style.display — ไม่ unmount
 * - browser เก็บ native scrollTop เองอัตโนมัติ — ไม่มี scroll bug ระหว่างหมวด
 * - lazy mount: เรนเดอร์เฉพาะหมวดที่เคยเข้าชมแล้วเท่านั้น
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { scrollStore } from "@/lib/scroll-store";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchMovies } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import {
  Film, Loader2, Search as SearchIcon, TrendingUp, Crown, Skull,
  Moon, Smile, Zap, AlertCircle, Clapperboard, X as XIcon,
  Sparkles, Globe, Wand2, Ghost, Sword, HeartCrack, Shield,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  computeCardTier,
  computeEffectTags,
  TIER_VISUAL,
  type ScoreInput,
} from "@/lib/ranks";
import { useLang, displayYear } from "@/lib/i18n";
import { MovieBadges } from "@/components/MovieBadges";
import { useEnsureMovieCores } from "@/lib/use-movie-cores";

// ── Types ──────────────────────────────────────────────────────────────────

type TrendingMovie = {
  imdbId: string;
  title: string;
  year: string | null;
  releaseDate?: string | null;
  posterUrl: string | null;
  tmdbRating?: string | null;
  voteCount?: number;
  genreIds?: number[];
  popularity?: number;
  franchiseIds?: number[];
};

type SearchMovieItem = TrendingMovie & { type?: string };
type PagedMovies = { movies: TrendingMovie[]; page: number; totalPages: number; totalResults: number };

// ── Rank visual ────────────────────────────────────────────────────────────

function getRankVisual(movie: TrendingMovie, detail?: any | null) {
  // เมื่อ detail โหลดแล้ว → ใช้เฉพาะข้อมูลจาก DB/TMDB endpoint ไม่ fallback กลับ movie list
  // เพราะ movie list (category/trending) อาจมีคะแนนต่างกับ TMDB direct endpoint
  // ทำให้ card กับ movie-detail แสดงแรงค์ตรงกันเสมอ
  const useDetail = detail != null;
  const rating     = useDetail
    ? parseFloat(detail.tmdbRating ?? detail.imdbRating ?? "0")
    : parseFloat(movie.tmdbRating ?? "0");
  const voteCount  = useDetail ? (detail.voteCount  ?? 0) : (movie.voteCount  ?? 0);
  const genreIds   = useDetail ? (detail.genreIds   ?? []) : (movie.genreIds   ?? []);
  const popularity = useDetail ? (detail.popularity ?? 0) : (movie.popularity ?? 0);
  const year       = movie.year ? parseInt(movie.year) : undefined;
  const releaseDate = useDetail ? (detail.releaseDate ?? movie.releaseDate ?? null) : (movie.releaseDate ?? null);
  const franchiseIds = useDetail ? (detail.franchiseIds ?? []) : (movie.franchiseIds ?? []);
  const input: ScoreInput = { tmdbRating: rating, voteCount, genreIds, popularity, year, releaseDate, franchiseIds };
  const tier   = computeCardTier(input);
  const visual = TIER_VISUAL[tier];
  const effects = computeEffectTags(input, tier);
  return { tier, visual, effects };
}

// ── MovieCard ──────────────────────────────────────────────────────────────

function MovieCard({ movie, grid, srclang }: { movie: TrendingMovie; grid?: boolean; srclang?: string }) {
  const { lang } = useLang();
  const { data: cachedDetail } = useQuery<any>({
    queryKey: ["/api/movies", movie.imdbId],
    queryFn: () => fetch(`/api/movies/${encodeURIComponent(movie.imdbId)}`).then(r => r.json()),
    enabled: false,
    staleTime: Infinity,
  });
  const { visual, effects, tier } = getRankVisual(movie, cachedDetail ?? null);
  const movieHref = srclang
    ? `/movie/${encodeURIComponent(movie.imdbId)}?srclang=${encodeURIComponent(srclang)}`
    : `/movie/${encodeURIComponent(movie.imdbId)}`;
  return (
    <Link
      href={movieHref}
      className={grid ? "w-full" : "flex-shrink-0"}
      onClick={() => sessionStorage.setItem("search_from_movie", "1")}
    >
      <div
        className="relative rounded-xl overflow-hidden bg-zinc-900 border border-border shimmer-no-border"
        style={grid ? { aspectRatio: "2/3", width: "100%" } : { width: 100, aspectRatio: "2/3" }}
      >
        {movie.posterUrl ? (
          <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
            <Film className="w-5 h-5 text-zinc-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80" />

        <div className="absolute" style={{ top: 6, right: 6 }}>
          <MovieBadges tier={tier} effects={effects} size="xs" layout="col" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-1.5">
          <p className="text-white text-[9px] font-bold line-clamp-2 leading-tight">{movie.title}</p>
          {movie.year && <p className="text-white/60 text-[8px]">{displayYear(movie.year, lang)}</p>}
        </div>
      </div>
    </Link>
  );
}

// ── Categories config ──────────────────────────────────────────────────────

type SectionConfig = {
  title: string; desc: string; icon: LucideIcon; color: string; emptyMsg?: string; staleTime?: number;
};

const SECTION_META: Record<string, SectionConfig> = {
  trending:          { title: "ยอดนิยม",           desc: "ดูเถอะ จะได้คุยกับชาวบ้านเขารู้เรื่อง",             icon: TrendingUp,   color: "text-red-500"    },
  now_playing:       { title: "กำลังฉาย",           desc: "กำเงินไปโรงหนังเดี๋ยวนี้เลย!",                    icon: Clapperboard, color: "text-blue-400"   },
  legendary:         { title: "LEGENDARY",          desc: "ดูแล้วเข้าใจว่าทำไมคนยังพูดถึง",                  icon: Crown,        color: "text-amber-400"  },
  cult_classic:      { title: "CULT CLASSIC",       desc: "พล็อตล้ำจนต้องร้อง ห้ะ?",                         icon: Skull,        color: "text-rose-400"   },
  "2am_deep_talk":   { title: "2 AM Deep Talk",     desc: "ตีสองแล้วยังไม่นอน มาหาเรื่องให้คิดจนเช้ากัน",    icon: Moon,         color: "text-indigo-400" },
  brain_rot:         { title: "Brain Rot",          desc: "ปล่อยสมองไหลไปกับหนัง พลังงานเหลือล้น",           icon: Zap,          color: "text-orange-400" },
  main_character:    { title: "Main Character",     desc: "ดูจบแล้วรู้สึกเหมือนเป็นพระเอก... จนกว่าจะส่องกระจก", icon: Smile,     color: "text-cyan-400"   },
  heartbreak:        { title: "อกหัก โรแมนติก",     desc: "เจ็บแล้วไม่จำ เดี๋ยวพี่ซ้ำให้เอง",                icon: HeartCrack,   color: "text-rose-400"   },
  chaos_red_flags:   { title: "Chaos & Red Flags",  desc: "ประสาทกินอย่างมีสไตล์ ใครชอบแนวนี้คือพวกเดียวกัน", icon: AlertCircle, color: "text-pink-400"   },
  anime:             { title: "Anime",              desc: "เข้าแล้วออกยาก วงการนี้ไม่มีคำว่าพัก",             icon: Sparkles,     color: "text-purple-400" },
  tokusatsu:         { title: "โทคุทัสสึ",           desc: "ระเบิดทุกตอน ไม่มีข้ออ้าง",                       icon: Sword,        color: "text-green-400"  },
  disney_dreamworks: { title: "Disney & DreamWorks", desc: "ใจฟูเบอร์แรง ดูแล้วเหมือนได้ชาร์จแบต",          icon: Wand2,        color: "text-yellow-400" },
  k_wave:            { title: "K-Wave",             desc: "เตรียมรามยอนให้พร้อม แล้วไปโอปป้ากัน",            icon: Globe,        color: "text-teal-400"   },
  midnight_horror:   { title: "Midnight Horror",    desc: "ไม่ได้น่ากลัวอย่างที่คิด... แต่นอนเปิดไฟด้วยก็ดี", icon: Ghost,       color: "text-red-400"    },
  marvel_dc:         { title: "Marvel & DC",        desc: "ดูทุกภาค หรือไม่ต้องก็ยังได้",                    icon: Shield,       color: "text-sky-400"    },
};

// Middle sections (between "กำลังฉาย" and "LEGENDARY") — reorder by time of day
const MIDDLE_SECTION_IDS = [
  "2am_deep_talk", "brain_rot", "main_character", "heartbreak", "chaos_red_flags",
  "anime", "tokusatsu", "disney_dreamworks", "k_wave", "midnight_horror", "marvel_dc",
] as const;

function getTimedMiddleOrder(): string[] {
  const h = new Date().getHours();
  // Late night / เที่ยงคืน – 5 AM: 2AM + heartbreak vibes ขึ้นก่อน
  if (h < 6)  return ["2am_deep_talk", "heartbreak", "midnight_horror", "anime", "k_wave", "chaos_red_flags", "brain_rot", "main_character", "disney_dreamworks", "marvel_dc", "tokusatsu"];
  // เช้า 6–11: เบาสบาย ครอบครัว
  if (h < 12) return ["disney_dreamworks", "marvel_dc", "anime", "main_character", "brain_rot", "k_wave", "tokusatsu", "heartbreak", "chaos_red_flags", "2am_deep_talk", "midnight_horror"];
  // บ่าย 12–17: brain rot + สนุกสนาน ไม่ต้องคิดมาก
  if (h < 18) return ["brain_rot", "anime", "disney_dreamworks", "k_wave", "main_character", "tokusatsu", "marvel_dc", "heartbreak", "chaos_red_flags", "2am_deep_talk", "midnight_horror"];
  // เย็น / กลางคืน 18–23: dark & moody + heartbreak เริ่มผงาด
  return ["chaos_red_flags", "heartbreak", "main_character", "marvel_dc", "k_wave", "anime", "brain_rot", "disney_dreamworks", "2am_deep_talk", "midnight_horror", "tokusatsu"];
}

const MIDDLE_CAT_MAP: Record<string, { id: string; label: string; icon: LucideIcon }> = {
  "2am_deep_talk":   { id: "2am_deep_talk",   label: "2 AM Deep Talk",    icon: Moon        },
  brain_rot:         { id: "brain_rot",         label: "Brain Rot",         icon: Zap         },
  main_character:    { id: "main_character",    label: "Main Character",    icon: Smile       },
  heartbreak:        { id: "heartbreak",         label: "อกหัก โรแมนติก",   icon: HeartCrack  },
  chaos_red_flags:   { id: "chaos_red_flags",   label: "Chaos & Red Flags", icon: AlertCircle },
  anime:             { id: "anime",             label: "Anime",             icon: Sparkles    },
  tokusatsu:         { id: "tokusatsu",         label: "โทคุทัสสึ",         icon: Sword       },
  disney_dreamworks: { id: "disney_dreamworks", label: "Disney & DreamWorks",icon: Wand2      },
  k_wave:            { id: "k_wave",            label: "K-Wave",            icon: Globe       },
  midnight_horror:   { id: "midnight_horror",   label: "Midnight Horror",   icon: Ghost       },
  marvel_dc:         { id: "marvel_dc",         label: "Marvel & DC",       icon: Shield      },
};

// Build the full ordered category list: fixed-first + timed-middle + fixed-last
const CATEGORIES = [
  { id: "trending",    label: "ยอดนิยม",    icon: TrendingUp   },
  { id: "now_playing", label: "กำลังฉาย",   icon: Clapperboard },
  ...getTimedMiddleOrder().map(id => MIDDLE_CAT_MAP[id]),
  { id: "legendary",   label: "LEGENDARY",  icon: Crown        },
  { id: "cult_classic",label: "CULT CLASSIC",icon: Skull       },
];


function buildFetchFn(categoryId: string, lang: string) {
  const apiLang = lang === "en" ? "en-US" : "th";
  const langQs = `&lang=${apiLang}`;
  if (categoryId === "trending")     return (p: number) => fetch(`/api/movies/trending?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "legendary")    return (p: number) => fetch(`/api/movies/top-rated?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "cult_classic") return (p: number) => fetch(`/api/movies/rare-finds?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "now_playing")  return (p: number) => fetch(`/api/movies/mood/now_playing?page=${p}${langQs}`).then(r => r.json());
  return (p: number) => fetch(`/api/movies/mood/${categoryId}?page=${p}${langQs}`).then(r => r.json());
}

// ── MovieSection — vertical grid ───────────────────────────────────────────

function MovieSectionVertical({ categoryId }: { categoryId: string }) {
  const { t, lang } = useLang();
  const base = SECTION_META[categoryId];
  const sec = t.sections[categoryId] ?? { title: base?.title ?? categoryId, desc: base?.desc ?? "" };
  const meta = base ? { ...base, title: sec.title, desc: sec.desc } : undefined;

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["movies-section-v", categoryId, lang],
    queryFn: ({ pageParam }) => buildFetchFn(categoryId, lang)(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (last: PagedMovies, allPages: PagedMovies[], lastParam: number) => {
      const loaded = allPages.reduce((s, p) => s + (p?.movies?.length ?? 0), 0);
      return lastParam < (last?.totalPages ?? 1) && loaded < 30 ? lastParam + 1 : undefined;
    },
    staleTime: meta?.staleTime ?? 0,
  });

  const movies = (data?.pages.flatMap(p => p?.movies ?? []) ?? []).slice(0, 30);

  // Pre-load rank-relevant fields for every visible card so badges show the
  // correct rank immediately instead of waiting until the user opens detail.
  useEnsureMovieCores(movies.map(m => m.imdbId));

  // Auto-fetch next pages until we have 30 movies
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && movies.length < 30) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, movies.length, fetchNextPage]);

  const Icon = meta?.icon ?? Film;
  const color = meta?.color ?? "text-foreground";

  return (
    <div className="pb-0.5">
      <div className="px-4 mb-2 mt-4">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", color)} />
          <h2 className={cn("font-display font-bold text-sm", color)}>{meta?.title}</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{meta?.desc}</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : movies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-8">
          <Icon className={cn("w-6 h-6 opacity-40", color)} />
          <p className="text-xs text-muted-foreground">{t.emptySection}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 px-4 pt-3 pb-2.5">
          {movies.map(movie => <MovieCard key={movie.imdbId} movie={movie} grid srclang={lang} />)}
        </div>
      )}
    </div>
  );
}

// ── Search language detection (mirrors server-side detectLanguage) ────────────

function detectSearchLang(text: string): string {
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-TW";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return "en-US";
}

// ── Search result row ──────────────────────────────────────────────────────

function SearchResultRow({ movie, srclang }: { movie: SearchMovieItem; srclang: string }) {
  const { lang } = useLang();
  const { data: cachedDetail } = useQuery<any>({
    queryKey: ["/api/movies", movie.imdbId],
    queryFn: () => fetch(`/api/movies/${encodeURIComponent(movie.imdbId)}`).then(r => r.json()),
    enabled: false,
    staleTime: Infinity,
  });
  const { visual, effects, tier } = getRankVisual(movie, cachedDetail ?? null);
  const href = srclang
    ? `/movie/${encodeURIComponent(movie.imdbId)}?srclang=${encodeURIComponent(srclang)}`
    : `/movie/${encodeURIComponent(movie.imdbId)}`;
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border active:bg-secondary transition-colors cursor-pointer">
        <div className="relative w-12 h-[68px] rounded-xl overflow-hidden bg-zinc-900 flex-shrink-0 border border-border shimmer-no-border">
          {movie.posterUrl
            ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-muted-foreground" /></div>}
  
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-sm text-foreground leading-tight line-clamp-2">{movie.title}</h3>
          {movie.year && <p className="text-xs text-muted-foreground mt-0.5">{displayYear(movie.year, lang)}</p>}
          <div className="mt-1">
            <MovieBadges tier={tier} effects={effects} size="xs" layout="row" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── CategoryScrollDiv — saves/restores scroll, reports scroll for header hide ─

function CategoryScrollDiv({
  catId, active, paddingTop, onScrollChange, children,
}: {
  catId: string;
  active: boolean;
  paddingTop: number;
  onScrollChange: (y: number, lastY: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `search_cat_${catId}`;
  const lastYRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollStore.get(key) ?? 0;
    lastYRef.current = saved;
    if (saved > 0) requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = saved; });
    const onScroll = () => {
      const y = el.scrollTop;
      scrollStore.set(key, y);
      onScrollChange(y, lastYRef.current);
      lastYRef.current = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollStore.set(key, el.scrollTop);
    };
  }, []); // mount/unmount only

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-y-auto overscroll-y-none"
      style={{ display: active ? "block" : "none", paddingTop, paddingBottom: 0 }}
    >
      {children}
    </div>
  );
}

// ── Movie Detective ────────────────────────────────────────────────────────

const TMDB_GENRES: { id: number; th: string; en: string }[] = [
  { id: 28,    th: "แอ็กชัน",      en: "Action" },
  { id: 12,    th: "การผจญภัย",   en: "Adventure" },
  { id: 16,    th: "แอนิเมชัน",   en: "Animation" },
  { id: 35,    th: "ตลก",         en: "Comedy" },
  { id: 80,    th: "อาชญากรรม",   en: "Crime" },
  { id: 99,    th: "สารคดี",      en: "Documentary" },
  { id: 18,    th: "ดราม่า",      en: "Drama" },
  { id: 10751, th: "ครอบครัว",    en: "Family" },
  { id: 14,    th: "แฟนตาซี",     en: "Fantasy" },
  { id: 36,    th: "ประวัติศาสตร์", en: "History" },
  { id: 27,    th: "สยองขวัญ",    en: "Horror" },
  { id: 10402, th: "ดนตรี",       en: "Music" },
  { id: 9648,  th: "ลึกลับ",      en: "Mystery" },
  { id: 10749, th: "โรแมนซ์",     en: "Romance" },
  { id: 878,   th: "ไซไฟ",        en: "Sci-Fi" },
  { id: 53,    th: "ทริลเลอร์",   en: "Thriller" },
  { id: 10752, th: "สงคราม",      en: "War" },
  { id: 37,    th: "คาวบอย",      en: "Western" },
];

const DECADES = ["1950s","1960s","1970s","1980s","1990s","2000s","2010s","2020s"];

function decadeLabel(d: string, lang: string): string {
  if (lang !== "th") return d;
  const base = parseInt(d.replace(/[^0-9]/g, ""), 10);
  if (isNaN(base)) return d;
  return `พ.ศ. ${base + 543}-${base + 552}`;
}

const DETECT_LANGS: { code: string; th: string; en: string }[] = [
  { code: "th", th: "ไทย",     en: "Thai" },
  { code: "en", th: "อังกฤษ",  en: "English" },
  { code: "ja", th: "ญี่ปุ่น",  en: "Japanese" },
  { code: "ko", th: "เกาหลี",  en: "Korean" },
  { code: "zh", th: "จีน",     en: "Chinese" },
  { code: "hi", th: "ฮินดี",   en: "Hindi" },
  { code: "fr", th: "ฝรั่งเศส", en: "French" },
  { code: "es", th: "สเปน",    en: "Spanish" },
];

type DetectResult = { movies: TrendingMovie[]; page: number; totalPages: number };

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors shrink-0",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground border-border"
      )}
    >
      {label}
    </button>
  );
}

function MovieDetective({ paddingTop }: { paddingTop: number }) {
  const { t, lang } = useLang();

  const [keyword, setKeyword] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [selectedDecade, setSelectedDecade] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [queryKeyword, setQueryKeyword] = useState("");
  const [queryGenres, setQueryGenres] = useState("");
  const [queryDecade, setQueryDecade] = useState("");
  const [queryLang, setQueryLang]     = useState("");
  const [querySrclang, setQuerySrclang] = useState("");

  const hasFilter = keyword.trim().length > 0 || selectedGenres.size > 0 || selectedDecade !== null || selectedLang !== null;

  const toggleGenre = useCallback((id: number) => {
    setSelectedGenres(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const { data, isFetching } = useQuery<DetectResult>({
    queryKey: ["detect", queryKeyword, queryGenres, queryDecade, queryLang, querySrclang],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (queryKeyword)  qs.set("query", queryKeyword);
      if (queryGenres)   qs.set("genres", queryGenres);
      if (queryDecade)   qs.set("decade", queryDecade);
      if (queryLang)     qs.set("lang", queryLang);
      if (querySrclang)  qs.set("srclang", querySrclang);
      const res = await fetch(`/api/movies/detect?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) return { movies: [], page: 1, totalPages: 1 };
      return res.json();
    },
    enabled: submitted && (!!queryKeyword || !!queryGenres || !!queryDecade || !!queryLang),
    staleTime: 1000 * 60 * 5,
  });

  const handleFind = () => {
    const kw = keyword.trim();
    const sl = kw ? detectSearchLang(kw) : lang;
    setQueryKeyword(kw);
    setQueryGenres([...selectedGenres].join(","));
    setQueryDecade(selectedDecade ?? "");
    setQueryLang(selectedLang ?? "");
    setQuerySrclang(sl);
    setSubmitted(true);
  };

  const movies = data?.movies ?? [];
  const resultSrclang = querySrclang || lang;

  // Pre-load rank-relevant fields for every detective result card.
  useEnsureMovieCores(movies.map(m => m.imdbId));

  return (
    <div
      className="absolute inset-0 overflow-y-auto overscroll-y-none"
      style={{ paddingTop, paddingBottom: 0 }}
    >
      <div className="px-4 pt-4 pb-2 space-y-5">

        {/* Keyword input */}
        <div className="space-y-2">
          <p className="text-[11px] font-black tracking-widest text-muted-foreground">{t.detectiveKeyword}</p>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && hasFilter) handleFind(); }}
            placeholder={t.detectiveKeywordPlaceholder}
            className="w-full h-11 rounded-xl border border-border bg-background px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>

        {/* Genre */}
        <div className="space-y-2">
          <p className="text-[11px] font-black tracking-widest text-muted-foreground">{t.detectiveGenre}</p>
          <div className="flex flex-wrap gap-2">
            {TMDB_GENRES.map(g => (
              <FilterChip
                key={g.id}
                label={lang === "th" ? g.th : g.en}
                active={selectedGenres.has(g.id)}
                onClick={() => toggleGenre(g.id)}
              />
            ))}
          </div>
        </div>

        {/* Era */}
        <div className="space-y-2">
          <p className="text-[11px] font-black tracking-widest text-muted-foreground">{t.detectiveDecade}</p>
          <div className="flex flex-wrap gap-2">
            {DECADES.map(d => (
              <FilterChip
                key={d}
                label={decadeLabel(d, lang)}
                active={selectedDecade === d}
                onClick={() => setSelectedDecade(prev => prev === d ? null : d)}
              />
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="space-y-2">
          <p className="text-[11px] font-black tracking-widest text-muted-foreground">{t.detectiveLang}</p>
          <div className="flex flex-wrap gap-2">
            {DETECT_LANGS.map(l => (
              <FilterChip
                key={l.code}
                label={lang === "th" ? l.th : l.en}
                active={selectedLang === l.code}
                onClick={() => setSelectedLang(prev => prev === l.code ? null : l.code)}
              />
            ))}
          </div>
        </div>

        {/* Find button */}
        <button
          onClick={handleFind}
          disabled={!hasFilter || isFetching}
          className={cn(
            "w-full h-12 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
            hasFilter && !isFetching
              ? "bg-foreground text-background active:scale-[0.98]"
              : "bg-border text-muted-foreground cursor-not-allowed"
          )}
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
          {t.detectiveFind}
        </button>

        {/* Hint before first search */}
        {!submitted && (
          <p className="text-center text-xs text-muted-foreground px-4">{t.detectiveHint}</p>
        )}

        {/* Results */}
        {submitted && !isFetching && movies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="w-14 h-14 rounded-3xl bg-secondary flex items-center justify-center">
              <Clapperboard className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-bold text-foreground">{t.noMoviesFound}</p>
            <p className="text-xs text-muted-foreground">{t.detectiveHint}</p>
          </div>
        )}

        {submitted && movies.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {movies.map(movie => <MovieCard key={movie.imdbId} movie={movie} grid srclang={resultSrclang} />)}
          </div>
        )}

      </div>
    </div>
  );
}


// ── Main page ──────────────────────────────────────────────────────────────

export default function Search() {
  const { t, lang } = useLang();
  const CATEGORIES_T = [
    { id: "detective",    label: t.detectiveTitle,                                    icon: SearchIcon },
    { id: "trending",    label: t.sections["trending"]?.title    ?? "ยอดนิยม",      icon: TrendingUp   },
    { id: "now_playing", label: t.sections["now_playing"]?.title ?? "กำลังฉาย",     icon: Clapperboard },
    ...getTimedMiddleOrder().map(id => ({
      ...MIDDLE_CAT_MAP[id],
      label: t.sections[id]?.title ?? MIDDLE_CAT_MAP[id]?.label ?? id,
    })),
    { id: "legendary",    label: t.sections["legendary"]?.title    ?? "LEGENDARY",    icon: Crown  },
    { id: "cult_classic", label: t.sections["cult_classic"]?.title ?? "CULT CLASSIC", icon: Skull  },
  ];
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 400);

  const headerRef = useRef<HTMLDivElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [headerH, setHeaderH]       = useState(130);
  const [headerHidden, setHeaderHidden] = useState(false);

  const [pillContainerW, setPillContainerW] = useState(0);
  useEffect(() => {
    const el = pillContainerRef.current;
    if (!el) return;
    const m = () => setPillContainerW(el.clientWidth);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore category when returning from movie detail; reset to trending otherwise.
  // A `?cat=<id>` query param (used by push notifications) wins over both.
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const fromQuery = qs.get("cat");
      if (fromQuery && CATEGORIES_T.some((c) => c.id === fromQuery)) {
        // Strip the param so a refresh doesn't keep overriding the user's choice.
        const url = new URL(window.location.href);
        url.searchParams.delete("cat");
        window.history.replaceState({}, "", url.toString());
        return fromQuery;
      }
    } catch { /* ignore */ }
    const fromMovie = sessionStorage.getItem("search_from_movie");
    if (fromMovie) {
      sessionStorage.removeItem("search_from_movie");
      return sessionStorage.getItem("search_category") ?? "trending";
    }
    return "trending";
  });
  const [visitedCategories, setVisitedCategories] = useState<Set<string>>(
    () => new Set([activeCategory])
  );

  // Measure header height via ResizeObserver — handles safe-area-inset on first load
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    // Re-measure after env(safe-area-inset-top) settles on first PWA launch
    const t = setTimeout(measure, 300);
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, []);

  // Header auto-hide logic — shared by all scroll sources
  const handleScrollChange = (y: number, lastY: number) => {
    if (y <= 0) {
      setHeaderHidden(false);
    } else if (y > lastY && y > headerH) {
      setHeaderHidden(true);
    } else if (y < lastY) {
      setHeaderHidden(false);
    }
  };

  // Attach scroll listener to the search-results container when it's active
  useEffect(() => {
    const el = searchResultsRef.current;
    if (!el || !debouncedQuery) return;
    let lastY = 0;
    const onScroll = () => {
      const y = el.scrollTop;
      handleScrollChange(y, lastY);
      lastY = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, headerH]);

  const handleCategoryChange = (catId: string) => {
    setVisitedCategories(prev => new Set([...prev, catId]));
    setActiveCategory(catId);
    setHeaderHidden(false);
  };

  // Persist active category so back-navigation from movie detail can restore it
  useEffect(() => {
    sessionStorage.setItem("search_category", activeCategory);
  }, [activeCategory]);

  // Manually scroll just the pill container (never the page/ancestors) so
  // mobile browsers don't shift the layout when the active pill changes.
  // First-load centering can be wrong because pill widths/icons/fonts aren't
  // measured yet on initial paint, so we re-run after layout, fonts, and a
  // couple of frames. The first run is "auto" (no animation) so the pill is
  // centered on first paint; subsequent category switches animate smoothly.
  const centerPillRanRef = useRef(false);
  useEffect(() => {
    if (!pillContainerW) return;
    let cancelled = false;
    const apply = (smooth: boolean) => {
      if (cancelled) return;
      const container = pillContainerRef.current;
      const pill = pillRefs.current.get(activeCategory);
      if (!container || !pill || pill.offsetWidth === 0) return;
      const target =
        pill.offsetLeft - (container.clientWidth - pill.offsetWidth) / 2;
      const max = Math.max(0, container.scrollWidth - container.clientWidth);
      const left = Math.max(0, Math.min(max, target));
      try {
        container.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
      } catch {
        container.scrollLeft = left;
      }
    };
    const isFirst = !centerPillRanRef.current;
    centerPillRanRef.current = true;
    apply(!isFirst);
    // Re-run after layout settles only on first load (icon/font hydration).
    // On subsequent category switches, skip re-runs to avoid jump-after-smooth.
    if (isFirst) {
      const raf1 = requestAnimationFrame(() =>
        requestAnimationFrame(() => apply(false)),
      );
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
      fonts?.ready?.then(() => apply(false)).catch(() => { /* ignore */ });
      const t = setTimeout(() => apply(false), 250);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf1);
        clearTimeout(t);
      };
    }
    return () => { cancelled = true; };
  }, [activeCategory, lang, pillContainerW]);


  const { data, isLoading } = useSearchMovies(
    { query: debouncedQuery, page: 1 },
    { query: { enabled: debouncedQuery.length > 1 } as any }
  );
  const movies = (data?.movies ?? []) as unknown as SearchMovieItem[];

  // Pre-load rank-relevant fields for every keyword search result card so the
  // badges show the correct rank immediately instead of after detail visit.
  useEnsureMovieCores(movies.map(m => m.imdbId));

  return (
    <div className="relative h-full overflow-hidden">
      {/* ── Absolute header ── */}
      <div
        ref={headerRef}
        className={cn(
          "absolute top-0 left-0 right-0 z-30",
          "bg-background/95 backdrop-blur-xl",
          !debouncedQuery && "border-b border-border",
          "transition-transform duration-300 ease-in-out",
          headerHidden && "-translate-y-full"
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {/* Title row */}
        <div className="flex items-center px-4 pt-4 pb-3">
          <div className="w-9 h-9" />
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center">Ticker</h1>
          <div className="w-9 h-9" />
        </div>
        {/* Search bar */}
        <div className={`px-4 ${debouncedQuery ? "pb-2" : "pb-3"}`}>
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <input
              className="search-bar w-full"
              style={{ paddingLeft: "2.75rem", paddingRight: query ? "2.75rem" : undefined }}
              placeholder={t.searchAnyLang}
              value={query}
              onChange={e => { setQuery(e.target.value); setHeaderHidden(false); }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10"
              >
                <XIcon className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        {/* Category tabs — hidden while searching */}
        {!debouncedQuery && (
          <div ref={pillContainerRef} className="flex items-center gap-2 pb-3 px-4 overflow-x-auto scrollbar-hide overscroll-x-contain">
            {CATEGORIES_T.map(cat => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  ref={el => { if (el) pillRefs.current.set(cat.id, el); else pillRefs.current.delete(cat.id); }}
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`filter-pill shrink-0 ${activeCategory === cat.id ? "active" : ""} flex items-center gap-1`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Search results ── */}
      {debouncedQuery && (
        <div
          ref={searchResultsRef}
          className="absolute inset-0 overflow-y-auto overscroll-y-none"
          style={{ paddingTop: headerH, paddingBottom: 0 }}
        >
          <div className="px-4 pt-0">
            {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
            {!isLoading && movies.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
                <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
                  <Clapperboard className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-display font-bold text-foreground">{t.noSearchResults}</p>
                  <p className="text-sm text-muted-foreground">{t.noUserFoundDesc}</p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 pb-2">
              {movies.map(movie => <SearchResultRow key={movie.imdbId} movie={movie} srclang={detectSearchLang(debouncedQuery)} />)}
            </div>
          </div>
        </div>
      )}

      {/* ── Category grids ── */}
      {!debouncedQuery && CATEGORIES_T.filter(cat => visitedCategories.has(cat.id) && cat.id !== "detective").map(cat => (
        <CategoryScrollDiv
          key={cat.id}
          catId={cat.id}
          active={activeCategory === cat.id}
          paddingTop={headerH}
          onScrollChange={handleScrollChange}
        >
          <MovieSectionVertical categoryId={cat.id} />
        </CategoryScrollDiv>
      ))}

      {/* ── Movie Detective ── */}
      {!debouncedQuery && visitedCategories.has("detective") && (
        <div className="absolute inset-0" style={{ display: activeCategory === "detective" ? "block" : "none" }}>
          <MovieDetective paddingTop={headerH} />
        </div>
      )}
    </div>
  );
}
