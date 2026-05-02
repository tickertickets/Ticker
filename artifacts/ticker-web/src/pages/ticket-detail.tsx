import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLang, displayYear, displayDate } from "@/lib/i18n";
import { ExpandableText } from "@/components/ExpandableText";
import { localizeTicketGenre } from "@/lib/tmdb-genres";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useGetTicket, useGetTicketComments, useCreateComment, useDeleteTicket } from "@workspace/api-client-react";
import { TicketCard } from "@/components/TicketCard";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { Loader2, ChevronLeft, Send, MapPin, CalendarDays, Trash2, MessageCircle, Flag, Share2 } from "lucide-react";
import { ShareStoryModal } from "@/components/ShareStoryModal";
import { useToast } from "@/hooks/use-toast";
import { ReactionButton } from "@/components/ReactionButton";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { cn, fmtCount } from "@/lib/utils";
import { ReportSheet } from "@/components/ReportSheet";
import { useSocketTicketUpdates, patchCommentCount } from "@/hooks/use-socket";
import { SocialLinkRow } from "@/components/SocialLinkRow";
import { AddLinkSheet } from "@/components/AddLinkSheet";
import type { SocialLink } from "@/lib/socialLinks";

type LocalComment = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  isPending?: boolean;
  user: { username: string | null; displayName: string | null; avatarUrl: string | null };
};

