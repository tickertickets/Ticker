import { useState } from "react";
import { createPortal } from "react-dom";
import { useGetNotifications } from "@workspace/api-client-react";
import { useLang, displayYear, displayDate } from "@/lib/i18n";
import { Avatar } from "@/components/ui/avatar";
import { Loader2, Heart, MessageCircle, UserPlus, Users, Sparkles, X, Lock, Unlock, ArrowLeft, Search, Bell, Trash2, Link2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { getNotifText } from "@/lib/notif-text";

// ── Party invite modal ──────────────────────────────────────────────────────

interface PartyInviteInfo {
  invite: { id: string; partyGroupId: string; status: string; assignedSeat?: number | null };
  movie: { movieTitle: string; movieYear?: string | null; posterUrl?: string | null; partySize?: number | null } | null;
  inviter: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  takenSeats: number[];
}

function PartyAcceptModal({
  inviteId,
  onClose,
  onSuccess,
}: {
  inviteId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [seatNumber, setSeatNumber] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isDyingStar, setIsDyingStar] = useState(false);
  const { t, lang } = useLang();
  const [error, setError] = useState("");

  const { data: info, isLoading } = useQuery<PartyInviteInfo>({
    queryKey: ["/api/party/invite", inviteId],
    queryFn: async () => {
      const res = await fetch(`/api/party/invite/${inviteId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const accept = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/party/invite/${inviteId}/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatNumber, rating, ratingType: isDyingStar ? "blackhole" : "star" }),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body;
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: Record<string, string>) => {
      if (err.error === "seat_taken") setError(t.errSeatTaken);
      else if (err.error === "duplicate_movie") setError(t.errDuplicateMovie);
      else setError(t.errGeneric);
    },
  });

  const decline = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/party/invite/${inviteId}/decline`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const partySize = info?.movie?.partySize ?? 10;
  const takenSeats = info?.takenSeats ?? [];

  const handleAccept = () => {
    if (!seatNumber) { setError(t.errChooseSeat); return; }
    if (!rating) { setError(t.errGiveRating); return; }
    setError("");
    accept.mutate();
  };

  const alreadyAccepted = info?.invite.status === "accepted";

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm mx-0 bg-background rounded-t-3xl shadow-2xl border-t border-border overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: "85dvh" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {!isLoading && (
          <div className="px-5 space-y-5" style={{ paddingBottom: "3rem" }}>
            <div className="flex items-center gap-3">
              {info?.movie?.posterUrl && (
                <img src={info.movie.posterUrl} alt={info.movie.movieTitle} className="w-12 h-16 rounded-xl object-cover flex-shrink-0" />
              )}
              <div>
                <p className="text-xs text-muted-foreground font-medium">{t.partyInviteFrom}</p>
                <p className="font-bold text-foreground text-sm">{info?.inviter?.displayName ?? `@${info?.inviter?.username}`}</p>
                <p className="font-display font-black text-base text-foreground leading-tight mt-0.5">{info?.movie?.movieTitle}</p>
                <p className="text-xs text-muted-foreground">{displayYear(info?.movie?.movieYear, lang)} · {t.partySizeLabel(partySize)}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-bold text-foreground mb-2">{t.chooseSeat}</p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: partySize }, (_, i) => i + 1).map(n => {
                  const isTaken = takenSeats.includes(n);
                  return (
                    <button
                      key={n}
                      disabled={isTaken}
                      onClick={() => { if (!isTaken) { setSeatNumber(n); setError(""); } }}
                      className={cn(
                        "w-10 h-10 rounded-xl text-sm font-bold transition-colors",
                        isTaken
                          ? "bg-border/30 text-muted-foreground/40 cursor-not-allowed"
                          : seatNumber === n
                          ? "bg-foreground text-background"
                          : "bg-secondary text-foreground hover:bg-secondary/80"
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">{t.seatTakenHint}</p>
            </div>

            {/* Rating */}
            <div>
              <p className="text-sm font-bold text-foreground mb-2">{t.yourRating}</p>
              <div className="flex gap-2 items-center">
                {[1, 2, 3, 4, 5].map(star => {
                  const active = star <= (hoverRating ?? rating ?? 0);
                  const fillColor = active ? (isDyingStar ? "#22c55e" : "#fbbf24") : undefined;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      className={cn(
                        "text-2xl leading-none transition-transform active:scale-90",
                        active ? "" : "text-muted-foreground/40"
                      )}
                      style={fillColor ? { color: fillColor } : undefined}
                      aria-label={`${star} ดาว`}
                    >
                      ★
                    </button>
                  );
                })}
                {rating && (
                  <span className="text-sm text-muted-foreground self-center ml-1">{rating}/5</span>
                )}
              </div>

              {/* Dying star toggle — same pattern as create-ticket */}
              <button
                type="button"
                role="switch"
                aria-checked={isDyingStar}
                onClick={() => setIsDyingStar(v => !v)}
                className="flex items-center gap-2 select-none active:opacity-70 mt-3"
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

            {error && <p className="text-sm text-red-500 font-semibold">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => decline.mutate()}
                disabled={decline.isPending || accept.isPending || alreadyAccepted || accept.isSuccess}
                className="flex-1 h-12 rounded-2xl font-bold text-sm bg-secondary text-foreground border border-border disabled:opacity-40"
              >
                {decline.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t.declineBtn}
              </button>
              <button
                onClick={handleAccept}
                disabled={accept.isPending || decline.isPending || !seatNumber || !rating || alreadyAccepted || accept.isSuccess}
                className={cn(
                  "flex-1 h-12 rounded-2xl font-bold text-sm transition-all",
                  (alreadyAccepted || accept.isSuccess)
                    ? "bg-border text-muted-foreground cursor-not-allowed"
                    : seatNumber && rating
                    ? "bg-foreground text-background"
                    : "bg-border text-muted-foreground cursor-not-allowed"
                )}
              >
                {accept.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  : alreadyAccepted || accept.isSuccess
                  ? t.alreadyAccepted
                  : t.acceptBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ── Follow request inline actions ────────────────────────────────────────────

function FollowRequestActions({ fromUsername, requestId, onDone }: { fromUsername: string; requestId: string; onDone: () => void }) {
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  const resolveRequest = async (action: "approve" | "reject") => {
    await fetch(`/api/users/${fromUsername}/follow-requests/${requestId}/${action}`, { method: "POST", credentials: "include" });
    setDone(action === "approve" ? "approved" : "rejected");
    onDone();
  };

  const approveM = useMutation({ mutationFn: () => resolveRequest("approve") });
  const rejectM  = useMutation({ mutationFn: () => resolveRequest("reject") });

  const { t } = useLang();
  if (done === "approved") return <p className="text-xs text-muted-foreground mt-1">{t.acceptedLabel}</p>;
  if (done === "rejected") return <p className="text-xs text-muted-foreground mt-1">{t.declinedLabel}</p>;

  return (
    <div className="mt-2 flex gap-2">
      <button
        onClick={() => approveM.mutate()}
        disabled={approveM.isPending || rejectM.isPending}
        className="px-3 py-1.5 rounded-xl bg-foreground text-background text-xs font-bold disabled:opacity-50"
      >
        {approveM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.acceptBtn}
      </button>
      <button
        onClick={() => rejectM.mutate()}
        disabled={approveM.isPending || rejectM.isPending}
        className="px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium border border-border disabled:opacity-50"
      >
        {rejectM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.declineBtn}
      </button>
    </div>
  );
}

// ── Memory request inline actions ───────────────────────────────────────────

function MemoryRequestActions({ ticketId, fromUserId, onDone }: { ticketId: string; fromUserId: string; onDone: () => void }) {
  const { data, isLoading } = useQuery<{ requests: Array<{ id: string; status: string; requester: { id: string } }> }>({
    queryKey: ["/api/tickets", ticketId, "memory-requests"],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/memory-requests`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const req = data?.requests.find(r => r.requester.id === fromUserId && r.status === "pending");

  const approve = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/memory-requests/${req!.id}/approve`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("failed");
    },
    onSuccess: onDone,
  });

  const deny = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/memory-requests/${req!.id}/deny`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("failed");
    },
    onSuccess: onDone,
  });

  const { t } = useLang();
  if (isLoading) return null;
  if (!req) return <p className="text-xs text-muted-foreground mt-1">{t.respondedLabel}</p>;

  return (
    <div className="mt-2 flex gap-2">
      <button
        onClick={() => approve.mutate()}
        disabled={approve.isPending || deny.isPending}
        className="px-3 py-1.5 rounded-xl bg-foreground text-background text-xs font-bold disabled:opacity-50"
      >
        {approve.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.approveBtn}
      </button>
      <button
        onClick={() => deny.mutate()}
        disabled={approve.isPending || deny.isPending}
        className="px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium border border-border disabled:opacity-50"
      >
        {deny.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.denyBtn}
      </button>
    </div>
  );
}

// ── Notification icon ───────────────────────────────────────────────────────

function getNotifIcon(type: string) {
  switch (type) {
    case 'like': return <Heart className="w-3.5 h-3.5 fill-current text-black dark:text-white" />;
    case 'comment': return <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'follow': return <UserPlus className="w-3.5 h-3.5 text-foreground" />;
    case 'follow_request': return <UserPlus className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'party_invite': return <Users className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'party_color_unlock': return <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'memory_request': return <Lock className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'memory_approved': return <Unlock className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'chain_continued': return <Link2 className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'chain_run_started': return <Link2 className="w-3.5 h-3.5 text-muted-foreground" />;
    default: return null;
  }
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Notifications() {
  const { t, lang } = useLang();
  const scrollRef = usePageScroll("notifications");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);

  const { data, isLoading } = useGetNotifications(undefined, { query: { refetchInterval: 60_000, staleTime: 30_000 } });

  const markOneRead = async (id: string) => {
    const notifs = (queryClient.getQueryData<any>(["/api/notifications"])?.notifications ?? []) as any[];
    const n = notifs.find((n: any) => n.id === id);
    const wasUnread = n && !n.isRead;
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
    queryClient.setQueryData<any>(["/api/notifications"], (old: any) => old ? {
      ...old,
      notifications: old.notifications.map((n: any) => n.id === id ? { ...n, isRead: true } : n),
      unreadCount: wasUnread ? Math.max(0, (old.unreadCount ?? 0) - 1) : (old.unreadCount ?? 0),
    } : old);
    if (wasUnread) {
      queryClient.setQueryData(["notifications-unread-count"], (old: any) => Math.max(0, (old ?? 0) - 1));
    }
  };

  const deleteNotif = async (id: string) => {
    const notifs = (queryClient.getQueryData<any>(["/api/notifications"])?.notifications ?? []) as any[];
    const removed = notifs.find((n: any) => n.id === id);
    await fetch(`/api/notifications/${id}`, { method: "DELETE", credentials: "include" });
    queryClient.setQueryData<any>(["/api/notifications"], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        notifications: old.notifications.filter((n: any) => n.id !== id),
        unreadCount: removed && !removed.isRead ? Math.max(0, (old.unreadCount ?? 0) - 1) : old.unreadCount,
      };
    });
    if (removed && !removed.isRead) {
      queryClient.setQueryData(["notifications-unread-count"], (old: any) => Math.max(0, (old ?? 0) - 1));
    }
  };

  const handleInviteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const allNotifications = data?.notifications ?? [];
  const notifications = searchQuery
    ? allNotifications.filter(n =>
        (n.fromUser.displayName || n.fromUser.username || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.message.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allNotifications;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-5 pb-3">
          <button onClick={() => navigate("/")} className="w-9 h-9 flex items-center justify-center">
            <ArrowLeft className="w-6 h-6 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1">
            {t.notifTitle}
          </h1>
          <button
            onClick={() => { setSearchOpen(v => !v); setSearchQuery(""); }}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
          >
            <Search className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <div className="px-4 pb-3">
            <input
              type="text"
              autoFocus
              placeholder={t.searchNotifsPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-10 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-transparent focus:border-border"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {notifications.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <Bell className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-display font-bold text-foreground">{t.noNotifs}</p>
            <p className="text-sm text-muted-foreground">{t.noNotifsDesc}</p>
          </div>
        </div>
      ) : (
        <div>
          {notifications.map(notif => {
            const notifRec = (notif as unknown) as Record<string, unknown>;
            const isPartyInvite = notif.type === "party_invite" && notifRec["partyInviteId"];
            const partyInviteId = notifRec["partyInviteId"] as string | null;
            const partyInviteStatus = notifRec["partyInviteStatus"] as string | null;
            const isColorNotif = notif.type === "party_color_unlock";

            return (
              <div
                key={notif.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 border-b border-border/40 transition-colors",
                  !notif.isRead && "bg-secondary/40"
                )}
                onClick={() => { if (!notif.isRead) markOneRead(notif.id); }}
              >
                {/* Avatar + type icon */}
                <div className="relative flex-shrink-0 mt-0.5">
                  <Avatar src={notif.fromUser.avatarUrl} fallback={notif.fromUser.displayName || notif.fromUser.username} />
                  {(() => {
                    const icon = getNotifIcon(notif.type);
                    if (!icon) return null;
                    return (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-background rounded-full border border-border flex items-center justify-center">
                        {icon}
                      </div>
                    );
                  })()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm text-foreground leading-snug", notif.isRead ? "" : "font-semibold")}>
                    <Link href={`/profile/${notif.fromUser.username}`} className="inline-flex items-center gap-1 font-bold text-foreground" onClick={e => e.stopPropagation()}>
                      {notif.fromUser.displayName || notif.fromUser.username}
                      {isVerified(notif.fromUser.username) && <VerifiedBadge />}
                      {notif.fromUser.id && <BadgeIcon userId={notif.fromUser.id} />}
                    </Link>{' '}
                    {getNotifText(notif.type, lang, notif.message)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">{displayDate(notif.createdAt, lang)}</p>

                  {!!isPartyInvite && partyInviteId && (
                    <div className="mt-2">
                      {partyInviteStatus === "accepted" ? (
                        <p className="text-xs text-muted-foreground">{t.alreadyAccepted}</p>
                      ) : partyInviteStatus === "declined" ? (
                        <p className="text-xs text-muted-foreground">{t.declinedLabel}</p>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setActiveInviteId(partyInviteId); }}
                          className="px-3 py-1.5 rounded-xl bg-foreground text-background text-xs font-bold"
                        >
                          {t.acceptBtn}
                        </button>
                      )}
                    </div>
                  )}

                  {(notif.type as string) === "follow_request" && notifRec["followRequestId"] && (
                    <FollowRequestActions
                      fromUsername={notif.fromUser.username}
                      requestId={notifRec["followRequestId"] as string}
                      onDone={() => queryClient.invalidateQueries({ queryKey: ['/api/notifications'] })}
                    />
                  )}

                  {(notif.type as string) === "memory_request" && notif.ticketId && (
                    <MemoryRequestActions
                      ticketId={notif.ticketId}
                      fromUserId={notif.fromUser.id}
                      onDone={() => {
                        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
                        queryClient.invalidateQueries({ queryKey: ["/api/tickets", notif.ticketId, "memory-requests"] });
                      }}
                    />
                  )}
                </div>

                {/* Right side: ticket/chain thumb + delete */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {notif.ticketId && !isPartyInvite && (notif.type as string) !== "memory_request" && (notifRec["ticketPosterUrl"] || isColorNotif) && (
                    <Link href={`/ticket/${notif.ticketId}`} onClick={e => e.stopPropagation()}>
                      <div className="w-11 h-14 rounded-xl overflow-hidden border border-border flex items-center justify-center bg-secondary">
                        {notifRec["ticketPosterUrl"] && !isColorNotif
                          ? <img src={notifRec["ticketPosterUrl"] as string} alt="" className="w-full h-full object-cover" />
                          : isColorNotif && <Sparkles className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </Link>
                  )}
                  {notifRec["chainId"] && (notif.type === "chain_continued" || notif.type === "chain_run_started") && (
                    <Link href={`/chain/${notifRec["chainId"]}`} onClick={e => e.stopPropagation()}>
                      <div className="w-11 h-11 rounded-xl overflow-hidden border border-border flex items-center justify-center bg-secondary">
                        <Link2 className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </Link>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); deleteNotif(notif.id); }}
                    className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Party accept modal */}
      {activeInviteId && (
        <PartyAcceptModal
          inviteId={activeInviteId}
          onClose={() => setActiveInviteId(null)}
          onSuccess={handleInviteSuccess}
        />
      )}
    </div>
  );
}
