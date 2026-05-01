import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useLang, displayYear } from "@/lib/i18n";
import { ExpandableText } from "./ExpandableText";
import { createPortal } from "react-dom";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useModalBackButton } from "@/hooks/use-modal-back-button";
import { Link, useLocation } from "wouter";
import { Bookmark, Star, MapPin, CalendarDays, ArrowRight, Lock, Unlock, Users, Flag, Send, Search, X, MessageCircle, Trash2, MoreVertical, Loader2, Ticket as TicketIcon, MessagesSquare, Share2, Pencil, Pin, PinOff } from "lucide-react";
import { ReactionButton } from "./ReactionButton";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";
import { ShareStoryModal } from "./ShareStoryModal";
import { cn, fmtCount } from "@/lib/utils";
import {
  POSTER_BG,
  POSTER_DARK,
  CARD_USERNAME_STYLE,
  CARD_SEED_W,
  CARD_SEED_H,
  getSpecialColorCfg,
  getRatingCardStyle,
  PosterMetaRow,
  PosterCardFront,
  ClassicCardFront,
  CardBackFace,
  RatingBadge,
} from "./CardFaceComponents";
import { useDeleteTicket } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { Ticket } from "@workspace/api-client-react";
import {
  getCardVisual,
  computeEffectTags,
  computeCardTier,
  TIER_VISUAL,
  type CardTier,
  type EffectTag,
  type ScoreInput,
} from "@/lib/ranks";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { useToast } from "@/hooks/use-toast";

interface TicketCardProps {
  ticket: Ticket;
  compact?: boolean;
  onLongPress?: (ticket: Ticket) => void;
  viewHref?: string;
  noMenu?: boolean;
}

// ── Sync reaction state across all cached queries ──────────────────
type ReactionPatch = {
  hasReacted: boolean;
  totalScore: number;
  myReactions: Record<string, number>;
  reactionBreakdown: Record<string, number>;
};
function syncReactionCache(qc: QueryClient, ticketId: string, patch: ReactionPatch) {
  const extra = { ...patch, isLiked: patch.hasReacted, likeCount: patch.totalScore };
  qc.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
    if (!old || typeof old !== "object") return old;
    const o = old as Record<string, unknown>;

    if (Array.isArray(o["tickets"])) {
      const arr = o["tickets"] as Array<Record<string, unknown>>;
      if (!arr.some((t) => t["id"] === ticketId)) return old;
      return { ...o, tickets: arr.map((t) => t["id"] === ticketId ? { ...t, ...extra } : t) };
    }

    if (Array.isArray(o["items"])) {
      const arr = o["items"] as Array<Record<string, unknown>>;
      const hasTicket = arr.some(
        (item) => item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId,
      );
      if (!hasTicket) return old;
      return {
        ...o,
        items: arr.map((item) => {
          if (item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId) {
            const t = item["ticket"] as Record<string, unknown>;
            return { ...item, ticket: { ...t, ...extra } };
          }
          return item;
        }),
      };
    }

    if (o["id"] === ticketId) return { ...o, ...extra };
    return old;
  });
}

// ── Types for live movie data from the server ─────────────────────
type MovieLiveSnapshot = {
  rating:       number | null;
  voteCount:    number | null;
  genreIds:     number[] | null;
  // Live franchise IDs from the movies DB cache. Required so cards on the feed
  // award FR / LEGENDARY tiers consistently with the movie-detail page even
  // when TMDB added the franchise membership AFTER the ticket was created
  // (the per-ticket tmdbSnapshot freezes franchiseIds at create time).
  franchiseIds: number[] | null;
  popularity:   number | null;
  releaseDate:  string | null;
  year:         number | null;
};

// ── Build the ScoreInput for rank computation ─────────────────────
//
// Priority — for each field:
//   1. movieLiveSnapshot  (DB cache, refreshed every 1 hour from TMDB)
//   2. tmdbSnapshot       (frozen at ticket-creation time — fallback only)
//
// This makes the card rank IDENTICAL to the movie-detail page, which uses
// the same DB cache as the source of truth.
function buildScoreInput(
  live: MovieLiveSnapshot | null,
  snap: { tmdbRating?: number; voteCount?: number; year?: number | null;
          popularity?: number; genreIds?: number[]; franchiseIds?: number[] } | null | undefined,
  movieYear: string | null | undefined,
): ScoreInput {
  // year: live table → snapshot → ticket.movieYear column
  const resolvedYear =
    live?.year       ??
    snap?.year       ??
    (movieYear ? parseInt(movieYear, 10) : null);

  // franchiseIds: prefer the live snapshot (always up to date) but fall back
  // to the per-ticket snapshot if the movies cache row predates this column.
  const liveFranchise = live?.franchiseIds;
  const resolvedFranchise =
    liveFranchise && liveFranchise.length > 0
      ? liveFranchise
      : (snap?.franchiseIds ?? liveFranchise ?? []);

  return {
    tmdbRating:   live?.rating       ?? snap?.tmdbRating  ?? 0,
    voteCount:    live?.voteCount    ?? snap?.voteCount   ?? 0,
    popularity:   live?.popularity   ?? snap?.popularity  ?? 0,
    genreIds:     live?.genreIds     ?? snap?.genreIds    ?? [],
    franchiseIds: resolvedFranchise,
    year:         resolvedYear,
    releaseDate:  live?.releaseDate  ?? null,
  };
}

// ── Extract effects from ticket data ─────────────────────────────
function getTicketEffects(ticket: Ticket): EffectTag[] {
  const t = (ticket as unknown) as Record<string, unknown>;
  // LEGENDARY / CULT CLASSIC ไม่มี effect tags เลย — เช็ค DB tier ก่อน
  const dbTierRaw = (t["currentRankTier"] ?? t["rankTier"]) as string | undefined;
  if (dbTierRaw === "holographic" || dbTierRaw === "cult_classic") return [];

  const live = (t["movieLiveSnapshot"] as MovieLiveSnapshot | null | undefined) ?? null;
  const snap = t["tmdbSnapshot"] as {
    tmdbRating?: number; voteCount?: number; year?: number | null;
    popularity?: number; genreIds?: number[]; franchiseIds?: number[];
  } | null | undefined;

  const input = buildScoreInput(live, snap, ticket.movieYear as string | null | undefined);
  if (!input.tmdbRating) return [];
  try {
    const tier = computeCardTier(input);
    return computeEffectTags(input, tier);
  } catch {
    return [];
  }
}

