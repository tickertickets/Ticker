import { useState, useCallback, useEffect, useRef } from "react";
import { useLang, displayYear } from "@/lib/i18n";
import { createPortal } from "react-dom";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useQuery } from "@tanstack/react-query";
import { useSearchMovies } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import { Search, ChevronLeft, Film, X, Plus, Loader2, TrendingUp, Timer, Users, GripVertical, Check } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { scrollStore } from "@/lib/scroll-store";
import { useEnsureMovieCores } from "@/lib/use-movie-cores";
import { useAuth } from "@/hooks/use-auth";
import { getChainDraftKey } from "@/lib/query-client";

// ── Draft storage ─────────────────────────────────────────────────

interface ChainDraft {
  draftId: string;
  title: string;
  description?: string;
  descriptionAlign?: "left" | "center" | "right";
  movies: ChainMovie[];
  communityOn?: boolean;
  challengeOn: boolean;
  timerAmount: number;
  timerUnitIdx: number;
  savedAt: number;
}

function isValidChainDraft(d: unknown): d is ChainDraft {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.draftId === "string" &&
    typeof o.title === "string" &&
    Array.isArray(o.movies) &&
    typeof o.challengeOn === "boolean" &&
    typeof o.timerAmount === "number" &&
    typeof o.timerUnitIdx === "number" &&
    typeof o.savedAt === "number"
  );
}

function readChainDrafts(key: string): ChainDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidChainDraft);
  } catch { return []; }
}
function writeChainDraft(key: string, d: ChainDraft, userId?: string) {
  const rest = readChainDrafts(key).filter(x => x.draftId !== d.draftId);
  localStorage.setItem(key, JSON.stringify([d, ...rest]));
  if (userId) {
    fetch("/api/drafts", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "chain", key: d.draftId, data: d }),
    }).catch(() => {});
  }
}
function eraseChainDraft(key: string, draftId: string, userId?: string) {
  localStorage.setItem(key, JSON.stringify(readChainDrafts(key).filter(x => x.draftId !== draftId)));
  if (userId) {
    fetch(`/api/drafts?type=chain&key=${encodeURIComponent(draftId)}`, {
      method: "DELETE", credentials: "include",
    }).catch(() => {});
  }
}


