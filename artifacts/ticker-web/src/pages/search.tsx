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
import { useAuth } from "@/hooks/use-auth";
import {
  Film, Loader2, Search as SearchIcon, TrendingUp, Crown, Skull,
  Moon, Smile, Zap, AlertCircle, Clapperboard, X as XIcon,
  Sparkles, Globe, Wand2, Ghost, Sword, HeartCrack, Shield,
  Dice5, Swords,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { RandomMoviePicker } from "@/components/RandomMoviePicker";
import { MovieVsPicker } from "@/components/MovieVsPicker";
import { cn } from "@/lib/utils";
import {
  computeCardTier, computeEffectTags, TIER_VISUAL, type ScoreInput,
} from "@/lib/ranks";
import { useLang, displayYear } from "@/lib/i18n";
import { MovieBadges } from "@/components/MovieBadges";
import { useEnsureMovieCores } from "@/lib/use-movie-cores";
import { useQueryClient } from "@tanstack/react-query";

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

// ── Rank visual ─────────────────────────────────────────────────────────────

function getRankVisual(movie: TrendingMovie, detail?: any | null) {
  const useDetail = detail != null;
  const rating     = useDetail ? parseFloat(detail.tmdbRating ?? detail.imdbRating ?? "0") : parseFloat(movie.tmdbRating ?? "0");
  const voteCount  = useDetail ? (detail.voteCount  ?? 0) : (movie.voteCount  ?? 0);
  const genreIds   = useDetail ? (detail.genreIds   ?? []) : (movie.genreIds   ?? []);
  const popularity = useDetail ? (detail.popularity ?? 0) : (movie.popularity ?? 0);
  const year       = movie.year ? parseInt(movie.year) : undefined;
  const releaseDate = useDetail ? (detail.releaseDate ?? movie.releaseDate ?? null) : (movie.releaseDate ?? null);
  const franchiseIds = useDetail ? (detail.franchiseIds ?? []) : (movie.franchiseIds ?? []);
  const input: ScoreInput = { tmdbRating: rating, voteCount, genreIds, popularity, year, releaseDate, franchiseIds };
  const tier    = computeCardTier(input);
  const visual  = TIER_VISUAL[tier];
  const effects = computeEffectTags(input, tier);
  return { tier, visual, effects };
}

// ── MovieCard ────────────────────────────────────────────────────────────────

function MovieCard({ movie, grid, srclang }: { movie: TrendingMovie; grid?: boolean; srclang?: string }) {
  const { lang } = useLang();
  const { data: cachedDetail } = useQuery<any>({
    queryKey: ["/api/movies", movie.imdbId],
    queryFn: () => fetch(`/api/movies/${encodeURIComponent(movie.imdbId)}`).then(r => r.json()),
    enabled: false,
    staleTime: Infinity,
  });
  const { effects, tier } = getRankVisual(movie, cachedDetail ?? null);
  const movieHref = srclang
    ? `/movie/${encodeURIComponent(movie.imdbId)}?srclang=${encodeURIComponent(srclang)}`
    : `/movie/${encodeURIComponent(movie.imdbId)}`;
  return (
    <Link href={movieHref} className={grid ? "w-full" : "flex-shrink-0"} onClick={() => { sessionStorage.setItem("search_from_movie", "1"); scrollStore.delete(`movie-${movie.imdbId}`); }}>
      <div
        className="relative rounded-xl overflow-hidden bg-zinc-900 border border-border shimmer-no-border"
        style={grid ? { aspectRatio: "2/3", width: "100%" } : { width: 100, aspectRatio: "2/3" }}
      >
        {movie.posterUrl
          ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><Film className="w-5 h-5 text-zinc-500" /></div>
        }
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

// ── Category / section config ────────────────────────────────────────────────

type SectionConfig = {
  title: string; desc: string; icon: LucideIcon; color: string; staleTime?: number;
};

const SECTION_META: Record<string, SectionConfig> = {
  trending:          { title: "ยอดนิยม",            desc: "ดูเถอะ จะได้คุยกับชาวบ้านเขารู้เรื่อง",                  icon: TrendingUp,   color: "text-red-500"    },
  now_playing:       { title: "กำลังฉาย",            desc: "กำเงินไปโรงหนังเดี๋ยวนี้เลย!",                          icon: Clapperboard, color: "text-blue-400"   },
  legendary:         { title: "LEGENDARY",           desc: "ดูแล้วเข้าใจว่าทำไมคนยังพูดถึง",                        icon: Crown,        color: "text-amber-400"  },
  cult_classic:      { title: "CULT CLASSIC",        desc: "พล็อตล้ำจนต้องร้อง ห้ะ?",                               icon: Skull,        color: "text-rose-400"   },
  "2am_deep_talk":   { title: "2 AM Deep Talk",      desc: "ตีสองแล้วยังไม่นอน มาหาเรื่องให้คิดจนเช้ากัน",          icon: Moon,         color: "text-indigo-400" },
  brain_rot:         { title: "Brain Rot",           desc: "ปล่อยสมองไหลไปกับหนัง พลังงานเหลือล้น",                 icon: Zap,          color: "text-orange-400" },
  main_character:    { title: "Main Character",      desc: "ดูจบแล้วรู้สึกเหมือนเป็นพระเอก... จนกว่าจะส่องกระจก",   icon: Smile,        color: "text-cyan-400"   },
  heartbreak:        { title: "อกหัก โรแมนติก",      desc: "เจ็บแล้วไม่จำ เดี๋ยวพี่ซ้ำให้เอง",                      icon: HeartCrack,   color: "text-rose-400"   },
  chaos_red_flags:   { title: "Chaos & Red Flags",   desc: "ประสาทกินอย่างมีสไตล์ ใครชอบแนวนี้คือพวกเดียวกัน",      icon: AlertCircle,  color: "text-pink-400"   },
  anime:             { title: "Anime",               desc: "เข้าแล้วออกยาก วงการนี้ไม่มีคำว่าพัก",                   icon: Sparkles,     color: "text-purple-400" },
  tokusatsu:         { title: "โทคุทัสสึ",            desc: "ระเบิดทุกตอน ไม่มีข้ออ้าง",                             icon: Sword,        color: "text-green-400"  },
  disney_dreamworks: { title: "Disney & DreamWorks", desc: "ใจฟูเบอร์แรง ดูแล้วเหมือนได้ชาร์จแบต",                 icon: Wand2,        color: "text-yellow-400" },
  k_wave:            { title: "K-Wave",              desc: "เตรียมรามยอนให้พร้อม แล้วไปโอปป้ากัน",                  icon: Globe,        color: "text-teal-400"   },
  midnight_horror:   { title: "Midnight Horror",     desc: "ไม่ได้น่ากลัวอย่างที่คิด... แต่นอนเปิดไฟด้วยก็ดี",      icon: Ghost,        color: "text-red-400"    },
  marvel_dc:         { title: "Marvel & DC",         desc: "ดูทุกภาค หรือไม่ต้องก็ยังได้",                          icon: Shield,       color: "text-sky-400"    },
};

const MIDDLE_CAT_MAP: Record<string, { id: string; label: string; icon: LucideIcon }> = {
  "2am_deep_talk":   { id: "2am_deep_talk",    label: "2 AM Deep Talk",     icon: Moon        },
  brain_rot:         { id: "brain_rot",         label: "Brain Rot",          icon: Zap         },
  main_character:    { id: "main_character",    label: "Main Character",     icon: Smile       },
  heartbreak:        { id: "heartbreak",        label: "อกหัก โรแมนติก",    icon: HeartCrack  },
  chaos_red_flags:   { id: "chaos_red_flags",   label: "Chaos & Red Flags",  icon: AlertCircle },
  anime:             { id: "anime",             label: "Anime",              icon: Sparkles    },
  tokusatsu:         { id: "tokusatsu",         label: "โทคุทัสสึ",          icon: Sword       },
  disney_dreamworks: { id: "disney_dreamworks", label: "Disney & DreamWorks",icon: Wand2       },
  k_wave:            { id: "k_wave",            label: "K-Wave",             icon: Globe       },
  midnight_horror:   { id: "midnight_horror",   label: "Midnight Horror",    icon: Ghost       },
  marvel_dc:         { id: "marvel_dc",         label: "Marvel & DC",        icon: Shield      },
};

function getTimedMiddleOrder(): string[] {
  const h = new Date().getHours();
  if (h < 6)  return ["2am_deep_talk", "heartbreak", "midnight_horror", "anime", "k_wave", "chaos_red_flags", "brain_rot", "main_character", "disney_dreamworks", "marvel_dc", "tokusatsu"];
  if (h < 12) return ["disney_dreamworks", "marvel_dc", "anime", "main_character", "brain_rot", "k_wave", "tokusatsu", "heartbreak", "chaos_red_flags", "2am_deep_talk", "midnight_horror"];
  if (h < 18) return ["brain_rot", "anime", "disney_dreamworks", "k_wave", "main_character", "tokusatsu", "marvel_dc", "heartbreak", "chaos_red_flags", "2am_deep_talk", "midnight_horror"];
  return ["chaos_red_flags", "heartbreak", "main_character", "marvel_dc", "k_wave", "anime", "brain_rot", "disney_dreamworks", "2am_deep_talk", "midnight_horror", "tokusatsu"];
}

// All pill categories in display order — movie categories only
const ALL_CATEGORIES = [
  { id: "trending",     label: "ยอดนิยม",         icon: TrendingUp  },
  { id: "now_playing",  label: "กำลังฉาย",         icon: Clapperboard},
  ...getTimedMiddleOrder().map(id => MIDDLE_CAT_MAP[id]),
  { id: "legendary",    label: "LEGENDARY",       icon: Crown       },
  { id: "cult_classic", label: "CULT CLASSIC",    icon: Skull       },
];

// Movie grid categories
const MOVIE_GRID_IDS = new Set([
  "trending", "now_playing", "legendary", "cult_classic",
  "2am_deep_talk", "brain_rot", "main_character", "heartbreak",
  "chaos_red_flags", "anime", "tokusatsu", "disney_dreamworks",
  "k_wave", "midnight_horror", "marvel_dc",
]);

// ── API helpers ──────────────────────────────────────────────────────────────

function buildFetchFn(categoryId: string, lang: string) {
  const apiLang = lang === "en" ? "en-US" : "th";
  const langQs = `&lang=${apiLang}`;
  if (categoryId === "trending")     return (p: number) => fetch(`/api/movies/trending?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "legendary")    return (p: number) => fetch(`/api/movies/top-rated?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "cult_classic") return (p: number) => fetch(`/api/movies/rare-finds?page=${p}${langQs}`).then(r => r.json());
  if (categoryId === "now_playing")  return (p: number) => fetch(`/api/movies/mood/now_playing?page=${p}${langQs}`).then(r => r.json());
  return (p: number) => fetch(`/api/movies/mood/${categoryId}?page=${p}${langQs}`).then(r => r.json());
}

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

// ── CategoryScrollDiv — CSS display toggle preserves native scroll ───────────

function CategoryScrollDiv({
  catId, active, paddingTop, onScrollChange, children,
}: {
  catId: string; active: boolean; paddingTop: number;
  onScrollChange: (y: number, lastY: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollStore.get(`search-cat-${catId}`);
    if (saved !== undefined) el.scrollTop = saved;
    return () => { scrollStore.set(`search-cat-${catId}`, el.scrollTop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let lastY = 0;
    const onScroll = () => {
      const y = el.scrollTop;
      onScrollChange(y, lastY);
      lastY = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [active, onScrollChange]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-y-auto overscroll-y-none"
      style={{ paddingTop, display: active ? "block" : "none" }}
    >
      {children}
    </div>
  );
}

// ── MovieSectionVertical — 3-column movie grid ───────────────────────────────

function MovieSectionVertical({ categoryId }: { categoryId: string }) {
  const { t, lang } = useLang();
  const base = SECTION_META[categoryId];
  const sec = t.sections[categoryId] ?? { title: base?.title ?? categoryId, desc: base?.desc ?? "" };
  const meta = base ? { ...base, title: sec.title, desc: sec.desc } : undefined;

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["movies-section-v", categoryId, lang],
    queryFn: ({ pageParam }) => buildFetchFn(categoryId, lang)(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (last: PagedMovies, _allPages: PagedMovies[], lastParam: unknown) => {
      return (lastParam as number) < (last?.totalPages ?? 1) ? (lastParam as number) + 1 : undefined;
    },
    staleTime: meta?.staleTime ?? 0,
  });

  const _allMovies = data?.pages.flatMap(p => p?.movies ?? []) ?? [];
  const movies = (() => {
    const seen = new Set<string>();
    return _allMovies.filter(m => {
      if (!m.imdbId || seen.has(m.imdbId)) return false;
      seen.add(m.imdbId);
      return true;
    });
  })();
  useEnsureMovieCores(movies.map(m => m.imdbId));

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
        <>
          <div className="grid grid-cols-3 gap-2.5 px-4 pt-3 pb-2.5">
            {(hasNextPage
              ? movies.slice(0, Math.floor(movies.length / 3) * 3)
              : movies
            ).map(movie => <MovieCard key={movie.imdbId} movie={movie} grid srclang={lang} />)}
          </div>
          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          <div ref={sentinelRef} className="h-0" />
        </>
      )}
    </div>
  );
}

// ── Search result rows ───────────────────────────────────────────────────────

function SearchResultRow({ movie, srclang }: { movie: SearchMovieItem; srclang: string }) {
  const { lang } = useLang();
  const { data: cachedDetail } = useQuery<any>({
    queryKey: ["/api/movies", movie.imdbId],
    enabled: false,
    staleTime: Infinity,
  });
  const { effects, tier } = getRankVisual(movie, cachedDetail ?? null);
  const year = movie.year ?? (movie.releaseDate ? movie.releaseDate.slice(0, 4) : null);
  const movieHref = srclang
    ? `/movie/${encodeURIComponent(movie.imdbId)}?srclang=${encodeURIComponent(srclang)}`
    : `/movie/${encodeURIComponent(movie.imdbId)}`;
  return (
    <Link href={movieHref} onClick={() => { sessionStorage.setItem("search_from_movie", "1"); scrollStore.delete(`movie-${movie.imdbId}`); }}>
      <div className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border active:bg-secondary transition-colors cursor-pointer">
        <div className="relative w-12 h-[68px] rounded-xl overflow-hidden bg-secondary flex-shrink-0 border border-border shimmer-no-border">
          {movie.posterUrl
            ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-muted-foreground" /></div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground leading-tight line-clamp-2">{movie.title}</p>
          {year && <p className="text-xs text-muted-foreground mt-0.5">{displayYear(year, lang)}</p>}
          <div className="mt-1">
            <MovieBadges tier={tier} effects={effects} size="xs" layout="row" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Main Search page ─────────────────────────────────────────────────────────

export default function Search() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [query, setQuery]                   = useState("");
  const [debouncedQuery]                    = useDebounceValue(query, 400);
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    // Check URL ?cat= param first (used by push notifications)
    try {
      const p = new URLSearchParams(window.location.search);
      const catParam = p.get("cat");
      if (catParam && ALL_CATEGORIES.some(c => c.id === catParam)) return catParam;
    } catch { /* ignore */ }
    const saved = sessionStorage.getItem("search_category");
    if (saved && ALL_CATEGORIES.some(c => c.id === saved)) return saved;
    return "trending";
  });
  const [visitedCategories, setVisitedCategories] = useState<Set<string>>(() => new Set([activeCategory]));
  const [showRandomPicker, setShowRandomPicker]   = useState(false);
  const [showVsPicker, setShowVsPicker]           = useState(false);
  const [showDiceTab, setShowDiceTab]             = useState(true);
  const headerRef        = useRef<HTMLDivElement>(null);
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const pillRefs         = useRef<Map<string, HTMLButtonElement>>(new Map());
  const searchResultsRef = useRef<HTMLDivElement>(null);

  const [headerH, setHeaderH]               = useState(130);
  const [headerHidden, setHeaderHidden]     = useState(false);
  const [pillContainerW, setPillContainerW] = useState(0);

  // Measure pill container width (for centering)
  useEffect(() => {
    const el = pillContainerRef.current;
    if (!el) return;
    const m = () => setPillContainerW(el.clientWidth);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure header height
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const tid = setTimeout(measure, 300);
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(tid); };
  }, []);

  // Header auto-hide on scroll
  const handleScrollChange = useCallback((y: number, lastY: number) => {
    if (y <= 0) setHeaderHidden(false);
    else if (y > lastY && y > headerH) setHeaderHidden(true);
    else if (y < lastY) setHeaderHidden(false);
  }, [headerH]);

  // Scroll listener for search results overlay
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
  }, [debouncedQuery, handleScrollChange]);

  const [location] = useLocation();

  // nav-refresh: tap search icon when already on search page — clear query only, keep active category
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.href === "/search") {
        setQuery("");
        setHeaderHidden(false);
        qc.invalidateQueries({ queryKey: ["movies-section-v", activeCategory] });
      }
    };
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  }, [qc, activeCategory]);

  const handleCategoryChange = (catId: string) => {
    setVisitedCategories(prev => new Set([...prev, catId]));
    setActiveCategory(catId);
    setHeaderHidden(false);
    sessionStorage.setItem("search_category", catId);
  };

  // Center active pill
  const centerPillRanRef = useRef(false);
  useEffect(() => {
    if (!pillContainerW) return;
    let cancelled = false;
    const apply = (smooth: boolean) => {
      if (cancelled) return;
      const container = pillContainerRef.current;
      const pill = pillRefs.current.get(activeCategory);
      if (!container || !pill || pill.offsetWidth === 0) return;
      const target = pill.offsetLeft - (container.clientWidth - pill.offsetWidth) / 2;
      const max = Math.max(0, container.scrollWidth - container.clientWidth);
      const left = Math.max(0, Math.min(max, target));
      try { container.scrollTo({ left, behavior: smooth ? "smooth" : "auto" }); }
      catch { container.scrollLeft = left; }
    };
    const isFirst = !centerPillRanRef.current;
    centerPillRanRef.current = true;
    apply(!isFirst);
    if (isFirst) {
      const raf1 = requestAnimationFrame(() => requestAnimationFrame(() => apply(false)));
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
      fonts?.ready?.then(() => apply(false)).catch(() => {});
      const tid = setTimeout(() => apply(false), 250);
      return () => { cancelled = true; cancelAnimationFrame(raf1); clearTimeout(tid); };
    }
    return () => { cancelled = true; };
  }, [activeCategory, lang, pillContainerW]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: movieSearchData, isLoading: movieSearchLoading } = useSearchMovies(
    { query: debouncedQuery, page: 1 },
    { query: { enabled: debouncedQuery.length > 1 } as any }
  );
  const searchedMovies = (movieSearchData?.movies ?? []) as unknown as SearchMovieItem[];
  useEnsureMovieCores(searchedMovies.map(m => m.imdbId));

  const srclang = detectSearchLang(debouncedQuery);

  // ── Smart-search: genre/keyword/topic-aware discovery ─────────────────────
  const smartLang = lang === "en" ? "en-US" : "th";
  const { data: smartSearchData, isLoading: smartSearchLoading } = useQuery<{
    results: TrendingMovie[];
    genreIds: number[];
    keywordIds: number[];
  }>({
    queryKey: ["smart-search", debouncedQuery, smartLang],
    queryFn: () =>
      fetch(`/api/movies/smart-search?q=${encodeURIComponent(debouncedQuery)}&lang=${smartLang}`)
        .then(r => r.json()),
    enabled: debouncedQuery.length > 1,
    staleTime: 60_000,
  });
  const smartMovies: TrendingMovie[] = smartSearchData?.results ?? [];
  // Show "You might like" section when: genre match, keyword match, or topic resolved (isTopicSearch)
  const isSmartResult = !!(smartSearchData?.results?.length && (
    smartSearchData?.genreIds?.length ||
    smartSearchData?.keywordIds?.length ||
    (smartSearchData as any)?.isTopicSearch
  ));
  const searchedImdbIds = new Set(searchedMovies.map(m => m.imdbId));
  const uniqueSmartMovies = smartMovies.filter(m => !searchedImdbIds.has(m.imdbId));

  // ── Translated categories for pills ──────────────────────────────────────

  const CATEGORIES_T = ALL_CATEGORIES.map(cat => {
    if (SECTION_META[cat.id]) {
      const sec = t.sections[cat.id];
      return sec ? { ...cat, label: sec.title } : cat;
    }
    return cat;
  });

  return (
    <div className="relative h-full overflow-hidden">

      {/* ── Sticky header ── */}
      <div
        ref={headerRef}
        className={cn(
          "absolute top-0 left-0 right-0 z-30",
          "bg-background/95 backdrop-blur-xl border-b border-border",
          "transition-transform duration-300 ease-in-out",
          headerHidden && "-translate-y-full"
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {/* Title */}
        <div className="flex items-center px-4 pt-4 pb-0">
          <div className="w-9 h-9" />
          <button
            onClick={() => setShowDiceTab(prev => !prev)}
            className="font-display font-bold text-xl tracking-tight text-foreground flex-1 text-center active:opacity-60 transition-opacity select-none"
          >
            Ticker
          </button>
          <div className="w-9 h-9" />
        </div>

        {/* Dice slide-out tab — smooth banner reveal using grid-template-rows */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: showDiceTab ? "1fr" : "0fr",
            transition: "grid-template-rows 650ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div className="overflow-hidden">
            <div
              className="flex justify-center py-2"
              style={{
                opacity: showDiceTab ? 1 : 0,
                transition: "opacity 500ms ease-in-out",
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowRandomPicker(true)}
                  className="w-10 h-10 rounded-2xl bg-secondary border border-border flex items-center justify-center active:opacity-60 transition-opacity shadow-sm"
                  title="สุ่มหนัง"
                >
                  <Dice5 className="w-5 h-5 text-foreground" />
                </button>
                <button
                  onClick={() => setShowVsPicker(true)}
                  className="w-10 h-10 rounded-2xl bg-secondary border border-border flex items-center justify-center active:opacity-60 transition-opacity shadow-sm"
                  title="VS"
                >
                  <Swords className="w-5 h-5 text-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Spacer below title (replaces pb-3 removed above) */}
        <div className="h-3" />

        {/* Search bar */}
        <div className="px-4 pb-2">
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
                onClick={() => { setQuery(""); setHeaderHidden(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10"
              >
                <XIcon className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Category pills */}
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
      </div>

      {/* ── Movie search results overlay ── */}
      {debouncedQuery && (
        <div
          ref={searchResultsRef}
          className="absolute inset-0 overflow-y-auto overscroll-y-none z-20"
          style={{ paddingTop: headerH }}
        >
          <div className="px-4 pt-2">
            {movieSearchLoading && (
              <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            )}
            {!movieSearchLoading && searchedMovies.length === 0 && (
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
              {searchedMovies.map(movie => <SearchResultRow key={movie.imdbId} movie={movie} srclang={srclang} />)}
            </div>

            {/* ── Smart-search section ── */}
            {isSmartResult && uniqueSmartMovies.length > 0 && !movieSearchLoading && (
              <div className="pb-4">
                <div className="flex items-center gap-1.5 mb-2 mt-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <p className="text-xs font-semibold text-muted-foreground tracking-widest">
                    {lang === "th" ? "คุณอาจชอบ" : "You might like"}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {uniqueSmartMovies.slice(0, 10).map(movie => (
                    <SearchResultRow key={movie.imdbId} movie={movie as SearchMovieItem} srclang={srclang} />
                  ))}
                </div>
              </div>
            )}
            {isSmartResult && smartSearchLoading && !movieSearchLoading && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Movie grid sections (lazy-mount via CSS display toggle) ── */}
      {CATEGORIES_T
        .filter(cat => visitedCategories.has(cat.id) && MOVIE_GRID_IDS.has(cat.id))
        .map(cat => (
          <CategoryScrollDiv
            key={cat.id}
            catId={cat.id}
            active={!debouncedQuery && activeCategory === cat.id}
            paddingTop={headerH}
            onScrollChange={handleScrollChange}
          >
            <MovieSectionVertical categoryId={cat.id} />
          </CategoryScrollDiv>
        ))
      }

      {/* ── Random Movie Picker ── */}
      {showRandomPicker && (
        <RandomMoviePicker
          onClose={() => setShowRandomPicker(false)}
          isGuest={!user}
        />
      )}

      {/* ── VS Movie Picker ── */}
      {showVsPicker && (
        <MovieVsPicker
          onClose={() => setShowVsPicker(false)}
        />
      )}

    </div>
  );
}
