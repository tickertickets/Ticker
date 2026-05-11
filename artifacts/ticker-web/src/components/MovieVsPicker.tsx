import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Film, Loader2, X as XIcon, ChevronRight, Search as SearchIcon, Swords, RefreshCw } from "lucide-react";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { useDebounceValue } from "usehooks-ts";

type VsMovie = {
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
  mediaType?: string;
};

type SearchResult = VsMovie & { type?: string };

export function MovieVsPicker({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<"pick" | "loading" | "result">("pick");
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 350);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<VsMovie[]>([]);
  const [winner, setWinner] = useState<VsMovie | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_MOVIES = 5;
  const MIN_MOVIES = 2;

  // ── Strings ──────────────────────────────────────────────────────────────
  const s = {
    title:          lang === "th" ? "VS — ให้ระบบเลือก"           : "VS — Let the System Pick",
    subtitle:       lang === "th" ? "เพิ่มหนัง 2–5 เรื่อง แล้วสุ่มหาผู้ชนะ" : "Add 2–5 movies and pick a random winner",
    searchPlaceholder: lang === "th" ? "ค้นหาหนัง..."             : "Search movies...",
    addBtn:         lang === "th" ? "เพิ่ม"                        : "Add",
    added:          lang === "th" ? "เพิ่มแล้ว"                   : "Added",
    maxMovies:      lang === "th" ? "เพิ่มได้สูงสุด 5 เรื่อง"     : "Maximum 5 movies",
    pickBtn:        lang === "th" ? "สุ่มเลือก!"                   : "Pick a Winner!",
    needMore:       lang === "th" ? "เพิ่มอย่างน้อย 2 เรื่อง"     : "Add at least 2 movies",
    loadingTitle:   lang === "th" ? "กำลังสุ่ม..."                  : "Picking a winner...",
    winnerLabel:    lang === "th" ? "ระบบเลือก"                   : "System picked",
    viewDetail:     lang === "th" ? "ดูรายละเอียด"                 : "View detail",
    pickAgain:      lang === "th" ? "สุ่มใหม่"                     : "Pick again",
    noResults:      lang === "th" ? "ไม่พบหนัง"                   : "No movies found",
    addedMovies:    lang === "th" ? "หนังที่เพิ่ม"                 : "Added movies",
    removeBtn:      lang === "th" ? "ลบ"                           : "Remove",
    backBtn:        lang === "th" ? "กลับ"                         : "Back",
  };

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!debouncedQuery.trim()) { setSearchResults([]); return; }
    const ctrl = new AbortController();
    setSearching(true);
    const apiLang = lang === "en" ? "en-US" : "th";
    fetch(`/api/movies/search?q=${encodeURIComponent(debouncedQuery)}&lang=${apiLang}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => { setSearchResults(data.results ?? []); setSearching(false); })
      .catch(() => { setSearching(false); });
    return () => ctrl.abort();
  }, [debouncedQuery, lang]);

  // ── Pick random winner ────────────────────────────────────────────────────
  const pickWinner = () => {
    if (picked.length < MIN_MOVIES) return;
    setStep("loading");
    setTimeout(() => {
      const idx = Math.floor(Math.random() * picked.length);
      setWinner(picked[idx]!);
      setStep("result");
    }, 1800);
  };

  const pickAgain = () => {
    if (picked.length < MIN_MOVIES) return;
    setStep("loading");
    setTimeout(() => {
      let idx: number;
      do { idx = Math.floor(Math.random() * picked.length); }
      while (picked.length > 1 && picked[idx]?.imdbId === winner?.imdbId);
      setWinner(picked[idx]!);
      setStep("result");
    }, 1200);
  };

  const addMovie = (m: VsMovie) => {
    if (picked.length >= MAX_MOVIES) return;
    if (picked.some(p => p.imdbId === m.imdbId)) return;
    setPicked(prev => [...prev, m]);
  };

  const removeMovie = (imdbId: string) => {
    setPicked(prev => prev.filter(p => p.imdbId !== imdbId));
  };

  const goToMovie = () => {
    if (!winner) return;
    onClose();
    navigate(`/movie/${encodeURIComponent(winner.imdbId)}`);
  };

  const isAdded = (imdbId: string) => picked.some(p => p.imdbId === imdbId);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-background border-t border-border overflow-hidden"
        style={{ maxHeight: "88vh" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* ── Loading step ── */}
        {step === "loading" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center">
              <Swords className="w-10 h-10 text-foreground animate-bounce" />
            </div>
            <div className="text-center">
              <p className="font-bold text-foreground text-base">{s.loadingTitle}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {picked.map(p => p.title).join(" vs ")}
              </p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ── Result step ── */}
        {step === "result" && winner && (() => {
          const tier = computeCardTier({
            tmdbRating: parseFloat(winner.tmdbRating ?? "0"),
            voteCount: winner.voteCount ?? 0,
            genreIds: winner.genreIds ?? [],
            popularity: winner.popularity ?? 0,
            franchiseIds: winner.franchiseIds ?? [],
          });
          const effects = computeEffectTags({
            tmdbRating: parseFloat(winner.tmdbRating ?? "0"),
            voteCount: winner.voteCount ?? 0,
            genreIds: winner.genreIds ?? [],
            popularity: winner.popularity ?? 0,
            franchiseIds: winner.franchiseIds ?? [],
          }, tier);
          return (
            <div className="flex flex-col" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
              <div className="relative flex items-center justify-center px-4 pt-2 pb-3">
                <button
                  onClick={() => setStep("pick")}
                  className="absolute left-4 flex items-center gap-1 text-xs text-muted-foreground active:opacity-70"
                >
                  {s.backBtn}
                </button>
                <div className="flex items-center gap-1.5">
                  <Swords className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground">VS</p>
                </div>
                <button
                  onClick={onClose}
                  className="absolute right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:opacity-70"
                >
                  <XIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <p className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 px-4">
                {s.winnerLabel}
              </p>

              <div className="px-4">
                <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-border" style={{ aspectRatio: "16/9" }}>
                  {winner.posterUrl
                    ? <img src={winner.posterUrl} alt={winner.title} className="w-full h-full object-cover" style={{ objectPosition: "center 20%" }} />
                    : <div className="w-full h-full flex items-center justify-center"><Film className="w-10 h-10 text-zinc-600" /></div>
                  }
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-end gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-bold text-white text-xl leading-tight line-clamp-2">{winner.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {winner.year && <p className="text-white/60 text-sm">{displayYear(winner.year, lang)}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <MovieBadges tier={tier} effects={effects} size="sm" layout="row" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 px-4 mt-4">
                <button
                  onClick={pickAgain}
                  className="flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl bg-secondary border border-border font-semibold text-sm text-foreground active:opacity-70 transition-opacity"
                >
                  <RefreshCw className="w-4 h-4 flex-shrink-0" />
                  <span className="whitespace-nowrap">{s.pickAgain}</span>
                </button>
                <button
                  onClick={goToMovie}
                  className="flex-[2] flex items-center justify-center gap-2 h-12 rounded-2xl bg-foreground text-background font-bold text-sm active:opacity-70 transition-opacity"
                >
                  <span className="whitespace-nowrap">{s.viewDetail}</span>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Pick step ── */}
        {step === "pick" && (
          <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(88vh - 40px)" }}>
            {/* Header */}
            <div className="px-4 pt-2 pb-3">
              <div className="relative flex items-center justify-center mb-1 pt-1">
                <div className="text-center">
                  <h2 className="font-display font-bold text-lg text-foreground">{s.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.subtitle}</p>
                </div>
                <button
                  onClick={onClose}
                  className="absolute right-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:opacity-70"
                >
                  <XIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Added movies row */}
            {picked.length > 0 && (
              <div className="px-4 mb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  {s.addedMovies} ({picked.length}/{MAX_MOVIES})
                </p>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {picked.map(m => (
                    <div key={m.imdbId} className="flex-shrink-0 relative">
                      <div className="w-[60px] rounded-xl overflow-hidden bg-secondary border border-border">
                        <div className="relative" style={{ aspectRatio: "2/3" }}>
                          {m.posterUrl
                            ? <img src={m.posterUrl} alt={m.title} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><Film className="w-3 h-3 text-muted-foreground" /></div>
                          }
                        </div>
                        <div className="p-1 h-[36px] overflow-hidden">
                          <p className="text-[8px] font-bold text-foreground line-clamp-2 leading-tight">{m.title}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeMovie(m.imdbId)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-foreground flex items-center justify-center"
                      >
                        <XIcon className="w-2.5 h-2.5 text-background" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pick button */}
            <div className="px-4 mb-3">
              <button
                onClick={pickWinner}
                disabled={picked.length < MIN_MOVIES}
                className="w-full h-11 rounded-2xl bg-foreground text-background font-bold text-sm flex items-center justify-center gap-2 active:opacity-70 transition-opacity disabled:opacity-30"
              >
                <Swords className="w-4 h-4 flex-shrink-0" />
                {picked.length < MIN_MOVIES ? s.needMore : s.pickBtn}
              </button>
            </div>

            {/* Search input */}
            <div className="px-4 mb-2">
              <div className="relative flex items-center">
                <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                <input
                  ref={inputRef}
                  className="search-bar w-full"
                  style={{ paddingLeft: "2.75rem", paddingRight: query ? "2.75rem" : undefined }}
                  placeholder={s.searchPlaceholder}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
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

            {/* Search results */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {searching && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!searching && debouncedQuery && searchResults.length === 0 && (
                <div className="flex justify-center py-8">
                  <p className="text-sm text-muted-foreground">{s.noResults}</p>
                </div>
              )}
              {!searching && searchResults.length > 0 && (
                <div className="flex flex-col gap-2">
                  {searchResults.slice(0, 12).map(m => {
                    const added = isAdded(m.imdbId);
                    const full = !added && picked.length >= MAX_MOVIES;
                    return (
                      <div
                        key={m.imdbId}
                        className="flex items-center gap-3 bg-secondary rounded-2xl px-3 py-2.5 border border-border"
                      >
                        <div className="w-9 h-[54px] rounded-lg overflow-hidden bg-zinc-900 flex-shrink-0">
                          {m.posterUrl
                            ? <img src={m.posterUrl} alt={m.title} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><Film className="w-3 h-3 text-muted-foreground" /></div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-tight line-clamp-1">{m.title}</p>
                          {m.year && <p className="text-xs text-muted-foreground mt-0.5">{m.year}</p>}
                        </div>
                        <button
                          onClick={() => !added && !full && addMovie(m)}
                          disabled={added || full}
                          className={`flex-shrink-0 h-7 px-3 rounded-xl text-xs font-bold transition-opacity ${
                            added
                              ? "bg-muted text-muted-foreground"
                              : full
                                ? "bg-muted text-muted-foreground opacity-50"
                                : "bg-foreground text-background active:opacity-70"
                          }`}
                        >
                          {added ? s.added : s.addBtn}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {!debouncedQuery && picked.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center">
                    <Swords className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground px-6">{s.subtitle}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