// ── Get tier visual from ticket — respects customRankTier when rankLocked ──
function getTicketVisual(ticket: Ticket) {
  const t = (ticket as unknown) as Record<string, unknown>;
  const live = (t["movieLiveSnapshot"] as MovieLiveSnapshot | null | undefined) ?? null;
  const snap = t["tmdbSnapshot"] as {
    tmdbRating?: number; voteCount?: number; year?: number | null;
    popularity?: number; genreIds?: number[]; franchiseIds?: number[];
  } | null | undefined;

  const effectiveRating = live?.rating ?? snap?.tmdbRating ?? 0;

  // ถ้า rankLocked + มี customRankTier → ใช้ค่า custom เสมอ
  const rankLocked = t["rankLocked"] as boolean | undefined;
  const customRankTier = t["customRankTier"] as string | null | undefined;
  if (rankLocked && customRankTier) {
    return getCardVisual(customRankTier, effectiveRating);
  }

  // DB tier สำหรับ special tiers (holographic=LEGENDARY, cult_classic=CULT CLASSIC)
  // ต้องเชื่อ DB เสมอ เพราะ snapshot อาจไม่มี year → real-time compute จะ downgrade ผิด
  const dbTierRaw = (t["currentRankTier"] ?? t["rankTier"]) as string | undefined;
  if (dbTierRaw === "holographic" || dbTierRaw === "cult_classic") {
    return getCardVisual(dbTierRaw, effectiveRating);
  }

  // คำนวณ real-time เสมอจาก live + snapshot
  // score=0 → computeCardTier คืน "common" (C) ซึ่งเป็นค่าถูกต้อง
  // ไม่ fallback ไป DB tier เพราะ DB tier อาจล้าสมัย (เก็บตอน create ticket)
  const input = buildScoreInput(live, snap, ticket.movieYear as string | null | undefined);
  const tier = computeCardTier(input);
  return { ...TIER_VISUAL[tier], tier };
}


// ── Share To Chat Modal ───────────────────────────────────────────
type ConvParticipant = { id: string; username: string; displayName: string | null; avatarUrl: string | null };
type Conversation = { id: string; participants: ConvParticipant[]; lastMessage: { content: string | null; imageUrl: string | null } | null; updatedAt: string };

function ShareToChatModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useModalBackButton(onClose);

  useEffect(() => {
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.removeEventListener("touchmove", block);
    };
  }, []);

  const { data } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["/api/chat/conversations"],
    queryFn: async () => {
      const res = await fetch("/api/chat/conversations", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: usersData } = useQuery<{ users: ConvParticipant[] }>({
    queryKey: ["/api/users/search", search, "followingOnly"],
    queryFn: async () => {
      if (!search.trim()) return { users: [] };
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(search)}&followingOnly=true`, { credentials: "include" });
      if (!res.ok) return { users: [] };
      return res.json();
    },
    enabled: search.trim().length > 0,
  });

  const conversations = data?.conversations ?? [];

  const filtered = conversations.filter(conv => {
    const other = conv.participants.find(p => p.id !== user?.id);
    const name = (other?.displayName || other?.username || "").toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handleSendToConversation = async (convId: string) => {
    setSending(convId);
    try {
      await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedTicketId: ticket.id }),
      });
      setSent(convId);
      setTimeout(() => { onClose(); navigate(`/chat/${convId}`); }, 600);
    } catch {} finally {
      setSending(null);
    }
  };

  const handleSendToUser = async (targetUserId: string) => {
    setSending(targetUserId);
    try {
      const res = await fetch("/api/chat/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      const conv = await res.json();
      await handleSendToConversation(conv.id);
    } catch {} finally {
      setSending(null);
    }
  };

  const searchResults = (usersData?.users ?? []).filter((u: ConvParticipant) => u.id !== user?.id);

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="bg-background"
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          zIndex: 9999,
          width: "min(100vw, 430px)",
          transform: "translateX(-50%)",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.22)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "80vh",
          overflow: "hidden",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-2 pb-3 border-b border-border flex-shrink-0">
          <div className="flex-1">
            <p className="font-bold text-sm text-foreground">{t.sendToFriend}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{ticket.movieTitle}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 bg-secondary rounded-2xl px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              placeholder={t.searchShortPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {/* Show user search results if searching */}
          {search.trim() && searchResults.length > 0 && (
            <>
              <p className="px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t.usersLabel}</p>
              {searchResults.map((u: ConvParticipant) => (
                <button
                  key={u.id}
                  onClick={() => handleSendToUser(u.id)}
                  disabled={sending === u.id}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-black flex-shrink-0 overflow-hidden border border-white/10">
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                        {(u.displayName || u.username)?.[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-foreground">{u.displayName || u.username}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center">
                    {sent === u.id ? <span className="text-xs text-background">✓</span> : <Send className="w-3.5 h-3.5 text-background" />}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Existing conversations */}
          {filtered.length > 0 && (
            <>
              {search.trim() && searchResults.length > 0 && <div className="h-px bg-border mx-4" />}
              <p className="px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t.recentChatsLabel}</p>
              {filtered.map(conv => {
                const other = conv.participants.find(p => p.id !== user?.id) ?? conv.participants[0]!;
                const isSent = sent === conv.id;
                return (
                  <button
                    key={conv.id}
                    onClick={() => handleSendToConversation(conv.id)}
                    disabled={!!sending || isSent}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-black flex-shrink-0 overflow-hidden border border-white/10">
                      {other.avatarUrl ? <img src={other.avatarUrl} alt="" className="w-full h-full object-cover" /> : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                          {(other.displayName || other.username)?.[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-foreground">{other.displayName || other.username}</p>
                      <p className="text-xs text-muted-foreground">@{other.username}</p>
                    </div>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", isSent ? "bg-foreground" : "bg-secondary border border-border")}>
                      {isSent ? <span className="text-xs text-background">✓</span> : sending === conv.id ? <div className="w-3.5 h-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" /> : <Send className="w-3.5 h-3.5 text-foreground" />}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {!search.trim() && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t.noChats}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── Report Button Component ───────────────────────────────────────
function ReportButton({ ticketId, className }: { ticketId: string; className?: string }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const handleReport = async (reason: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok || res.status === 409) setDone(true);
    } catch {}
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={e => {
          e.stopPropagation();
          if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; }
          setOpen(v => !v);
        }}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        title={t.report}
      >
        {done ? <Flag className="w-3.5 h-3.5 fill-red-400 text-red-400" /> : <Flag className="w-3.5 h-3.5" />}
      </button>
      {open && !done && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 bg-background border border-border rounded-xl shadow-lg overflow-hidden min-w-[140px]" onClick={e => e.stopPropagation()}>
            {[
              { key: "spam",          label: t.reportReasons[0] },
              { key: "inappropriate", label: t.reportReasons[1] },
              { key: "harassment",    label: t.reportReasons[2] },
              { key: "spoiler",       label: t.reportReasons[3] },
              { key: "other",         label: t.reportReasons[4] },
            ].map(r => (
              <button key={r.key} onClick={() => handleReport(r.key)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors text-foreground">
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Long-press hook ───────────────────────────────────────────────
function useLongPress(callback: () => void, ms = 500) {
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired     = useRef(false);
  const startPos  = useRef<{ x: number; y: number } | null>(null);

  const start = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    fired.current = false;
    if ("touches" in e) {
      startPos.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    }
    timerRef.current = setTimeout(() => {
      fired.current = true;
      timerRef.current = null;
      callback();
    }, ms);
  }, [callback, ms]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPos.current) return;
    const dx = e.touches[0]!.clientX - startPos.current.x;
    const dy = e.touches[0]!.clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 8) cancel();
  }, [cancel]);

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchMove,
    onTouchEnd: () => { if (!fired.current) cancel(); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  TCG CARD — compact (profile grid)
// ═══════════════════════════════════════════════════════════════
function CompactCard({ ticket, onLongPress, viewHref }: { ticket: Ticket; onLongPress?: (t: Ticket) => void; viewHref?: string }) {
  const { t, lang } = useLang();
  const [flipped, setFlipped] = useState(false);
  const [flipSign, setFlipSign] = useState<1 | -1>(1);
  const [pressing, setPressing] = useState(false);
  const { user } = useAuth();

  const isOwner  = user?.id === ticket.userId;
  const specialColorCfg = getSpecialColorCfg(((ticket as unknown) as Record<string, unknown>)["specialColor"] as string | null);
  const partySeat = ((ticket as unknown) as Record<string, unknown>)["partySeatNumber"] as number | null | undefined;
  const compactRatingType = (((ticket as unknown) as Record<string, unknown>)["ratingType"] as string | undefined) ?? "star";
  const compactRatingStyle = getRatingCardStyle(ticket.rating, compactRatingType);
  const compactCardTheme = (((ticket as unknown) as Record<string, unknown>)["cardTheme"] as string | undefined) ?? "classic";
  const isCompactPoster = compactCardTheme === "poster";
  const compactFrontShadow = specialColorCfg ? specialColorCfg.glow : (compactRatingStyle.glow.boxShadow ?? "0 4px 14px rgba(0,0,0,0.5)");

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(110);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    if (w > 0) setContainerW(w);
    const ro = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compactScale = containerW / CARD_SEED_W;
  const tAnyC = (ticket as unknown) as Record<string, unknown>;
  const compactImageSrc = (tAnyC["cardBackdropUrl"] as string | null | undefined) ?? ticket.posterUrl ?? null;

  const longPressHandlers = useLongPress(() => {
    if (isOwner && onLongPress) {
      setPressing(false);
      onLongPress(ticket);
    }
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!flipped) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setFlipSign(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
    }
    setFlipped(f => !f);
  };

  return (
    <div
      ref={containerRef}
      className="relative cursor-pointer select-none"
      style={{
        width: "100%",
        aspectRatio: "2/3",
        perspective: 1000,
        transform: pressing ? "scale(0.96)" : "scale(1)",
        transition: pressing ? "transform 0.1s ease-out" : "transform 0.35s cubic-bezier(0.23,1,0.32,1)",
      }}
      onClick={handleClick}
      onPointerDown={() => setPressing(true)}
      onPointerUp={() => setPressing(false)}
      onPointerCancel={() => setPressing(false)}
      {...longPressHandlers}
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)",
          transform: flipped ? `rotateY(${flipSign * 180}deg)` : "rotateY(0deg)",
        }}
      >
        {/* ── FRONT — seed-scaled to match create-ticket preview ── */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            borderRadius: isCompactPoster ? 0 : "0.75rem",
            background: isCompactPoster ? POSTER_BG : "#111",
            boxShadow: specialColorCfg ? specialColorCfg.glow : (isCompactPoster ? "var(--ticket-shadow-poster)" : compactRatingStyle.glow.boxShadow),
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, width: CARD_SEED_W, height: CARD_SEED_H, transformOrigin: "top left", transform: `scale(${compactScale})` }}>
            {isCompactPoster ? (
              <PosterCardFront
                ticket={ticket}
                borderColorHex={compactRatingStyle.borderColorHex}
              />
            ) : (
              <ClassicCardFront ticket={ticket} imageSrc={compactImageSrc} />
            )}
          </div>
        </div>


        {/* ── BACK — seed-scaled, same layout as FeedCard back ── */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            borderRadius: isCompactPoster ? 0 : "0.75rem",
            background: isCompactPoster ? POSTER_BG : "var(--card-back-bg)",
            border: isCompactPoster ? "none" : "1px solid var(--card-back-border)",
            boxShadow: isCompactPoster ? (specialColorCfg ? specialColorCfg.glow : "var(--ticket-shadow-back-poster)") : compactFrontShadow,
          }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, width: CARD_SEED_W, height: CARD_SEED_H, transformOrigin: "top left", transform: `scale(${compactScale})` }}>
            <div className="absolute inset-0 p-3 flex flex-col">
              {partySeat && (
                <div
                  className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black"
                  style={specialColorCfg
                    ? { background: specialColorCfg.color, color: "#000" }
                    : { background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }
                  }
                >
                  {partySeat}
                </div>
              )}
              {((ticket as unknown) as Record<string, unknown>)["isPrivateMemory"] && !ticket.memoryNote ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-1">
                  <Lock className="w-5 h-5" style={{ color: isCompactPoster ? "rgba(28,28,28,0.4)" : "var(--card-back-text-muted)" }} />
                  <p className="text-[10px] italic text-center" style={{ color: isCompactPoster ? "rgba(28,28,28,0.45)" : "var(--card-back-text-muted)" }}>{t.privateMemory}</p>
                </div>
              ) : ticket.memoryNote ? (
                <p className="text-[11px] leading-relaxed italic flex-1 break-words whitespace-pre-wrap" style={{ color: isCompactPoster ? "rgba(28,28,28,0.6)" : "var(--card-back-text)", overflowWrap: "break-word", wordBreak: "break-word" }}>
                  "{ticket.memoryNote}"
                </p>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[10px] italic text-center whitespace-nowrap" style={{ color: isCompactPoster ? "rgba(28,28,28,0.8)" : "var(--card-back-text-faint)" }}>{t.noMemoryYet}</p>
                </div>
              )}
              <div className="mt-auto space-y-1 mb-2">
                {ticket.watchedAt && (
                  <div className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3 shrink-0" style={{ color: isCompactPoster ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                    <span className="text-[10px]" style={{ color: isCompactPoster ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)" }}>
                      {new Date(ticket.watchedAt).toLocaleDateString("th", { month: "short", year: "numeric" })}
                    </span>
                  </div>
                )}
                {ticket.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" style={{ color: isCompactPoster ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                    <span className="text-[10px] truncate" style={{ color: isCompactPoster ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)" }}>{ticket.location}</span>
                  </div>
                )}
              </div>
              <Link href={viewHref ?? `/ticket/${ticket.id}`} onClick={e => e.stopPropagation()}>
                <div
                  className={`flex items-center justify-center gap-1 text-[11px] font-semibold py-2 ${isCompactPoster ? "" : "rounded-xl"}`}
                  style={isCompactPoster
                    ? { border: "1px solid rgba(28,28,28,0.12)", color: "rgba(28,28,28,0.45)" }
                    : { border: "1px solid var(--card-back-border)", color: "var(--card-back-text)" }}
                >
                  View <ArrowRight className="w-3 h-3" />
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Action button — mirrors ChainsSection button style exactly ─────────────────
function ActionBtn({ onClick, children }: { onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 select-none transition-all duration-100 active:scale-75 active:opacity-50 group outline-none focus:outline-none focus-visible:outline-none"
      style={{ WebkitTapHighlightColor: "transparent", outline: "none" }}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
//  FEED CARD (Home feed)
// ═══════════════════════════════════════════════════════════════

// ── Comment cycling bubble ─────────────────────────────────────────────────────
function CommentBubble({ ticketId, commentCount }: { ticketId: string; commentCount: number }) {
  const { t } = useLang();
  const { data } = useQuery<{ comments: Array<{ id: string; user: { displayName: string | null }; content: string }> }>({
    queryKey: [`/api/tickets/${ticketId}/comments-preview`],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/comments?limit=6`, { credentials: "include" });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: commentCount > 0,
  });

  const comments = data?.comments ?? [];
  const [idx, setIdx]   = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (comments.length <= 1) return;
    const timer = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % comments.length);
        setShow(true);
      }, 300);
    }, 3500);
    return () => clearInterval(timer);
  }, [comments.length]);

  if (commentCount === 0 || comments.length === 0) return null;
  const c = comments[idx];

  return (
    <div className="mx-4 mb-3 px-3 py-2 bg-secondary/60 rounded-2xl flex items-start gap-2">
      <MessageCircle className="w-3 h-3 text-muted-foreground/60 shrink-0 mt-[3px]" />
      <p
        className="text-xs text-foreground/70 leading-snug line-clamp-1 flex-1 transition-opacity duration-300"
        style={{ opacity: show ? 1 : 0 }}
      >
        <span className="font-semibold text-foreground/85">{c.user?.displayName ?? t.user}</span>
        {" "}{c.content}
      </p>
    </div>
  );
}

