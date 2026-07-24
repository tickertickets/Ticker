import { useState, useEffect, useCallback, useMemo } from "react";
import { useSocketChainUpdates } from "@/hooks/use-socket";
import { useLang, displayYear, displayDate } from "@/lib/i18n";
import { ExpandableText } from "@/components/ExpandableText";
import { scrollStore } from "@/lib/scroll-store";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Link2, Play, Film, Check, X, Plus, Search, Loader2, Users, Pencil, MessageCircle, MessagesSquare, Send, Trash2, CornerDownRight, Flag, CalendarDays } from "lucide-react";
import { ReportSheet } from "@/components/ReportSheet";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { renderCommentContent } from "@/lib/renderCommentContent";
import { useSearchMovies } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import { SocialLinkRow } from "@/components/SocialLinkRow";
import { AddLinkSheet } from "@/components/AddLinkSheet";
import type { SocialLink } from "@/lib/socialLinks";
import { useLinkSync } from "@/hooks/use-link-sync";
import type { QueryClient } from "@tanstack/react-query";
import { PosterImage } from "@/components/PosterImage";

// Immediately sync the updated chain into both feed caches so navigating
// back to the home feed reflects the change without waiting for a refetch.
function patchChainInFeeds(qc: QueryClient, chainId: string, data: any) {
  const movies = (data as any)?.movies;
  qc.setQueryData(["chains-feed"], (old: any) => {
    if (!old?.chains) return old;
    return {
      ...old,
      chains: old.chains.map((c: any) =>
        c.id === chainId ? { ...c, ...(movies !== undefined ? { movies } : {}) } : c
      ),
    };
  });
  qc.setQueriesData({ queryKey: ["mixed-feed"] }, (old: any) => {
    if (!old?.items) return old;
    return {
      ...old,
      items: old.items.map((item: any) =>
        item.chain?.id === chainId
          ? { ...item, chain: { ...item.chain, ...(movies !== undefined ? { movies } : {}) } }
          : item
      ),
    };
  });
  qc.invalidateQueries({ queryKey: ["chains-feed"] });
  qc.invalidateQueries({ queryKey: ["mixed-feed"] });
}

type ChainMovie = {
  id: string;
  position: number;
  imdbId: string;
  movieTitle: string;
  movieYear?: string | null;
  posterUrl?: string | null;
  genre?: string | null;
  customRankTier?: string | null;
  tmdbSnapshot?: { tmdbRating?: number } | null;
  addedByUserId?: string | null;
  addedBy?: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  memoryNote?: string | null;
};

type RunItem = {
  id: string;
  position: number;
  status: "pending" | "watching" | "done";
  startedAt?: string | null;
  finishedAt?: string | null;
  elapsedMs?: number | null;
  ticketId?: string | null;
  rating?: number | null;
  ratingType?: string | null;
  customRankTier?: string | null;
  memoryNote?: string | null;
  movie?: ChainMovie | null;
};

type ChainRun = {
  id: string;
  chainId: string;
  userId: string;
  user?: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  status: string;
  totalElapsedMs: number;
  completedCount: number;
  startedAt: string;
  completedAt?: string | null;
  items: RunItem[];
};

type ChainData = {
  id: string;
  userId: string;
  user?: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  title: string;
  description?: string | null;
  descriptionAlign?: "left" | "center" | "right" | null;
  isPrivate: boolean;
  chainCount: number;
  movieCount: number;
  movies: ChainMovie[];
  myRun?: ChainRun | null;
  ownerRun?: ChainRun | null;
  /** Returned by the backend when ?viewUserId=xxx is passed — the viewed user's run */
  viewedUserRun?: ChainRun | null;
  challengeDurationMs?: number | null;
  mode?: string;
  foundMovieIds?: string[];
  createdAt: string;
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function LiveTimer({ startMs, addedMs = 0 }: { startMs: number; addedMs?: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startMs + addedMs);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startMs + addedMs), 1000);
    return () => clearInterval(interval);
  }, [startMs, addedMs]);
  return <span>{formatDuration(elapsed)}</span>;
}

