import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useLang, displayYear } from "@/lib/i18n";
import { navBack } from "@/lib/nav-back";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchMovies, useCreateTicket, type TicketListResponse } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import { Search, ChevronLeft, Film, MapPin, Calendar, Star, Loader2, Users, X, Check, TrendingUp, Clapperboard, Tv, ChevronDown, ChevronUp, Lock, ArrowRight } from "lucide-react";
import { computeCardTier, TIER_VISUAL, computeEffectTags, type ScoreInput } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { useEnsureMovieCores } from "@/lib/use-movie-cores";
import { RatingBadge, CARD_USERNAME_STYLE, getRatingCardStyle } from "@/components/CardFaceComponents";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { scrollStore, scrollOnceStore } from "@/lib/scroll-store";
import { getDraftKey } from "@/lib/query-client";

interface TicketMovieItem {
  imdbId: string;
  title: string;
  year?: string | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  tmdbRating?: string | null;
  voteCount?: number;
  genreIds?: number[];
  popularity?: number;
  franchiseIds?: number[];
}

function useMovieDetail(imdbId: string) {
  // Read-only — rank-relevant fields are pre-loaded by useEnsureMovieCores at
  // the parent level via the lightweight /api/movies/core batch endpoint.
  // We do not actively fetch the heavy /api/movies/:id endpoint here because
  // doing so per-row created a thundering herd of slow requests that delayed
  // the badge update significantly.
  const { data } = useQuery<any>({
    queryKey: ["/api/movies", imdbId],
    enabled: false,
    staleTime: Infinity,
  });
  return { detail: data ?? null, isLoading: false };
}

function getTicketRankVisual(movie: TicketMovieItem, detail?: any) {
  const input: ScoreInput = {
    tmdbRating:   detail?.tmdbRating  ? parseFloat(detail.tmdbRating)  : parseFloat(movie.tmdbRating ?? "0"),
    voteCount:    detail?.voteCount   ?? movie.voteCount   ?? 0,
    genreIds:     detail?.genreIds    ?? movie.genreIds    ?? [],
    popularity:   detail?.popularity  ?? movie.popularity  ?? 0,
    year:         (detail?.year ?? movie.year) ? parseInt(detail?.year ?? movie.year ?? "0") : undefined,
    releaseDate:  detail?.releaseDate ?? movie.releaseDate ?? null,
    franchiseIds: detail?.franchiseIds ?? movie.franchiseIds ?? [],
  };
  const tier = computeCardTier(input);
  return { visual: TIER_VISUAL[tier], tier, effects: computeEffectTags(input, tier) };
}

