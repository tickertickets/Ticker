import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { ChevronLeft, Trash2, RotateCcw, X, Loader2, LogOut, Film, Lock, MessageSquare, Heart, Link2, Moon, Ticket, ChevronRight, Star, Eye, EyeOff, Sparkles, TrendingUp, Users, Bell, Shield, Clock, Info } from "lucide-react";
import { isPushSupported, getPushStatus, enablePushNotifications, disablePushNotifications, hasLocalSubscription, describePushError } from "@/lib/push";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { ReportSheet } from "@/components/ReportSheet";
import { getTheme, setTheme } from "@/lib/theme";
import { BadgeIconStatic } from "@/components/BadgeIcon";
import { PopcornBadgeIcon } from "@/components/PopcornBadge";
import { scrollStore } from "@/lib/scroll-store";
import { useLang } from "@/lib/i18n";
import { Languages } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivityTicketLike = {
  id: string;
  ticketId: string;
  movieTitle: string;
  posterUrl?: string | null;
  rankTier?: string | null;
  createdAt: string;
};

type ActivityTicketComment = {
  id: string;
  ticketId: string;
  movieTitle: string;
  posterUrl?: string | null;
  rankTier?: string | null;
  content: string;
  createdAt: string;
};

type ActivityChainLike = {
  id: string;
  chainId: string;
  chainTitle: string;
  posterUrl?: string | null;
  createdAt: string;
};

type ActivityChainComment = {
  id: string;
  chainId: string;
  chainTitle: string;
  posterUrl?: string | null;
  content: string;
  createdAt: string;
};

type ActivityOwnTicket = {
  id: string;
  ticketId: string;
  movieTitle: string;
  posterUrl?: string | null;
  rankTier?: string | null;
  createdAt: string;
};

type ActivitiesData = {
  ticketLikes: ActivityTicketLike[];
  ticketComments: ActivityTicketComment[];
  chainLikes: ActivityChainLike[];
  chainComments: ActivityChainComment[];
  ownTickets: ActivityOwnTicket[];
};

type TrashedTicket = {
  id: number;
  movieTitle: string;
  posterUrl?: string | null;
  rankTier?: string | null;
  deletedAt: string;
  tmdbSnapshot?: { tmdbRating?: number } | null;
};