export default function ChainDetail() {
  const { t, lang } = useLang();
  const [, params] = useRoute("/chain/:id");
  const [location, navigate] = useLocation();
  const chainId = params?.id ?? "";

  // ?viewUserId=xxx — when navigating from another user's "เล่นแล้ว" tab,
  // we pass their userId so the API returns viewedUserRun for read-only display.
  const viewUserId = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("viewUserId") || undefined; }
    catch { return undefined; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  // usePageScroll: saves scroll position continuously and restores it when
  // navigating back (from movie-detail OR from profile). hideUntilRestored
  // prevents the visible "starts at top, snaps to position" jerk while the
  // movie list loads after mount — identical pattern to ticket-detail.tsx.
  const scrollRef = usePageScroll(`chain-${chainId}`, { hideUntilRestored: true });

  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [watchingItemId, setWatchingItemId] = useState<string | null>(null);
  const [itemStartMs, setItemStartMs] = useState<number | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [itemRating, setItemRating] = useState<number>(0);
  const [editingReviewItemId, setEditingReviewItemId] = useState<string | null>(null);
  const [editReviewText, setEditReviewText] = useState("");

  // Community chain: add movie
  const [showAddMovie, setShowAddMovie] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [debouncedAddQuery] = useDebounceValue(addQuery, 400);
  const [pendingMovie, setPendingMovie] = useState<{ imdbId: string; title: string; year: string | null; posterUrl: string | null } | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [removingMovieId, setRemovingMovieId] = useState<string | null>(null);

  // edit note on existing movie
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [reportChainOpen, setReportChainOpen] = useState(false);

  // ── Chain comments ────────────────────────────────────────────────────────
  const [chainCommentText, setChainCommentText] = useState("");
  const [chainReplyingTo, setChainReplyingTo] = useState<{ id: string; username: string } | null>(null);
  const [chainCommentSubmitting, setChainCommentSubmitting] = useState(false);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);

  // Scroll to specific comment from notification URL param
  useEffect(() => {
    const commentId = new URLSearchParams(window.location.search).get("commentId");
    if (!commentId) return;
    const tryScroll = () => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); return true; }
      return false;
    };
    if (!tryScroll()) { setTimeout(tryScroll, 600); }
  }, []);
  const [editNoteText, setEditNoteText] = useState("");
  const [descLinks, setDescLinks] = useState<SocialLink[]>([]);
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const { syncChainLinks } = useLinkSync();

  const { data: addSearchData, isLoading: addSearchLoading } = useSearchMovies(
    { query: debouncedAddQuery, page: 1 },
    { query: { enabled: showAddMovie && debouncedAddQuery.length > 1 } as any },
  );
  const { data: trendingData } = useQuery({
    queryKey: ["trending-for-chain"],
    queryFn: () => fetch("/api/movies/trending?page=1", { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: showAddMovie,
  });
  const addSearchResults = ((addSearchData?.movies ?? []) as Array<{ imdbId: string; title: string; year: string | null; posterUrl: string | null }>);
  const trendingSuggestions = ((trendingData?.movies ?? []) as Array<{ imdbId: string; title: string; year: string | null; posterUrl: string | null }>).slice(0, 12);

  const addMovieMutation = useMutation({
    mutationFn: async ({ movie, note }: { movie: { imdbId: string; title: string; year: string | null; posterUrl: string | null }; note: string }) => {
      const res = await fetch(`/api/chains/${chainId}/movies`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imdbId: movie.imdbId, movieTitle: movie.title, movieYear: movie.year, posterUrl: movie.posterUrl, memoryNote: note.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/chains", chainId], data);
      patchChainInFeeds(qc, chainId, data);
      setShowAddMovie(false);
      setAddQuery("");
      setPendingMovie(null);
      setPendingNote("");
    },
  });

  const removeMovieMutation = useMutation({
    mutationFn: async (movieId: string) => {
      setRemovingMovieId(movieId);
      const res = await fetch(`/api/chains/${chainId}/movies/${movieId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/chains", chainId], data);
      patchChainInFeeds(qc, chainId, data);
      setRemovingMovieId(null);
    },
    onError: () => setRemovingMovieId(null),
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ movieId, note }: { movieId: string; note: string }) => {
      const res = await fetch(`/api/chains/${chainId}/movies/${movieId}/note`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/chains", chainId], data);
      patchChainInFeeds(qc, chainId, data);
      setEditingNoteId(null);
      setEditNoteText("");
    },
  });

  const toggleFoundMutation = useMutation({
    mutationFn: async (movieId: string) => {
      const res = await fetch(`/api/chains/${chainId}/hunt-found`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieId }),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/chains", chainId], data);
      patchChainInFeeds(qc, chainId, data);
    },
  });

  const { data: chain, isLoading, isPending } = useQuery<ChainData>({
    queryKey: ["/api/chains", chainId, viewUserId ?? null],
    queryFn: async () => {
      const url = viewUserId
        ? `/api/chains/${chainId}?viewUserId=${encodeURIComponent(viewUserId)}`
        : `/api/chains/${chainId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!chainId,
    refetchInterval: 60000,
  });

  useSocketChainUpdates(chainId);

  type ChainComment = {
    id: string;
    content: string;
    createdAt: string;
    userId: string;
    replyToId?: string | null;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  const { data: chainCommentsData, refetch: refetchChainComments } = useQuery<{ comments: ChainComment[] }>({
    queryKey: ["/api/chains", chainId, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/chains/${chainId}/comments`, { credentials: "include" });
      if (!res.ok) return { comments: [] };
      return res.json();
    },
    enabled: !!chainId,
    staleTime: 30000,
  });
  const chainComments = chainCommentsData?.comments ?? [];

  const submitChainComment = async () => {
    if (!chainCommentText.trim() || chainCommentSubmitting || !chainId) return;
    setChainCommentSubmitting(true);
    try {
      const res = await fetch(`/api/chains/${chainId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chainCommentText.trim(), replyToId: chainReplyingTo?.id ?? null }),
      });
      if (res.ok) {
        setChainCommentText("");
        setChainReplyingTo(null);
        refetchChainComments();
      }
    } finally {
      setChainCommentSubmitting(false);
    }
  };

  const deleteChainComment = async (commentId: string) => {
    await fetch(`/api/chains/${chainId}/comments/${commentId}`, { method: "DELETE", credentials: "include" });
    refetchChainComments();
  };

  // Sync description links whenever chain data changes (including after feed-side saves).
  // Must be AFTER the `chain` const declaration to avoid TDZ ReferenceError.
  useEffect(() => {
    if (!chain) return;
    setDescLinks(((chain as any).descriptionLinks as SocialLink[] | undefined) ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.id, JSON.stringify((chain as any)?.descriptionLinks ?? null)]);

  const startRunMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/chains/${chainId}/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json();
        if (body.error === "already_running") return null;
        throw new Error("failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });
      qc.invalidateQueries({ queryKey: ["chains-feed"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await fetch(`/api/chains/${chainId}/run/${runId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });
      qc.invalidateQueries({ queryKey: ["chains-feed"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
    },
  });

  const editReviewNoteMutation = useMutation({
    mutationFn: async ({ runId, itemId, note }: { runId: string; itemId: string; note: string }) => {
      const res = await fetch(`/api/chains/${chainId}/run/${runId}/item/${itemId}/note`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryNote: note.trim() || null }),
      });
      if (!res.ok) throw new Error("failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });
      setEditingReviewItemId(null);
      setEditReviewText("");
    },
  });

  const startItem = useCallback(async (itemId: string) => {
    const run = chain?.myRun;
    if (!run) return;
    await fetch(`/api/chains/${chainId}/run/${run.id}/item/${itemId}/start`, {
      method: "PATCH",
      credentials: "include",
    });
    setWatchingItemId(itemId);
    setItemStartMs(Date.now());
    qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });
    qc.invalidateQueries({ queryKey: ["chains-feed"] });
    qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
  }, [chain, chainId, qc]);

  const finishItem = useCallback(async (itemId: string, note?: string, rating?: number) => {
    const run = chain?.myRun;
    if (!run) return;
    const elapsedMs = itemStartMs ? Date.now() - itemStartMs : 0;
    setFinishing(itemId);
    await fetch(`/api/chains/${chainId}/run/${run.id}/item/${itemId}/finish`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elapsedMs, rating: rating ?? null, ratingType: "star", memoryNote: note?.trim() || null }),
    });
    setWatchingItemId(null);
    setItemStartMs(null);
    setFinishing(null);
    setReviewingItemId(null);
    setReviewText("");
    setItemRating(0);
    qc.invalidateQueries({ queryKey: ["/api/chains", chainId] });
    qc.invalidateQueries({ queryKey: ["chains-feed"] });
    qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
    qc.invalidateQueries({ queryKey: ["mixed-feed"] });
  }, [chain, chainId, itemStartMs, qc]);

  // Scroll restoration is now handled entirely by usePageScroll above.
  // The movie-link onClick still writes the current scrollTop to scrollStore
  // (same key used by usePageScroll) so the position is captured at the exact
  // moment the user taps a movie — this is a no-op safety measure since
  // usePageScroll's onScroll listener already keeps the store up-to-date.

  const myRun = chain?.myRun;
  const ownerRun = chain?.ownerRun;
  const viewedUserRun = chain?.viewedUserRun;
  const isOwner = user?.id === chain?.userId;
  // When ?viewUserId= is set (arriving from another user's "เล่นแล้ว" tab),
  // show that user's run data in read-only mode instead of myRun/ownerRun.
  const isViewingOtherRun = !!viewUserId && !!viewedUserRun && viewUserId !== user?.id;
  const displayRun = isViewingOtherRun ? viewedUserRun : (myRun ?? ownerRun);
  const isMyDisplayRun = isViewingOtherRun ? false : !!myRun;
  const currentItem = myRun?.items.find(i => i.status === "watching" || watchingItemId === i.id);
  const foundSet = new Set(chain?.foundMovieIds ?? []);
  const foundMovies = (chain?.movies ?? []).filter(m => foundSet.has(m.id));

  if (!chain) {
    if (isLoading || isPending) return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
    return (
      <div className="h-full bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">ไม่พบ Chain นี้</p>
        <button onClick={() => navBack(navigate)} className="text-sm underline">ย้อนกลับ</button>
      </div>
    );
  }


  return (
    <div className="flex flex-col overflow-hidden h-full">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-background border-b border-border relative flex items-center justify-center px-4" style={{ paddingTop: "max(1.25rem, var(--sai-top))", paddingBottom: "1.25rem" }}>
          <button
            onClick={() => navBack(navigate)}
            className="absolute left-4 w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-base text-foreground truncate max-w-[240px]">{chain.title}</h1>
          {user && !isOwner && (
            <button
              onClick={() => setReportChainOpen(true)}
              className="absolute right-4 w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
              aria-label="Report chain"
            >
              <Flag className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-y-none">
      <div className="px-4 pt-5 pb-2 space-y-4">

        {/* ── Owner info ── */}
        {chain.user && (
          <Link href={`/profile/${chain.user.username}`}>
            {/* Sized to match the owner row used on ticket detail (w-10 avatar,
                text-sm name) rather than the smaller in-list avatar sizes. */}
            <div className="flex items-center gap-3 ml-1">
              <div className="w-10 h-10 rounded-xl bg-secondary border border-border overflow-hidden flex-shrink-0 flex items-center justify-center">
                {chain.user.avatarUrl
                  ? <img src={chain.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-sm font-bold text-foreground">{(chain.user.displayName || chain.user.username || "?")?.[0]?.toUpperCase()}</span>}
              </div>
              <div className="flex flex-col leading-tight">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-foreground">{chain.user.displayName || chain.user.username}</span>
                  {isVerified(chain.user.username) && <VerifiedBadge />}
                  {chain.user.id && <BadgeIcon userId={chain.user.id} />}
                </div>
                <span className="text-xs text-muted-foreground">@{chain.user.username}</span>
              </div>
            </div>
          </Link>
        )}

        {chain.description && (
          <div className="!mt-4">
            <ExpandableText
              text={chain.description}
              align={chain.descriptionAlign ?? "left"}
              className="text-sm text-muted-foreground leading-relaxed"
            />
          </div>
        )}

        {/* Description social links */}
        {(descLinks.length > 0 || isOwner) && (
          <div className="!mt-3">
            <SocialLinkRow
              links={descLinks}
              isOwner={isOwner}
              onManage={() => setLinkSheetOpen(true)}
            />
          </div>
        )}
        {isOwner && linkSheetOpen && (
          <AddLinkSheet
            open={linkSheetOpen}
            onClose={() => setLinkSheetOpen(false)}
            links={descLinks}
            entityType="chain"
            entityId={chainId}
            onSaved={(newLinks) => {
              setDescLinks(newLinks);
              syncChainLinks(chainId, newLinks);
            }}
          />
        )}

        {/* Chain creation date */}
        {chain.createdAt && (
          <div className="!mt-3 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              {lang === "th" ? "สร้างเมื่อ" : "Created"}{" "}
              {displayDate(chain.createdAt, lang, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
        )}

        {/* ── Movie horizontal preview ── */}
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none !mt-5" style={{ WebkitOverflowScrolling: "touch", contain: "content" }}>
          {chain.movies.map((movie, idx) => {
            const runItem = displayRun?.items.find(i => i.position === movie.position);
            const isDone = runItem?.status === "done";
            const inner = (
              <div className={cn(
                "relative w-full aspect-[2/3] rounded-xl overflow-hidden border-2",
                isDone ? "border-foreground/40" : "border-transparent"
              )}>
                <PosterImage src={movie.posterUrl} alt={movie.movieTitle} eager={idx < 6} />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />
                {isDone ? (
                  <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                ) : (
                  <span className="absolute top-1.5 left-2 text-white/70 text-[9px] font-black">{idx + 1}</span>
                )}
              </div>
            );
            return (
              <div key={movie.id} className="relative flex-shrink-0 w-[72px]">
                {movie.imdbId ? (
                  <Link href={`/movie/${encodeURIComponent(movie.imdbId)}`} onClick={e => e.stopPropagation()} className="block active:opacity-70">
                    {inner}
                  </Link>
                ) : inner}
              </div>
            );
          })}
        </div>

        {/* ── Chain / Cancel button ── */}
        {(!myRun && !isOwner || myRun?.status === "live" || myRun?.status === "completed") && (
          (myRun?.status === "live" || myRun?.status === "completed") ? (
            <button
              onClick={() => cancelRunMutation.mutate(myRun!.id)}
              disabled={cancelRunMutation.isPending}
              className="w-full h-12 rounded-2xl bg-secondary text-muted-foreground font-bold text-sm flex items-center justify-center gap-2 border border-border disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {cancelRunMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <X className="w-4 h-4" />}
              {cancelRunMutation.isPending
                ? "กำลังยกเลิก..."
                : myRun?.status === "completed" ? "เริ่มใหม่ (ลบผลที่ทำไว้)" : "ยกเลิก Chain"}
            </button>
          ) : (
            <button
              onClick={() => { if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; } startRunMutation.mutate(); }}
              disabled={startRunMutation.isPending}
              className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {startRunMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Link2 className="w-4 h-4" />}
              {startRunMutation.isPending ? t.startingChain : t.chainNowBtn}
            </button>
          )
        )}

        {/* ── Community label ── */}
        {chain.mode === "community" && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="h-px flex-1 bg-border" />
            <div className="flex flex-col items-center gap-0">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-500">Community</span>
              <span className="font-mono font-black text-2xl text-foreground leading-none tracking-tight">ร่วมกันแชร์หนังที่คุณรัก</span>
            </div>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        {/* ── Hunt label ── */}
        {chain.mode === "hunt" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-3 py-2">
              <div className="h-px flex-1 bg-border" />
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground">Hunt</span>
                <span className="text-[11px] text-muted-foreground text-center px-4">{t.huntChainBanner}</span>
              </div>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* ── Found movies summary ── */}
            {foundMovies.length > 0 && (
              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 px-3 py-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="flex items-center px-2 py-0.5 bg-purple-500 rounded-full">
                    <span className="text-[9px] font-black text-white tracking-wider uppercase">{t.huntFoundBadge}</span>
                  </span>
                  <span className="text-xs font-bold text-purple-500">{t.huntFoundTitle(foundMovies.length)}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {foundMovies.map(m => (
                    <div key={m.id} className="relative w-12 h-16 rounded-lg overflow-hidden shrink-0">
                      <PosterImage src={m.posterUrl} alt={m.movieTitle} />
                      <div className="absolute inset-0 bg-purple-500/25 flex items-end justify-center pb-1">
                        <Check className="w-4 h-4 text-white drop-shadow" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Challenge label (static, owner-set duration) ── */}
        {chain.challengeDurationMs && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="h-px flex-1 bg-border" />
            <div className="flex flex-col items-center gap-0">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500">Challenge</span>
              <span className="font-mono font-black text-2xl text-foreground leading-none tracking-tight">
                {formatDuration(chain.challengeDurationMs)}
              </span>
            </div>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        {/* ── Completed total time (my run or owner run) — Challenge mode only ── */}
        {chain.challengeDurationMs && displayRun?.status === "completed" && displayRun.totalElapsedMs > 0 && (
          <div className="flex flex-col items-center gap-0.5 py-1">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              {isMyDisplayRun ? "เวลารวม" : `เวลารวม (${displayRun.user?.displayName ?? displayRun.user?.username ?? "ผู้สร้าง"})`}
            </span>
            <span className="font-mono font-black text-3xl leading-none tracking-tight text-red-500">
              {formatDuration(displayRun.totalElapsedMs)}
            </span>
          </div>
        )}

        {/* ── Owner is LIVE indicator (shown when viewer hasn't started, Challenge mode only) ── */}
        {chain.challengeDurationMs && !myRun && ownerRun?.status === "live" && (
          <div className="flex items-center justify-center gap-2 py-1">
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 rounded-full">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-red-500">
                {chain.user?.displayName ?? chain.user?.username} กำลัง Chain อยู่
              </span>
            </span>
          </div>
        )}

        {/* ── Movie list ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black tracking-widest text-foreground">{t.movieListLabel}</p>
              {(chain.mode === "community" || chain.mode === "hunt") && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-foreground/10 rounded-full border border-border">
                  {chain.mode === "hunt" ? <Search className="w-2.5 h-2.5 text-foreground" /> : <Users className="w-2.5 h-2.5 text-foreground" />}
                  <span className="text-[9px] font-black text-foreground tracking-wider">{chain.mode === "hunt" ? "Hunt" : "Community"}</span>
                  <span className="text-[9px] text-muted-foreground">{chain.movies.length}/50</span>
                </span>
              )}
            </div>
          </div>
          {chain.movies.map((movie, idx) => {
            const runItem = displayRun?.items.find(i => i.position === movie.position);
            const isDone = runItem?.status === "done";
            const isWatching = isMyDisplayRun && (watchingItemId === runItem?.id || runItem?.status === "watching");
            const isPending = isMyDisplayRun && runItem?.status === "pending";
            const isRemoving = removingMovieId === movie.id;
            const isFound = chain.mode === "hunt" && foundSet.has(movie.id);
            const canEdit = (chain.mode === "community" || chain.mode === "hunt") && !!user && user.id === movie.addedByUserId;

            return (
              <div
                key={movie.id}
                className={cn(
                  "rounded-2xl border overflow-hidden transition-all",
                  isDone
                    ? "border-border bg-background"
                    : isWatching
                    ? "border-foreground/20 bg-foreground/5"
                    : isFound
                    ? "border-purple-500/40 bg-purple-500/5"
                    : "border-border bg-background",
                  isRemoving && "opacity-40"
                )}
              >
                {/* Row */}
                <div className="flex items-start gap-3 p-3">
                  <span className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-[10px]",
                    isDone ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"
                  )}>
                    {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                  </span>

                  {/* Clickable: poster + title area → movie detail */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={(() => {
                        const qs = new URLSearchParams();
                        if (movie.posterUrl) qs.set("srcposter", movie.posterUrl);
                        if (movie.movieTitle) qs.set("srctitle", movie.movieTitle);
                        const q = qs.toString();
                        return `/movie/${encodeURIComponent(movie.imdbId)}${q ? `?${q}` : ""}`;
                      })()}
                      className="flex items-center gap-3"
                      onClick={() => {
                        const el = scrollRef.current;
                        if (el) scrollStore.set(`chain-${chainId}`, el.scrollTop);
                      }}
                    >
                      <div className="relative w-9 h-12 rounded-lg overflow-hidden bg-secondary shrink-0">
                        <PosterImage src={movie.posterUrl} alt={movie.movieTitle} fallbackIcon={<Film className="w-4 h-4 text-muted-foreground" />} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{movie.movieTitle}</p>
                        <p className="text-xs text-muted-foreground">{displayYear(movie.movieYear, lang)}</p>
                        {(chain.mode === "community" || chain.mode === "hunt") && (
                          <p className="text-[10px] text-muted-foreground/70 truncate">
                            {movie.addedBy ? `เพิ่มโดย @${movie.addedBy.username}` : "\u00A0"}
                          </p>
                        )}
                      </div>
                    </Link>

                    {/* Note area — community/hunt chain (why the movie was added) */}
                    {(chain.mode === "community" || chain.mode === "hunt") && (() => {
                      if (editingNoteId === movie.id) {
                        return (
                          <div className="mt-2">
                            <textarea
                              autoFocus
                              maxLength={100}
                              rows={2}
                              value={editNoteText}
                              onChange={e => setEditNoteText(e.target.value)}
                              placeholder={t.reasonPlaceholder}
                              className="w-full bg-secondary rounded-xl text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none px-3 py-2"
                            />
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[10px] text-muted-foreground">{editNoteText.length}/100</span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => { setEditingNoteId(null); setEditNoteText(""); }}
                                  className="text-[11px] text-muted-foreground px-2 py-1"
                                >ยกเลิก</button>
                                <button
                                  onClick={() => updateNoteMutation.mutate({ movieId: movie.id, note: editNoteText })}
                                  disabled={updateNoteMutation.isPending}
                                  className="text-[11px] font-bold text-foreground bg-secondary border border-border rounded-lg px-3 py-1 disabled:opacity-40"
                                >บันทึก</button>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      if (movie.memoryNote) {
                        return (
                          <p className="mt-1.5 text-[11px] text-muted-foreground italic break-words line-clamp-3">
                            "{movie.memoryNote}"
                          </p>
                        );
                      }
                      return null;
                    })()}
                    {/* Watch review — editable after marking done, for any chain mode */}
                    {isDone && isMyDisplayRun && editingReviewItemId === runItem?.id ? (
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          autoFocus
                          maxLength={150}
                          rows={2}
                          value={editReviewText}
                          onChange={e => setEditReviewText(e.target.value)}
                          placeholder="เขียนรีวิวสั้นๆ... (ไม่บังคับ)"
                          className="w-full bg-secondary rounded-xl text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none px-3 py-2"
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{editReviewText.length}/150</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setEditingReviewItemId(null); setEditReviewText(""); }}
                              className="text-[11px] text-muted-foreground px-2 py-1"
                            >ยกเลิก</button>
                            <button
                              onClick={() => editReviewNoteMutation.mutate({ runId: myRun!.id, itemId: runItem!.id, note: editReviewText })}
                              disabled={editReviewNoteMutation.isPending}
                              className="text-[11px] font-bold text-background bg-foreground rounded-lg px-3 py-1 disabled:opacity-40"
                            >{editReviewNoteMutation.isPending ? "กำลังบันทึก..." : "บันทึก"}</button>
                          </div>
                        </div>
                      </div>
                    ) : isDone && (runItem?.memoryNote || isMyDisplayRun) ? (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        {runItem?.memoryNote
                          ? <p className="flex-1 text-[11px] text-foreground/60 italic break-words line-clamp-3">"{runItem.memoryNote}"</p>
                          : <p className="flex-1 text-[11px] text-muted-foreground/50 italic">ยังไม่มีรีวิว</p>
                        }
                        {isMyDisplayRun && (
                          <button
                            onClick={() => { setEditingReviewItemId(runItem!.id); setEditReviewText(runItem?.memoryNote ?? ""); }}
                            className="shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground active:opacity-60 transition-opacity"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Right actions */}
                  {(isOwner || (!!user && user.id === movie.addedByUserId)) && (chain.mode === "community" || chain.mode === "hunt") && !isWatching ? (
                    <div className="flex flex-col items-center gap-1.5 shrink-0 mt-[10px]">
                      {/* Hunt: found toggle button (owner only) */}
                      {chain.mode === "hunt" && isOwner && (
                        <button
                          onClick={() => toggleFoundMutation.mutate(movie.id)}
                          disabled={toggleFoundMutation.isPending}
                          title={isFound ? t.huntFoundToggleOff : t.huntFoundToggleOn}
                          className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-50",
                            isFound ? "bg-purple-500" : "bg-secondary border border-border"
                          )}
                        >
                          <Check className={cn("w-3.5 h-3.5", isFound ? "text-white" : "text-muted-foreground")} />
                        </button>
                      )}
                      <button
                        onClick={() => removeMovieMutation.mutate(movie.id)}
                        disabled={isRemoving}
                        className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center active:opacity-70 transition-opacity"
                      >
                        <X className="w-3 h-3 text-muted-foreground" />
                      </button>
                      {/* Pencil — edit note, directly below X (adder only) */}
                      {canEdit && editingNoteId !== movie.id && (
                        <button
                          onClick={() => { setEditingNoteId(movie.id); setEditNoteText(movie.memoryNote ?? ""); }}
                          className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center active:opacity-70 transition-opacity"
                        >
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  ) : isWatching && chain.challengeDurationMs ? (
                    <div className="flex items-center gap-1.5 shrink-0 mt-[10px]">
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500 rounded-full">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        <span className="text-[9px] font-black text-white tracking-widest">LIVE</span>
                      </span>
                      {itemStartMs && (
                        <span className="font-mono font-black text-sm text-red-500 leading-none tabular-nums">
                          <LiveTimer startMs={itemStartMs} />
                        </span>
                      )}
                    </div>
                  ) : isWatching ? (
                    null
                  ) : isDone && runItem?.elapsedMs && chain.challengeDurationMs ? (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-secondary rounded-full shrink-0 border border-border mt-[10px]">
                      <span className="font-mono text-[9px] font-bold text-muted-foreground tabular-nums">{formatDuration(runItem.elapsedMs)}</span>
                    </span>
                  ) : myRun && isPending && !currentItem ? (
                    <button
                      onClick={() => startItem(runItem!.id)}
                      className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center shrink-0 mt-[8px]"
                    >
                      <Play className="w-3.5 h-3.5 text-background" />
                    </button>
                  ) : null}
                </div>

                {/* Watching panel */}
                {isWatching && runItem && (
                  <div className="px-3 pb-3 pt-2 border-t border-border/40">
                    {reviewingItemId === runItem.id ? (
                      /* Step 2 — star rating + optional review input */
                      <div className="space-y-2">
                        {/* Star rating row */}
                        <div className="flex items-center justify-center gap-1 py-1">
                          {[1, 2, 3, 4, 5].map(star => (
                            <button
                              key={star}
                              onClick={() => setItemRating(prev => prev === star ? 0 : star)}
                              className="text-2xl leading-none transition-transform active:scale-110"
                              aria-label={`${star} ดาว`}
                            >
                              {star <= itemRating ? "★" : "☆"}
                            </button>
                          ))}
                        </div>
                        <textarea
                          autoFocus
                          maxLength={150}
                          rows={2}
                          value={reviewText}
                          onChange={e => setReviewText(e.target.value)}
                          placeholder="เขียนรีวิวสั้นๆ... (ไม่บังคับ)"
                          className="w-full bg-secondary rounded-xl text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none px-3 py-2.5"
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{reviewText.length}/150</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => finishItem(runItem.id, undefined, undefined)}
                              disabled={finishing === runItem.id}
                              className="text-xs text-muted-foreground px-3 py-1.5 rounded-xl active:bg-secondary disabled:opacity-40"
                            >
                              {finishing === runItem.id ? "กำลังบันทึก..." : "ข้าม"}
                            </button>
                            <button
                              onClick={() => finishItem(runItem.id, reviewText, itemRating || undefined)}
                              disabled={finishing === runItem.id}
                              className="text-xs font-bold text-background bg-foreground rounded-xl px-4 py-1.5 disabled:opacity-40"
                            >
                              {finishing === runItem.id ? "กำลังบันทึก..." : "บันทึก"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Step 1 — cancel + mark done buttons */
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setWatchingItemId(null); setItemStartMs(null); }}
                          className="h-11 w-11 rounded-2xl bg-secondary flex items-center justify-center shrink-0"
                          aria-label="ยกเลิกการดู"
                        >
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => setReviewingItemId(runItem.id)}
                          disabled={finishing === runItem.id}
                          className="flex-1 h-11 rounded-2xl bg-foreground text-background font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                        >
                          <Check className="w-4 h-4" />
                          {finishing === runItem.id ? "กำลังบันทึก..." : "ดูจบแล้ว"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add movie button — community: anyone; hunt: non-owner only */}
          {(chain.mode === "community" || (chain.mode === "hunt" && !isOwner)) && user && chain.movies.length < 50 && (
            <button
              onClick={() => setShowAddMovie(true)}
              className="w-full h-11 rounded-2xl border-2 border-dashed border-border flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground active:bg-secondary transition-colors"
            >
              <Plus className="w-4 h-4" />
              เพิ่มหนังลงใน Chain
            </button>
          )}
          {(chain.mode === "community" || chain.mode === "hunt") && chain.movies.length >= 50 && (
            <p className="text-center text-xs text-muted-foreground py-1">{t.chainFullMsg}</p>
          )}
        </div>

        {/* ── Comments section ── */}
        {(() => {
          const rootComments = chainComments.filter(c => !c.replyToId);
          const repliesMap = new Map<string, ChainComment[]>();
          for (const c of chainComments) {
            if (c.replyToId) {
              const arr = repliesMap.get(c.replyToId) ?? [];
              arr.push(c);
              repliesMap.set(c.replyToId, arr);
            }
          }
          const fmtDate = (iso: string) => {
            const diff = Date.now() - new Date(iso).getTime();
            const mins = Math.floor(diff / 60000);
            const hrs = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            if (mins < 1) return "เมื่อกี้";
            if (mins < 60) return `${mins} นาที`;
            if (hrs < 24) return `${hrs} ชั่วโมง`;
            return `${days} วัน`;
          };
          const renderComment = (c: ChainComment, isReply = false) => (
            <div id={`comment-${c.id}`} key={c.id} className={cn("flex gap-2.5", isReply && "ml-7 pl-3 border-l border-border")}>
              <Link href={`/profile/${c.username}`}>
                <div className={cn("rounded-lg overflow-hidden bg-secondary border border-border flex-shrink-0 flex items-center justify-center", isReply ? "w-7 h-7" : "w-8 h-8")}>
                  {c.avatarUrl
                    ? <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xs font-bold text-foreground">{(c.displayName ?? c.username ?? "?")?.[0]?.toUpperCase()}</span>}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <Link href={`/profile/${c.username}`}>
                    <span className="text-xs font-bold text-foreground">{c.displayName ?? c.username}</span>
                  </Link>
                  {isVerified(c.username) && <VerifiedBadge className="w-3 h-3 flex-shrink-0" />}
                  {c.userId && <BadgeIcon userId={c.userId} size={12} />}
                  <span className="text-[10px] text-muted-foreground">{fmtDate(c.createdAt)}</span>
                  {user?.id === c.userId && (
                    confirmDeleteCommentId === c.id ? (
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => setConfirmDeleteCommentId(null)} className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-lg bg-secondary">ยกเลิก</button>
                        <button onClick={() => { deleteChainComment(c.id); setConfirmDeleteCommentId(null); }} className="text-[10px] font-bold text-destructive px-1.5 py-0.5 rounded-lg bg-destructive/10">ลบ</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteCommentId(c.id)} className="ml-auto p-1 text-muted-foreground/40 hover:text-destructive transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )
                  )}
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-3 py-2">
                  <p className="text-sm text-foreground/90 leading-snug break-words" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>{renderCommentContent(c.content)}</p>
                </div>
                {!isReply && user && (
                  <button
                    onClick={() => setChainReplyingTo({ id: c.id, username: c.username ?? c.displayName ?? "?" })}
                    className="text-[10px] text-muted-foreground font-semibold mt-1 ml-1 flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <CornerDownRight className="w-3 h-3" />
                    ตอบกลับ
                  </button>
                )}
              </div>
            </div>
          );
          return (
            <div className="mt-2 pt-5 border-t border-border">
              <div className="flex items-center gap-2 mb-4">
                <MessagesSquare className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-display font-bold text-sm text-foreground">
                  ความคิดเห็น{chainComments.length > 0 ? ` (${chainComments.length})` : ""}
                </h3>
              </div>

              {chainComments.length === 0 && (
                <div className="text-center py-6 mb-2">
                  <MessagesSquare className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">ยังไม่มีความคิดเห็น</p>
                </div>
              )}
              {chainComments.length > 0 && (
                <div className="overflow-y-auto mb-4" style={{ maxHeight: "26rem", scrollbarWidth: "none" } as React.CSSProperties}>
                  <div className="space-y-3">
                    {rootComments.map(c => (
                      <div key={c.id} className="space-y-2">
                        {renderComment(c)}
                        {(repliesMap.get(c.id) ?? []).map(r => renderComment(r, true))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pb-2" />
            </div>
          );
        })()}

        {/* ── Add Movie Sheet (community) ── */}
        {showAddMovie && (
          <div className="fixed inset-0 z-[200]" onClick={() => setShowAddMovie(false)}>
            <div
              className="absolute inset-0 bg-background flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 pb-3 border-b border-border shrink-0" style={{ paddingTop: "max(1rem, var(--sai-top))" }}>
                <p className="text-sm font-black uppercase tracking-widest">เพิ่มหนัง</p>
                <button
                  onClick={() => { setShowAddMovie(false); setAddQuery(""); setPendingMovie(null); setPendingNote(""); }}
                  className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-3 py-2.5 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    autoFocus
                    className="w-full h-10 bg-secondary rounded-xl text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    style={{ paddingLeft: "2.25rem", paddingRight: "0.75rem" }}
                    placeholder={t.searchAnyLang}
                    value={addQuery}
                    onChange={e => setAddQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {addSearchLoading && (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!debouncedAddQuery && !addSearchLoading && (
                  <div className="px-3 flex flex-col gap-2 pb-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5">ยอดนิยม</p>
                    {trendingSuggestions.map(movie => {
                      const already = chain.movies.some(m => m.imdbId === movie.imdbId);
                      return (
                        <div key={movie.imdbId} className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border">
                          <div className="relative w-12 h-[68px] rounded-xl overflow-hidden bg-secondary shrink-0">
                            <PosterImage src={movie.posterUrl} alt={movie.title} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{movie.title}</p>
                            <p className="text-xs text-muted-foreground">{displayYear(movie.year, lang)}</p>
                          </div>
                          {already
                            ? <span className="text-[11px] text-muted-foreground shrink-0">มีแล้ว</span>
                            : (
                              <button
                                onClick={() => setPendingMovie(movie)}
                                disabled={addMovieMutation.isPending}
                                className="w-8 h-8 rounded-xl bg-foreground flex items-center justify-center shrink-0 active:opacity-70 disabled:opacity-40 transition-opacity"
                              >
                                <Plus className="w-4 h-4 text-background" />
                              </button>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {debouncedAddQuery && !addSearchLoading && addSearchResults.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-6">ไม่พบหนัง</p>
                )}
                {debouncedAddQuery && (
                  <div className="px-3 pt-2 flex flex-col gap-2 pb-2">
                    {addSearchResults.map(movie => {
                      const already = chain.movies.some(m => m.imdbId === movie.imdbId);
                      return (
                        <div key={movie.imdbId} className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border">
                          <div className="relative w-12 h-[68px] rounded-xl overflow-hidden bg-secondary shrink-0">
                            <PosterImage src={movie.posterUrl} alt={movie.title} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{movie.title}</p>
                            <p className="text-xs text-muted-foreground">{displayYear(movie.year, lang)}</p>
                          </div>
                          {already
                            ? <span className="text-[11px] text-muted-foreground shrink-0">มีแล้ว</span>
                            : (
                              <button
                                onClick={() => setPendingMovie(movie)}
                                disabled={addMovieMutation.isPending}
                                className="w-8 h-8 rounded-xl bg-foreground flex items-center justify-center shrink-0 active:opacity-70 disabled:opacity-40 transition-opacity"
                              >
                                <Plus className="w-4 h-4 text-background" />
                              </button>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* ── Pending movie confirm panel ── */}
              {pendingMovie && (
                <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="relative w-9 h-12 rounded-lg overflow-hidden bg-secondary shrink-0">
                      <PosterImage src={pendingMovie.posterUrl} alt={pendingMovie.title} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{pendingMovie.title}</p>
                      <p className="text-xs text-muted-foreground">{displayYear(pendingMovie.year, lang)}</p>
                    </div>
                    <button onClick={() => { setPendingMovie(null); setPendingNote(""); }} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    maxLength={100}
                    rows={2}
                    placeholder={t.reasonPlaceholder}
                    value={pendingNote}
                    onChange={e => setPendingNote(e.target.value)}
                    className="w-full bg-secondary rounded-xl text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none px-3 py-2.5 mb-2.5"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{pendingNote.length}/100</span>
                    <button
                      onClick={() => addMovieMutation.mutate({ movie: pendingMovie, note: pendingNote })}
                      disabled={addMovieMutation.isPending}
                      className="h-9 px-5 rounded-xl bg-foreground text-background text-sm font-bold flex items-center gap-2 active:opacity-70 disabled:opacity-40 transition-opacity"
                    >
                      {addMovieMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      เพิ่ม
                    </button>
                  </div>
                  {addMovieMutation.error && (
                    <p className="text-xs text-red-500 text-center mt-1.5">
                      {(addMovieMutation.error as any)?.message ?? "เกิดข้อผิดพลาด"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
      {reportChainOpen && chainId && (
        <ReportSheet type="chain" targetId={chainId} onClose={() => setReportChainOpen(false)} />
      )}
      </div>{/* end scroll */}

      {user && (
        <div
          className="flex flex-col gap-0 px-4 pt-3 border-t border-border flex-shrink-0"
          style={{ paddingBottom: "max(12px, var(--sai-bottom) + 12px)" }}
        >
          {chainReplyingTo && (
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <CornerDownRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">ตอบ @{chainReplyingTo.username}</span>
              <button type="button" onClick={() => setChainReplyingTo(null)} className="ml-auto text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-black border border-white/10 flex-shrink-0 flex items-center justify-center">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-white">
                  {user.displayName?.[0]?.toUpperCase() ?? "T"}
                </span>
              )}
            </div>
            <div className="flex-1 bg-secondary rounded-2xl px-3.5 py-1.5">
              <textarea
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none"
                placeholder="เขียนความคิดเห็น..."
                value={chainCommentText}
                onChange={(e) => setChainCommentText(e.target.value)}
                rows={1}
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitChainComment();
                  }
                }}
              />
            </div>
            <button
              type="button"
              onClick={submitChainComment}
              disabled={!chainCommentText.trim() || chainCommentSubmitting}
              className="flex-shrink-0 w-9 h-9 bg-foreground text-background rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
            >
              {chainCommentSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