export default function TicketDetail() {
  const [, params] = useRoute("/ticket/:id");
  const ticketId = params?.id;
  useSocketTicketUpdates(ticketId);
  const scrollRef = usePageScroll(`ticket-${ticketId ?? ""}`);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { t, lang } = useLang();

  const [commentText, setCommentText] = useState("");
  const [localComments, setLocalComments] = useState<LocalComment[]>([]);

  const [hasReacted, setHasReacted] = useState<boolean | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);
  const [myReactions, setMyReactions] = useState<Record<string, number> | null>(null);
  const [reactionBreakdown, setReactionBreakdown] = useState<Record<string, number> | null>(null);
  const [reportTicketOpen, setReportTicketOpen] = useState(false);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);
  const [storyShareOpen, setStoryShareOpen] = useState(false);
  const { toast } = useToast();
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);
  const deleteSheetCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [captionLinks, setCaptionLinks] = useState<SocialLink[]>([]);
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    if (deleteSheetOpen) {
      const id = requestAnimationFrame(() => setDeleteSheetVisible(true));
      cleanup = () => cancelAnimationFrame(id);
    }
    return cleanup;
  }, [deleteSheetOpen]);

  const closeDeleteSheet = () => {
    if (deleteSheetCloseTimer.current !== null) return;
    setDeleteSheetVisible(false);
    deleteSheetCloseTimer.current = setTimeout(() => {
      setDeleteSheetOpen(false);
      deleteSheetCloseTimer.current = null;
    }, 300);
  };
  const [tagRating, setTagRating] = useState<number | null>(null);
  const [savingTagRating, setSavingTagRating] = useState(false);

  const { data: ticket, isLoading: ticketLoading } = useGetTicket(ticketId || "", {
    query: { enabled: !!ticketId && ticketId !== "new" } as any,
  });

  const { data: commentsData } = useGetTicketComments(
    ticketId || "",
    { limit: 50 },
    { query: { enabled: !!ticketId && ticketId !== "new" } as any }
  );

  const createComment = useCreateComment();
  const deleteTicket = useDeleteTicket();

  // Sync server data into local state on every ticketId / commentsData change.
  // Re-hydrating from the cached query data on remount avoids the "comments
  // disappear on back-navigate" bug caused by an unconditional reset effect.
  useEffect(() => {
    if (commentsData?.comments) {
      const serverComments: LocalComment[] = commentsData.comments.map((c) => ({
        id: c.id,
        userId: c.userId,
        content: c.content,
        createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt as any).toISOString(),
        user: {
          username: (c.user as any)?.username ?? null,
          displayName: (c.user as any)?.displayName ?? null,
          avatarUrl: (c.user as any)?.avatarUrl ?? null,
        },
      }));
      setLocalComments((prev) => {
        // Keep optimistic items not yet present in server data
        const pendingNotYetSaved = prev.filter(
          (p) => p.isPending && !serverComments.some((s) => s.content === p.content && s.userId === p.userId)
        );
        return [...serverComments, ...pendingNotYetSaved];
      });
    } else {
      setLocalComments([]);
    }
  }, [ticketId, commentsData]);

  // Reset transient per-ticket state (not localComments — that hydrates from cache)
  useEffect(() => {
    setCommentText("");
    setHasReacted(null);
    setTotalScore(null);
    setMyReactions(null);
    setReactionBreakdown(null);
    setTagRating(null);
  }, [ticketId]);

  // Sync caption links from loaded ticket
  useEffect(() => {
    if (!ticket) return;
    const td = ticket as unknown as Record<string, unknown>;
    setCaptionLinks((td["captionLinks"] as SocialLink[] | undefined) ?? []);
  }, [(ticket as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tx = ticket as unknown as Record<string, unknown>;
  const effectiveHasReacted   = hasReacted       !== null ? hasReacted       : (tx?.["hasReacted"]       as boolean               ?? ticket?.isLiked   ?? false);
  const effectiveTotalScore   = totalScore       !== null ? totalScore       : (tx?.["totalScore"]       as number                ?? ticket?.likeCount  ?? 0);
  const effectiveMyReactions  = myReactions      !== null ? myReactions      : (tx?.["myReactions"]      as Record<string,number> ?? {});
  const effectiveBreakdown    = reactionBreakdown !== null ? reactionBreakdown : (tx?.["reactionBreakdown"] as Record<string,number> ?? {});

  // Sync tag rating from loaded ticket
  useEffect(() => {
    if (!ticket || !user) return;
    const td = ticket as unknown as Record<string, unknown>;
    const tagRatings = (td["tagRatings"] as Array<{ userId: string; rating: number }> | undefined) ?? [];
    const mine = tagRatings.find((r) => r.userId === user.id)?.rating ?? null;
    if (mine !== null) setTagRating(mine);
  }, [ticket?.id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reactions ────────────────────────────────────────────────────────────────
  const REACTION_PTS: Record<string, number> = { heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5 };

  const patchAllCaches = (patch: { hasReacted: boolean; totalScore: number; myReactions: Record<string, number>; reactionBreakdown: Record<string, number> }) => {
    const extra = { ...patch, isLiked: patch.hasReacted, likeCount: patch.totalScore };
    queryClient.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
      if (!old || typeof old !== "object") return old;
      const o = old as Record<string, unknown>;
      if (o["id"] === ticket!.id) return { ...o, ...extra };
      if (Array.isArray(o["tickets"])) {
        const arr = o["tickets"] as Array<Record<string, unknown>>;
        if (!arr.some((tt) => tt["id"] === ticket!.id)) return old;
        return { ...o, tickets: arr.map((tt) => tt["id"] === ticket!.id ? { ...tt, ...extra } : tt) };
      }
      if (Array.isArray(o["items"])) {
        const arr = o["items"] as Array<Record<string, unknown>>;
        if (!arr.some((item) => item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket!.id)) return old;
        return {
          ...o,
          items: arr.map((item) => {
            if (item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket!.id) {
              return { ...item, ticket: { ...(item["ticket"] as object), ...extra } };
            }
            return item;
          }),
        };
      }
      return old;
    });
  };

  // Invalidate ALL queries that could contain this ticket's data.
  // The socket handlers already patch cache in real-time; this ensures
  // background refetches keep feed, profile, and detail consistent.
  const invalidateTicketCaches = (id: string) => {
    queryClient.invalidateQueries({ queryKey: [`/api/tickets/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/tickets/${id}/comments`] });
    queryClient.invalidateQueries({ queryKey: ["mixed-feed"] });
    // Profile tickets (keyed as /api/users/:username/tickets)
    if (ticket?.user?.username) {
      queryClient.invalidateQueries({ queryKey: [`/api/users/${ticket.user.username}/tickets`] });
    }
  };

  const handleReact = async (reactions: Record<string, number>) => {
    if (!ticket || !user) return;
    const isEmpty = Object.values(reactions).every((v) => v === 0);
    const prevPatch = { hasReacted: effectiveHasReacted, totalScore: effectiveTotalScore, myReactions: effectiveMyReactions, reactionBreakdown: effectiveBreakdown };
    const optimisticBreakdown: Record<string, number> = { ...effectiveBreakdown };
    for (const [type, cnt] of Object.entries(reactions)) {
      const delta = cnt - (effectiveMyReactions[type] ?? 0);
      optimisticBreakdown[type] = Math.max(0, (optimisticBreakdown[type] ?? 0) + delta);
    }
    const newScore = Object.entries(optimisticBreakdown).reduce((s, [tp, c]) => s + c * (REACTION_PTS[tp] ?? 1), 0);
    const newHasReacted = !isEmpty;
    const optimisticPatch = { hasReacted: newHasReacted, totalScore: newScore, myReactions: reactions, reactionBreakdown: optimisticBreakdown };
    setHasReacted(newHasReacted);
    setTotalScore(newScore);
    setMyReactions(reactions);
    setReactionBreakdown(optimisticBreakdown);
    patchAllCaches(optimisticPatch);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/react`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactions }),
      });
      if (res.ok) {
        const data = await res.json() as { totalScore: number; hasReacted: boolean; myReactions: Record<string, number>; reactionBreakdown: Record<string, number> };
        setHasReacted(data.hasReacted);
        setTotalScore(data.totalScore);
        setMyReactions(data.myReactions);
        setReactionBreakdown(data.reactionBreakdown);
        patchAllCaches(data);
      }
    } catch {
      setHasReacted(prevPatch.hasReacted);
      setTotalScore(prevPatch.totalScore);
      setMyReactions(prevPatch.myReactions);
      setReactionBreakdown(prevPatch.reactionBreakdown);
      patchAllCaches(prevPatch);
    }
  };

  // ── Comment: Add ─────────────────────────────────────────────────────────────
  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text || !ticketId || !user) return;

    const tempId = `opt-${Date.now()}`;
    const optimistic: LocalComment = {
      id: tempId,
      userId: user.id,
      content: text,
      createdAt: new Date().toISOString(),
      isPending: true,
      user: { username: user.username ?? null, displayName: user.displayName ?? null, avatarUrl: user.avatarUrl ?? null },
    };

    setLocalComments((prev) => [...prev, optimistic]);
    setCommentText("");

    try {
      await createComment.mutateAsync({ ticketId, data: { content: text } });
      invalidateTicketCaches(ticketId);
    } catch {
      setLocalComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentText(text);
    }
  };

  // ── Comment: Delete ───────────────────────────────────────────────────────────
  const handleDeleteComment = async (commentId: string) => {
    if (!ticketId) return;
    setLocalComments((prev) => prev.filter((c) => c.id !== commentId));
    // Patch all caches immediately so feed/profile show the new count even if
    // the user navigates away before the socket event arrives.
    patchCommentCount(queryClient, ticketId, -1);

    try {
      await fetch(`/api/tickets/${ticketId}/comments/${commentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      invalidateTicketCaches(ticketId);
    } catch {
      // Restore the optimistic patch on failure
      patchCommentCount(queryClient, ticketId, 1);
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}/comments`] });
    }
  };

  // ── Delete ticket ─────────────────────────────────────────────────────────────
  const handleDeleteTicket = () => {
    if (!ticketId || !ticket) return;
    setDeleteSheetOpen(true);
  };

  const confirmDeleteTicket = async () => {
    if (!ticketId || !ticket) return;
    closeDeleteSheet();
    try {
      await deleteTicket.mutateAsync({ ticketId });
      queryClient.invalidateQueries();
      navigate(`/profile/${ticket.user?.username}`);
    } catch {}
  };

  if (ticketId === "new") return null;

  if (!ticket) {
    if (ticketLoading) return null;
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 px-6 text-center">
        <p className="font-display font-bold text-foreground">{t.cardNotFound}</p>
        <Link href="/">
          <div className="px-5 py-2.5 bg-foreground text-background rounded-2xl text-sm font-semibold">
            {t.backHome}
          </div>
        </Link>
      </div>
    );
  }

  const isOwner = user?.id === ticket.userId;
  const td = ticket as unknown as Record<string, unknown>;
  const caption = (td["caption"] as string | null) || null;
  const hideLikes = (td["hideLikes"] as boolean | undefined) ?? false;
  const episodeLabel = (td["episodeLabel"] as string | null) ?? null;
  const taggedUsers = (td["taggedUsers"] as Array<{ id: string; username: string }> | undefined) ?? [];
  const partyMembers = (td["partyMembers"] as Array<{ username: string; displayName: string | null }> | undefined) ?? [];
  const tagRatings = (td["tagRatings"] as Array<{ userId: string; rating: number }> | undefined) ?? [];
  const isTagged = !!user && taggedUsers.some((u) => u.id === user.id);

  const ownerUsername = ticket.user?.username;
  const seenUsernames = new Set<string>();
  const associatedUsers: { username: string }[] = [];
  for (const u of [...taggedUsers, ...partyMembers]) {
    if (u.username && u.username !== ownerUsername && !seenUsernames.has(u.username)) {
      seenUsernames.add(u.username);
      associatedUsers.push(u);
    }
  }

  const commentCount = localComments.length;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="z-30 bg-background border-b border-border px-4 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
          onClick={() => navBack(navigate, `/profile/${ticket.user?.username}`)}
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 flex justify-center">
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground">Ticker</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; }
              setStoryShareOpen(true);
            }}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          {isOwner ? (
            <button
              onClick={handleDeleteTicket}
              disabled={deleteTicket.isPending}
              className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {deleteTicket.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          ) : user && !isVerified(ticket.user?.username) ? (
            <button
              onClick={() => setReportTicketOpen(true)}
              className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <Flag className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-9" />
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">

        {/* Ticket card */}
        <div className="flex justify-center py-6 px-4">
          <div style={{ width: 180 }}>
            <TicketCard ticket={ticket} compact viewHref={`/movie/${encodeURIComponent(ticket.imdbId)}`} />
          </div>
        </div>

        {/* Movie info */}
        <div className="px-4 pt-2 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-2xl text-foreground leading-tight">
                {ticket.movieTitle}
              </h2>
              <p className="text-muted-foreground text-sm mt-0.5">{displayYear(ticket.movieYear, lang)}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-3 flex-wrap">
            {(() => {
              const g = localizeTicketGenre(ticket, lang);
              return g ? (
                <span className="px-3 py-1 bg-secondary rounded-full text-xs font-bold text-foreground uppercase tracking-wide">
                  {g}
                </span>
              ) : null;
            })()}
            {ticket.watchedAt && (
              <span className="flex items-center gap-1 px-3 py-1 bg-secondary rounded-full text-xs font-medium text-muted-foreground">
                <CalendarDays className="w-3 h-3" />
                {displayDate(ticket.watchedAt, lang, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            {ticket.location && (
              <span className="flex items-center gap-1 px-3 py-1 bg-secondary rounded-full text-xs font-medium text-muted-foreground">
                <MapPin className="w-3 h-3" />
                {ticket.location}
              </span>
            )}
            {(((ticket as unknown) as Record<string, unknown>)["isSpoiler"] === true) && (
              <span
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border"
                style={{ background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }}
                title={t.spoilerAlertDesc}
              >
                <span aria-hidden className="font-black leading-none">!</span>
                {t.spoiler}
              </span>
            )}
          </div>
        </div>

        {/* Associated users */}
        {associatedUsers.length > 0 && (
          <div
            className="flex flex-nowrap items-center mt-4 px-4 overflow-x-auto"
            style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {associatedUsers.map((u, i) => (
              <span key={u.username} className="flex-shrink-0 flex items-center">
                {i > 0 && <span className="text-muted-foreground/40 text-xs select-none mx-1.5">·</span>}
                <Link href={`/profile/${u.username}`}>
                  <span className="whitespace-nowrap text-xs text-muted-foreground font-semibold hover:text-foreground transition-colors">
                    @{u.username}
                  </span>
                </Link>
              </span>
            ))}
          </div>
        )}

        {/* Episode label + Caption */}
        {(episodeLabel || caption) && (
          <div className="mx-4 mt-4 space-y-1">
            {episodeLabel && <p className="text-xs font-semibold text-primary/80 tracking-wide">{episodeLabel}</p>}
            {caption && (
              <ExpandableText
                text={caption}
                className="text-sm text-foreground leading-relaxed"
              />
            )}
          </div>
        )}

        {/* Caption social links */}
        {(captionLinks.length > 0 || isOwner) && (
          <div className="mx-4 mt-3">
            <SocialLinkRow
              links={captionLinks}
              isOwner={isOwner}
              onManage={() => setLinkSheetOpen(true)}
            />
          </div>
        )}
        {isOwner && linkSheetOpen && ticketId && (
          <AddLinkSheet
            open={linkSheetOpen}
            onClose={() => setLinkSheetOpen(false)}
            links={captionLinks}
            entityType="caption"
            entityId={ticketId}
            onSaved={setCaptionLinks}
          />
        )}

        {/* Tag rating */}
        {isTagged && (
          <div className="mx-4 mt-5 p-3 rounded-2xl bg-secondary/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t.yourRating}</p>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  disabled={savingTagRating}
                  onClick={async () => {
                    const prev = tagRating;
                    setTagRating(n);
                    setSavingTagRating(true);
                    try {
                      await fetch(`/api/tickets/${ticketId}/tag-rating`, {
                        method: "PATCH",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ rating: n }),
                      });
                      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
                    } catch {
                      setTagRating(prev);
                    } finally {
                      setSavingTagRating(false);
                    }
                  }}
                  className={cn(
                    "w-9 h-9 rounded-xl text-sm font-black transition-all",
                    tagRating === n
                      ? "bg-foreground text-background scale-110"
                      : "bg-secondary text-muted-foreground hover:bg-foreground/10"
                  )}
                >
                  {n}
                </button>
              ))}
              {tagRating && (
                <span className="text-xs text-muted-foreground ml-1">
                  {tagRating >= 4.5 ? t.ratingExcellent : tagRating >= 3.5 ? t.ratingVeryGood : tagRating >= 2.5 ? t.ratingGood : tagRating >= 1.5 ? t.ratingOkay : t.ratingBad}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Creator + Likes row */}
        <div className="mx-4 mt-4 flex items-center gap-3">
          <Link href={`/profile/${ticket.user?.username}`}>
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-secondary border border-border flex-shrink-0">
              {ticket.user?.avatarUrl ? (
                <img src={ticket.user.avatarUrl} alt={ticket.user.displayName ?? ""} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm font-bold text-muted-foreground">
                  {ticket.user?.displayName?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
          </Link>
          <div className="flex-1 min-w-0">
            <Link href={`/profile/${ticket.user?.username}`}>
              <div className="flex items-center gap-1">
                <p className="text-sm font-bold text-foreground hover:underline">{ticket.user?.displayName}</p>
                {isVerified(ticket.user?.username) && <VerifiedBadge />}
                {ticket.user?.id && <BadgeIcon userId={ticket.user.id} />}
              </div>
            </Link>
            <p className="text-xs text-muted-foreground">@{ticket.user?.username}</p>
          </div>
          <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200", effectiveHasReacted ? "border-border bg-secondary" : "border-foreground/20 bg-transparent")}>
            <ReactionButton
              myReactions={effectiveMyReactions}
              reactionBreakdown={effectiveBreakdown}
              hideLikes={hideLikes}
              onReact={handleReact}
              disabled={!user}
              iconSize={18}
            />
          </div>
        </div>

        {/* Comments section */}
        <div className="mt-5 border-t border-border">
          {/* Comment header */}
          <div className="flex items-center gap-2 px-4 py-3">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-display font-bold text-sm text-foreground">
              {t.commentsLabel}{commentCount > 0 && ` (${fmtCount(commentCount)})`}
            </h3>
          </div>

          {/* Comments list — fixed-height scrollable frame, mirrors movie-detail's Ticker Community */}
          <div className="px-4">
            {commentCount === 0 ? (
              <div className="pt-6 pb-12 text-center">
                <MessageCircle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{t.noCommentsYet}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.beFirstToComment}</p>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-[360px] space-y-4 mt-1 pb-4">
                {localComments.map((comment) => {
                  let dateStr: string | null = null;
                  if (comment.createdAt) {
                    const diff = Date.now() - new Date(comment.createdAt).getTime();
                    const mins = Math.floor(diff / 60000);
                    const hours = Math.floor(diff / 3600000);
                    const days = Math.floor(diff / 86400000);
                    dateStr = mins < 1
                      ? t.timeJustNow
                      : mins < 60
                        ? `${mins} ${t.timeMin}`
                        : hours < 24
                          ? `${hours} ${t.timeHr}`
                          : days < 7
                            ? `${days} ${t.timeDay}`
                            : displayDate(comment.createdAt, lang, { month: "short", day: "numeric" });
                  }
                  return (
                    <div key={comment.id} className={cn("flex gap-3", comment.isPending && "opacity-60")}>
                      <Link href={`/profile/${comment.user?.username}`}>
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-black border border-white/10 flex-shrink-0 flex items-center justify-center">
                          {comment.user?.avatarUrl ? (
                            <img src={comment.user.avatarUrl} alt={comment.user.displayName ?? ""} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-bold text-white">
                              {comment.user?.displayName?.[0]?.toUpperCase() ?? "T"}
                            </span>
                          )}
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1">
                          <Link href={`/profile/${comment.user?.username}`}>
                            <span className="text-xs font-bold text-foreground hover:underline">
                              {comment.user?.displayName ?? comment.user?.username}
                            </span>
                          </Link>
                          {comment.userId && <BadgeIcon userId={comment.userId} size={12} />}
                          {comment.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                          ) : (
                            <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                          )}
                          {!comment.isPending && user && (user.id === comment.userId || isOwner) && (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              className="ml-auto p-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                          {!comment.isPending && user && user.id !== comment.userId && !isOwner && (
                            <button
                              onClick={() => setReportCommentId(comment.id)}
                              className="ml-auto p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                            >
                              <Flag className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="bg-secondary rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                          <p className="text-sm text-foreground/90 leading-relaxed break-words" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>{/* end scrollable */}

      {/* Comment input — pinned at bottom */}
      {user && (
        <form
          onSubmit={handleComment}
          className="flex items-center gap-2 px-4 pt-3 border-t border-border flex-shrink-0"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-black border border-white/10 flex-shrink-0 flex items-center justify-center">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-white">
                {user.displayName?.[0]?.toUpperCase() ?? "T"}
              </span>
            )}
          </div>
          <div className="flex-1 bg-secondary rounded-2xl px-3.5 py-2.5">
            <textarea
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none"
              placeholder={t.addCommentPlaceholder}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleComment(e as any);
                }
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!commentText.trim() || createComment.isPending}
            className="flex-shrink-0 w-9 h-9 bg-foreground text-background rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
          >
            {createComment.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </form>
      )}

      {/* Share story modal — same system as feed */}
      {storyShareOpen && ticket && (
        <ShareStoryModal
          ticket={ticket}
          onClose={() => setStoryShareOpen(false)}
          onOpenChat={() => setStoryShareOpen(false)}
        />
      )}

      {/* Report ticket sheet */}
      {reportTicketOpen && ticketId && (
        <ReportSheet type="ticket" targetId={ticketId} onClose={() => setReportTicketOpen(false)} />
      )}

      {/* Report comment sheet */}
      {reportCommentId && (
        <ReportSheet type="comment" targetId={reportCommentId} onClose={() => setReportCommentId(null)} />
      )}

      {/* Delete ticket confirmation — bottom sheet matching CardContextMenu style */}
      {deleteSheetOpen && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-end"
          onClick={closeDeleteSheet}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className={cn(
              "relative w-full bg-background rounded-t-3xl transition-transform duration-300 ease-out",
              deleteSheetVisible ? "translate-y-0" : "translate-y-full",
            )}
            style={{
              boxShadow: "0 -4px 32px rgba(0,0,0,0.18)",
              paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="px-5 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">{t.moveToTrashTitle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.moveToTrashDesc}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeDeleteSheet}
                  className="flex-1 py-3 rounded-2xl bg-secondary text-sm font-semibold text-foreground transition-colors active:bg-secondary/70"
                >
                  {t.cancelBtn}
                </button>
                <button
                  onClick={confirmDeleteTicket}
                  disabled={deleteTicket.isPending}
                  className="flex-1 py-3 rounded-2xl bg-foreground text-sm font-semibold text-background transition-colors active:bg-foreground/80 disabled:opacity-60"
                >
                  {deleteTicket.isPending ? t.deletingLabel : t.confirmDeleteLabel}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