// ── Comment modal (quick popup from feed) ─────────────────────────────────────
function CommentModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  useModalBackButton(onClose);

  const { data, refetch, isLoading: commentsLoading } = useQuery<{ comments: Array<{ id: string; userId: string; user: { displayName: string | null; username: string; avatarUrl: string | null }; content: string; createdAt: string }> }>({
    queryKey: [`/api/tickets/${ticket.id}/comments`],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticket.id}/comments?limit=100`, { credentials: "include" });
      return res.json();
    },
  });
  const commentList = data?.comments ?? [];

  const handleSubmit = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: comment.trim() }),
      });
      setComment("");
      refetch();
      // bump comment count in all feed caches immediately
      qc.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const o = old as Record<string, unknown>;
        if (o["id"] === ticket.id) return { ...o, commentCount: (Number(o["commentCount"]) || 0) + 1 };
        if (Array.isArray(o["tickets"])) {
          const arr = o["tickets"] as Array<Record<string, unknown>>;
          if (!arr.some(t => t["id"] === ticket.id)) return old;
          return { ...o, tickets: arr.map(t => t["id"] === ticket.id ? { ...t, commentCount: (Number(t["commentCount"]) || 0) + 1 } : t) };
        }
        if (Array.isArray(o["items"])) {
          const arr = o["items"] as Array<Record<string, unknown>>;
          if (!arr.some(item => item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket.id)) return old;
          return {
            ...o, items: arr.map(item => {
              if (item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket.id) {
                const t = item["ticket"] as Record<string, unknown>;
                return { ...item, ticket: { ...t, commentCount: (Number(t["commentCount"]) || 0) + 1 } };
              }
              return item;
            }),
          };
        }
        return old;
      });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ paddingBottom: keyboardHeight }} onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-background rounded-t-3xl shadow-2xl flex flex-col"
        style={{ width: "min(100%, 430px)", height: "min(80vh, 600px)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <div className="flex items-center px-4 pb-3 border-b border-border flex-shrink-0">
          <p className="font-bold text-sm text-foreground flex-1">
            {t.commentsLabel}{commentList.length > 0 ? ` (${commentList.length})` : ""}
          </p>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-3 min-h-0">
          {commentsLoading ? (
            <div className="flex flex-col px-4 py-2">
              {Array.from({ length: Math.min(Math.max(ticket.commentCount ?? 1, 1), 8) }).map((_, i) => (
                <div key={i} className="flex gap-3 py-2.5 animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex gap-2 mb-2 items-center">
                      <div className="h-3 w-16 bg-secondary rounded-full" />
                      <div className="h-2.5 w-8 bg-secondary/60 rounded-full" />
                    </div>
                    <div className="h-9 bg-secondary rounded-2xl rounded-tl-sm w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : commentList.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">{t.noCommentsBeFirst}</p>
          ) : (
            commentList.map(c => {
              const diff  = Date.now() - new Date(c.createdAt).getTime();
              const mins  = Math.floor(diff / 60000);
              const hours = Math.floor(diff / 3600000);
              const days  = Math.floor(diff / 86400000);
              const timeStr = mins < 1 ? t.timeJustNow : mins < 60 ? `${mins} ${t.timeMin}` : hours < 24 ? `${hours} ${t.timeHr}` : `${days} ${t.timeDay}`;
              return (
                <div key={c.id} className="flex gap-3 px-4 py-2.5">
                  <div className="w-8 h-8 rounded-2xl bg-black flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/10">
                    {c.user?.avatarUrl
                      ? <img src={c.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-white">{c.user?.displayName?.[0]?.toUpperCase() ?? "T"}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-bold text-foreground">{c.user?.displayName || c.user?.username}</span>
                      <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                      {user && user.id === c.userId && (
                        <button
                          onClick={async () => {
                            // Optimistic: remove comment immediately + decrement count in all caches
                            qc.setQueryData<{ comments: typeof commentList }>([`/api/tickets/${ticket.id}/comments`], old =>
                              old ? { comments: old.comments.filter(x => x.id !== c.id) } : old
                            );
                            qc.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
                              if (!old || typeof old !== "object") return old;
                              const o = old as Record<string, unknown>;
                              if (o["id"] === ticket.id) return { ...o, commentCount: Math.max(0, (Number(o["commentCount"]) || 0) - 1) };
                              if (Array.isArray(o["tickets"])) {
                                const arr = o["tickets"] as Array<Record<string, unknown>>;
                                if (!arr.some(t => t["id"] === ticket.id)) return old;
                                return { ...o, tickets: arr.map(t => t["id"] === ticket.id ? { ...t, commentCount: Math.max(0, (Number(t["commentCount"]) || 0) - 1) } : t) };
                              }
                              if (Array.isArray(o["items"])) {
                                const arr = o["items"] as Array<Record<string, unknown>>;
                                if (!arr.some(item => item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket.id)) return old;
                                return {
                                  ...o, items: arr.map(item => {
                                    if (item["type"] === "ticket" && (item["ticket"] as Record<string, unknown>)?.["id"] === ticket.id) {
                                      const t = item["ticket"] as Record<string, unknown>;
                                      return { ...item, ticket: { ...t, commentCount: Math.max(0, (Number(t["commentCount"]) || 0) - 1) } };
                                    }
                                    return item;
                                  }),
                                };
                              }
                              return old;
                            });
                            try {
                              await fetch(`/api/tickets/${ticket.id}/comments/${c.id}`, { method: "DELETE", credentials: "include" });
                              qc.invalidateQueries({ queryKey: [`/api/tickets/${ticket.id}/comments`] });
                              qc.invalidateQueries({ queryKey: ["mixed-feed"] });
                            } catch {
                              refetch();
                            }
                          }}
                          className="ml-auto p-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="bg-secondary rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                      <p className="text-sm text-foreground/90 leading-relaxed">{c.content}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {user && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-black flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/10">
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-xs font-bold text-white">{(user.displayName || user.username || "?")?.[0]?.toUpperCase()}</span>}
            </div>
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSubmit()}
              placeholder={t.addCommentPlaceholder}
              className="flex-1 bg-secondary rounded-2xl px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !comment.trim()}
              className="flex-shrink-0 w-9 h-9 bg-foreground text-background rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Poster card constants (re-exported from CardFaceComponents via import above) ──
// POSTER_BG, POSTER_DARK are imported from CardFaceComponents


// ── Feed card ──────────────────────────────────────────────────────────────────
function FeedCard({ ticket, onLongPress }: { ticket: Ticket; onLongPress?: (t: Ticket) => void }) {
  const { t, lang } = useLang();
  const [hasReacted,        setHasReacted]        = useState((ticket as any).hasReacted ?? ticket.isLiked ?? false);
  const [bookmarked,        setBookmarked]        = useState(ticket.isBookmarked || false);
  const [totalScore,        setTotalScore]        = useState<number>((ticket as any).totalScore ?? ticket.likeCount ?? 0);
  const [myReactions,       setMyReactions]       = useState<Record<string, number>>((ticket as any).myReactions ?? {});
  const [reactionBreakdown, setReactionBreakdown] = useState<Record<string, number>>((ticket as any).reactionBreakdown ?? {});

  useEffect(() => { setHasReacted((ticket as any).hasReacted ?? ticket.isLiked ?? false); }, [ticket.isLiked, (ticket as any).hasReacted]);
  useEffect(() => { setTotalScore((ticket as any).totalScore ?? ticket.likeCount ?? 0); }, [ticket.likeCount, (ticket as any).totalScore]);
  useEffect(() => { if ((ticket as any).myReactions) setMyReactions((ticket as any).myReactions); }, [(ticket as any).myReactions]);
  useEffect(() => { if ((ticket as any).reactionBreakdown) setReactionBreakdown((ticket as any).reactionBreakdown); }, [(ticket as any).reactionBreakdown]);

  const [shareOpen,      setShareOpen]      = useState(false);
  const [storyShareOpen, setStoryShareOpen] = useState(false);
  const [commentOpen,    setCommentOpen]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flipped,       setFlipped]       = useState(false);
  const [flipSign,      setFlipSign]      = useState<1 | -1>(1);
  const [cardPressing,  setCardPressing]  = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingLikeHighlight, setPendingLikeHighlight] = useState(false);
  const cardExportRef = useRef<HTMLDivElement>(null);
  const heartWrapRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!pendingLikeHighlight) return;
    let handler: ((e: Event) => void) | null = null;
    const tid = setTimeout(() => {
      handler = (e: Event) => {
        if (heartWrapRef.current?.contains(e.target as Node)) return;
        setPendingLikeHighlight(false);
      };
      document.addEventListener("click", handler);
      document.addEventListener("touchend", handler);
    }, 0);
    return () => {
      clearTimeout(tid);
      if (handler) {
        document.removeEventListener("click", handler);
        document.removeEventListener("touchend", handler);
      }
    };
  }, [pendingLikeHighlight]);

  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const deleteTicket = useDeleteTicket();
  const { toast } = useToast();

  const requireAuth = (e: React.MouseEvent) => {
    if (user) return false;
    e.preventDefault(); e.stopPropagation();
    toast({ title: t.signInToLike, duration: 1500 });
    return true;
  };

  const isOwner   = user?.id === ticket.userId;
  const avatarUrl  = ticket.user?.avatarUrl;
  const specialColorCfg = getSpecialColorCfg(((ticket as unknown) as Record<string, unknown>)["specialColor"] as string | null);
  const partySeat = ((ticket as unknown) as Record<string, unknown>)["partySeatNumber"] as number | null | undefined;
  const partySize = ((ticket as unknown) as Record<string, unknown>)["partySize"] as number | null | undefined;
  const ratingType = (((ticket as unknown) as Record<string, unknown>)["ratingType"] as string | undefined) ?? "star";
  const cardTheme = (((ticket as unknown) as Record<string, unknown>)["cardTheme"] as string | undefined) ?? "classic";
  const isPoster = cardTheme === "poster";
  const ratingStyle = getRatingCardStyle(ticket.rating, ratingType);
  const feedFrontShadow = specialColorCfg ? specialColorCfg.glow : (ratingStyle.glow.boxShadow ?? "0 4px 14px rgba(0,0,0,0.5)");

  const handleReact = async (reactions: Record<string, number>) => {
    if (!user) {
      toast({ title: t.signInToLike, duration: 1500 });
      setPendingLikeHighlight(true);
      return;
    }
    const isEmpty = Object.values(reactions).every((v) => v === 0);
    if (isEmpty) {
      setPendingLikeHighlight(true);
    } else {
      setPendingLikeHighlight(false);
    }
    const prevHasReacted = hasReacted;
    const prevTotalScore = totalScore;
    const prevMyReactions = myReactions;
    const prevBreakdown = reactionBreakdown;
    const optimisticBreakdown: Record<string, number> = { ...reactionBreakdown };
    for (const [type, cnt] of Object.entries(reactions)) {
      const delta = cnt - (myReactions[type] ?? 0);
      optimisticBreakdown[type] = Math.max(0, (optimisticBreakdown[type] ?? 0) + delta);
    }
    const REACTION_PTS: Record<string, number> = { heart: 1, fire: 2, lightning: 3, sparkle: 4, popcorn: 5 };
    const newScore = Object.entries(optimisticBreakdown).reduce((s, [t, c]) => s + c * (REACTION_PTS[t] ?? 1), 0);
    const newHasReacted = !isEmpty;
    setHasReacted(newHasReacted);
    setTotalScore(newScore);
    setMyReactions(reactions);
    setReactionBreakdown(optimisticBreakdown);
    syncReactionCache(queryClient, ticket.id, { hasReacted: newHasReacted, totalScore: newScore, myReactions: reactions, reactionBreakdown: optimisticBreakdown });
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
        syncReactionCache(queryClient, ticket.id, data);
      }
    } catch {
      setHasReacted(prevHasReacted);
      setTotalScore(prevTotalScore);
      setMyReactions(prevMyReactions);
      setReactionBreakdown(prevBreakdown);
      syncReactionCache(queryClient, ticket.id, { hasReacted: prevHasReacted, totalScore: prevTotalScore, myReactions: prevMyReactions, reactionBreakdown: prevBreakdown });
    }
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    if (requireAuth(e)) return;
    e.preventDefault(); e.stopPropagation();
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await fetch(`/api/tickets/${ticket.id}/bookmark`, {
        method: next ? "POST" : "DELETE",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    } catch {
      setBookmarked(!next);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await deleteTicket.mutateAsync({ ticketId: ticket.id });
      queryClient.invalidateQueries();
    } catch {}
  };

  const handleExportPNG = useCallback(async () => {
    if (exporting || !cardExportRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(cardExportRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        imageTimeout: 15000,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const filename = `ticket-${ticket.movieTitle?.replace(/\s+/g, '-') || 'card'}-${Date.now()}.png`;
        const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS && typeof navigator.share === 'function') {
          try {
            const file = new File([blob], filename, { type: 'image/png' });
            await navigator.share({ files: [file], title: filename });
          } catch {
            saveAs(blob, filename);
          }
        } else {
          saveAs(blob, filename);
        }
        setExporting(false);
      });
    } catch (err) {
      console.error('Export failed:', err);
      setExporting(false);
    }
  }, [ticket, exporting]);

  return (
    <div className="bg-background pb-4 border-b border-border/50" ref={cardExportRef}>
      {/* Creator row */}
      <div className="flex items-center gap-2.5 pl-0 pr-4 pt-3 pb-3">
        <Link href={`/profile/${ticket.user?.username}`}>
          <div className="flex items-end gap-2 bg-secondary rounded-r-2xl pl-3 pr-3 py-1.5 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg overflow-hidden bg-black border border-white/10 flex items-center justify-center flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={ticket.user?.displayName ?? ""} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] font-bold text-white">
                  {ticket.user?.displayName?.[0]?.toUpperCase() ?? "T"}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <p className="text-[13px] font-bold text-foreground leading-none">{ticket.user?.displayName}</p>
                {isVerified(ticket.user?.username) && <VerifiedBadge className="w-[13px] h-[13px]" />}
                {ticket.user?.id && <BadgeIcon userId={ticket.user.id} size={13} />}
              </div>
              <div className="flex items-center gap-[3px] mt-[2px]">
                <div className="w-[13px] h-[13px] rounded-[3px] bg-foreground flex items-center justify-center flex-shrink-0">
                  <TicketIcon className="w-[8px] h-[8px] text-background" />
                </div>
                <span className="text-[10px] text-muted-foreground font-medium leading-none">Tickets</span>
              </div>
            </div>
          </div>
        </Link>
        {(((ticket as unknown) as Record<string, unknown>)["isSpoiler"] === true) && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border"
            style={{ background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.4)", color: "#ef4444" }}
            title={t.spoilerAlertDesc}
          >
            <span aria-hidden className="font-black leading-none">!</span>
            {t.spoiler}
          </span>
        )}
        {isOwner ? (
          <button
            onClick={handleDelete}
            className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={confirmDelete ? t.confirmDeleteAgain : t.deletePost}
          >
            {deleteTicket.isPending
              ? <span className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin block" />
              : <Trash2 className={cn("w-3.5 h-3.5", confirmDelete && "text-foreground")} />}
          </button>
        ) : isVerified(ticket.user?.username) ? null : (
          <ReportButton ticketId={ticket.id} className="ml-auto" />
        )}
      </div>

      {/* Ticket card — tap to flip */}
      <div className="flex justify-center px-4 mb-2">
        <div style={{ width: 160, aspectRatio: "2/3", position: "relative", perspective: "1000px" }}>
          {/* 3D flip container */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transition: cardPressing
                ? "transform 0.1s ease-out"
                : "transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)",
              transform: cardPressing
                ? `${flipped ? `rotateY(${flipSign * 180}deg)` : "rotateY(0deg)"} scale(0.95)`
                : (flipped ? `rotateY(${flipSign * 180}deg)` : "rotateY(0deg)"),
              cursor: "pointer",
            }}
            onPointerDown={() => setCardPressing(true)}
            onPointerUp={() => setCardPressing(false)}
            onPointerCancel={() => setCardPressing(false)}
            onClick={(e) => {
              setCardPressing(false);
              if (!flipped) {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setFlipSign(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
              }
              setFlipped(f => !f);
            }}
          >
          {/* ── FRONT — seed-scaled ── */}
          {(() => {
            const tAnyF = (ticket as unknown) as Record<string, unknown>;
            const feedImageSrc = (tAnyF["cardBackdropUrl"] as string | null | undefined) ?? ticket.posterUrl ?? null;
            const FEED_SCALE = 160 / CARD_SEED_W;
            return (
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  borderRadius: isPoster ? 0 : "0.75rem",
                  background: isPoster ? POSTER_BG : "#111",
                  boxShadow: specialColorCfg ? specialColorCfg.glow : (isPoster ? "var(--ticket-shadow-poster)" : ratingStyle.glow.boxShadow),
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, width: CARD_SEED_W, height: CARD_SEED_H, transformOrigin: "top left", transform: `scale(${FEED_SCALE})` }}>
                  {isPoster ? (
                    <PosterCardFront ticket={ticket} borderColorHex={ratingStyle.borderColorHex} />
                  ) : (
                    <ClassicCardFront ticket={ticket} imageSrc={feedImageSrc} />
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── BACK — seed-scaled ── */}
          {(() => {
            const FEED_SCALE = 160 / CARD_SEED_W;
            return (
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  borderRadius: isPoster ? 0 : "0.75rem",
                  background: isPoster ? POSTER_BG : "var(--card-back-bg)",
                  border: isPoster ? "none" : "1px solid var(--card-back-border)",
                  boxShadow: isPoster ? (specialColorCfg ? specialColorCfg.glow : "var(--ticket-shadow-back-poster)") : feedFrontShadow,
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, width: CARD_SEED_W, height: CARD_SEED_H, transformOrigin: "top left", transform: `scale(${FEED_SCALE})` }}>
                  <div className="absolute inset-0 p-3 flex flex-col">
                    {partySeat && (
                      <div
                        className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black"
                        style={specialColorCfg
                          ? { background: specialColorCfg.color, color: "#000" }
                          : { background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }
                        }
                      >
                        {partySeat}
                      </div>
                    )}
                    {((ticket as unknown) as Record<string, unknown>)["isPrivateMemory"] && !ticket.memoryNote ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-1">
                        <Lock className="w-5 h-5" style={{ color: isPoster ? "rgba(28,28,28,0.4)" : "var(--card-back-text-muted)" }} />
                        <p className="text-[10px] italic text-center" style={{ color: isPoster ? "rgba(28,28,28,0.45)" : "var(--card-back-text-muted)" }}>{t.privateMemory}</p>
                      </div>
                    ) : ticket.memoryNote ? (
                      <p className="text-[11px] leading-relaxed italic flex-1 break-words whitespace-pre-wrap" style={{ color: isPoster ? "rgba(28,28,28,0.6)" : "var(--card-back-text)", overflowWrap: "break-word", wordBreak: "break-word" }}>
                        "{ticket.memoryNote}"
                      </p>
                    ) : (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-[10px] italic text-center whitespace-nowrap" style={{ color: isPoster ? "rgba(28,28,28,0.8)" : "var(--card-back-text-faint)" }}>{t.noMemoryYet}</p>
                      </div>
                    )}
                    <div className="mt-auto space-y-1 mb-2">
                      {ticket.watchedAt && (
                        <div className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3 shrink-0" style={{ color: isPoster ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                          <span className="text-[10px]" style={{ color: isPoster ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)" }}>
                            {new Date(ticket.watchedAt).toLocaleDateString("th", { month: "short", year: "numeric" })}
                          </span>
                        </div>
                      )}
                      {ticket.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" style={{ color: isPoster ? "rgba(28,28,28,0.35)" : "var(--card-back-text-faint)" }} />
                          <span className="text-[10px] truncate" style={{ color: isPoster ? "rgba(28,28,28,0.55)" : "var(--card-back-text-muted)" }}>{ticket.location}</span>
                        </div>
                      )}
                    </div>
                    <Link href={`/movie/${encodeURIComponent(ticket.imdbId)}`} onClick={e => e.stopPropagation()}>
                      <div
                        className={cn("flex items-center justify-center gap-1 text-[11px] font-semibold py-2 transition-colors", isPoster ? "rounded-none" : "rounded-xl")}
                        style={isPoster
                          ? { border: "1px solid rgba(28,28,28,0.12)", color: "rgba(28,28,28,0.45)" }
                          : { border: "1px solid var(--card-back-border)", color: "var(--card-back-text)" }}
                      >
                        View <ArrowRight className="w-3 h-3" />
                      </div>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })()}
          </div>

        </div>
      </div>

      {/* Associated users (tagged + party members) — horizontal scroll row below card */}
      {(() => {
        const tagged = (((ticket as unknown) as Record<string, unknown>)["taggedUsers"] as Array<{ id?: string; username: string; displayName: string | null }> | undefined) ?? [];
        const party  = (((ticket as unknown) as Record<string, unknown>)["partyMembers"] as Array<{ seatNumber?: number; username: string; displayName: string | null; avatarUrl?: string | null }> | undefined) ?? [];
        // merge + deduplicate by username, exclude the ticket owner
        const ownerUsername = ticket.user?.username;
        const seen = new Set<string>();
        const all: { username: string }[] = [];
        for (const u of [...tagged, ...party]) {
          if (u.username && u.username !== ownerUsername && !seen.has(u.username)) {
            seen.add(u.username);
            all.push(u);
          }
        }
        if (all.length === 0) return null;
        return (
          <div
            className="flex flex-nowrap items-center mt-3 px-4 overflow-x-auto"
            style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {all.map((u, i) => (
              <span key={u.username} className="flex-shrink-0 flex items-center">
                {i > 0 && <span className="text-muted-foreground/40 text-xs select-none mx-1.5">·</span>}
                <Link href={`/profile/${u.username}`} onClick={e => e.stopPropagation()}>
                  <span className="whitespace-nowrap text-xs text-muted-foreground font-semibold hover:text-foreground transition-colors">
                    @{u.username}
                  </span>
                </Link>
              </span>
            ))}
          </div>
        );
      })()}

      {/* Episode label + Caption */}
      {(() => {
        const feedCaption = ((ticket as unknown) as Record<string, unknown>)["caption"] as string | null | undefined;
        const captionAlign = ((ticket as unknown) as Record<string, unknown>)["captionAlign"] as string | null | undefined;
        const episodeLabel = ((ticket as unknown) as Record<string, unknown>)["episodeLabel"] as string | null | undefined;
        const displayText = feedCaption;
        const isPrivateMem = ((ticket as unknown) as Record<string, unknown>)["isPrivateMemory"] as boolean;
        const captionAlignProp: "left" | "center" | "right" =
          captionAlign === "center" ? "center" : captionAlign === "right" ? "right" : "left";
        if (isPrivateMem && !ticket.memoryNote && !feedCaption) {
          return (
            <>
              {episodeLabel && (
                <p className="text-xs font-semibold text-primary/80 tracking-wide px-4 mt-5">{episodeLabel}</p>
              )}
              <Link href={`/ticket/${ticket.id}`}>
                <div className="px-4 mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span className="italic">{t.privateMemoryHint}</span>
                </div>
              </Link>
            </>
          );
        }
        if (!episodeLabel && !displayText) return null;
        return (
          <>
            {episodeLabel && (
              <p className="text-xs font-semibold text-primary/80 tracking-wide px-4 mt-5">{episodeLabel}</p>
            )}
            {displayText && (
              <div className="px-4 mt-3">
                <ExpandableText
                  text={displayText}
                  align={captionAlignProp}
                  clampLines={3}
                  className="text-sm text-foreground/80 leading-relaxed"
                />
              </div>
            )}
          </>
        );
      })()}

      {/* Comment cycling bubble — only rendered when there are comments to avoid empty gap */}
      {(ticket.commentCount ?? 0) > 0 && (
        <div className="mt-4">
          <CommentBubble ticketId={ticket.id} commentCount={ticket.commentCount ?? 0} />
        </div>
      )}

      {/* Action bar */}
      {(() => {
        const IC = 20;
        const hideLikes = !!(ticket as any)?.hideLikes;
        const hideComments = !!(ticket as any)?.hideComments;
        return (
          <div className="flex items-center justify-center gap-8 mt-4">
            {/* ❤️ Heart */}
            <div ref={heartWrapRef}>
              <ReactionButton
                myReactions={myReactions}
                reactionBreakdown={reactionBreakdown}
                hideLikes={hideLikes}
                onReact={handleReact}
                iconSize={IC}
                pendingHighlight={pendingLikeHighlight}
              />
            </div>

            {/* 🎬 Comment */}
            {!hideComments && (
              <ActionBtn onClick={e => { setPendingLikeHighlight(false); if (requireAuth(e)) return; e.preventDefault(); e.stopPropagation(); setCommentOpen(true); }}>
                <MessagesSquare style={{ width: IC, height: IC }} className="text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                {(ticket.commentCount ?? 0) > 0 && (
                  <span className="text-xs font-bold tabular-nums leading-5 text-muted-foreground/60">{fmtCount(ticket.commentCount ?? 0)}</span>
                )}
              </ActionBtn>
            )}

            {/* 🔖 Bookmark */}
            <ActionBtn onClick={e => { setPendingLikeHighlight(false); handleBookmark(e); }}>
              <Bookmark
                style={{ width: IC, height: IC }}
                className={cn("transition-colors", bookmarked ? "fill-foreground text-foreground" : "text-muted-foreground/60 group-hover:text-foreground")}
              />
            </ActionBtn>

            {/* 📤 Share */}
            <ActionBtn onClick={e => { setPendingLikeHighlight(false); if (requireAuth(e)) return; e.preventDefault(); e.stopPropagation(); setStoryShareOpen(true); }}>
              <Share2 style={{ width: IC, height: IC }} className="text-muted-foreground/60 group-hover:text-foreground transition-colors" />
            </ActionBtn>
          </div>
        );
      })()}

      {storyShareOpen && (
        <ShareStoryModal
          ticket={ticket}
          onClose={() => setStoryShareOpen(false)}
          onOpenChat={() => setShareOpen(true)}
        />
      )}
      {shareOpen && <ShareToChatModal ticket={ticket} onClose={() => setShareOpen(false)} />}
      {commentOpen && <CommentModal ticket={ticket} onClose={() => setCommentOpen(false)} />}
    </div>
  );
}

// ── Card context menu (after long press) ─────────────────────────
export interface CardMenuProps {
  ticket: Ticket;
  onClose: () => void;
}

export function CardContextMenu({ ticket, onClose }: CardMenuProps) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const deleteTicket = useDeleteTicket();
  const { user: me } = useAuth();
  const [, navigate] = useLocation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [visible, setVisible] = useState(false);
  // pinnedIds === null  → still loading (button hidden)
  // pinnedIds === []    → user has nothing pinned yet
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null);
  const [pinning, setPinning] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOwner = !!me && me.id === ticket.userId;

  useModalBackButton(onClose);
  const isPinned = pinnedIds != null && pinnedIds.includes(ticket.id);
  // Profile cover renders 3 tiles (1 row × 3 cols, one image per pinned post).
  // Newest pin goes to the front (left); pinning a 4th pushes the oldest out.
  const PIN_LIMIT = 3;

  useEffect(() => {
    document.documentElement.setAttribute("data-scroll-lock", "true");
    const id = requestAnimationFrame(() => setVisible(true));
    return () => {
      document.documentElement.removeAttribute("data-scroll-lock");
      cancelAnimationFrame(id);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Fetch the current user's pinned-ticket list once when the menu opens, so
  // we know whether to show "Pin to cover" or "Unpin from cover".
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users/me/profile", { credentials: "include" });
        if (!res.ok) { if (!cancelled) setPinnedIds([]); return; }
        const data = await res.json();
        if (cancelled) return;
        const ids = Array.isArray(data?.pinnedTicketIds) ? (data.pinnedTicketIds as string[]) : [];
        setPinnedIds(ids);
      } catch {
        if (!cancelled) setPinnedIds([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOwner]);

  const handleClose = () => {
    if (closeTimerRef.current !== null) return;
    setVisible(false);
    closeTimerRef.current = setTimeout(onClose, 300);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteTicket.mutateAsync({ ticketId: ticket.id });
      queryClient.invalidateQueries();
    } catch {}
    setDeleting(false);
    handleClose();
  };

  const handleTogglePrivate = async () => {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/privacy`, { method: "PATCH", credentials: "include" });
      if (res.ok) queryClient.invalidateQueries();
    } catch {}
    handleClose();
  };

  const handleToggleHideLikes = async () => {
    try {
      await fetch(`/api/tickets/${ticket.id}/hide-likes`, { method: "PATCH", credentials: "include" });
      queryClient.invalidateQueries();
    } catch {}
    handleClose();
  };

  const handleToggleHideComments = async () => {
    try {
      await fetch(`/api/tickets/${ticket.id}/hide-comments`, { method: "PATCH", credentials: "include" });
      queryClient.invalidateQueries();
    } catch {}
    handleClose();
  };

  // Toggle this ticket in the user's pinned-cover list. Limit is enforced by
  // the API (drops anything past 6) so we mirror the cap in the UI to avoid
  // sending extra IDs that would silently get dropped.
  const handleTogglePin = async () => {
    if (pinnedIds == null || pinning) return;
    const nextIds = isPinned
      ? pinnedIds.filter((id) => id !== ticket.id)
      : [ticket.id, ...pinnedIds].slice(0, PIN_LIMIT);
    setPinning(true);
    try {
      const res = await fetch("/api/users/me/pinned", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketIds: nextIds }),
      });
      if (res.ok) {
        // Local state updates immediately; profile pages refetch on focus so
        // the cover mosaic refreshes without a manual reload.
        setPinnedIds(nextIds);
        if (me?.username) {
          queryClient.invalidateQueries({ queryKey: [`/api/users/${me.username}`] });
        }
      }
    } catch { /* swallow — silent failure is fine, user can retry */ }
    setPinning(false);
    handleClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={cn(
          "relative w-full bg-background rounded-t-3xl transition-transform duration-300 ease-out",
          visible ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.18)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Pill handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Movie label */}
        <div className="px-5 pt-3 pb-3 border-b border-border/60">
          <p className="font-bold text-base text-foreground truncate">{ticket.movieTitle}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{displayYear(ticket.movieYear, lang)}</p>
        </div>

        {confirmDelete ? (
          /* ── Confirm delete state ── */
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
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-3 rounded-2xl bg-secondary text-sm font-semibold text-foreground transition-colors active:bg-secondary/70"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-2xl bg-foreground text-sm font-semibold text-background transition-colors active:bg-foreground/80 disabled:opacity-60"
              >
                {deleting ? t.deletingLabel : t.confirmDeleteLabel}
              </button>
            </div>
          </div>
        ) : (
          /* ── Normal menu ── */
          <div className="py-2">
            {isOwner && pinnedIds != null && (
              <button
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors disabled:opacity-60"
                onClick={handleTogglePin}
                disabled={pinning}
              >
                <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                  {isPinned
                    ? <PinOff className="w-4 h-4 text-muted-foreground" />
                    : <Pin className="w-4 h-4 text-muted-foreground" />}
                </div>
                <span>
                  {isPinned
                    ? (lang === "th" ? "ยกเลิกการปักหมุดบนโปรไฟล์" : "Unpin from profile cover")
                    : (lang === "th" ? "ปักหมุดบนโปรไฟล์" : "Pin to profile cover")}
                </span>
              </button>
            )}
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={() => {
                // Pre-seed ticket cache → edit-ticket shows instantly with no spinner
                queryClient.setQueryData([`/api/tickets/${ticket.id}`], (old: any) => old ?? ticket);
                // Store back path so edit-ticket can navigate() back (no reload indicator)
                sessionStorage.setItem("ticker:edit-ticket-back", window.location.pathname + window.location.search);
                handleClose();
                setTimeout(() => navigate(`/ticket/${ticket.id}/edit`), 200);
              }}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{t.editPost}</span>
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleTogglePrivate}
            >
              {ticket.isPrivate ? (
                <>
                  <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                    <Unlock className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span>{t.makePublic}</span>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span>{t.setPrivate}</span>
                </>
              )}
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleToggleHideLikes}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Star className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{((ticket as any)?.hideLikes) ? t.showLikes : t.hideLikes}</span>
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleToggleHideComments}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{((ticket as any)?.hideComments) ? t.enableComments : t.disableComments}</span>
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleDelete}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{t.moveToTrash}</span>
            </button>
            <div className="mx-5 my-2 h-px bg-border/60" />
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
              onClick={handleClose}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{t.cancelBtn}</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Caption block with "อ่านเพิ่มเติม" ─────────────────────────────
function CaptionBlock({ text, isLong, alignClass }: { text: string; isLong: boolean; alignClass: string }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={cn("px-4 mt-3", alignClass)}>
      <p className={cn("text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words", !expanded && isLong && "line-clamp-3")}
         style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
        {text}
      </p>
      {isLong && (
        <button onClick={() => setExpanded(v => !v)}
          className="mt-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
          {expanded ? t.collapse : t.readMore}
        </button>
      )}
    </div>
  );
}




// ── Main Export ───────────────────────────────────────────────────
export function TicketCard({ ticket, compact = false, onLongPress, viewHref, noMenu = false }: TicketCardProps) {
  const [contextTicket, setContextTicket] = useState<Ticket | null>(null);

  const handleLongPress = noMenu ? undefined : (t: Ticket) => {
    setContextTicket(t);
    onLongPress?.(t);
  };

  return (
    <>
      {compact
        ? <CompactCard ticket={ticket} onLongPress={handleLongPress} viewHref={viewHref} />
        : <FeedCard ticket={ticket} onLongPress={handleLongPress} />
      }
      {!noMenu && contextTicket && (
        <CardContextMenu ticket={contextTicket} onClose={() => setContextTicket(null)} />
      )}
    </>
  );
}
