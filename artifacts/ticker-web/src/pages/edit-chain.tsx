import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useLang, displayYear } from "@/lib/i18n";
import { useRoute, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchMovies } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import { ChevronLeft, Loader2, Film, X, Plus, Search, TrendingUp, Timer, Users, Lock, GripVertical, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnsureMovieCores } from "@/lib/use-movie-cores";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";

// ── Types ─────────────────────────────────────────────────────────────────
type ChainMovie = {
  id: string;
  imdbId: string;
  movieTitle: string;
  movieYear?: string | null;
  posterUrl?: string | null;
  position: number;
};

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

type ChainData = {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  descriptionAlign?: "left" | "center" | "right" | null;
  mode?: string | null;
  challengeDurationMs?: number | null;
  movies: ChainMovie[];
};

function SearchMovieRow({ movie, already, onAdd, addedLabel }: {
  movie: TrendingMovie;
  already: boolean;
  onAdd: (movie: TrendingMovie) => void;
  addedLabel: string;
}) {
  const { lang } = useLang();
  return (
    <div className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="w-9 h-12 rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-border relative shimmer-no-border">
        {movie.posterUrl
          ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
          : <Film className="w-4 h-4 text-muted-foreground m-auto mt-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{movie.title}</p>
        <p className="text-[11px] text-muted-foreground">{displayYear(movie.year, lang)}</p>
      </div>
      {already
        ? <span className="text-[11px] text-muted-foreground shrink-0">{addedLabel}</span>
        : (
          <button
            onClick={() => onAdd(movie)}
            className="w-8 h-8 rounded-xl bg-foreground flex items-center justify-center shrink-0 active:opacity-70 transition-opacity"
          >
            <Plus className="w-4 h-4 text-background" />
          </button>
        )}
    </div>
  );
}

const TIMER_UNITS = [
  { key: "durationHour", ms: 3_600_000 },
  { key: "durationDay", ms: 86_400_000 },
  { key: "durationWeek", ms: 604_800_000 },
] as const;

function SortableMovieItem({ movie, idx, dragLabel }: { movie: ChainMovie; idx: number; dragLabel: string }) {
  const { lang } = useLang();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: movie.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-3 bg-secondary rounded-2xl px-3 py-2.5 border border-border"
    >
      <span className="text-xs font-black text-muted-foreground w-5 text-center shrink-0">{idx + 1}</span>
      <div className="w-9 h-12 rounded-lg overflow-hidden bg-background border border-border/60 shrink-0">
        {movie.posterUrl
          ? <img src={movie.posterUrl} alt={movie.movieTitle} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><Film className="w-3 h-3 text-muted-foreground" /></div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{movie.movieTitle}</p>
        {movie.movieYear && <p className="text-[11px] text-muted-foreground">{displayYear(movie.movieYear, lang)}</p>}
      </div>
      <button {...attributes} {...listeners} className="p-1.5 text-muted-foreground touch-none cursor-grab active:cursor-grabbing" aria-label={dragLabel}>
        <GripVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

function formatChallengeDuration(ms: number, labels: { durationHour: string; durationDay: string; durationWeek: string }): string {
  for (let i = TIMER_UNITS.length - 1; i >= 0; i--) {
    if (ms % TIMER_UNITS[i].ms === 0) {
      return `${ms / TIMER_UNITS[i].ms} ${labels[TIMER_UNITS[i].key]}`;
    }
  }
  return `${Math.round(ms / 86_400_000)} ${labels.durationDay}`;
}

// ── Main component ─────────────────────────────────────────────────────────
export default function EditChain() {
  const { t, lang } = useLang();
  const [, params] = useRoute("/chain/:id/edit");
  const chainId = params?.id ?? "";
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // Use SPA navigate instead of history.back() to avoid browser reload indicator
  const goBack = useCallback(() => {
    const back = sessionStorage.getItem("ticker:edit-chain-back");
    sessionStorage.removeItem("ticker:edit-chain-back");
    if (back) navigate(back);
    else navBack(navigate);
  }, [navigate]);

  // ── Read cache synchronously on first render ──────────────────────────────
  // IMPORTANT: capture isPartial with useState so it doesn't change when
  // the network response arrives and overwrites the partial cache entry.
  const cached = qc.getQueryData<ChainData & { _partial?: boolean }>(["/api/chains", chainId]);
  const [isPartial]   = useState(() => !!(cached as any)?._partial);
  // seeded=true only when we have a FULL cache (not partial) — prevents the loading gate
  // from opening too early and showing movies=[]/[] then shifting when network arrives.
  const [seeded,      setSeeded]             = useState(() => !!cached && !isPartial);

  // ── Lazy-init all form fields from cache ──────────────────────────────────
  const [title,              setTitle]              = useState(() => cached?.title ?? "");
  const [description,        setDesc]               = useState(() => cached?.description ?? "");
  const [descriptionAlign,   setDescAlign]          = useState<"left" | "center" | "right">(() => cached?.descriptionAlign ?? "left");
  const [movies,             setMovies]             = useState<ChainMovie[]>(() => isPartial ? [] : (cached?.movies ?? []));
  const [mode,               setMode]               = useState<string>(() => cached?.mode ?? "standard");
  const [challengeDurationMs,setChallengeDurationMs]= useState<number | null>(() => cached?.challengeDurationMs ?? null);
  const [maxMovies,          setMaxMovies]          = useState(50);

  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [removingId,setRemovingId]= useState<string | null>(null);
  const [showSearch,setShowSearch]= useState(false);
  const [sortMode,  setSortMode]  = useState(false);
  const [query,     setQuery]     = useState("");
  const [showCommunityWarning, setShowCommunityWarning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = movies.findIndex(m => m.id === active.id);
    const newIdx = movies.findIndex(m => m.id === over.id);
    const reordered = arrayMove(movies, oldIdx, newIdx);
    setMovies(reordered);
    try {
      await fetch(`/api/chains/${chainId}/movies/reorder`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieIds: reordered.map(m => m.id) }),
      });
    } catch {
      setMovies(movies);
    }
  }, [movies, chainId]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [title]);

  useEffect(() => {
    if (showSearch) {
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [showSearch]);
  const [debouncedQuery] = useDebounceValue(query, 400);

  // ── Fetch if no cache, OR if only partial cache (need full movie data) ────
  // staleTime:0 when partial — forces real fetch even though cache is brand-new
  const { data: chainData } = useQuery<ChainData>({
    queryKey: ["/api/chains", chainId],
    queryFn: () => fetch(`/api/chains/${chainId}`, { credentials: "include" }).then(r => r.json()),
    staleTime: isPartial ? 0 : 5 * 60 * 1000,
    enabled: !!chainId && (!cached || isPartial),
  });

  const { data: searchData, isLoading: searchLoading } = useSearchMovies(
    { query: debouncedQuery, page: 1 },
    { query: { enabled: debouncedQuery.length > 1 } as any },
  );
  const { data: trendingData } = useQuery({
    queryKey: ["trending-for-chain"],
    queryFn: () => fetch("/api/movies/trending?page=1").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const trendingSuggestions: TrendingMovie[] = (trendingData?.movies ?? []).slice(0, 16);
  const searchResults: TrendingMovie[] = (searchData?.movies ?? []) as unknown as TrendingMovie[];

  // Pre-load rank-relevant fields for every visible chain row so the badges
  // show the correct rank immediately instead of waiting for detail visit.
  useEnsureMovieCores([
    ...trendingSuggestions.map(m => m.imdbId),
    ...searchResults.map(m => m.imdbId),
  ]);

  // ── Hydrate from network data ─────────────────────────────────────────────
  // isPartial is captured once at mount (useState) — stable even after cache updates.
  // chainData arrives from network after mount; we only act on real data (no _partial flag).
  useEffect(() => {
    if (!chainData) return;
    if ((chainData as any)._partial) return; // still the placeholder — wait for real response

    if (isPartial && !seeded) {
      // Had only title/desc from profile cache — fill in movies from real network response
      setMovies(chainData.movies ?? []);
      setDescAlign(chainData.descriptionAlign ?? "left");
      setMaxMovies(50);
      setSeeded(true); // unblock form render — data is now complete
    } else if (!seeded) {
      // No cache at all — seed every field from network
      setTitle(chainData.title ?? "");
      setDesc(chainData.description ?? "");
      setDescAlign(chainData.descriptionAlign ?? "left");
      setMovies(chainData.movies ?? []);
      setMode(chainData.mode ?? "standard");
      setChallengeDurationMs(chainData.challengeDurationMs ?? null);
      setMaxMovies(50);
      setSeeded(true);
    }
  }, [chainData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Movie actions ─────────────────────────────────────────────────────────
  const addMovieToChain = useCallback(async (movie: TrendingMovie) => {
    if (movies.find(m => m.imdbId === movie.imdbId)) return;
    if (movies.length >= maxMovies) return;
    // Optimistic: add immediately so the poster shows at once and duplicate guard blocks
    const tempId = `temp-${movie.imdbId}`;
    const optimistic: ChainMovie = {
      id: tempId,
      imdbId: movie.imdbId,
      movieTitle: movie.title,
      movieYear: movie.year,
      posterUrl: movie.posterUrl,
      position: movies.length + 1,
    };
    setMovies(prev => [...prev, optimistic]);
    try {
      const res = await fetch(`/api/chains/${chainId}/movies`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imdbId: movie.imdbId,
          movieTitle: movie.title,
          movieYear: movie.year,
          posterUrl: movie.posterUrl,
          memoryNote: null,
        }),
      });
      const body = await res.json();
      if (!res.ok) { setMovies(prev => prev.filter(m => m.id !== tempId)); return; }
      setMovies(body.movies ?? []);
      qc.setQueryData(["/api/chains", chainId], body);
    } catch {
      setMovies(prev => prev.filter(m => m.id !== tempId));
    }
  }, [movies, maxMovies, chainId, qc]);

  const removeMovieFromChain = async (movieId: string) => {
    setRemovingId(movieId);
    try {
      const res = await fetch(`/api/chains/${chainId}/movies/${movieId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) return;
      setMovies(body.movies ?? []);
      qc.setQueryData(["/api/chains", chainId], body);
    } catch {}
    setRemovingId(null);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/chains/${chainId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, descriptionAlign }),
      });
      if (!res.ok) throw new Error(t.errSaveFailed);
      const updated = await res.json();

      const patchList = (old: { chains: any[] } | undefined) => {
        if (!old?.chains) return old;
        return {
          ...old,
          chains: old.chains.map((c: any) =>
            c.id === chainId ? { ...c, title: updated.title, description: updated.description, descriptionAlign: updated.descriptionAlign } : c
          ),
        };
      };
      const patchMixed = (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item: any) =>
            item.type === "chain" && item.chain?.id === chainId
              ? { ...item, chain: { ...item.chain, title: updated.title, description: updated.description, descriptionAlign: updated.descriptionAlign } }
              : item
          ),
        };
      };

      qc.setQueryData(["chains-feed"], patchList);
      qc.setQueriesData({ queryKey: ["chains-own-following"] }, patchList);
      qc.setQueryData(["chains-hot-following"], patchList);
      qc.setQueriesData({ queryKey: ["mixed-feed"] }, patchMixed);
      qc.setQueriesData({ queryKey: ["profile-chains-created"] }, patchList);
      qc.setQueryData(["/api/chains", chainId], (old: any) => old ? { ...old, ...updated } : updated);

      qc.invalidateQueries({ queryKey: ["chains-feed"] });
      qc.invalidateQueries({ queryKey: ["chains-own-following"] });
      qc.invalidateQueries({ queryKey: ["mixed-feed"] });
      // NOT invalidating profile-chains-created — setQueriesData already patched it in-place
      // so the chain stays in its current position (no re-sort from server)
      qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });

      goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errGeneric);
      setSaving(false);
    }
  };

  const isCommunity = mode === "community";
  const isHunt      = mode === "hunt";
  const isChallenge = !!challengeDurationMs;

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Header — fixed outside scroll so content below is always scrollable ── */}
      <div className="shrink-0 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-base text-foreground flex-1">{t.editChainTitle}</h1>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">

      {/* ── Loading gate: show spinner until all data is ready (prevents any element from shifting after entry) ── */}
      {!seeded ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
      <div>

      {/* ── Movie preview strip ── */}
      {movies.length === 0 ? (
        <div className="flex flex-col items-center pt-3 pb-2">
          {isHunt ? (
            <div
              className="w-[72px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2"
              style={{ aspectRatio: "2/3" }}
            >
              <Search className="w-5 h-5 text-muted-foreground" />
            </div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              className="w-[72px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 active:bg-secondary transition-colors"
              style={{ aspectRatio: "2/3" }}
            >
              <Plus className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium">{t.addMovieLabel}</span>
            </button>
          )}
        </div>
      ) : sortMode ? (
        /* Sort mode: vertical drag-and-drop list */
        <div className="px-4 pt-4 pb-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
            <SortableContext items={movies.map(m => m.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {movies.map((movie, idx) => (
                  <SortableMovieItem key={movie.id} movie={movie} idx={idx} dragLabel={t.dragToSort} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <div className="flex items-end gap-2.5 px-5 pt-7 pb-5 overflow-x-auto scrollbar-none">
          {movies.map((movie, idx) => (
            <div
              key={movie.id}
              className={cn("relative shrink-0 w-[72px] transition-opacity", removingId === movie.id && "opacity-40")}
              style={{ aspectRatio: "2/3" }}
            >
              <div className="w-full h-full rounded-xl overflow-hidden bg-secondary border border-border/60">
                {movie.posterUrl ? (
                  <img src={movie.posterUrl} alt={movie.movieTitle} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-transparent via-transparent to-black/50 pointer-events-none" />
                <span className="absolute top-1.5 left-2 text-white/80 text-[9px] font-black">{idx + 1}</span>
              </div>
              <button
                onClick={() => removeMovieFromChain(movie.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground shadow-md flex items-center justify-center z-10"
              >
                <X className="w-2.5 h-2.5 text-background" />
              </button>
            </div>
          ))}
          {movies.length < maxMovies && (
            <button
              onClick={() => setShowSearch(v => !v)}
              className="w-[72px] shrink-0 rounded-xl border-2 border-dashed border-border flex items-center justify-center active:bg-secondary transition-colors"
              style={{ aspectRatio: "2/3" }}
            >
              <Plus className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {/* Sort/done toggle — shows only when ≥2 movies */}
      {movies.length > 1 && (
        <div className="flex justify-end px-5 pb-1">
          <button
            onClick={() => setSortMode(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground active:text-foreground transition-colors"
          >
            {sortMode ? <Check className="w-3.5 h-3.5" /> : <GripVertical className="w-3.5 h-3.5" />}
            {sortMode ? t.sortDoneBtn : t.reorderBtn}
          </button>
        </div>
      )}

      {/* ── Form ── */}
      <div className={cn("px-4 space-y-3", showSearch ? "pb-0" : "pb-2")}>

        {/* ชื่อ */}
        <div>
          <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.chainNameLabel}</p>
          <textarea
            ref={titleRef}
            className="w-full min-h-[48px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none overflow-hidden leading-snug"
            rows={1}
            placeholder={t.chainNamePlaceholder}
            value={title}
            onChange={e => {
              setTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            maxLength={80}
          />
        </div>

        {/* คำอธิบาย */}
        <div>
          <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.chainDescLabel}</p>
          <textarea
            className={cn(
              "w-full h-[64px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none",
              descriptionAlign === "center" && "text-center",
              descriptionAlign === "right" && "text-right",
            )}
            placeholder={t.chainDescPlaceholder}
            value={description}
            onChange={e => setDesc(e.target.value)}
            maxLength={5000}
          />
          <div className="flex justify-between items-center mt-1 px-1">
            <span />
            <span className={cn("text-[10px]", description.length > 4900 ? "text-red-500" : "text-muted-foreground")}>
              {description.length}/5000
            </span>
          </div>
          <div className="flex justify-center mt-1">
            <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-bold">
              {(["left", "center", "right"] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setDescAlign(a)}
                  className={cn(
                    "px-4 py-1.5",
                    descriptionAlign === a ? "bg-foreground text-background" : "bg-background text-muted-foreground",
                    a !== "left" && "border-l border-border",
                  )}
                >
                  {a === "left" ? "L" : a === "center" ? "C" : "R"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* หนังใน Chain */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-black tracking-widest text-foreground">
              {t.moviesInChainLabel}
              <span className={cn("ml-2 font-bold normal-case tracking-normal", movies.length > 0 ? "text-foreground" : "text-muted-foreground")}>
                {movies.length}/{maxMovies}
              </span>
            </p>
            {!isHunt && movies.length < maxMovies && (
              <button
                onClick={() => setShowSearch(v => !v)}
                className={cn(
                  "flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold transition-all",
                  showSearch ? "bg-secondary text-foreground" : "bg-foreground text-background",
                )}
              >
                {showSearch ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {showSearch ? t.closeBtn : t.addMovieLabel}
              </button>
            )}
          </div>

          {/* Search panel */}
          {showSearch && (
            <div className="bg-secondary rounded-2xl overflow-hidden border border-border">
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                  <input
                    autoFocus
                    className="w-full h-10 bg-background rounded-xl text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    style={{ paddingLeft: "2.25rem", paddingRight: query ? "2.75rem" : "0.75rem" }}
                    placeholder={t.searchAnyLang}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10"
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
              <div className="h-52 overflow-y-auto">
                {searchLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!debouncedQuery && !searchLoading && (
                  <>
                    <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-red-500" />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t.trendingNow}</p>
                    </div>
                    {trendingSuggestions.map(movie => (
                      <SearchMovieRow
                        key={movie.imdbId}
                        movie={movie}
                        already={!!movies.find(m => m.imdbId === movie.imdbId)}
                        onAdd={addMovieToChain}
                        addedLabel={t.chainAddedLabel}
                      />
                    ))}
                  </>
                )}
                {debouncedQuery && !searchLoading && searchResults.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-5">{t.noMoviesFound}</p>
                )}
                {debouncedQuery && searchResults.map(movie => (
                  <SearchMovieRow
                    key={movie.imdbId}
                    movie={movie}
                    already={!!movies.find(m => m.imdbId === movie.imdbId)}
                    onAdd={addMovieToChain}
                    addedLabel={t.chainAddedLabel}
                  />
                ))}
              </div>
            </div>
          )}

          {movies.length === 0 && !showSearch && (
            <p className="text-sm text-muted-foreground text-center py-4">{t.noMoviesInChain}</p>
          )}
        </div>

        {/* ── Mode (locked, display-only) ── */}
        {(isChallenge || isCommunity) && (
          <div className="opacity-60 pointer-events-none">
            {isChallenge && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Timer className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs font-black tracking-widest text-foreground">Challenge Timer</p>
                    <p className="text-[11px] text-muted-foreground">{formatChallengeDuration(challengeDurationMs!, t)}</p>
                  </div>
                </div>
                <Lock className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            {isCommunity && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs font-black tracking-widest text-foreground">Community</p>
                    <p className="text-[11px] text-muted-foreground">{t.communityAddDesc}</p>
                  </div>
                </div>
                <Lock className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        )}

      </div>

      </div>)}{/* end seeded gate */}

      </div>{/* end scrollable */}

      {/* ── Save button — outside scroll so it always sits at the bottom ── */}
      <div className="shrink-0 px-4 pt-3 pb-4 bg-background">
        {error && <p className="text-sm text-red-500 text-center font-semibold mb-2">{error}</p>}
        <button
          onClick={() => { if (!saving && title.trim()) setShowCommunityWarning(true); }}
          disabled={saving || !title.trim()}
          className="w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-transform bg-foreground text-background active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : t.saveBtn}
        </button>
      </div>

      {/* ── Community Rules Modal ── */}
      {showCommunityWarning && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end" onClick={() => setShowCommunityWarning(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl border-t border-border px-5 pt-5"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px) + 1rem)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <p className="text-base font-bold text-foreground mb-2 text-center">{t.communityRulesTitle}</p>
            <p className="text-xs text-muted-foreground mb-4 text-center leading-relaxed">{t.communityRulesSubtitle}</p>
            <div className="max-h-[40vh] overflow-y-auto bg-secondary rounded-2xl px-4 py-3 mb-4">
              {t.communityRulesBody.split("\n").map((line, i) => (
                <p key={i} className={`text-sm text-foreground/80 leading-snug text-left${i > 0 && line === "" ? " mt-3" : i > 0 ? " mt-1.5" : ""}`}>{line || "\u00A0"}</p>
              ))}
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed">{t.communityRulesFootnote}</p>
            </div>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed mb-3 px-1">
              {lang === "th"
                ? "ความคิดเห็น การรีวิว และการให้คะแนนเป็นของผู้ใช้แต่ละคน Ticker ขอไม่รับผิดชอบต่อเนื้อหาที่ผู้ใช้สร้างขึ้น"
                : "All reviews, ratings, and opinions are solely those of the users. Ticker is not responsible for user-generated content."}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowCommunityWarning(false); handleSave(); }}
                className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-sm"
              >
                {t.communityRulesConfirmSave}
              </button>
              <button
                onClick={() => setShowCommunityWarning(false)}
                className="w-full h-12 rounded-2xl text-muted-foreground font-semibold text-sm"
              >
                {t.communityRulesCancel}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