type TrashedChain = {
  id: string;
  title: string;
  movieCount: number;
  movies: { posterUrl?: string | null }[];
  deletedAt: string;
};

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchTrash(): Promise<{ tickets: TrashedTicket[] }> {
  const res = await fetch("/api/tickets/trash/list", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch trash");
  return res.json();
}

async function restoreTicket(ticketId: number) {
  const res = await fetch(`/api/tickets/trash/${ticketId}/restore`, {
    method: "POST", credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to restore");
  }
  return res.json();
}

async function purgeTicket(ticketId: number) {
  const res = await fetch(`/api/tickets/trash/${ticketId}/purge`, {
    method: "DELETE", credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to purge");
  return res.json();
}

async function fetchActivities(): Promise<ActivitiesData> {
  const res = await fetch("/api/users/me/activities", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch activities");
  return res.json();
}

async function fetchChainTrash(): Promise<{ chains: TrashedChain[] }> {
  const res = await fetch("/api/chains/trash/list", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch chain trash");
  return res.json();
}

async function restoreChain(chainId: string) {
  const res = await fetch(`/api/chains/trash/${chainId}/restore`, {
    method: "POST", credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to restore");
  return res.json();
}

async function purgeChain(chainId: string) {
  const res = await fetch(`/api/chains/trash/${chainId}/purge`, {
    method: "DELETE", credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to purge");
  return res.json();
}

// ── Days remaining helper ─────────────────────────────────────────────────────

function daysRemaining(deletedAt: string) {
  const deleted = new Date(deletedAt).getTime();
  const now = Date.now();
  const elapsed = (now - deleted) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(30 - elapsed));
}

// ── Trash Item ────────────────────────────────────────────────────────────────

function TrashItem({ ticket, onRestore, onPurge }: {
  ticket: TrashedTicket;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const days = daysRemaining(ticket.deletedAt);
  const { t } = useLang();

  return (
    <div className="flex items-center gap-3 bg-secondary rounded-2xl p-3 border border-border">
      <div className="relative w-10 h-14 rounded-xl overflow-hidden bg-zinc-900 flex-shrink-0 border border-border">
        {ticket.posterUrl ? (
          <img src={ticket.posterUrl} alt={ticket.movieTitle} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-foreground leading-tight line-clamp-1">
          {ticket.movieTitle}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {days > 0 ? t.deletePermanentlyIn(days) : t.willDeleteSoon}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button
          onClick={onRestore}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-secondary border border-border text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {t.restore}
        </button>
        <button
          onClick={onPurge}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-secondary border border-border text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          {t.purge}
        </button>
      </div>
    </div>
  );
}

// ── Chain Trash Item ──────────────────────────────────────────────────────────

function ChainTrashItem({ chain, onRestore, onPurge }: {
  chain: TrashedChain;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const days = daysRemaining(chain.deletedAt);
  const poster = chain.movies[0]?.posterUrl;
  const { t } = useLang();

  return (
    <div className="flex items-center gap-3 bg-secondary rounded-2xl p-3 border border-border">
      <div className="relative w-10 h-14 rounded-xl overflow-hidden bg-zinc-900 flex-shrink-0 border border-border">
        {poster ? (
          <img src={poster} alt={chain.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Link2 className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-foreground leading-tight line-clamp-1">{chain.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t.moviesCount(chain.movieCount)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {days > 0 ? t.deletePermanentlyIn(days) : t.willDeleteSoon}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button
          onClick={onRestore}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-secondary border border-border text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {t.restore}
        </button>
        <button
          onClick={onPurge}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-secondary border border-border text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          {t.purge}
        </button>
      </div>
    </div>
  );
}

// ── Badge Section Component ──────────────────────────────────────────────────

const BADGE_COLORS: Record<number, string> = {
  1: "#9CA3AF",
  2: "#cd7f32",
  3: "#43a047",
  4: "#e91e8c",
  5: "#9c27b0",
};

const BADGE_GRADIENTS: Record<number, string> = {
  1: "linear-gradient(135deg, #D1D5DB 0%, #9CA3AF 50%, #6B7280 100%)",
  2: "linear-gradient(135deg, #f5c87a 0%, #cd7f32 50%, #8b4513 100%)",
  3: "linear-gradient(135deg, #a5d6a7 0%, #43a047 50%, #1b5e20 100%)",
  4: "linear-gradient(135deg, #fbb8df 0%, #e91e8c 50%, #880e4f 100%)",
  5: "linear-gradient(135deg, #e1bee7 0%, #9c27b0 50%, #4a148c 100%)",
};

const BADGE_NAMES: Record<number, { en: string; th: string; desc: string }> = {
  0: { en: "ยังไม่มี Badge", th: "", desc: "" },
  1: { en: "Viewer", th: "คนดูหนัง", desc: "ก้าวแรกสู่โลกหนัง" },
  2: { en: "Fan", th: "แฟนหนัง", desc: "ติดตามหนังไม่พลาด" },
  3: { en: "Cinephile", th: "ซีเนฟิล", desc: "หลงรักศิลปะภาพยนตร์" },
  4: { en: "Critic", th: "นักวิจารณ์", desc: "เสียงที่เชื่อถือได้" },
  5: { en: "For Supporter", th: "ผู้สนับสนุน", desc: "สำหรับผู้สนับสนุน Ticker" },
};

type BadgeData = {
  level: number;
  isSupporterApproved?: boolean;
  xpCurrent: number;
  xpFromPosts: number;
  xpFromTags: number;
  xpFromParty: number;
  xpRequired: number;
  progress: number;
  canEvolve: boolean;
  atMaxLevel: boolean;
  claimed: boolean;
  badgeHidden: boolean;
  pageBadgeHidden?: boolean;
  isPageVerified?: boolean;
  displayLevel: number | null;
  meta: { name: string; nameTH: string; color: string; gradient: string } | null;
  rules: {
    xpRequired: number;
    sources: { action: string; label: string; xpPerAction: number; dailyCap: number }[];
  };
} | null;

function BadgeSection({
  badge,
  loading,
  onClaim,
  onEvolve,
  onSetDisplay,
  claiming,
  evolving,
  settingDisplay,
  claimError,
  evolveError,
  onRequestSupporter,
  supporterStatus,
  onRequestPageVerify,
  pageVerifyStatus,
  isPageVerified,
  onTogglePageBadge,
  togglingPageBadge,
}: {
  badge: BadgeData;
  loading: boolean;
  onClaim: () => void;
  onEvolve: () => void;
  onSetDisplay: (level: number) => void;
  claiming: boolean;
  evolving: boolean;
  settingDisplay: boolean;
  claimError: string | null;
  evolveError: string | null;
  onRequestSupporter: () => void;
  supporterStatus: "pending" | "approved" | "rejected" | null;
  onRequestPageVerify: () => void;
  pageVerifyStatus: "pending" | "approved" | "rejected" | null;
  isPageVerified: boolean;
  onTogglePageBadge: () => void;
  togglingPageBadge: boolean;
}) {
  const { t } = useLang();
  const level = badge?.level ?? 0;
  const isSupporterApproved = badge?.isSupporterApproved ?? false;
  const claimed = badge?.claimed ?? false;

  // ── Which ticket level is visibly ON ──────────────────────────────────────
  // Server returns displayLevel: number|null
  //   null  → never been set; default = show at earned/supporter max
  //   0     → explicitly hidden
  //   1-5   → explicitly showing that level
  // We mirror the same logic the server uses in GET /badges/user/:id.
  const serverDisplayLevel = badge?.displayLevel ?? null;
  const badgeHiddenRaw = badge?.badgeHidden ?? false;
  const openTicketLevel: number =
    serverDisplayLevel !== null
      ? serverDisplayLevel
      : badgeHiddenRaw
      ? 0
      : isSupporterApproved
      ? 5
      : level;

  // Popcorn is ON when page-verified AND pageBadgeHidden is false
  const popcornOpen = isPageVerified && !(badge?.pageBadgeHidden ?? true);

  // Track if activeDot was restored from sessionStorage — prevents useEffect from overriding it
  const restoredFromSession = useRef(false);

  const [activeDot, setActiveDot] = useState(() => {
    const saved = sessionStorage.getItem("badge_tab");
    if (saved !== null) {
      sessionStorage.removeItem("badge_tab");
      restoredFromSession.current = true;
      return parseInt(saved, 10);
    }
    // On fresh mount badge is still loading, so default = 0; useEffect will correct once loaded
    return 0;
  });
  // One-shot guard: only auto-jump to the active badge on the FIRST load of
  // badge data per Settings mount.  After that, respect wherever the user
  // swiped to (so a popcorn ON → ticket-tab swipe doesn't yank back).
  const initialJumped = useRef(false);
  const [showXpHint, setShowXpHint] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const xpCurrent = badge?.xpCurrent ?? 0;
  const xpRequired = badge?.xpRequired ?? 100;
  const progress = badge?.progress ?? 0;
  const canEvolve = badge?.canEvolve ?? false;
  const atMaxLevel = badge?.atMaxLevel ?? false;
  const badgeHidden = badgeHiddenRaw;

  const postXP = badge?.xpFromPosts ?? 0;
  const tagXP = badge?.xpFromTags ?? 0;
  const partyXP = badge?.xpFromParty ?? 0;

  // On first load of badge data, jump to whichever badge the user has active.
  // Priority:  popcorn (page-verified & shown)  →  chosen Lv displayLevel
  //         →  supporter Lv5  →  highest earned Lv  →  default 0
  // This runs ONCE per mount; after that the user's swipes are respected so
  // toggling visibility never yanks the carousel.
  useEffect(() => {
    if (restoredFromSession.current) {
      restoredFromSession.current = false;
      initialJumped.current = true;
      return;
    }
    if (initialJumped.current) return;
    if (badge == null) return; // wait for first fetch

    if (popcornOpen) {
      setActiveDot(5);
    } else if (claimed && level > 0) {
      if (serverDisplayLevel != null && serverDisplayLevel > 0) {
        setActiveDot(serverDisplayLevel - 1);
      } else if (isSupporterApproved) {
        setActiveDot(4);
      } else {
        setActiveDot(level - 1);
      }
    }
    initialJumped.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badge]);

  const SWIPE_THRESHOLD = 35;
  const MAX_DOT = 5; // 0..4 = Lv1..Lv5, 5 = Popcorn

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    setActiveDot(prev => Math.max(0, Math.min(MAX_DOT, prev + (dx < 0 ? 1 : -1))));
  };

  if (loading) {
    return (
      <div className="bg-secondary rounded-2xl p-4 border border-border flex items-center justify-center min-h-[420px]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* ── Section header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="font-bold text-sm text-foreground leading-tight">{t.badgeCollectionTitle}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {activeDot === 5 ? t.badgeCollectionDescPopcorn : t.badgeCollectionDesc}
            </p>
          </div>
        </div>
        {(() => {
          const isPopcorn = activeDot === 5;
          if (isPopcorn) return null;
          const dotLvl = activeDot + 1;
          const dotCol = BADGE_COLORS[dotLvl] ?? "#6B7280";
          return (
            <div
              className="text-[11px] font-black px-2 py-0.5 rounded-full transition-all duration-300"
              style={{ background: `${dotCol}22`, color: dotCol }}
            >
              {`Lv ${dotLvl} / 5`}
            </div>
          );
        })()}
      </div>

      {/* ── Carousel ───────────────────────────────────────────── */}
      <div
        className="overflow-hidden pb-3"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${activeDot * 100}%)` }}
        >
        {[1, 2, 3, 4, 5].map((lvl) => {
          const col = BADGE_COLORS[lvl] ?? "#6B7280";
          const grad = BADGE_GRADIENTS[lvl] ?? `linear-gradient(135deg, ${col}80, ${col})`;
          const names = t.badgeNames[lvl] ?? { name: "", desc: "" };
          const isSupporter = lvl === 5;
          const isLv5Supporter = isSupporter && isSupporterApproved;
          const isStart = !claimed && lvl === 1;
          const isCurrent = claimed && lvl === level && !isSupporter;
          const isEarned = claimed && lvl < level && !isSupporter;
          const isLocked = !isStart && !isCurrent && !isEarned && !isLv5Supporter;

          let statusLabel = "";
          let statusColor = "";
          if (isLv5Supporter) { statusLabel = t.myLevel; statusColor = col; }
          else if (isStart) { statusLabel = t.levelStart; statusColor = col; }
          else if (isCurrent) { statusLabel = t.myLevel; statusColor = col; }
          else if (isEarned) { statusLabel = t.levelEarned; statusColor = "#22c55e"; }
          else { statusLabel = t.levelLocked; statusColor = "#6b7280"; }

          const isActive = isCurrent || isStart || isLv5Supporter;

          return (
            <div
              key={lvl}
              className="flex-shrink-0 rounded-2xl overflow-hidden flex flex-col"
              style={{
                width: "100%",
                border: `1.5px solid ${isActive ? col + "70" : isEarned ? col + "50" : col + "28"}`,
                background: isActive
                  ? `linear-gradient(160deg, var(--secondary) 0%, ${col}18 100%)`
                  : isEarned
                  ? `linear-gradient(160deg, var(--secondary) 0%, ${col}0a 100%)`
                  : "var(--secondary)",
                boxShadow: isActive ? `0 0 20px ${col}25, 0 2px 8px rgba(0,0,0,0.15)` : "0 1px 4px rgba(0,0,0,0.10)",
              }}
            >
              <div className="p-4 flex flex-col flex-1">
                {/* ── Status row ── fixed 24px */}
                <div className="flex items-center justify-between" style={{ height: 24, marginBottom: 14, overflow: "hidden" }}>
                  <span
                    className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${statusColor}20`, color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {[...Array(lvl)].map((_, i) => (
                      <Star
                        key={i}
                        className="w-2.5 h-2.5 fill-current"
                        style={{ color: col, opacity: isLocked ? 0.45 : 1 }}
                      />
                    ))}
                  </div>
                </div>

                {/* ── Badge icon ── fixed 84px */}
                <div className="flex justify-center items-center flex-shrink-0" style={{ height: 84, marginBottom: 10 }}>
                  <div
                    style={{
                      transform: "rotate(-14deg)",
                      filter: openTicketLevel === lvl
                        ? `drop-shadow(0 0 8px ${col}80)`
                        : "none",
                      opacity: isLocked ? 0.55 : 1,
                      transition: "filter 0.3s, opacity 0.3s",
                    }}
                  >
                    <BadgeIconStatic level={lvl} size={68} flat={false} />
                  </div>
                </div>

                {/* ── Name ── fixed 40px, text anchored to top */}
                <div className="flex flex-col items-center justify-start flex-shrink-0" style={{ height: 40, marginBottom: 12, overflow: "hidden" }}>
                  <p
                    className="font-black text-base leading-tight"
                    style={{ color: col, opacity: isLocked ? 0.55 : 1 }}
                  >
                    {names.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight" style={{ opacity: isLocked ? 0.45 : 1 }}>
                    {names.desc}
                  </p>
                </div>

                {/* ── Bottom action area ── fills rest */}
                <div className="flex flex-col gap-2 mt-auto">

                  {/* Current level */}
                  {isCurrent && claimed && (
                    <>
                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {atMaxLevel ? t.maxLevel : t.nextLevel(level + 1)}
                          </span>
                          <span className="text-[10px] font-bold" style={{ color: col }}>
                            {atMaxLevel ? t.maxXp : `${xpCurrent} / ${xpRequired} XP`}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-black/20 dark:bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${progress}%`, background: grad }}
                          />
                        </div>
                      </div>

                      {/* XP sources */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="rounded-lg p-1.5 text-center" style={{ background: "rgba(59,130,246,0.12)" }}>
                          <TrendingUp className="w-3 h-3 mx-auto mb-0.5 text-blue-400" />
                          <p className="text-[10px] font-bold text-blue-400">{postXP}</p>
                          <p className="text-[9px] text-muted-foreground">{t.xpPosts}</p>
                        </div>
                        <div className="rounded-lg p-1.5 text-center" style={{ background: "rgba(168,85,247,0.12)" }}>
                          <Users className="w-3 h-3 mx-auto mb-0.5 text-purple-400" />
                          <p className="text-[10px] font-bold text-purple-400">{tagXP}</p>
                          <p className="text-[9px] text-muted-foreground">Tag</p>
                        </div>
                        <div className="rounded-lg p-1.5 text-center" style={{ background: "rgba(245,158,11,0.12)" }}>
                          <Star className="w-3 h-3 mx-auto mb-0.5 text-amber-400" />
                          <p className="text-[10px] font-bold text-amber-400">{partyXP}</p>
                          <p className="text-[9px] text-muted-foreground">{t.xpParty}</p>
                        </div>
                      </div>

                      {/* Evolve / XP needed */}
                      {!atMaxLevel && (
                        <div className="space-y-1.5">
                          {evolveError && <p className="text-[10px] text-red-500 text-center">{evolveError}</p>}
                          {canEvolve ? (
                            <button
                              onClick={onEvolve}
                              disabled={evolving}
                              className="w-full h-9 rounded-xl font-bold text-xs text-white hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                              style={{ background: BADGE_GRADIENTS[level + 1] ?? grad }}
                            >
                              {evolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              {evolving ? t.evolvingBadge : t.evolveBtn(t.badgeNames[level + 1]?.name ?? "")}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => setShowXpHint(v => !v)}
                                className="w-full h-9 rounded-xl font-bold text-xs text-muted-foreground bg-secondary border border-border hover:border-foreground/30 transition-all active:scale-95 flex items-center justify-center"
                              >
                                {t.xpNeeded(xpRequired)}
                              </button>
                              {showXpHint && (
                                <div className="rounded-xl p-3 space-y-1.5" style={{ background: `${col}12` }}>
                                  <p className="text-[10px] font-bold text-center mb-2" style={{ color: col }}>{t.howToEarnXP}</p>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3 text-blue-400" />{t.xpPosts}</span>
                                    <span className="font-bold text-blue-400">{t.xpPerPost}</span>
                                  </div>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3 text-purple-400" />Tag</span>
                                    <span className="font-bold text-purple-400">{t.xpPerTag}</span>
                                  </div>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-muted-foreground flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />{t.xpParty}</span>
                                    <span className="font-bold text-amber-400">{t.xpPerParty}</span>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {atMaxLevel && (
                        <div className="flex items-center justify-center gap-1 py-1">
                          {[1,2,3,4,5].map((i) => <Star key={i} className="w-2.5 h-2.5 fill-current" style={{ color: BADGE_COLORS[i] }} />)}
                        </div>
                      )}

                      {/* Visibility toggle — icon only, show on current level */}
                      {(() => {
                        const isOn = openTicketLevel === lvl;
                        return (
                          <button
                            onClick={() => onSetDisplay(isOn ? 0 : lvl)}
                            disabled={settingDisplay}
                            className="flex items-center justify-center mx-auto w-9 h-9 rounded-full transition-all active:scale-95 mt-1"
                            style={{ background: isOn ? `${col}22` : "rgba(128,128,128,0.12)" }}
                          >
                            {settingDisplay ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : isOn ? (
                              <Eye className="w-4 h-4" style={{ color: col }} />
                            ) : (
                              <EyeOff className="w-4 h-4 text-muted-foreground opacity-60" />
                            )}
                          </button>
                        );
                      })()}
                    </>
                  )}

                  {/* Not claimed Lv1 */}
                  {isStart && !claimed && (
                    <>
                      <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                        {t.collectXpDesc}
                      </p>
                      {claimError && <p className="text-[10px] text-red-500 text-center">{claimError}</p>}
                      <button
                        onClick={onClaim}
                        disabled={claiming}
                        className="w-full h-9 rounded-xl font-bold text-xs text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        style={{ background: grad }}
                      >
                        {claiming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ticket className="w-3.5 h-3.5" />}
                        {claiming ? t.claimingBadge : t.claimBadgeBtn}
                      </button>
                    </>
                  )}

                  {/* Earned (past levels) — show eye toggle */}
                  {isEarned && (
                    <>
                      <div className="flex items-center justify-center gap-1.5 py-1">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#22c55e18" }}>
                          <Star className="w-3 h-3 fill-current text-green-500" />
                        </div>
                        <span className="text-[11px] text-green-500 font-semibold">{t.earnedBadge}</span>
                      </div>
                      {(() => {
                        const isOn = openTicketLevel === lvl;
                        return (
                          <button
                            onClick={() => onSetDisplay(isOn ? 0 : lvl)}
                            disabled={settingDisplay}
                            className="flex items-center justify-center mx-auto w-9 h-9 rounded-full transition-all active:scale-95"
                            style={{ background: isOn ? `${col}22` : "rgba(128,128,128,0.12)" }}
                          >
                            {settingDisplay ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : isOn ? (
                              <Eye className="w-4 h-4" style={{ color: col }} />
                            ) : (
                              <EyeOff className="w-4 h-4 text-muted-foreground opacity-60" />
                            )}
                          </button>
                        );
                      })()}
                    </>
                  )}

                  {/* Locked — show target XP (not for supporter tier) */}
                  {isLocked && !isSupporter && (
                    <p className="text-[10px] text-muted-foreground text-center opacity-50">
                      {t.xpNeededTotal((lvl - 1) * 100)}
                    </p>
                  )}

                  {/* Supporter Lv5 — current Legend */}
                  {isLv5Supporter && (
                    <>
                      <div className="flex items-center justify-center gap-1.5 py-0.5">
                        <p className="text-[11px] font-semibold text-center" style={{ color: col }}>
                          {t.supportThanks}
                        </p>
                      </div>
                      {(() => {
                        const isOn = openTicketLevel === lvl;
                        return (
                          <button
                            onClick={() => onSetDisplay(isOn ? 0 : lvl)}
                            disabled={settingDisplay}
                            className="flex items-center justify-center mx-auto w-9 h-9 rounded-full transition-all active:scale-95 mt-1"
                            style={{ background: isOn ? `${col}22` : "rgba(128,128,128,0.12)" }}
                          >
                            {settingDisplay ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : isOn ? (
                              <Eye className="w-4 h-4" style={{ color: col }} />
                            ) : (
                              <EyeOff className="w-4 h-4 text-muted-foreground opacity-60" />
                            )}
                          </button>
                        );
                      })()}
                    </>
                  )}

                  {/* Supporter Lv5 — not yet Legend */}
                  {isSupporter && !isLv5Supporter && (
                    <div className="flex flex-col gap-2">
                      {supporterStatus === "pending" ? (
                        <div className="rounded-xl p-2.5 text-center" style={{ background: `${col}12`, border: `1px solid ${col}30` }}>
                          <p className="text-[10px] font-bold" style={{ color: col }}>{t.pendingReview}</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">{t.pendingReviewDesc}</p>
                        </div>
                      ) : (
                        <button
                          onClick={onRequestSupporter}
                          className="w-full h-9 rounded-xl font-bold text-xs text-white hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                          style={{ background: grad }}
                        >
                          {t.supportTicker}
                        </button>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </div>
          );
        })}

        {/* ── Popcorn Bucket — Page Verification card (idx 5) ── */}
        {(() => {
          const col = "#ef4444";
          const grad = "linear-gradient(135deg, #f59e0b, #ef4444)";
          const isActive = isPageVerified || pageVerifyStatus === "approved";
          const isPending = pageVerifyStatus === "pending" && !isActive;
          const isRejected = pageVerifyStatus === "rejected" && !isActive;

          let statusLabel = "";
          let statusColor = "";
          if (isActive) { statusLabel = t.myLevel; statusColor = col; }
          else if (isPending) { statusLabel = t.pendingReview; statusColor = "#f59e0b"; }
          else if (isRejected) { statusLabel = t.levelLocked; statusColor = "#6b7280"; }
          else { statusLabel = t.levelLocked; statusColor = "#6b7280"; }

          return (
            <div
              key="popcorn"
              className="flex-shrink-0 rounded-2xl overflow-hidden flex flex-col"
              style={{
                width: "100%",
                border: `1.5px solid ${isActive ? col + "70" : col + "28"}`,
                background: isActive
                  ? `linear-gradient(160deg, var(--secondary) 0%, ${col}18 100%)`
                  : "var(--secondary)",
                boxShadow: isActive ? `0 0 20px ${col}25, 0 2px 8px rgba(0,0,0,0.15)` : "0 1px 4px rgba(0,0,0,0.10)",
              }}
            >
              <div className="p-4 flex flex-col flex-1">
                {/* Status row */}
                <div className="flex items-center justify-between" style={{ height: 24, marginBottom: 14, overflow: "hidden" }}>
                  <span
                    className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${statusColor}20`, color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Badge icon — large popcorn tilted to the right */}
                <div className="flex justify-center items-center flex-shrink-0" style={{ height: 84, marginBottom: 10 }}>
                  <div
                    style={{
                      transform: "rotate(28deg)",
                      filter: popcornOpen ? `drop-shadow(0 0 8px ${col}80)` : "none",
                      opacity: isActive ? 1 : 0.6,
                      transition: "filter 0.3s, opacity 0.3s",
                    }}
                  >
                    <PopcornBadgeIcon size={84} flat={false} />
                  </div>
                </div>

                {/* Name */}
                <div className="flex flex-col items-center justify-start flex-shrink-0" style={{ height: 40, marginBottom: 12, overflow: "hidden" }}>
                  <p className="font-black text-base leading-tight" style={{ color: col, opacity: isActive ? 1 : 0.7 }}>
                    {t.popcornBadgeName}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {t.popcornBadgeDesc}
                  </p>
                </div>

                {/* Bottom action */}
                <div className="flex flex-col gap-2 mt-auto">
                  {isActive && (
                    <>
                      <div className="flex items-center justify-center gap-1.5 py-0.5">
                        <p className="text-[11px] font-semibold text-center" style={{ color: col }}>
                          {t.popcornApprovedDesc}
                        </p>
                      </div>
                      <button
                        onClick={onTogglePageBadge}
                        disabled={togglingPageBadge}
                        className="flex items-center justify-center mx-auto w-9 h-9 rounded-full transition-all active:scale-95 mt-1"
                        style={{ background: popcornOpen ? `${col}22` : "rgba(128,128,128,0.12)" }}
                      >
                        {togglingPageBadge ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : popcornOpen ? (
                          <Eye className="w-4 h-4" style={{ color: col }} />
                        ) : (
                          <EyeOff className="w-4 h-4 text-muted-foreground opacity-60" />
                        )}
                      </button>
                    </>
                  )}
                  {isPending && (
                    <div className="rounded-xl p-2.5 text-center" style={{ background: `${col}12`, border: `1px solid ${col}30` }}>
                      <p className="text-[10px] font-bold" style={{ color: col }}>{t.pendingReview}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{t.popcornPendingDesc}</p>
                    </div>
                  )}
                  {isRejected && (
                    <p className="text-[10px] text-red-500 text-center leading-relaxed">
                      {t.popcornRejectedDesc}
                    </p>
                  )}
                  {!isActive && !isPending && (
                    <button
                      onClick={onRequestPageVerify}
                      className="w-full h-9 rounded-xl font-bold text-xs text-white hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                      style={{ background: grad }}
                    >
                      {t.popcornSettingsLabel}
                    </button>
                  )}
                  {isRejected && (
                    <button
                      onClick={onRequestPageVerify}
                      className="w-full h-9 rounded-xl font-bold text-xs text-white hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                      style={{ background: grad }}
                    >
                      {t.popcornSettingsLabel}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        </div>
      </div>

      {/* ── Pagination indicator ── */}
      <div className="flex justify-center pt-1">
        {/* Desktop: prev/next buttons + dot */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => setActiveDot(prev => Math.max(0, prev - 1))}
            disabled={activeDot === 0}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-30 hover:bg-secondary active:scale-95"
          >
            <ChevronLeft className="w-4 h-4 text-foreground" />
          </button>
          <div
            className="rounded-full transition-colors duration-300"
            style={{
              width: 28,
              height: 4,
              background: activeDot === 5 ? "#ef4444" : (BADGE_COLORS[activeDot + 1] ?? "#6B7280"),
            }}
          />
          <button
            onClick={() => setActiveDot(prev => Math.min(MAX_DOT, prev + 1))}
            disabled={activeDot === MAX_DOT}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-30 hover:bg-secondary active:scale-95"
          >
            <ChevronRight className="w-4 h-4 text-foreground" />
          </button>
        </div>
        {/* Mobile: dot only */}
        <div className="md:hidden">
          <div
            className="rounded-full transition-colors duration-300"
            style={{
              width: 28,
              height: 4,
              background: activeDot === 5 ? "#ef4444" : (BADGE_COLORS[activeDot + 1] ?? "#6B7280"),
            }}
          />
        </div>
      </div>
    </div>
  );
}


// ── Page ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  // Always reset scroll to top when entering this page
  useEffect(() => {
    scrollStore.delete("settings");
  }, []);

  const [location, navigate] = useLocation();
  const { t, lang, setLang } = useLang();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const initialSection = (() => {
    const saved = sessionStorage.getItem("ticker:settings_section");
    if (saved === "trash" || saved === "activities") {
      sessionStorage.removeItem("ticker:settings_section");
      return saved;
    }
    return "main";
  })();
  const [activeSection, setActiveSection] = useState<"main" | "trash" | "activities">(initialSection as "main" | "trash" | "activities");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean>(() => !!(user as unknown as Record<string,unknown>)?.["isPrivate"]);
  const [savingPrivate, setSavingPrivate] = useState(false);
  const [isDark, setIsDark] = useState(() => getTheme(user?.id) === "dark");

  const handleThemeToggle = () => {
    const next = !isDark;
    setIsDark(next);
    setTheme(next ? "dark" : "light", true, user?.id);
  };

  // Sync isDark toggle when user ID becomes known (e.g. page load before auth resolves)
  useEffect(() => {
    if (user?.id) setIsDark(getTheme(user.id) === "dark");
  }, [user?.id]);

  // Sync local isPrivate state whenever the auth user refreshes
  // Guard with !savingPrivate so an in-flight save's optimistic state isn't overwritten
  useEffect(() => {
    if (user && !savingPrivate) setIsPrivate(!!user.isPrivate);
  }, [user?.isPrivate, savingPrivate]);

  const [contactOpen, setContactOpen] = useState(false);
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [purgeDialog, setPurgeDialog] = useState<
    { type: "ticket"; id: number } | { type: "chain"; id: string } | null
  >(null);

  // Push notifications
  const [pushSupported] = useState<boolean>(() => isPushSupported());
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    () => (typeof Notification !== "undefined" ? Notification.permission : "unsupported")
  );
  useEffect(() => {
    if (!pushSupported || !user) return;
    let cancelled = false;
    // Fast local check first (no network)
    hasLocalSubscription().then(local => {
      if (cancelled) return;
      setPushEnabled(local);
      // Then reconcile with server
      getPushStatus().then(s => { if (!cancelled) setPushEnabled(s.enabled); });
    });
    return () => { cancelled = true; };
  }, [pushSupported, user?.id]);

  const handlePushToggle = async () => {
    if (pushBusy) return;
    const next = !pushEnabled;
    // Optimistic UI — flip immediately so the toggle feels responsive
    setPushEnabled(next);
    setPushBusy(true);
    try {
      if (!next) {
        await disablePushNotifications();
      } else {
        const r = await enablePushNotifications();
        if (!r.ok) {
          setPushEnabled(false);
          alert(describePushError(r.reason, lang));
        }
      }
    } finally {
      // Refresh permission state in case the user just allowed/denied via
      // the browser/OS prompt — surfaces the denied helper immediately.
      if (typeof Notification !== "undefined") setPushPermission(Notification.permission);
      setPushBusy(false);
    }
  };

  // Admin status
  const { data: adminInfo } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["admin-whoami"],
    queryFn: () => fetch("/api/admin/whoami", { credentials: "include" }).then(r => r.ok ? r.json() : { isAdmin: false }),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const isAdmin = !!adminInfo?.isAdmin;

  const handlePrivateToggle = () => {
    setPrivacyDialogOpen(true);
  };

  const handlePrivacyConfirm = async () => {
    if (savingPrivate || !user) return;
    const newVal = !isPrivate;
    setPrivacyDialogOpen(false);
    setIsPrivate(newVal);
    setSavingPrivate(true);
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: newVal }),
      });
      if (!res.ok) throw new Error("Failed to update privacy");
      // Update localStorage cache immediately so next render uses correct value
      try {
        const cached = localStorage.getItem("_usr");
        if (cached) {
          const parsed = JSON.parse(cached);
          parsed.isPrivate = newVal;
          localStorage.setItem("_usr", JSON.stringify(parsed));
        }
      } catch { /* non-fatal */ }
      // Invalidate the auth session query (used by useGetMe / useAuth)
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Also invalidate profile and chain-related caches so feeds update
      queryClient.invalidateQueries({ queryKey: [`/api/users/${user.username}`] });
      queryClient.invalidateQueries({ queryKey: ["profile-chains-created"] });
      queryClient.invalidateQueries({ queryKey: ["profile-chains-played"] });
      queryClient.invalidateQueries({ queryKey: ["chains-hot-following"] });
      queryClient.invalidateQueries({ queryKey: ["chains-own-following"] });
      queryClient.invalidateQueries({ queryKey: ["chains"] });
    } catch {
      setIsPrivate(!newVal);
    } finally {
      setSavingPrivate(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: fetchTrash,
    enabled: activeSection === "trash",
  });

  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: ["my-activities"],
    queryFn: fetchActivities,
    enabled: activeSection === "activities" && !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const restoreMutation = useMutation({
    mutationFn: restoreTicket,
    onSuccess: () => {
      setRestoreError(null);
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err: Error) => {
      setRestoreError(err.message);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: purgeTicket,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trash"] }),
  });

  const handlePurge = (id: number) => {
    setPurgeDialog({ type: "ticket", id });
  };

  const { data: chainTrashData, isLoading: chainTrashLoading } = useQuery({
    queryKey: ["chain-trash"],
    queryFn: fetchChainTrash,
    enabled: activeSection === "trash",
  });

  const restoreChainMutation = useMutation({
    mutationFn: restoreChain,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chain-trash"] });
      queryClient.invalidateQueries({ queryKey: ["chains-feed"] });
      queryClient.invalidateQueries({ queryKey: ["mixed-feed"] });
    },
  });

  const purgeChainMutation = useMutation({
    mutationFn: purgeChain,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chain-trash"] }),
  });

  const handleChainPurge = (id: string) => {
    setPurgeDialog({ type: "chain", id });
  };

  const handlePurgeConfirm = () => {
    if (!purgeDialog) return;
    if (purgeDialog.type === "ticket") purgeMutation.mutate(purgeDialog.id);
    else purgeChainMutation.mutate(purgeDialog.id);
    setPurgeDialog(null);
  };

  const tickets = data?.tickets ?? [];

  // ── Badge system ──────────────────────────────────────────────────────────

  const { data: badgeData, isLoading: badgeLoading } = useQuery({
    queryKey: ["badge-me"],
    queryFn: async () => {
      const res = await fetch("/api/badges/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        level: number;
        xpCurrent: number;
        xpFromPosts: number;
        xpFromTags: number;
        xpFromParty: number;
        xpRequired: number;
        progress: number;
        canEvolve: boolean;
        atMaxLevel: boolean;
        claimed: boolean;
        badgeHidden: boolean;
        pageBadgeHidden: boolean;
        isPageVerified: boolean;
        displayLevel: number | null;
        meta: { name: string; nameTH: string; color: string; gradient: string } | null;
        rules: {
          xpRequired: number;
          sources: { action: string; label: string; xpPerAction: number; dailyCap: number }[];
        };
      }>;
    },
    enabled: !!user,
  });

  const { data: supporterData } = useQuery({
    queryKey: ["supporter-my-request"],
    queryFn: () => fetch("/api/supporter/my-request", { credentials: "include" }).then(r => r.json()) as Promise<{ request: { status: "pending" | "approved" | "rejected" } | null }>,
    enabled: !!user,
    staleTime: 30_000,
  });
  const supporterStatus = supporterData?.request?.status ?? null;

  const { data: pageVerifyData } = useQuery({
    queryKey: ["page-verify-my-request"],
    queryFn: () => fetch("/api/page-verify/my-request", { credentials: "include" }).then(r => r.json()) as Promise<{ request: { status: "pending" | "approved" | "rejected" } | null }>,
    enabled: !!user,
    staleTime: 30_000,
  });
  const pageVerifyStatus = pageVerifyData?.request?.status ?? null;
  const isPageVerified = badgeData?.isPageVerified ?? false;

  const claimBadgeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/badges/claim", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message ?? "เกิดข้อผิดพลาด");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["badge-me"], (old: Record<string, unknown> | undefined) =>
        old ? { ...old, claimed: true, level: data.level ?? 1 } : old
      );
      queryClient.invalidateQueries({ queryKey: ["badge-me"] });
      if (user?.id) queryClient.invalidateQueries({ queryKey: ["badge-user", user.id] });
    },
  });

  const evolveBadgeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/badges/evolve", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message ?? "เกิดข้อผิดพลาด");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badge-me"] });
      if (user?.id) queryClient.invalidateQueries({ queryKey: ["badge-user", user.id] });
    },
  });

  // ── Single-active-badge mutation ────────────────────────────────────────────
  // One eye click = one API call = one atomic state on the server.
  // Mutual exclusion (popcorn ⇄ ticket) is enforced server-side, not stitched
  // together client-side.  Optimistic update keeps the UI instant and the
  // background refetch propagates the truth (and lets other users' devices
  // pick it up via short staleTime on /badges/user/:id).
  type Active = { kind: "none" } | { kind: "ticket"; level: number } | { kind: "popcorn" };
  const setActiveMutation = useMutation({
    mutationFn: async (active: Active) => {
      const res = await fetch("/api/badges/active", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(active),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "เกิดข้อผิดพลาด");
      return res.json() as Promise<{ displayLevel: number; pageBadgeHidden: boolean }>;
    },
    onMutate: async (active) => {
      await queryClient.cancelQueries({ queryKey: ["badge-me"] });
      const previous = queryClient.getQueryData<any>(["badge-me"]);
      if (previous) {
        const next = { ...previous };
        if (active.kind === "ticket") {
          next.displayLevel = active.level;
          next.pageBadgeHidden = true;
        } else if (active.kind === "popcorn") {
          next.displayLevel = 0;
          next.pageBadgeHidden = false;
        } else {
          next.displayLevel = 0;
          next.pageBadgeHidden = true;
        }
        queryClient.setQueryData(["badge-me"], next);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["badge-me"], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["badge-me"] });
      if (user?.id) queryClient.invalidateQueries({ queryKey: ["badge-user", user.id] });
    },
  });

  const scrollRef = usePageScroll("settings");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button
            onClick={() => {
              if (activeSection !== "main") setActiveSection("main");
              else navBack(navigate);
            }}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-lg text-foreground">
            {activeSection === "trash" ? t.trashPageTitle
              : activeSection === "activities" ? t.activitiesPageTitle
              : t.settingsPageTitle}
          </h1>
        </div>
      </div>

      {/* Main Settings */}
      {activeSection === "main" && (
        <div className="px-4 pt-6 pb-6 space-y-4">
          {/* Account info */}
          {user && (
            <div className="bg-secondary rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground flex-shrink-0">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.displayName ?? ""} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg font-bold text-background">
                      {(user.displayName ?? user.username ?? "?")[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">{user.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{user.username}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Badge / Evolution Section ───────────────────────────────── */}
          {user && (
            <BadgeSection
              key={badgeLoading ? "loading" : "loaded"}
              badge={badgeData ?? null}
              loading={badgeLoading}
              onClaim={() => claimBadgeMutation.mutate()}
              onEvolve={() => evolveBadgeMutation.mutate()}
              onSetDisplay={(lvl) =>
                setActiveMutation.mutate(lvl === 0 ? { kind: "none" } : { kind: "ticket", level: lvl })
              }
              claiming={claimBadgeMutation.isPending}
              evolving={evolveBadgeMutation.isPending}
              settingDisplay={setActiveMutation.isPending}
              claimError={claimBadgeMutation.error?.message ?? null}
              evolveError={evolveBadgeMutation.error?.message ?? null}
              onRequestSupporter={() => { sessionStorage.setItem("badge_tab", "4"); navigate("/supporter"); }}
              supporterStatus={supporterStatus}
              onRequestPageVerify={() => { sessionStorage.setItem("badge_tab", "5"); navigate("/page-verify"); }}
              pageVerifyStatus={pageVerifyStatus}
              isPageVerified={isPageVerified}
              onTogglePageBadge={() =>
                setActiveMutation.mutate(
                  badgeData?.pageBadgeHidden === false ? { kind: "none" } : { kind: "popcorn" },
                )
              }
              togglingPageBadge={setActiveMutation.isPending}
            />
          )}

          {/* Settings rows */}
          <div className="bg-secondary rounded-2xl overflow-hidden border border-border divide-y divide-border">
            {/* Dark Mode toggle */}
            <div className="w-full flex items-center gap-3 px-4 py-4">
              <div className="w-8 h-8 rounded-xl bg-background flex items-center justify-center">
                <Moon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.darkTheme}</p>
                <p className="text-xs text-muted-foreground">{t.darkThemeDesc}</p>
              </div>
              <button
                onClick={handleThemeToggle}
                aria-label="Toggle dark theme"
                className={cn(
                  "w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 focus:outline-none",
                  isDark ? "bg-foreground" : "bg-border"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full bg-white shadow transition-transform",
                  isDark ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            {/* Language toggle */}
            <div className="w-full flex items-center gap-3 px-4 py-4">
              <div className="w-8 h-8 rounded-xl bg-background flex items-center justify-center">
                <Languages className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.language}</p>
                <p className="text-xs text-muted-foreground">{lang === "th" ? t.langTh : t.langEn}</p>
              </div>
              <button
                onClick={() => setLang(lang === "th" ? "en" : "th")}
                aria-label="Toggle language"
                className={cn(
                  "w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 focus:outline-none",
                  lang === "th" ? "bg-foreground" : "bg-border"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full bg-white shadow transition-transform",
                  lang === "th" ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            {/* Privacy toggle */}
            <div className="w-full flex items-center gap-3 px-4 py-4">
              <div className="w-8 h-8 rounded-xl bg-background flex items-center justify-center">
                <Lock className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.privateProfile}</p>
                <p className="text-xs text-muted-foreground">{t.privateProfileDesc}</p>
              </div>
              {/* Toggle pill */}
              <button
                onClick={handlePrivateToggle}
                disabled={savingPrivate}
                aria-label="Toggle private profile"
                className={cn(
                  "w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 focus:outline-none disabled:opacity-50",
                  isPrivate ? "bg-foreground" : "bg-border"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full bg-white shadow transition-transform",
                  isPrivate ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            {pushSupported && (
              <div className="w-full flex flex-col gap-2 px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-background flex items-center justify-center">
                    <Bell className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{t.pushNotifications}</p>
                    <p className="text-xs text-muted-foreground">{t.pushNotificationsDesc}</p>
                  </div>
                  <button
                    onClick={handlePushToggle}
                    disabled={pushBusy}
                    aria-pressed={pushEnabled}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 focus:outline-none disabled:opacity-50",
                      pushEnabled ? "bg-foreground" : "bg-border"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-full bg-white shadow transition-transform",
                      pushEnabled ? "translate-x-5" : "translate-x-0"
                    )} />
                  </button>
                </div>
                {pushPermission === "denied" && (
                  <div className="ml-11 rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                    <p className="text-xs font-semibold text-destructive">{t.pushBlockedTitle}</p>
                    <p className="text-xs text-destructive/80 mt-1 leading-relaxed">
                      {/Android/i.test(navigator.userAgent) ? t.pushBlockedAndroidPwa : t.pushBlockedDesktop}
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Contact Ticker */}
          <div className="bg-secondary rounded-2xl overflow-hidden border border-border">
            <button
              onClick={() => setContactOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.contactTicker}</p>
                <p className="text-xs text-muted-foreground">{t.contactTickerDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
          </div>

          {/* Support Ko-fi */}
          <div className="bg-secondary rounded-2xl overflow-hidden border border-border">
            <a
              href="https://ko-fi.com/tickertickets"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Heart className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.supportTicker}</p>
                <p className="text-xs text-muted-foreground">{t.supportTickerDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </a>
          </div>

          <div className="bg-secondary rounded-2xl overflow-hidden border border-border divide-y divide-border">
            {isAdmin && (
              <button
                onClick={() => navigate("/admin")}
                className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-foreground">{t.adminPanel}</p>
                  <p className="text-xs text-muted-foreground">{t.adminPanelDesc}</p>
                </div>
                <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
              </button>
            )}
            <button
              onClick={() => setActiveSection("activities")}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Clock className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.activities}</p>
                <p className="text-xs text-muted-foreground">{t.activitiesDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
            <button
              onClick={() => setActiveSection("trash")}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.trash}</p>
                <p className="text-xs text-muted-foreground">{t.trashDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
            <button
              onClick={() => setLogoutDialogOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.logout}</p>
                <p className="text-xs text-muted-foreground">{t.logoutDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
            <button
              onClick={() => { setDeleteAccountConfirm(""); setDeleteAccountDialogOpen(true); }}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{t.deleteAccountLabel}</p>
                <p className="text-xs text-muted-foreground">{t.deleteAccountLabelDesc}</p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
          </div>

          {/* About Ticker */}
          <div className="bg-secondary rounded-2xl overflow-hidden border border-border">
            <div className="w-full flex items-start gap-3 px-4 py-4">
              <div className="w-8 h-8 rounded-xl bg-background flex items-center justify-center shrink-0">
                <Info className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">{t.aboutTickerLabel}</p>
                <div className="mt-1.5 space-y-1.5">
                  {t.aboutTickerBody.split("\n\n").map((para, i) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">{para}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* TMDB Attribution */}
          <div className="px-1 -mt-2 pb-0">
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 group"
            >
              <img
                src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
                alt="TMDB"
                className="h-3 w-auto opacity-50 group-hover:opacity-80 transition-opacity"
              />
              <p className="text-[10px] text-muted-foreground/60 leading-snug group-hover:text-muted-foreground transition-colors">
                This product uses the TMDB API but is not endorsed or certified by TMDB.
              </p>
            </a>
          </div>
        </div>
      )}

      {/* Contact sheet */}
      {contactOpen && (
        <ReportSheet type="contact" targetId="" onClose={() => setContactOpen(false)} />
      )}

      {/* Privacy confirmation bottom sheet */}
      {privacyDialogOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm" onClick={() => setPrivacyDialogOpen(false)} />
          <div
            className="fixed bottom-0 z-[200] bg-background rounded-t-3xl border-t border-border"
            style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center px-5 pb-4 pt-3 gap-3">
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Lock className="w-4 h-4 text-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-base text-foreground">
                  {isPrivate ? t.makePublicTitle : t.makePrivateTitle}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {isPrivate ? t.makePublicDesc : t.makePrivateDesc}
                </p>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={() => setPrivacyDialogOpen(false)}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handlePrivacyConfirm}
                disabled={savingPrivate}
                className="flex-1 h-11 rounded-2xl bg-foreground text-background text-sm font-bold disabled:opacity-50"
              >
                {savingPrivate ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t.confirmBtn}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Purge confirmation bottom sheet */}
      {!!purgeDialog && createPortal(
        <>
          <div className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm" onClick={() => setPurgeDialog(null)} />
          <div
            className="fixed bottom-0 z-[200] bg-background rounded-t-3xl border-t border-border"
            style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center px-5 pb-4 pt-3 gap-3">
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-base text-foreground">{t.purgeTitle}</h2>
                <p className="text-xs text-muted-foreground">{t.purgeDesc}</p>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={() => setPurgeDialog(null)}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handlePurgeConfirm}
                className="flex-1 h-11 rounded-2xl bg-foreground text-background text-sm font-bold"
              >
                {t.purge}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Logout bottom sheet */}
      {logoutDialogOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm" onClick={() => setLogoutDialogOpen(false)} />
          <div
            className="fixed bottom-0 z-[200] bg-background rounded-t-3xl border-t border-border"
            style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center px-5 pb-4 pt-3 gap-3">
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <LogOut className="w-4 h-4 text-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-base text-foreground">{t.logoutTitle}</h2>
                <p className="text-xs text-muted-foreground">{t.logoutConfirmDesc}</p>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={() => setLogoutDialogOpen(false)}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold"
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={() => { setLogoutDialogOpen(false); logout(); }}
                className="flex-1 h-11 rounded-2xl bg-foreground text-background text-sm font-bold"
              >
                {t.logout}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Delete account bottom sheet */}
      {deleteAccountDialogOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm" onClick={() => { setDeleteAccountConfirm(""); setDeletingAccount(false); setDeleteAccountDialogOpen(false); }} />
          <div
            className="fixed bottom-0 z-[200] bg-background rounded-t-3xl border-t border-border"
            style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center px-5 pb-4 pt-3 gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-base text-red-600">{t.deleteAccountTitle}</h2>
                <p className="text-xs text-muted-foreground">{t.purgeDesc}</p>
              </div>
            </div>
            <div className="px-4 pb-2 space-y-1.5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t.deleteAccountPermText(<strong className="text-foreground">{t.deleteAccountConfirmWord}</strong> as unknown as string)}
              </p>
              <input
                className="w-full border border-border rounded-2xl px-4 py-3 text-sm text-foreground bg-secondary outline-none focus:border-red-400 transition-colors"
                placeholder={t.deleteAccountPlaceholder}
                value={deleteAccountConfirm}
                onChange={e => setDeleteAccountConfirm(e.target.value)}
              />
            </div>
            <div className="px-4 pt-3 pb-4 flex gap-2">
              <button
                onClick={() => { setDeleteAccountConfirm(""); setDeletingAccount(false); setDeleteAccountDialogOpen(false); }}
                disabled={deletingAccount}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold disabled:opacity-40"
              >
                {t.cancelBtn}
              </button>
              <button
                disabled={deleteAccountConfirm !== t.deleteAccountConfirmWord || deletingAccount}
                onClick={async () => {
                  if (deleteAccountConfirm !== t.deleteAccountConfirmWord) return;
                  setDeletingAccount(true);
                  try {
                    const res = await fetch("/api/users/me", { method: "DELETE", credentials: "include" });
                    if (res.ok) await logout();
                  } catch {
                    setDeletingAccount(false);
                  }
                }}
                className="flex-1 h-11 rounded-2xl bg-red-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : t.deleteAccountLabel}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Trash Section */}
      {activeSection === "trash" && (
        <div className="px-4 pt-4 pb-3">
          <p className="text-xs text-muted-foreground mb-4 truncate">
            {t.trashSectionNote}
          </p>

          {restoreError && (
            <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              <span className="text-amber-500 mt-0.5 shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 leading-snug">{restoreError}</p>
              </div>
              <button onClick={() => setRestoreError(null)} className="text-amber-400 shrink-0 mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!isLoading && !chainTrashLoading && tickets.length === 0 && (chainTrashData?.chains ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center"><Trash2 className="w-8 h-8 text-muted-foreground" /></div>
              <p className="font-bold text-base text-foreground">{t.trashEmpty}</p>
              <p className="text-sm text-muted-foreground">{t.trashEmptyDesc}</p>
            </div>
          )}

          {/* Tickets */}
          {!isLoading && tickets.length > 0 && (
            <div className={(chainTrashData?.chains ?? []).length > 0 ? "mb-4" : ""}>
              <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-2 px-1">Tickets</p>
              <div className="space-y-3">
                {tickets.map(ticket => (
                  <TrashItem
                    key={ticket.id}
                    ticket={ticket}
                    onRestore={() => restoreMutation.mutate(ticket.id)}
                    onPurge={() => handlePurge(ticket.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Chains */}
          {!chainTrashLoading && (chainTrashData?.chains ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-2 px-1">Chains</p>
              <div className="space-y-3">
                {(chainTrashData?.chains ?? []).map(chain => (
                  <ChainTrashItem
                    key={chain.id}
                    chain={chain}
                    onRestore={() => restoreChainMutation.mutate(chain.id)}
                    onPurge={() => handleChainPurge(chain.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activities Section */}
      {activeSection === "activities" && (
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs text-muted-foreground mb-4 truncate">
            {t.activitiesNote}
          </p>

          {activitiesLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!activitiesLoading && (() => {
            const tl = activitiesData?.ticketLikes ?? [];
            const tc = activitiesData?.ticketComments ?? [];
            const cl = activitiesData?.chainLikes ?? [];
            const cc = activitiesData?.chainComments ?? [];
            const ot = activitiesData?.ownTickets ?? [];
            const hasTickets = tl.length > 0 || tc.length > 0 || ot.length > 0;
            const hasChains = cl.length > 0 || cc.length > 0;
            const isEmpty = !hasTickets && !hasChains;

            if (isEmpty) {
              return (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
                    <Clock className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="font-bold text-base text-foreground">{t.activitiesEmpty}</p>
                  <p className="text-sm text-muted-foreground">{t.activitiesEmptyDesc}</p>
                </div>
              );
            }

            // Helper: relative time string
            const relTime = (iso: string) => {
              const diff = Date.now() - new Date(iso).getTime();
              const mins = Math.floor(diff / 60000);
              const hours = Math.floor(diff / 3600000);
              const days = Math.floor(diff / 86400000);
              if (mins < 1) return t.timeJustNow;
              if (mins < 60) return `${mins}${t.timeMin}`;
              if (hours < 24) return `${hours}${t.timeHr}`;
              return `${days}${t.timeDay}`;
            };

            // Merge ticket activities sorted by createdAt desc
            type TicketActivity =
              | (ActivityTicketLike & { kind: "like" })
              | (ActivityTicketComment & { kind: "comment" })
              | (ActivityOwnTicket & { kind: "own" });
            const ticketItems: TicketActivity[] = [
              ...tl.map(x => ({ ...x, kind: "like" as const })),
              ...tc.map(x => ({ ...x, kind: "comment" as const })),
              ...ot.map(x => ({ ...x, kind: "own" as const })),
            ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            type ChainActivity =
              | (ActivityChainLike & { kind: "like" })
              | (ActivityChainComment & { kind: "comment" });
            const chainItems: ChainActivity[] = [
              ...cl.map(x => ({ ...x, kind: "like" as const })),
              ...cc.map(x => ({ ...x, kind: "comment" as const })),
            ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            const ActivityRow = ({ posterUrl, title, label, timeStr, comment, icon, onClick }: {
              posterUrl?: string | null;
              title: string;
              label: string;
              timeStr: string;
              comment?: string;
              icon: React.ReactNode;
              onClick?: () => void;
            }) => (
              <div className="flex items-start gap-3 bg-secondary rounded-2xl p-3 border border-border active:opacity-70 cursor-pointer" onClick={onClick}>
                <div className="relative w-10 h-14 rounded-xl overflow-hidden bg-zinc-900 flex-shrink-0 border border-border">
                  {posterUrl ? (
                    <img src={posterUrl} alt={title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-muted-foreground flex-shrink-0">{icon}</span>
                    <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto flex-shrink-0">{timeStr}</span>
                  </div>
                  <p className="font-bold text-sm text-foreground leading-tight line-clamp-1">{title}</p>
                  {comment && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-snug">{comment}</p>
                  )}
                </div>
              </div>
            );

            return (
              <>
                {hasTickets && (
                  <div className={hasChains ? "mb-4" : ""}>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-2 px-1">Tickets</p>
                    <div className="space-y-2">
                      {ticketItems.map(item => (
                        <ActivityRow
                          key={item.id}
                          posterUrl={item.posterUrl}
                          title={item.movieTitle}
                          label={
                            item.kind === "like"
                              ? t.activitiesLikedTicket
                              : item.kind === "comment"
                              ? t.activitiesCommentedTicket
                              : (lang === "th" ? "โพสต์ตั๋ว" : "Posted ticket")
                          }
                          timeStr={relTime(item.createdAt)}
                          comment={item.kind === "comment" ? (item as ActivityTicketComment & { kind: "comment" }).content : undefined}
                          icon={
                            item.kind === "like"
                              ? <Heart className="w-3 h-3 text-foreground" />
                              : item.kind === "comment"
                              ? <MessageSquare className="w-3 h-3 text-foreground" />
                              : <Ticket className="w-3 h-3 text-foreground" />
                          }
                          onClick={() => { sessionStorage.setItem("ticker:settings_section", "activities"); navigate(`/post/ticket/${item.ticketId}`); }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {hasChains && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-2 px-1">Chains</p>
                    <div className="space-y-2">
                      {chainItems.map(item => (
                        <ActivityRow
                          key={item.id}
                          posterUrl={item.posterUrl}
                          title={item.chainTitle}
                          label={item.kind === "like" ? t.activitiesLikedChain : t.activitiesCommentedChain}
                          timeStr={relTime(item.createdAt)}
                          comment={item.kind === "comment" ? item.content : undefined}
                          icon={item.kind === "like"
                            ? <Heart className="w-3 h-3 text-foreground" />
                            : <MessageSquare className="w-3 h-3 text-foreground" />
                          }
                          onClick={() => { sessionStorage.setItem("ticker:settings_section", "activities"); navigate(`/post/chain/${item.chainId}`); }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground text-center px-6 pt-6 pb-8 leading-relaxed">
        {lang === "th"
          ? "ความคิดเห็น การรีวิว และการให้คะแนนทั้งหมดบน Ticker เป็นความรับผิดชอบของผู้ใช้แต่ละคน Ticker และผู้พัฒนาขอไม่รับผิดชอบต่อเนื้อหาที่ผู้ใช้สร้างขึ้นซึ่งอยู่นอกเหนือการควบคุมของเรา"
          : "All reviews, ratings, and opinions on Ticker are solely those of the individual users. Ticker and its developers are not responsible for user-generated content beyond our reasonable control."}
      </p>
    </div>
  );
}