function TicketMovieRow({ movie, onSelect, ariaLabel }: { movie: TicketMovieItem; onSelect: (imdbId: string, movie: TicketMovieItem) => void; ariaLabel: (name: string) => string }) {
  const { lang } = useLang();
  const { detail, isLoading } = useMovieDetail(movie.imdbId);
  const rankReady = !isLoading;
  const { visual, tier, effects } = getTicketRankVisual(movie, detail);
  return (
    <div className="w-full flex items-center gap-3 p-3 rounded-2xl border border-border bg-background active:bg-secondary transition-colors">
      <div className="relative w-12 h-[68px] rounded-xl overflow-hidden bg-secondary flex-shrink-0 border border-border shimmer-no-border">
        {movie.posterUrl ? (
          <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-foreground leading-tight line-clamp-2">{movie.title}</p>
        {movie.year && <p className="text-xs text-muted-foreground mt-0.5">{displayYear(movie.year, lang)}</p>}
        <div className="mt-1">
          <MovieBadges tier={tier} effects={effects} size="xs" layout="row" />
        </div>
      </div>
      <button
        onClick={() => onSelect(movie.imdbId, movie)}
        className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
        aria-label={ariaLabel(movie.title)}
      >
        <span className="text-background text-sm font-bold">+</span>
      </button>
    </div>
  );
}

interface Draft {
  movieId: string;
  movieTitle: string;
  movieYear?: string | null;
  posterUrl?: string | null;
  savedAt: number;
  rating: number;
  ratingType: "star" | "blackhole";
  memoryNote: string;
  caption: string;
  captionAlign: "left" | "center" | "right";
  watchDate: string;
  watchLocation: string;
  cardTheme: "classic" | "poster";
  selectedBackdropUrl: string | null;
  cardOffsetX: number;
  isPrivate: boolean;
  isPrivateMemory: boolean;
  partyMode: boolean;
  partySize: number;
  partySeatNumber: number;
}

function readDrafts(key: string): Draft[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function writeDraft(key: string, d: Draft, userId?: string) {
  const rest = readDrafts(key).filter(x => x.movieId !== d.movieId);
  localStorage.setItem(key, JSON.stringify([d, ...rest]));
  if (userId) {
    fetch("/api/drafts", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ticket", key: d.movieId, data: d }),
    }).catch(() => {});
  }
}
function eraseDraft(key: string, movieId: string, userId?: string) {
  localStorage.setItem(key, JSON.stringify(readDrafts(key).filter(x => x.movieId !== movieId)));
  if (userId) {
    fetch(`/api/drafts?type=ticket&key=${encodeURIComponent(movieId)}`, {
      method: "DELETE", credentials: "include",
    }).catch(() => {});
  }
}


function detectLang(text: string): string {
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-TW";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return "en-US";
}

interface MovieDetails {
  imdbId: string;
  title: string;
  year?: string | null;
  genre?: string | null;
  genreList?: string[];
  genreIds?: number[];
  plot?: string | null;
  posterUrl?: string | null;
  imdbRating?: string | null;
  voteCount?: number;
  popularity?: number;
  runtime?: string | null;
  director?: string | null;
  producer?: string | null;
  actors?: string | null;
  mediaType?: "movie" | "tv" | null;
  numberOfSeasons?: number | null;
}

interface UserSearchResult {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export default function CreateTicket() {
  const { t, lang } = useLang();
  // Plain scroll ref — not usePageScroll — mirrors chain-detail exactly.
  // create-ticket always starts at top on fresh entry; scroll is only preserved
  // for the step 1 → 2 (select movie) → back flow.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRestoredRef = useRef(false);
  // autoFocus the search input only on first entry, NOT when returning from step 2.
  // If autoFocus fires on step-1 remount it triggers browser scrollIntoView which
  // fights with our scroll restoration and always wins, snapping back to top.
  const allowAutoFocusRef = useRef(true);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);

  // One-shot scroll restoration when returning from step 2 → step 1.
  // Exactly mirrors chain-detail: synchronous set in useLayoutEffect, consumed once.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !el.isConnected) return;
    if (step === 2) {
      el.scrollTop = 0;
      scrollRestoredRef.current = false; // arm for next step-1 restoration
      allowAutoFocusRef.current = false;  // prevent autoFocus-driven scrollIntoView on step-1 return
      return;
    }
    // step === 1
    if (scrollRestoredRef.current) return;
    const key = "create-ticket-step1";
    const target = scrollOnceStore.get(key) ?? 0;
    scrollOnceStore.delete(key); // consume immediately — one-shot
    scrollRestoredRef.current = true;
    if (target <= 0) return;
    el.scrollTop = target; // synchronous, before browser paint — no flash
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 400);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  // Snapshot of title/year/poster captured at selection time (from search
  // results, trending, or draft). Always wins over the refetched details so
  // the language the user picked the movie in is preserved.
  const [selectedSnapshot, setSelectedSnapshot] = useState<{
    title: string; year?: string | null; posterUrl?: string | null;
  } | null>(null);
  const [selectedLang, setSelectedLang] = useState("th");

  const [memoryNote, setMemoryNote] = useState("");
  const [caption, setCaption] = useState("");
  const [watchDate, setWatchDate] = useState("");
  const [watchLocation, setWatchLocation] = useState("");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isDyingStar, setIsDyingStar] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isPrivateMemory, setIsPrivateMemory] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // UI state
  const [previewFlipped, setPreviewFlipped] = useState(false);
  const [previewFlipSign, setPreviewFlipSign] = useState<1 | -1>(1);
  const [captionAlign, setCaptionAlign] = useState<"left" | "center" | "right">("left");

  // Card theme state
  const [cardTheme, setCardTheme] = useState<"classic" | "poster">("classic");
  const [selectedBackdropUrl, setSelectedBackdropUrl] = useState<string | null>(null);
  const [cardOffsetX, setCardOffsetX] = useState(50);

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(() => new Date().getMonth());

  // Drag-to-pan refs (used in poster preview)
  const isDraggingRef = useRef(false);
  const dragStartRef  = useRef({ x: 0, offset: 50 });

  const onPanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current  = { x: e.clientX, offset: cardOffsetX };
    e.currentTarget.style.cursor = "grabbing";
  }, [cardOffsetX]);

  const onPanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const containerWidth = e.currentTarget.offsetWidth || 178;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaPercent = (deltaX / containerWidth) * 180;
    const newOffset = Math.max(0, Math.min(100, dragStartRef.current.offset - deltaPercent));
    setCardOffsetX(Math.round(newOffset));
  }, []);

  const onPanPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.style.cursor = "grab";
  }, []);

  // Party mode state
  const [partyMode, setPartyMode] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [partySeatNumber, setPartySeatNumber] = useState(1);
  const [partyInvitees, setPartyInvitees] = useState<UserSearchResult[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [debouncedUserSearch] = useDebounceValue(userSearchQuery, 400);

  // Episode selector state (for TV shows)
  const [selectedEpisodeLabel, setSelectedEpisodeLabel] = useState<string | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [showEpisodePicker, setShowEpisodePicker] = useState(false);

  // Draft state
  const draftKey = getDraftKey(user?.id);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => readDrafts(getDraftKey(user?.id)));
  const [draftsFetching, setDraftsFetching] = useState<boolean>(false);

  // On mount (for logged-in users): fetch server drafts and merge with localStorage
  useEffect(() => {
    if (!user?.id) return;
    setDraftsFetching(true);
    fetch("/api/drafts?type=ticket", { credentials: "include" })
      .then(r => r.ok ? r.json() : { drafts: [] })
      .then(({ drafts: serverDrafts }: { drafts: unknown[] }) => {
        if (!Array.isArray(serverDrafts)) return;
        const validServer = serverDrafts.filter((d): d is Draft =>
          !!d && typeof d === "object" && typeof (d as Draft).movieId === "string"
        );
        const localDrafts = readDrafts(draftKey);
        const merged: Draft[] = [...validServer];
        for (const ld of localDrafts) {
          if (!merged.find(sd => sd.movieId === ld.movieId)) merged.push(ld);
        }
        if (merged.length > 0) {
          localStorage.setItem(draftKey, JSON.stringify(merged));
          setDrafts(merged);
        }
      })
      .catch(() => {})
      .finally(() => setDraftsFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Lock body scroll when draft dialog is open
  useEffect(() => {
    if (showDraftDialog) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showDraftDialog]);

  // Refs for auto-save (unmount + debounce)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveDraftDataRef = useRef<Draft | null>(null);
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);



  const createTicket = useCreateTicket();


  const searchLang = debouncedQuery ? detectLang(debouncedQuery) : "en-US";

  const { data: searchData, isLoading: searchLoading } = useSearchMovies(
    { query: debouncedQuery, page: 1 },
    { query: { enabled: debouncedQuery.length > 1 } as any }
  );

  const { data: trendingPage1 } = useQuery({
    queryKey: ["trending-for-ticket-search", 1],
    queryFn: () => fetch("/api/movies/trending?page=1").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const { data: trendingPage2 } = useQuery({
    queryKey: ["trending-for-ticket-search", 2],
    queryFn: () => fetch("/api/movies/trending?page=2").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  type TrendingSuggestion = {
    imdbId: string; title: string; year?: string | null; posterUrl?: string | null;
    tmdbRating?: string | null; voteCount?: number; genreIds?: number[];
    popularity?: number; franchiseIds?: number[];
  };
  const trendingSuggestions = [
    ...((trendingPage1?.movies ?? []) as TrendingSuggestion[]),
    ...((trendingPage2?.movies ?? []) as TrendingSuggestion[]),
  ].slice(0, 30);

  const { data: movieDetails } = useQuery<MovieDetails>({
    queryKey: ["/api/movies", selectedMovieId, selectedLang],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(selectedMovieId!)}?lang=${selectedLang}`);
      if (!res.ok) throw new Error("Failed to fetch movie");
      return res.json();
    },
    enabled: !!selectedMovieId,
  });

  const { data: userSearchResults, isLoading: userSearchLoading } = useQuery<{ users: UserSearchResult[] }>({
    queryKey: ["/api/users/search", debouncedUserSearch, "followingOnly"],
    queryFn: async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(debouncedUserSearch)}&limit=8&followingOnly=true`, { credentials: "include" });
      if (!res.ok) return { users: [] };
      return res.json();
    },
    enabled: debouncedUserSearch.length > 1 && partyMode,
  });

  const movies = searchData?.movies ?? [];

  // Pre-load rank-relevant fields for every visible movie so the badges show
  // the correct rank immediately instead of waiting for detail page visit.
  useEnsureMovieCores([
    ...trendingSuggestions.map(m => m.imdbId),
    ...movies.map(m => m.imdbId),
  ]);

  // Snapshot-first reads — preserve the language used at selection time.
  const displayTitle = selectedSnapshot?.title ?? movieDetails?.title ?? "";
  const movieYearStr = selectedSnapshot?.year ?? movieDetails?.year ?? null;
  const posterUrl = selectedSnapshot?.posterUrl ?? movieDetails?.posterUrl ?? "";

  // Fetch seasons for TV shows to enable episode selection
  const isTvShow = !!(movieDetails?.mediaType === "tv" || selectedMovieId?.startsWith("tmdb_tv:"));
  const { data: seasonsData } = useQuery<{
    seasons: Array<{
      seasonNumber: number;
      name: string;
      episodes: Array<{
        episodeNumber: number;
        name: string;
        airDate: string | null;
        rating: number | null;
        voteCount: number;
      }>;
    }>;
  }>({
    queryKey: ["/api/movies", selectedMovieId, "seasons"],
    queryFn: async () => {
      const res = await fetch(`/api/movies/${encodeURIComponent(selectedMovieId!)}/seasons`);
      if (!res.ok) return { seasons: [] };
      return res.json();
    },
    enabled: !!selectedMovieId && isTvShow,
    staleTime: 10 * 60 * 1000,
  });

  const { data: backdropsData, isLoading: backdropsLoading } = useQuery<{ backdrops: string[] }>({
    queryKey: ["/api/movies/backdrops", selectedMovieId],
    queryFn: async () => {
      const r = await fetch(`/api/movies/${encodeURIComponent(selectedMovieId!)}/backdrops`);
      return r.json();
    },
    enabled: !!selectedMovieId,
    staleTime: 10 * 60 * 1000,
  });
  const backdrops = backdropsData?.backdrops ?? [];

  useEffect(() => {
    if (cardTheme === "poster" && backdrops.length > 0 && !selectedBackdropUrl) {
      setSelectedBackdropUrl(backdrops[0]);
      setCardOffsetX(50);
    }
  }, [cardTheme, backdrops, selectedBackdropUrl]);

  useEffect(() => {
    if (!backdrops.length) return;
    backdrops.forEach(url => { const img = new Image(); img.src = url; });
  }, [backdrops]);

  const hasFormChanges = useMemo(() => {
    return rating > 0 || memoryNote.trim().length > 0 ||
      caption.trim().length > 0 || watchDate.length > 0 || watchLocation.trim().length > 0 ||
      !!selectedBackdropUrl || partyMode || cardTheme !== "classic";
  }, [rating, memoryNote, caption, watchDate, watchLocation, selectedBackdropUrl, partyMode, cardTheme]);

  // Keep autoSaveDraftDataRef always up-to-date so unmount can save latest values
  useEffect(() => {
    if (!selectedMovieId || !hasFormChanges) {
      autoSaveDraftDataRef.current = null;
      return;
    }
    autoSaveDraftDataRef.current = {
      movieId: selectedMovieId,
      movieTitle: displayTitle,
      movieYear: movieYearStr,
      posterUrl: posterUrl || null,
      savedAt: Date.now(),
      rating, ratingType: isDyingStar ? "blackhole" : "star",
      memoryNote, caption, captionAlign,
      watchDate, watchLocation, cardTheme, selectedBackdropUrl, cardOffsetX,
      isPrivate, isPrivateMemory, partyMode, partySize, partySeatNumber,
    };
  }, [selectedMovieId, movieDetails, rating, isDyingStar, memoryNote, caption, captionAlign,
      watchDate, watchLocation, cardTheme, selectedBackdropUrl, cardOffsetX,
      isPrivate, isPrivateMemory, partyMode, partySize, partySeatNumber, hasFormChanges]);

  // Debounced auto-save (600ms) — persists draft while user is editing
  useEffect(() => {
    if (!selectedMovieId || !hasFormChanges) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (autoSaveDraftDataRef.current) {
        writeDraft(draftKey, autoSaveDraftDataRef.current, user?.id);
        setDrafts(readDrafts(draftKey));
      }
    }, 600);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating, isDyingStar, memoryNote, caption, captionAlign, watchDate, watchLocation,
      cardTheme, selectedBackdropUrl, cardOffsetX, isPrivate, isPrivateMemory,
      partyMode, partySize, partySeatNumber, selectedMovieId, hasFormChanges]);

  // Save draft immediately on unmount (covers tab-navigation away from the page)
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (autoSaveDraftDataRef.current) {
        writeDraft(draftKey, autoSaveDraftDataRef.current, userIdRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const resetFormState = useCallback(() => {
    setRating(0); setHoverRating(0); setIsDyingStar(false);
    setMemoryNote(""); setCaption(""); setCaptionAlign("left");
    setWatchDate(""); setWatchLocation("");
    setCardTheme("classic"); setSelectedBackdropUrl(null); setCardOffsetX(50);
    setPartyMode(false); setPartySize(2); setPartySeatNumber(1); setPartyInvitees([]);
    setIsPrivate(false); setIsPrivateMemory(false); setIsSpoiler(false);
    setSubmitError(""); setPreviewFlipped(false); setPreviewFlipSign(1);
    setSelectedEpisodeLabel(null); setExpandedSeason(null); setShowEpisodePicker(false);
  }, []);

  const applyDraft = useCallback((d: Draft) => {
    setRating(d.rating); setHoverRating(0);
    setIsDyingStar(d.ratingType === "blackhole");
    setMemoryNote(d.memoryNote); setCaption(d.caption); setCaptionAlign(d.captionAlign);
    setWatchDate(d.watchDate); setWatchLocation(d.watchLocation);
    setCardTheme(d.cardTheme); setSelectedBackdropUrl(d.selectedBackdropUrl); setCardOffsetX(d.cardOffsetX);
    setIsPrivate(d.isPrivate); setIsPrivateMemory(d.isPrivateMemory);
    setPartyMode(d.partyMode); setPartySize(d.partySize); setPartySeatNumber(d.partySeatNumber);
    setPartyInvitees([]);
    setSubmitError(""); setPreviewFlipped(false); setPreviewFlipSign(1);
  }, []);

  const handleSelectMovie = (imdbId: string, partial?: { title: string; year?: string | null; posterUrl?: string | null; tmdbRating?: string | null; voteCount?: number; genreIds?: number[]; popularity?: number; franchiseIds?: number[] }) => {
    scrollOnceStore.set("create-ticket-step1", scrollRef.current?.scrollTop ?? 0);
    const lang = debouncedQuery
      ? detectLang(debouncedQuery)
      : (partial?.title ? detectLang(partial.title) : "en-US");
    if (partial) {
      queryClient.setQueryData(["/api/movies", imdbId, lang], (old: any) => old ?? {
        imdbId,
        title: partial.title,
        year: partial.year ?? null,
        posterUrl: partial.posterUrl ?? null,
        tmdbRating: partial.tmdbRating ?? null,
        voteCount: partial.voteCount ?? 0,
        genreIds: partial.genreIds ?? [],
        popularity: partial.popularity ?? 0,
        franchiseIds: partial.franchiseIds ?? [],
        genre: null, genreList: [], plot: null, imdbRating: null, runtime: null,
        director: null, producer: null, actors: null, mediaType: null, numberOfSeasons: null,
      });
    }
    // Capture title/year/poster from the search/trending/draft snapshot so
    // the language at selection time is preserved even after the detail
    // refetch returns the movie's original-language values.
    if (partial?.title) {
      setSelectedSnapshot({
        title: partial.title,
        year: partial.year ?? null,
        posterUrl: partial.posterUrl ?? null,
      });
    } else {
      setSelectedSnapshot(null);
    }
    const existingDraft = readDrafts(draftKey).find(d => d.movieId === imdbId);
    if (existingDraft) {
      applyDraft(existingDraft);
    } else {
      resetFormState();
    }
    setSelectedMovieId(imdbId);
    setSelectedLang(lang);
    setStep(2);
  };

  const handleSaveDraft = () => {
    if (!selectedMovieId) return;
    const d: Draft = {
      movieId: selectedMovieId,
      movieTitle: displayTitle,
      movieYear: movieYearStr,
      posterUrl: posterUrl || null,
      savedAt: Date.now(),
      rating, ratingType: isDyingStar ? "blackhole" : "star", memoryNote, caption, captionAlign,
      watchDate, watchLocation, cardTheme, selectedBackdropUrl,
      cardOffsetX, isPrivate, isPrivateMemory, partyMode, partySize, partySeatNumber,
    };
    writeDraft(draftKey, d, user?.id);
    const updated = readDrafts(draftKey);
    setDrafts(updated);
    setShowDraftDialog(false);
    resetFormState();
    setStep(1);
  };

  const handleDiscardAndBack = () => {
    if (selectedMovieId) eraseDraft(draftKey, selectedMovieId, user?.id);
    setDrafts(readDrafts(draftKey));
    setShowDraftDialog(false);
    resetFormState();
    setStep(1);
  };

  const handleDeleteDraft = (movieId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    eraseDraft(draftKey, movieId, user?.id);
    setDrafts(readDrafts(draftKey));
  };

  const handleBack = () => {
    if (step === 1) {
      navBack(setLocation);
    } else if (hasFormChanges) {
      setShowDraftDialog(true);
    } else {
      resetFormState();
      setStep(1);
    }
  };

  const addInvitee = useCallback((u: UserSearchResult) => {
    if (u.id === user?.id) return;
    if (partyInvitees.find(p => p.id === u.id)) return;
    if (partyInvitees.length >= partySize - 1) return;
    setPartyInvitees(prev => [...prev, u]);
    setUserSearchQuery("");
  }, [user, partyInvitees, partySize]);

  const removeInvitee = useCallback((id: string) => {
    setPartyInvitees(prev => prev.filter(p => p.id !== id));
  }, []);

  const handlePartyModeToggle = () => {
    setPartyMode(v => {
      if (!v) {
        setPartySize(2);
        setPartySeatNumber(1);
        setPartyInvitees([]);
      }
      return !v;
    });
  };

  const handlePartySizeChange = (newSize: number) => {
    setPartySize(newSize);
    if (partySeatNumber > newSize) setPartySeatNumber(1);
    // Trim invitees if too many
    if (partyInvitees.length > newSize - 1) {
      setPartyInvitees(prev => prev.slice(0, newSize - 1));
    }
  };

  const handleSubmit = async () => {
    if (!selectedMovieId || !movieDetails) return;
    if (!rating || rating < 1) {
      setSubmitError(t.errNoRating);
      return;
    }
    setSubmitError("");
    // Fresh-fetch trash list at submit time to catch stale cache
    try {
      const trashRes = await fetch("/api/tickets/trash/list", { credentials: "include" });
      if (trashRes.ok) {
        const trashJson = await trashRes.json() as { tickets: Array<{ imdbId: string }> };
        const isTVShow = selectedMovieId.startsWith("tmdb_tv:");
        if (!isTVShow && trashJson.tickets?.some(t => t.imdbId === selectedMovieId)) {
          setSubmitError(t.errDuplicateMovie);
          return;
        }
      }
    } catch {}
    try {
      const newTicket = await createTicket.mutateAsync({
        data: {
          imdbId: selectedMovieId,
          movieTitle: displayTitle,
          movieYear: movieYearStr ?? undefined,
          posterUrl: posterUrl || undefined,
          genre: movieDetails.genre?.split(",")[0]?.trim() ?? undefined,
          template: "classic",
          memoryNote: memoryNote || undefined,
          caption: caption || undefined,
          captionAlign: captionAlign !== "left" ? captionAlign : undefined,
          episodeLabel: selectedEpisodeLabel || undefined,
          watchedAt: watchDate || undefined,
          location: watchLocation || undefined,
          rating: rating,
          ratingType: isDyingStar ? "blackhole" : "star",
          isPrivateMemory: isPrivateMemory || undefined,
          isPrivate,
          isSpoiler: isSpoiler || undefined,
          partyMode: partyMode || undefined,
          partySize: partyMode ? partySize : undefined,
          partySeatNumber: partyMode ? partySeatNumber : undefined,
          partyInviteeIds: partyMode ? partyInvitees.map(u => u.id) : undefined,
          cardTheme,
          cardBackdropUrl: cardTheme === "poster" ? (selectedBackdropUrl ?? undefined) : undefined,
          cardBackdropOffsetX: cardTheme === "poster" ? cardOffsetX : undefined,
          cardRuntime: cardTheme === "poster" ? (movieDetails.runtime ?? undefined) : undefined,
          cardDirector: cardTheme === "poster" ? (movieDetails.director ?? undefined) : undefined,
          cardProducer: cardTheme === "poster" ? (movieDetails.producer ?? undefined) : undefined,
          cardActors: cardTheme === "poster" ? (movieDetails.actors ?? undefined) : undefined,
        } as Parameters<typeof createTicket.mutateAsync>[0]["data"],
      });

      // Prepend new card to the profile ticket cache (all param variants)
      if (user?.username) {
        queryClient.setQueriesData<TicketListResponse>(
          { queryKey: [`/api/users/${user.username}/tickets`] },
          (old) => old
            ? { ...old, tickets: [newTicket, ...old.tickets] }
            : { tickets: [newTicket], hasMore: false },
        );
        // Optimistically prepend to profile page ticket grid
        queryClient.setQueriesData<TicketListResponse>(
          { queryKey: ["profile-tickets-popular", user.username] },
          (old) => old
            ? { ...old, tickets: [newTicket, ...old.tickets] }
            : { tickets: [newTicket], hasMore: false },
        );
        // Force refetch so any sort/filter changes are reflected
        queryClient.invalidateQueries({ queryKey: ["profile-tickets-popular", user.username] });
      }

      // Prepend new card to the global feed cache (all param variants)
      queryClient.setQueriesData<TicketListResponse>(
        { queryKey: ["/api/tickets"] },
        (old) => old
          ? { ...old, tickets: [newTicket, ...old.tickets] }
          : { tickets: [newTicket], hasMore: false },
      );

      // Invalidate this movie's ratings so movie-detail updates
      queryClient.invalidateQueries({ queryKey: ["/api/movies", selectedMovieId, "ratings-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movies", selectedMovieId, "community"] });
      // Refresh all feeds so new post appears immediately
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["chains-hot-following"] });
      queryClient.invalidateQueries({ queryKey: ["chains-own-following"] });
      // Force home feed to refetch so the new post appears immediately on return
      queryClient.invalidateQueries({ queryKey: ["mixed-feed"] });

      // Erase draft for this movie since it was successfully posted
      eraseDraft(draftKey, selectedMovieId, user?.id);
      autoSaveDraftDataRef.current = null;

      // Navigate to following feed at top — same as Instagram post flow
      scrollStore.set("following", 0);
      setLocation("/");
      // Trigger scroll-to-top + feed refresh in the persistent following tab
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("nav-refresh", { detail: { href: "/" } }));
      });
    } catch (err: unknown) {
      const body = err instanceof Error ? err.message : "";
      if (body.includes("duplicate_movie")) {
        if (body.includes("คุณโพสต์ตอนนี้ไปแล้ว")) {
          setSubmitError(t.errDuplicateEpisode);
        } else if (body.includes("คุณโพสต์ดูทั่วไปของซีรีส์นี้ไปแล้ว")) {
          setSubmitError(t.errDuplicateGeneral);
        } else {
          setSubmitError(t.errDuplicateMovie);
        }
      } else {
        setSubmitError(t.errGeneric);
      }
    }
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={handleBack}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-base flex-1 text-foreground">
            {step === 1 ? t.stepSelectMovie : t.stepPostTicket}
          </h1>
        </div>
      </div>

      {/* STEP 1 — Movie Search */}
      {step === 1 && (
        <div className="px-4 pt-4 pb-2">
          <div className="relative mb-4">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <input
              className="search-bar"
              style={{ paddingLeft: "3rem", paddingRight: query ? "2.75rem" : undefined }}
              placeholder={t.searchAnyLang}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={allowAutoFocusRef.current}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center z-10"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {searchLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* ── ดราฟที่บันทึกไว้ ── */}
          {draftsFetching && !debouncedQuery && !searchLoading && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-2">{t.savedDraftsLabel}</p>
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          {drafts.length > 0 && !draftsFetching && !debouncedQuery && !searchLoading && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-2">{t.savedDraftsLabel}</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {drafts.map(draft => (
                  <div
                    key={draft.movieId}
                    onClick={() => handleSelectMovie(draft.movieId, { title: draft.movieTitle, year: draft.movieYear, posterUrl: draft.posterUrl })}
                    className="relative flex-shrink-0 w-28 cursor-pointer active:opacity-70 transition-opacity"
                  >
                    <div className="w-full aspect-[2/3] rounded-xl overflow-hidden bg-secondary border border-border">
                      {draft.posterUrl ? (
                        <img src={draft.posterUrl} alt={draft.movieTitle} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] font-semibold text-foreground mt-1 line-clamp-1 leading-tight">{draft.movieTitle}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(draft.savedAt).toLocaleDateString(t.dateLocale, { day: "numeric", month: "short" })}
                    </p>
                    <button
                      onClick={(e) => handleDeleteDraft(draft.movieId, e)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center"
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!debouncedQuery && !searchLoading && (
            <div>
              {trendingSuggestions.length > 0 ? (
                <>
                  <div className="flex items-center gap-1.5 mb-3">
                    <TrendingUp className="w-4 h-4 text-red-500" />
                    <p className="text-xs font-semibold text-muted-foreground tracking-widest">{t.trendingNow}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {trendingSuggestions.map((movie) => (
                      <TicketMovieRow key={movie.imdbId} movie={movie} onSelect={handleSelectMovie} ariaLabel={t.selectMovieAria} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                  <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
                    <Film className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display font-bold text-foreground">{t.whatDidYouWatch}</p>
                    <p className="text-sm text-muted-foreground">{t.searchForMovieDesc}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!searchLoading && debouncedQuery && movies.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">{t.noMovieFoundTryAgain}</p>
          )}

          <div className="flex flex-col gap-2">
            {movies.map((movie) => (
              <TicketMovieRow key={movie.imdbId} movie={movie as TicketMovieItem} onSelect={handleSelectMovie} ariaLabel={t.selectMovieAria} />
            ))}
          </div>
        </div>
      )}

      {/* STEP 2 — Memory Form */}
      {step === 2 && movieDetails && (
        <div className="pb-4">

          {/* ── Card Preview (flippable) ── */}
          <div className="flex flex-col items-center pt-7 pb-5 gap-2">
            <div
              className="cursor-pointer"
              style={{ width: 190, height: 285, perspective: "800px", userSelect: "none", WebkitUserSelect: "none" }}
              onClick={(e) => {
                if (!previewFlipped) {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setPreviewFlipSign(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
                }
                setPreviewFlipped(v => !v);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div
                className="relative w-full h-full transition-transform duration-500"
                style={{ transformStyle: "preserve-3d", transform: previewFlipped ? `rotateY(${previewFlipSign * 180}deg)` : "rotateY(0deg)" }}
              >
                {/* Front */}
                {cardTheme === "poster" ? (
                  /* ── Poster theme preview (190×266) ── */
                  <div
                    className={cn("absolute inset-0 overflow-hidden flex flex-col", getRatingCardStyle(rating, isDyingStar ? "blackhole" : "star").shimmer)}
                    style={{
                      background: "#ccc9c3",
                      borderRadius: 0,
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      ...getRatingCardStyle(rating, isDyingStar ? "blackhole" : "star").glow,
                      boxShadow: "var(--ticket-shadow-poster)",
                    }}
                  >
                    {/* Image — inset 5px L/R/T, drag-to-pan */}
                    <div className="flex-shrink-0 w-full" style={{ padding: "5px 5px 0" }}>
                      <div
                        className="relative overflow-hidden w-full"
                        style={{ aspectRatio: "1 / 1", outline: "0.5px solid rgba(0,0,0,0.2)", cursor: "grab", touchAction: "none" }}
                        onPointerDown={onPanPointerDown}
                        onPointerMove={onPanPointerMove}
                        onPointerUp={onPanPointerUp}
                        onPointerCancel={onPanPointerUp}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        {selectedBackdropUrl ? (
                          <img
                            src={selectedBackdropUrl}
                            alt={displayTitle}
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ objectPosition: `${cardOffsetX}% center`, pointerEvents: "none" }}
                          />
                        ) : (
                          <div
                            className="absolute inset-0"
                            style={{ background: "#b0ada8" }}
                          />
                        )}
                        {rating > 0 && (
                          <div style={{ position: "absolute", top: 4, right: 4 }}>
                            <RatingBadge rating={rating} ratingType={isDyingStar ? "blackhole" : "star"} size={16} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Text area — matches PosterCardFront exactly */}
                    <div
                      className="flex-shrink-0 flex flex-col"
                      style={{ padding: "5px 8px 24px" }}
                    >
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 900,
                          textTransform: "uppercase",
                          color: "#1c1c1c",
                          letterSpacing: "-0.01em",
                          lineHeight: 1.45,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {displayTitle}
                      </div>
                      {movieYearStr && (
                        <div style={{ fontSize: 8, fontWeight: 700, color: "#1c1c1c", opacity: 0.58, letterSpacing: "0.02em", marginTop: 2 }}>
                          {displayYear(movieYearStr, lang)}
                        </div>
                      )}
                    </div>
                    {user?.username && (
                      <p style={{ ...CARD_USERNAME_STYLE, color: "#1c1c1c", opacity: 0.38 }}>
                        @{user.username}
                      </p>
                    )}
                  </div>
                ) : (
                /* ── Classic theme preview ── */
                <div
                  className={cn("absolute inset-0 rounded-2xl overflow-hidden", getRatingCardStyle(rating, isDyingStar ? "blackhole" : "star").shimmer)}
                  style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", ...getRatingCardStyle(rating, isDyingStar ? "blackhole" : "star").glow }}
                >
                  {posterUrl ? (
                    <img src={posterUrl} alt={displayTitle} className="w-full h-full object-cover" style={{ pointerEvents: "none" }} />
                  ) : (
                    <div className="w-full h-full bg-secondary flex items-center justify-center">
                      <Film className="w-10 h-10 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 px-2 pb-6">
                    <p className="font-display font-bold text-[13px] text-white leading-tight line-clamp-1">{displayTitle}</p>
                    {movieYearStr && <p className="text-white/55 text-[10px] mt-0.5">{displayYear(movieYearStr, lang)}</p>}
                  </div>
                  {user?.username && (
                    <p style={{ ...CARD_USERNAME_STYLE, color: "rgba(255,255,255,0.35)" }}>
                      @{user.username}
                    </p>
                  )}
                  {rating > 0 && (
                    <div className="absolute top-2 right-2">
                      <RatingBadge rating={rating} ratingType={isDyingStar ? "blackhole" : "star"} size={16} />
                    </div>
                  )}
                </div>
                )}
                {/* Back — matches actual CardBackFace layout */}
                <div
                  className="absolute inset-0 overflow-hidden p-3 flex flex-col"
                  style={{
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    borderRadius: cardTheme === "poster" ? 0 : 16,
                    background: cardTheme === "poster" ? "#ccc9c3" : "var(--card-back-bg)",
                    border: cardTheme === "poster" ? "none" : "1px solid var(--card-back-border)",
                    boxShadow: cardTheme === "poster" ? "var(--ticket-shadow-back-poster)" : "var(--ticket-shadow)",
                  }}
                >
                  {partyMode && (
                    <div
                      className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black"
                      style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }}
                    >
                      {partySeatNumber}
                    </div>
                  )}
                  {isPrivateMemory && !memoryNote ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-1">
                      <Lock style={{ width: 14, height: 14, color: cardTheme === "poster" ? "rgba(28,28,28,0.4)" : "var(--card-back-text-faint)" }} />
                      <p style={{ fontSize: 10, fontStyle: "italic", textAlign: "center", color: cardTheme === "poster" ? "rgba(28,28,28,0.45)" : "var(--card-back-text-muted)" }}>{t.privateMemory}</p>
                    </div>
                  ) : memoryNote ? (
                    <p style={{
                      fontSize: 11, lineHeight: 1.6, fontStyle: "italic", flex: 1,
                      color: cardTheme === "poster" ? "rgba(28,28,28,0.6)" : "var(--card-back-text)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      "{memoryNote}"
                    </p>
                  ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <p style={{ fontSize: 10, fontStyle: "italic", textAlign: "center", color: cardTheme === "poster" ? "rgba(28,28,28,0.8)" : "var(--card-back-text-faint)" }}>
                        {t.noMemoryYet}
                      </p>
                    </div>
                  )}

                  <div style={{ marginTop: "auto", marginBottom: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                    {watchDate && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Calendar style={{ width: 10, height: 10, flexShrink: 0, color: cardTheme === "poster" ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                        <span style={{ fontSize: 9, color: cardTheme === "poster" ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)" }}>
                          {new Date(watchDate).toLocaleDateString(t.dateLocale, { month: "short", year: "numeric" })}
                        </span>
                      </div>
                    )}
                    {watchLocation.trim() && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <MapPin style={{ width: 10, height: 10, flexShrink: 0, color: cardTheme === "poster" ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                        <span style={{ fontSize: 9, color: cardTheme === "poster" ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {watchLocation}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 4,
                    paddingTop: 8, paddingBottom: 8, fontSize: 11, fontWeight: 600,
                    borderRadius: cardTheme === "poster" ? 0 : 8,
                    border: `1px solid ${cardTheme === "poster" ? "rgba(28,28,28,0.12)" : "var(--card-back-border)"}`,
                    color: cardTheme === "poster" ? "rgba(28,28,28,0.45)" : "var(--card-back-text)",
                  }}>
                    View <ArrowRight style={{ width: 12, height: 12 }} />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{t.tapToFlip}</p>
          </div>

          <div className="px-4 space-y-5">

            {/* ── Card Design ── */}
            <div>
              <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.themeLabel}</p>
              <div className="flex rounded-xl overflow-hidden border border-border">
                <button
                  onClick={() => { setCardTheme("classic"); setSelectedBackdropUrl(null); }}
                  className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors",
                    cardTheme === "classic" ? "bg-foreground text-background" : "bg-background text-muted-foreground")}
                >
                  <Film className="w-4 h-4" /> {t.classicTheme}
                </button>
                <button
                  onClick={() => { setCardTheme("poster"); }}
                  className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold border-l border-border transition-colors",
                    cardTheme === "poster" ? "bg-foreground text-background" : "bg-background text-muted-foreground")}
                >
                  <Clapperboard className="w-4 h-4" /> {t.posterTheme}
                </button>
              </div>

              {/* Backdrop picker */}
              {cardTheme === "poster" && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">{t.chooseCoverLabel}</p>
                  {backdropsLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : backdrops.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4 italic">{t.noBackdropFound}</p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4">
                      {backdrops.map((url, i) => (
                        <button
                          key={i}
                          onClick={() => { setSelectedBackdropUrl(url); setCardOffsetX(50); }}
                          className={cn(
                            "relative shrink-0 w-28 h-[63px] rounded-xl overflow-hidden border-2 transition-all",
                            selectedBackdropUrl === url ? "border-foreground ring-2 ring-foreground/20" : "border-border"
                          )}
                        >
                          <img src={url} alt={`backdrop ${i+1}`} className="w-full h-full object-cover" />
                          {selectedBackdropUrl === url && (
                            <div className="absolute inset-0 bg-foreground/15 flex items-center justify-center">
                              <Check className="w-5 h-5 text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedBackdropUrl && (
                    <p className="text-[10px] text-muted-foreground mt-2 text-center">{t.dragToAdjust}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Rating ── */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => {
                  const active = s <= (hoverRating || rating);
                  const fillColor = active ? (isDyingStar ? "#22c55e" : "#fbbf24") : "#6b7280";
                  return (
                    <button key={s}
                      onMouseEnter={() => setHoverRating(s)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => { setRating(s); setSubmitError(""); }}
                      className="p-1 transition-transform active:scale-90"
                    >
                      <svg width={36} height={36} viewBox="0 0 24 24" fill={fillColor} xmlns="http://www.w3.org/2000/svg" className="transition-all">
                        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                      </svg>
                    </button>
                  );
                })}
              </div>

              {/* ── Dying Star toggle switch ── */}
              <button
                type="button"
                role="switch"
                aria-checked={isDyingStar}
                onClick={() => setIsDyingStar(v => !v)}
                className="flex items-center gap-2 select-none active:opacity-70"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                <div className={cn(
                  "w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0",
                  isDyingStar ? "bg-foreground" : "bg-border"
                )}>
                  <div className={cn(
                    "w-5 h-5 rounded-full bg-white shadow transition-transform",
                    isDyingStar ? "translate-x-5" : "translate-x-0"
                  )} />
                </div>
                <span className="text-sm font-bold text-foreground">{t.dyingStarLabel}</span>
              </button>
            </div>

            {/* ── ความทรงจำ ── */}
            <div>
              <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.memoryLabel}</p>
              <textarea
                className="w-full h-[72px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none"
                placeholder={t.memoryPlaceholder}
                value={memoryNote}
                maxLength={100}
                onChange={(e) => setMemoryNote(e.target.value)}
              />
            </div>

            {/* ── เลือกตอน (TV shows only) ── */}
            {isTvShow && (
              <div>
                <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.episodeLabel}</p>
                {/* Selected episode label display / toggle */}
                <button
                  type="button"
                  onClick={() => setShowEpisodePicker(v => !v)}
                  className="w-full flex items-center justify-between bg-secondary rounded-2xl px-4 h-12 text-sm font-medium text-foreground"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Tv className="w-4 h-4 text-muted-foreground shrink-0 -translate-y-0.5" />
                    <span className="truncate leading-none">
                      {selectedEpisodeLabel ?? t.episodeOptional}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0 ml-2">
                    {selectedEpisodeLabel && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setSelectedEpisodeLabel(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setSelectedEpisodeLabel(null); } }}
                        className="p-1 rounded-full hover:bg-muted text-muted-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {showEpisodePicker ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </span>
                </button>

                {/* Season / episode accordion */}
                {showEpisodePicker && (
                  <div className="mt-2 rounded-2xl border border-border overflow-hidden divide-y divide-border">
                    {!seasonsData ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : seasonsData.seasons.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">{t.noEpisodeData}</div>
                    ) : (
                      seasonsData.seasons.map((season) => (
                        <div key={season.seasonNumber}>
                          <button
                            type="button"
                            onClick={() => setExpandedSeason(v => v === season.seasonNumber ? null : season.seasonNumber)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-secondary hover:bg-muted/60 transition-colors text-sm font-semibold text-foreground"
                          >
                            <span>{season.name}</span>
                            {expandedSeason === season.seasonNumber ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </button>
                          {expandedSeason === season.seasonNumber && (
                            <div className="divide-y divide-border">
                              {season.episodes.map((ep) => {
                                const label = `S${String(season.seasonNumber).padStart(2,"0")}E${String(ep.episodeNumber).padStart(2,"0")} · ${ep.name}`;
                                const isSelected = selectedEpisodeLabel === label;
                                return (
                                  <button
                                    key={ep.episodeNumber}
                                    type="button"
                                    onClick={() => { setSelectedEpisodeLabel(label); setShowEpisodePicker(false); }}
                                    className={cn(
                                      "w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors",
                                      isSelected ? "bg-primary/10 text-primary" : "bg-background text-foreground hover:bg-muted/40"
                                    )}
                                  >
                                    <span className="text-left">
                                      <span className="font-mono text-xs text-muted-foreground mr-2">
                                        E{String(ep.episodeNumber).padStart(2,"0")}
                                      </span>
                                      {ep.name}
                                    </span>
                                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── แคปชั่น ── */}
            <div>
              <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.captionLabel}</p>
              <textarea
                className={cn("w-full h-[88px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none",
                  captionAlign === "center" && "text-center",
                  captionAlign === "right" && "text-right"
                )}
                placeholder={t.reviewPlaceholder}
                value={caption}
                maxLength={1500}
                onChange={(e) => setCaption(e.target.value)}
              />
              {/* Alignment picker */}
              <div className="flex justify-center mt-2">
                <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-bold">
                  {(["left","center","right"] as const).map(a => (
                    <button key={a} onClick={() => setCaptionAlign(a)}
                      className={cn("px-4 py-1.5 transition-colors",
                        captionAlign === a ? "bg-foreground text-background" : "bg-background text-muted-foreground",
                        a !== "left" && "border-l border-border"
                      )}>
                      {a === "left" ? "L" : a === "center" ? "C" : "R"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── รายละเอียด ── */}
            <div>
              <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.detailsLabel}</p>
              <div className="grid grid-cols-2 gap-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (watchDate) {
                      const d = new Date(watchDate);
                      setPickerYear(d.getFullYear());
                      setPickerMonth(d.getMonth());
                    } else {
                      const now = new Date();
                      setPickerYear(now.getFullYear());
                      setPickerMonth(now.getMonth());
                    }
                    setShowDatePicker(true);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setShowDatePicker(true)}
                  className="flex items-center gap-2 bg-secondary rounded-2xl px-3 h-12 w-full cursor-pointer select-none"
                >
                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className={cn("flex-1 text-sm", watchDate ? "text-foreground" : "text-muted-foreground")}>
                    {watchDate ? new Date(watchDate + "T00:00:00").toLocaleDateString(t.dateLocale, { day: "numeric", month: "long", year: "numeric" }) : t.datePlaceholder}
                  </span>
                  {watchDate && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setWatchDate(""); }}
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-secondary rounded-2xl px-3 h-12">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    placeholder={t.watchLocationPlaceholder} value={watchLocation} onChange={(e) => setWatchLocation(e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── ปาร์ตี้ ── */}
            <div className="rounded-2xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5 bg-secondary">
                <div className="flex items-center gap-3">
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", partyMode ? "bg-foreground" : "bg-border")}>
                    <Users className={cn("w-3.5 h-3.5", partyMode ? "text-background" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{t.partyLabel}</p>
                    <p className="text-xs text-muted-foreground">{t.partyDesc}</p>
                  </div>
                </div>
                <button onClick={handlePartyModeToggle}
                  className={cn("w-11 h-6 rounded-full transition-colors relative", partyMode ? "bg-foreground" : "bg-border")}>
                  <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all", partyMode ? "left-5" : "left-0.5")} />
                </button>
              </div>
              {partyMode && (
                <div className="px-4 py-4 space-y-4 bg-background">
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">{t.partyTicketCount}</p>
                    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                      {[2,3,4,5,6,7,8,9,10].map(n => (
                        <button key={n} onClick={() => handlePartySizeChange(n)}
                          className={cn("w-9 h-9 rounded-xl text-sm font-bold transition-colors shrink-0",
                            partySize===n ? "bg-foreground text-background" : "bg-secondary text-foreground")}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">{t.yourTicketNum}</p>
                    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                      {Array.from({length:partySize},(_,i)=>i+1).map(n => (
                        <button key={n} onClick={() => setPartySeatNumber(n)}
                          className={cn("w-9 h-9 rounded-xl text-sm font-bold transition-colors shrink-0",
                            partySeatNumber===n ? "bg-foreground text-background" : "bg-secondary text-foreground")}>#{n}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">{t.inviteFriendsLabel(partyInvitees.length)} / {partySize-1}</p>
                    {partyInvitees.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {partyInvitees.map(u => (
                          <div key={u.id} className="flex items-center gap-1.5 bg-secondary px-2.5 py-1.5 rounded-xl">
                            <span className="text-xs font-semibold">@{u.username}</span>
                            <button onClick={() => removeInvitee(u.id)}><X className="w-3 h-3 text-muted-foreground" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {partyInvitees.length < partySize-1 && (
                      <>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <input className="w-full h-10 bg-secondary rounded-xl pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground"
                            placeholder={t.searchUsersPlaceholder} value={userSearchQuery} onChange={(e) => setUserSearchQuery(e.target.value)} />
                          {userSearchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-muted-foreground" />}
                        </div>
                        {(userSearchResults?.users?.length ?? 0) > 0 && userSearchQuery && (
                          <div className="mt-1 bg-secondary rounded-xl overflow-hidden border border-border">
                            {(userSearchResults?.users ?? []).filter(u=>u.id!==user?.id&&!partyInvitees.find(p=>p.id===u.id)).slice(0,5).map(u=>(
                              <button key={u.id} onClick={() => addInvitee(u)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-border/50 transition-colors text-left">
                                <div className="w-7 h-7 rounded-lg bg-border overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">
                                  {u.avatarUrl ? <img src={u.avatarUrl} alt={u.username} className="w-full h-full object-cover"/> : u.username[0]?.toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold truncate">@{u.username}</p>
                                  {u.displayName && <p className="text-[10px] text-muted-foreground truncate">{u.displayName}</p>}
                                </div>
                                <Check className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── การ์ดส่วนตัว ── */}
            <div className="flex items-center justify-between py-3 px-4 bg-secondary rounded-2xl">
              <p className="text-sm font-bold text-foreground">{t.privateCardLabel}</p>
              <button onClick={() => setIsPrivate(v => !v)}
                className={cn("w-11 h-6 rounded-full transition-colors relative", isPrivate ? "bg-foreground" : "bg-border")}>
                <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all", isPrivate ? "left-5" : "left-0.5")} />
              </button>
            </div>

            {/* ── Spoiler alert ── */}
            <div className="flex items-center justify-between py-3 px-4 bg-secondary rounded-2xl">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{t.spoilerAlert}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.spoilerAlertDesc}</p>
              </div>
              <button onClick={() => setIsSpoiler(v => !v)}
                className={cn("shrink-0 w-11 h-6 rounded-full transition-colors relative", isSpoiler ? "bg-foreground" : "bg-border")}>
                <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all", isSpoiler ? "left-5" : "left-0.5")} />
              </button>
            </div>

            {submitError && <p className="text-sm text-red-500 text-center font-semibold">{submitError}</p>}

            {/* Submit */}
            <button onClick={handleSubmit}
              disabled={createTicket.isPending || rating < 1}
              className={cn("w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all",
                rating >= 1 ? "bg-foreground text-background active:scale-[0.98]" : "bg-border text-muted-foreground cursor-not-allowed")}>
              {createTicket.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : partyMode ? (
                <><Users className="w-4 h-4" /> {t.postPartyTicketBtn}</>
              ) : t.postTicketBtn}
            </button>
          </div>
        </div>
      )}

      {step === 2 && !movieDetails && null}

      {/* ── Modern Date Picker Bottom Sheet ── */}
      {showDatePicker && (() => {
        const today = new Date();
        const thMonths = t.calMonths;
        const thDays = t.calDays;
        const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
        const firstDayOfWeek = new Date(pickerYear, pickerMonth, 1).getDay();
        const selectedVal = watchDate;
        const cells: (number | null)[] = [...Array(firstDayOfWeek).fill(null), ...Array.from({length: daysInMonth}, (_, i) => i + 1)];
        while (cells.length % 7 !== 0) cells.push(null);

        const prevMonth = () => {
          if (pickerMonth === 0) { setPickerYear(y => y - 1); setPickerMonth(11); }
          else setPickerMonth(m => m - 1);
        };
        const nextMonth = () => {
          if (pickerMonth === 11) { setPickerYear(y => y + 1); setPickerMonth(0); }
          else setPickerMonth(m => m + 1);
        };
        const selectDate = (day: number) => {
          const m = String(pickerMonth + 1).padStart(2, "0");
          const d = String(day).padStart(2, "0");
          setWatchDate(`${pickerYear}-${m}-${d}`);
          setShowDatePicker(false);
        };
        const isToday = (day: number) => day === today.getDate() && pickerMonth === today.getMonth() && pickerYear === today.getFullYear();
        const isSelected = (day: number) => {
          const m = String(pickerMonth + 1).padStart(2, "0");
          const d = String(day).padStart(2, "0");
          return selectedVal === `${pickerYear}-${m}-${d}`;
        };
        const isFuture = (day: number) => new Date(pickerYear, pickerMonth, day) > today;

        return createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end"
            onClick={() => setShowDatePicker(false)}
            style={{ touchAction: "none" }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative w-full bg-background rounded-t-3xl border-t border-border overflow-hidden"
              style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.22)", paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-border" />
              </div>

              {/* Month navigation */}
              <div className="flex items-center justify-between px-5 py-2">
                <button onClick={prevMonth} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:bg-border transition-colors">
                  <ChevronLeft className="w-4 h-4 text-foreground" />
                </button>
                <span className="font-bold text-base text-foreground">{thMonths[pickerMonth]} {pickerYear}</span>
                <button
                  onClick={nextMonth}
                  disabled={pickerYear === today.getFullYear() && pickerMonth === today.getMonth()}
                  className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:bg-border transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4 text-foreground rotate-180" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 px-4 mb-0.5">
                {thDays.map(d => (
                  <div key={d} className="flex items-center justify-center h-7">
                    <span className="text-[11px] font-semibold text-muted-foreground">{d}</span>
                  </div>
                ))}
              </div>

              {/* Date grid */}
              <div className="grid grid-cols-7 px-4 pb-4 gap-y-0.5">
                {cells.map((day, i) => (
                  day === null ? (
                    <div key={`empty-${i}`} />
                  ) : (
                    <button
                      key={day}
                      onClick={() => !isFuture(day) && selectDate(day)}
                      disabled={isFuture(day)}
                      className={cn(
                        "mx-auto flex items-center justify-center w-8 h-8 rounded-xl text-sm font-semibold transition-colors",
                        isSelected(day) && "bg-foreground text-background",
                        !isSelected(day) && isToday(day) && "bg-secondary text-foreground ring-1 ring-foreground/30",
                        !isSelected(day) && !isToday(day) && !isFuture(day) && "text-foreground hover:bg-secondary active:bg-border",
                        isFuture(day) && "text-muted-foreground/30 cursor-not-allowed",
                      )}
                    >
                      {day}
                    </button>
                  )
                ))}
              </div>
            </div>
          </div>
        , document.body);
      })()}

      {/* ── Draft Dialog ── */}
      {showDraftDialog && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end" onClick={() => setShowDraftDialog(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl border-t border-border px-5 pt-5"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px) + 1rem)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <p className="text-base font-bold text-foreground mb-1 text-center">{t.saveDraftTitle}</p>
            <p className="text-sm text-muted-foreground mb-5 text-center">{t.saveDraftDesc}</p>
            <div className="flex flex-col gap-2">
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
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