function ChainMovieRow({ movie, already, onAdd, addedLabel }: {
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

type ChainMovie = {
  imdbId: string;
  movieTitle: string;
  movieYear?: string | null;
  posterUrl?: string | null;
  genre?: string | null;
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

const TIMER_UNITS = [
  { key: "durationHour", ms: 3_600_000 },
  { key: "durationDay",  ms: 86_400_000 },
  { key: "durationWeek", ms: 604_800_000 },
] as const;

function SortableMovieItem({ movie, idx, dragLabel }: { movie: ChainMovie; idx: number; dragLabel: string }) {
  const { lang } = useLang();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: movie.imdbId });
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

export default function CreateChain() {
  const { t, lang } = useLang();
  const scrollRef = usePageScroll("create-chain");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const chainDraftKey = getChainDraftKey(user?.id);

  const [title, setTitle]             = useState("");
  const [description, setDesc]        = useState("");
  const [descriptionAlign, setDescAlign] = useState<"left" | "center" | "right">("left");
  const [movies, setMovies]           = useState<ChainMovie[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showSearch, setShowSearch]       = useState(false);
  const [sortMode, setSortMode]           = useState(false);
  const [showCommunityWarning, setShowCommunityWarning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setMovies(prev => {
      const oldIdx = prev.findIndex(m => m.imdbId === active.id);
      const newIdx = prev.findIndex(m => m.imdbId === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }, []);

  const [communityOn, setCommunityOn]   = useState(false);
  const [huntOn, setHuntOn]             = useState(false);
  const [challengeOn, setChallengeOn]   = useState(false);
  const [timerAmount, setTimerAmount]   = useState(1);
  const [timerUnitIdx, setTimerUnitIdx] = useState(1);

  // Draft state
  const [activeDraftId, setActiveDraftId] = useState<string>(
    () => Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
  const [drafts, setDrafts] = useState<ChainDraft[]>(() => readChainDrafts(getChainDraftKey(user?.id)));
  const [showDraftDialog, setShowDraftDialog] = useState(false);

  // Lock body scroll when draft dialog is open
  useEffect(() => {
    if (showDraftDialog) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showDraftDialog]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);

  // On mount (for logged-in users): fetch server drafts and merge with localStorage
  useEffect(() => {
    if (!user?.id) return;
    fetch("/api/drafts?type=chain", { credentials: "include" })
      .then(r => r.ok ? r.json() : { drafts: [] })
      .then(({ drafts: serverDrafts }: { drafts: unknown[] }) => {
        if (!Array.isArray(serverDrafts)) return;
        const validServer = serverDrafts.filter(isValidChainDraft);
        if (validServer.length === 0) return;
        const localDrafts = readChainDrafts(chainDraftKey);
        const merged: ChainDraft[] = [...validServer];
        for (const ld of localDrafts) {
          if (!merged.find(sd => sd.draftId === ld.draftId)) merged.push(ld);
        }
        localStorage.setItem(chainDraftKey, JSON.stringify(merged));
        setDrafts(merged);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Navigation guard refs
  const hasFormChangesRef = useRef(false);
  const hasDraftsRef = useRef(false);
  const skipGuardRef = useRef(false);
  const sentinelCountRef = useRef(0);

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 400);

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

  // mode derived from toggles (no separate state)
  const mode = huntOn ? "hunt" : communityOn ? "community" : "standard";
  const maxMovies = 50;
  const hasFormChanges = title.trim().length > 0 || description.trim().length > 0 || movies.length > 0 || challengeOn || communityOn || huntOn;

  // Keep refs in sync so popstate handler always reads current values
  useEffect(() => { hasFormChangesRef.current = hasFormChanges; }, [hasFormChanges]);
  useEffect(() => { hasDraftsRef.current = drafts.length > 0; }, [drafts]);

  // Show draft picker on entry if there are existing drafts
  useEffect(() => {
    if (drafts.length > 0) {
      setShowDraftDialog(true);
      window.history.pushState({ chainDraftGuard: true }, "");
      sentinelCountRef.current = 1;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push a history sentinel the first time the form becomes dirty or drafts exist
  useEffect(() => {
    if ((hasFormChanges || drafts.length > 0) && sentinelCountRef.current === 0) {
      window.history.pushState({ chainDraftGuard: true }, "");
      sentinelCountRef.current = 1;
    }
  }, [hasFormChanges, drafts.length]);

  // Intercept browser back gesture / hardware back button
  useEffect(() => {
    const handlePopState = () => {
      if (skipGuardRef.current) {
        skipGuardRef.current = false;
        return;
      }
      if (hasFormChangesRef.current || hasDraftsRef.current) {
        // Re-push sentinel to stay at current URL
        window.history.pushState({ chainDraftGuard: true }, "");
        sentinelCountRef.current += 1;
        setShowDraftDialog(true);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Warn on page reload / tab close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasFormChangesRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Navigate back past all pushed sentinels to reach the real previous page
  const performNavBack = useCallback(() => {
    skipGuardRef.current = true;
    const steps = sentinelCountRef.current > 0 ? sentinelCountRef.current + 1 : 1;
    window.history.go(-steps);
  }, []);

  // ── Auto-save on change (debounced 600ms) ────────────────────────
  useEffect(() => {
    if (!hasFormChanges) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      writeChainDraft(chainDraftKey, {
        draftId: activeDraftId,
        title, description, descriptionAlign, movies, communityOn, challengeOn, timerAmount, timerUnitIdx,
        savedAt: Date.now(),
      }, userIdRef.current);
      setDrafts(readChainDrafts(chainDraftKey));
    }, 600);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, descriptionAlign, movies, communityOn, challengeOn, timerAmount, timerUnitIdx]);

  const addMovie = useCallback((movie: TrendingMovie) => {
    if (movies.find(m => m.imdbId === movie.imdbId)) return;
    if (movies.length >= maxMovies) return;
    setMovies(prev => [...prev, {
      imdbId: movie.imdbId,
      movieTitle: movie.title,
      movieYear: movie.year,
      posterUrl: movie.posterUrl,
      genre: null,
    }]);
    // do NOT reset query — user may want to add sequels from same search
  }, [movies, maxMovies]);

  const removeMovie = (imdbId: string) => {
    setMovies(prev => prev.filter(m => m.imdbId !== imdbId));
  };

  const challengeMs = challengeOn
    ? timerAmount * TIMER_UNITS[timerUnitIdx].ms
    : null;

  // ── Draft helpers ────────────────────────────────────────────────
  const applyDraft = useCallback((d: ChainDraft) => {
    setTitle(d.title);
    setDesc(d.description ?? "");
    setDescAlign(d.descriptionAlign ?? "left");
    setMovies(d.movies);
    setCommunityOn(d.communityOn ?? false);
    setChallengeOn(d.challengeOn);
    setTimerAmount(d.timerAmount);
    setTimerUnitIdx(d.timerUnitIdx);
    setActiveDraftId(d.draftId);
    setShowDraftDialog(false);
  }, []);

  const handleSaveDraft = () => {
    writeChainDraft(chainDraftKey, {
      draftId: activeDraftId,
      title, description, descriptionAlign, movies, communityOn, challengeOn, timerAmount, timerUnitIdx,
      savedAt: Date.now(),
    }, user?.id);
    setDrafts(readChainDrafts(chainDraftKey));
    setShowDraftDialog(false);
    performNavBack();
  };

  const handleDiscardAndBack = () => {
    eraseChainDraft(chainDraftKey, activeDraftId, user?.id);
    setDrafts(readChainDrafts(chainDraftKey));
    setShowDraftDialog(false);
    performNavBack();
  };

  const handleDeleteDraft = (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    eraseChainDraft(chainDraftKey, draftId, user?.id);
    setDrafts(readChainDrafts(chainDraftKey));
  };

  const handleBack = () => {
    if (hasFormChanges || drafts.length > 0) {
      setShowDraftDialog(true);
    } else {
      performNavBack();
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setSubmitError(t.errChainNameRequired); return; }
    if (!huntOn && movies.length < 1) { setSubmitError(t.errChainMinMovie); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/chains", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          descriptionAlign,
          isPrivate: false,
          mode,
          coverImageUrl: movies[0]?.posterUrl ?? null,
          challengeDurationMs: challengeMs,
          movies: movies.map((m, i) => ({
            imdbId: m.imdbId,
            movieTitle: m.movieTitle,
            movieYear: m.movieYear ?? null,
            posterUrl: m.posterUrl ?? null,
            genre: m.genre ?? null,
            customRankTier: null,
            position: i + 1,
          })),
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      // Erase draft on successful submit
      eraseChainDraft(chainDraftKey, activeDraftId, user?.id);
      qc.invalidateQueries({ queryKey: ["/api/chains"] });
      qc.invalidateQueries({ queryKey: ["chains-feed"] });
      qc.invalidateQueries({ queryKey: ["chains-own-following"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-created"] });
      if (user?.username) qc.invalidateQueries({ queryKey: [`/api/users/${user.username}`] });
      // Force home feed to refetch so the new chain appears immediately on return
      qc.invalidateQueries({ queryKey: ["mixed-feed"] });
      scrollStore.set("following", 0);
      setLocation("/");
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("nav-refresh", { detail: { href: "/" } }));
      });
    } catch {
      setSubmitError(t.errSaveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && title.trim().length > 0 && (huntOn || movies.length >= 1);

  return (
    <div className="h-full flex flex-col bg-background">
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">

      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={handleBack}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-base text-foreground flex-1">{t.createChainTitle}</h1>
        </div>
      </div>

      {/* ── Card preview — same size & spacing as create-ticket ── */}
      {huntOn ? (
        /* Hunt mode placeholder — magnifying glass cover */
        <div className="flex justify-center pt-7 pb-5">
          <div
            className="relative w-[72px] rounded-xl bg-secondary flex flex-col items-center justify-center overflow-hidden"
            style={{ aspectRatio: "2/3" }}
          >
            <Search className="w-7 h-7 text-foreground/30" />
            <span className="absolute bottom-2 text-[8px] font-black tracking-widest text-foreground/40">HUNT</span>
          </div>
        </div>
      ) : movies.length === 0 ? (
        /* Ghost card — centered */
        <div className="flex justify-center pt-7 pb-5">
          <button
            onClick={() => setShowSearch(true)}
            className="w-[72px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 active:bg-secondary transition-colors"
            style={{ aspectRatio: "2/3" }}
          >
            <Plus className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">{t.addMovieLabel}</span>
          </button>
        </div>
      ) : sortMode ? (
        /* Sort mode: vertical drag-and-drop list */
        <div className="px-4 pt-4 pb-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
            <SortableContext items={movies.map(m => m.imdbId)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {movies.map((movie, idx) => (
                  <SortableMovieItem key={movie.imdbId} movie={movie} idx={idx} dragLabel={t.dragToSort} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        /* Horizontal scroll once movies are added */
        <div className="flex items-end gap-2.5 px-5 pt-7 pb-5 overflow-x-auto scrollbar-none">
          {movies.map((movie, idx) => (
            <div key={movie.imdbId} className="relative shrink-0 w-[72px]" style={{ aspectRatio: "2/3" }}>
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
                onClick={() => removeMovie(movie.imdbId)}
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

      {/* Sort/done toggle — shows only when ≥2 movies and not in hunt mode */}
      {!huntOn && movies.length > 1 && (
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
      <div className="px-4 space-y-5 pb-4">

        {/* ชื่อ */}
        <div>
          <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.chainNameLabel}</p>
          <textarea
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
              "w-full h-[88px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none",
              descriptionAlign === "center" && "text-center",
              descriptionAlign === "right" && "text-right",
            )}
            placeholder={t.chainDescPlaceholder}
            value={description}
            onChange={e => setDesc(e.target.value)}
            maxLength={5000}
          />
          <div className="flex justify-center mt-2">
            <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-bold">
              {(["left", "center", "right"] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setDescAlign(a)}
                  className={cn(
                    "px-4 py-1.5 transition-colors",
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
        {huntOn ? (
          <p className="text-xs text-muted-foreground text-center py-1 px-2">{t.huntModeDesc}</p>
        ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-black tracking-widest text-foreground">
              {t.moviesInChainLabel}
              <span className={cn("ml-2 font-bold normal-case tracking-normal", movies.length > 0 ? "text-foreground" : "text-muted-foreground")}>
                {movies.length}/{maxMovies}
              </span>
            </p>
            {movies.length < maxMovies && (
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
            <div className="mb-3 bg-secondary rounded-2xl overflow-hidden border border-border">
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
                      <p className="text-[10px] font-bold text-muted-foreground tracking-wider">{t.trendingNow}</p>
                    </div>
                    {trendingSuggestions.map(movie => (
                      <ChainMovieRow
                        key={movie.imdbId}
                        movie={movie}
                        already={!!movies.find(m => m.imdbId === movie.imdbId)}
                        onAdd={addMovie}
                        addedLabel={t.chainAddedLabel}
                      />
                    ))}
                  </>
                )}
                {debouncedQuery && !searchLoading && searchResults.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-5">{t.noMoviesFound}</p>
                )}
                {debouncedQuery && searchResults.map(movie => (
                  <ChainMovieRow
                    key={movie.imdbId}
                    movie={movie}
                    already={!!movies.find(m => m.imdbId === movie.imdbId)}
                    onAdd={addMovie}
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
        )}

        {/* Challenge Timer */}
        <div className={cn(communityOn && "opacity-40 pointer-events-none")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Timer className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs font-black tracking-widest text-foreground">Challenge Timer</p>
                <p className="text-[11px] text-muted-foreground">{t.chainTimerDesc}</p>
              </div>
            </div>
            <button
              onClick={() => setChallengeOn(v => !v)}
              className={cn(
                "w-11 h-6 rounded-full transition-colors shrink-0 relative",
                challengeOn ? "bg-foreground" : "bg-secondary",
              )}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-background shadow transition-all"
                style={{ left: challengeOn ? "calc(100% - 1.375rem)" : "0.125rem" }}
              />
            </button>
          </div>

          {challengeOn && (
            <div className="mt-3 bg-secondary rounded-2xl p-4 space-y-3">
              <div className="flex rounded-xl overflow-hidden border border-border text-xs font-bold">
                {TIMER_UNITS.map((u, i) => (
                  <button
                    key={u.key}
                    onClick={() => setTimerUnitIdx(i)}
                    className={cn(
                      "flex-1 py-2 transition-colors",
                      timerUnitIdx === i ? "bg-foreground text-background" : "bg-background text-muted-foreground",
                      i > 0 && "border-l border-border"
                    )}
                  >
                    {t[u.key]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4 justify-center">
                <button
                  onClick={() => setTimerAmount(v => Math.max(1, v - 1))}
                  className="w-10 h-10 rounded-2xl bg-background border border-border flex items-center justify-center text-xl font-bold text-foreground active:scale-95 transition-transform"
                >
                  −
                </button>
                <div className="text-center min-w-[80px]">
                  <p className="text-3xl font-black text-foreground">{timerAmount}</p>
                  <p className="text-xs text-muted-foreground">{t[TIMER_UNITS[timerUnitIdx].key]}</p>
                </div>
                <button
                  onClick={() => setTimerAmount(v => Math.min(timerUnitIdx === 0 ? 48 : timerUnitIdx === 1 ? 30 : 12, v + 1))}
                  className="w-10 h-10 rounded-2xl bg-background border border-border flex items-center justify-center text-xl font-bold text-foreground active:scale-95 transition-transform"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Community toggle */}
        <div className={cn("flex items-center justify-between", (challengeOn || huntOn) && "opacity-40 pointer-events-none")}>
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs font-black tracking-widest text-foreground">Community</p>
              <p className="text-[11px] text-muted-foreground">{t.communityAddDesc}</p>
            </div>
          </div>
          <button
            onClick={() => { setCommunityOn(v => !v); setHuntOn(false); }}
            className={cn(
              "w-11 h-6 rounded-full transition-colors shrink-0 relative",
              communityOn ? "bg-foreground" : "bg-secondary",
            )}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-background shadow transition-all"
              style={{ left: communityOn ? "calc(100% - 1.375rem)" : "0.125rem" }}
            />
          </button>
        </div>

        {/* Hunt toggle */}
        <div className={cn("flex items-center justify-between", (challengeOn || communityOn) && "opacity-40 pointer-events-none")}>
          <div className="flex items-center gap-2.5">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs font-black tracking-widest text-foreground">{t.huntModeLabel}</p>
              <p className="text-[11px] text-muted-foreground">{t.huntModeDesc}</p>
            </div>
          </div>
          <button
            onClick={() => { setHuntOn(v => !v); setCommunityOn(false); }}
            className={cn(
              "w-11 h-6 rounded-full transition-colors shrink-0 relative",
              huntOn ? "bg-foreground" : "bg-secondary",
            )}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-background shadow transition-all"
              style={{ left: huntOn ? "calc(100% - 1.375rem)" : "0.125rem" }}
            />
          </button>
        </div>

      </div>

    </div>{/* end scrollable */}

      {/* ── Submit — outside scroll so it always sits at the bottom ── */}
      <div className="shrink-0 px-4 pt-3 pb-4 bg-background">
        {submitError && (
          <p className="text-sm text-rose-500 text-center font-semibold mb-2">{submitError}</p>
        )}
        <button
          onClick={() => {
            if (!canSubmit) return;
            setShowCommunityWarning(true);
          }}
          disabled={!canSubmit}
          className={cn(
            "w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all",
            canSubmit
              ? "bg-foreground text-background active:scale-[0.98]"
              : "bg-border text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
          {submitting ? t.creatingChain : t.createChainTitle}
        </button>
      </div>

      {/* ── Community Guidelines modal (before submit) ── */}
      {showCommunityWarning && createPortal(
        <>
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm" onClick={() => setShowCommunityWarning(false)} />
          <div
            className="fixed bottom-0 z-[9999] bg-background rounded-t-3xl border-t border-border"
            style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="px-5 pt-3 pb-5">
              <h2 className="font-display font-bold text-base text-foreground mb-2 text-center">{t.communityRulesTitle}</h2>
              <p className="text-xs text-muted-foreground mb-3 text-center leading-relaxed">{t.communityRulesSubtitle}</p>
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
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCommunityWarning(false)}
                  className="flex-1 h-12 rounded-2xl border border-border text-foreground text-sm font-bold"
                >
                  {t.communityRulesCancel}
                </button>
                <button
                  onClick={() => { setShowCommunityWarning(false); handleSubmit(); }}
                  disabled={submitting}
                  className="flex-1 h-12 rounded-2xl bg-foreground text-background text-sm font-bold disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t.communityRulesConfirmSave}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── "บันทึกดราฟ?" exit bottom-sheet ── */}
      {showDraftDialog && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end" onClick={() => setShowDraftDialog(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl border-t border-border px-5 pt-5"
            style={{
              boxShadow: "0 -4px 32px rgba(0,0,0,0.18)",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px) + 1rem)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            {hasFormChanges ? (
              <>
                <p className="text-base font-bold text-foreground mb-1 text-center">{t.saveDraftChainTitle}</p>
                <p className="text-sm text-muted-foreground mb-5 text-center">
                  {t.saveDraftChainDesc}
                </p>
              </>
            ) : (
              <p className="text-base font-bold text-foreground mb-4 text-center">{t.savedDraftChainLabel}</p>
            )}

            {/* Existing draft cards — vertical card layout */}
            {drafts.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1 mb-3 scrollbar-none">
                {drafts.map(draft => {
                  const posters = draft.movies.slice(0, 4).map(m => m.posterUrl).filter(Boolean) as string[];
                  return (
                    <div
                      key={draft.draftId}
                      onClick={() => applyDraft(draft)}
                      className="relative flex-shrink-0 w-[120px] cursor-pointer active:opacity-70 transition-opacity"
                    >
                      <div className="w-full bg-secondary rounded-2xl border border-border overflow-hidden">
                        {/* Poster collage */}
                        <div className="relative w-full bg-border/60" style={{ aspectRatio: "3/4" }}>
                          {posters.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Film className="w-6 h-6 text-muted-foreground/50" />
                            </div>
                          )}
                          {posters.length === 1 && (
                            <img src={posters[0]} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          {posters.length === 2 && (
                            <div className="absolute inset-0 flex gap-px bg-black">
                              {posters.map((url, i) => (
                                <div key={i} className="flex-1 overflow-hidden">
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                          {posters.length >= 3 && (
                            <div className="absolute inset-0 grid grid-cols-2 gap-px bg-black">
                              {posters.slice(0, 4).map((url, i) => (
                                <div key={i} className="overflow-hidden">
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                          {/* X button — inside card, top-right */}
                          <button
                            onClick={(e) => handleDeleteDraft(draft.draftId, e)}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center z-10"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        </div>
                        <div className="px-2.5 py-2">
                          <p className="text-[11px] font-semibold text-foreground line-clamp-1 leading-tight">
                            {draft.title || t.chainUntitled}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {t.moviesCount(draft.movies.length)} · {new Date(draft.savedAt).toLocaleDateString(t.dateLocale, { day: "numeric", month: "short" })}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {hasFormChanges && (
                <>
                  <button
                    onClick={handleSaveDraft}
                    className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-sm"
                  >
                    {t.saveDraftBtn}
                  </button>
                  <button
                    onClick={handleDiscardAndBack}
                    className="w-full h-12 rounded-2xl bg-secondary text-rose-500 font-bold text-sm"
                  >
                    {t.discardBtn}
                  </button>
                  <button
                    onClick={() => setShowDraftDialog(false)}
                    className="w-full h-12 rounded-2xl text-muted-foreground font-semibold text-sm"
                  >
                    {t.continueBtn}
                  </button>
                </>
              )}
              {!hasFormChanges && (
                <>
                  <button
                    onClick={() => setShowDraftDialog(false)}
                    className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-sm"
                  >
                    {t.startOverBtn}
                  </button>
                  <button
                    onClick={performNavBack}
                    className="w-full h-12 rounded-2xl text-muted-foreground font-semibold text-sm"
                  >
                    {t.backBtn}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
