import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Image, X, Star, Lock, Copy, Trash2, Link2, Film } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { getCardVisual } from "@/lib/ranks";
import { compressImage, CHAT_COMPRESS } from "@/lib/image-compress";
import { BadgeIcon } from "@/components/BadgeIcon";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { useLang, displayYear } from "@/lib/i18n";
import { clearPushByTag } from "@/lib/clear-push";

type MessageUser = { id: string; username: string; displayName: string | null; avatarUrl: string | null };

type SharedTicket = {
  id: string; movieTitle: string; movieYear: string | null; posterUrl: string | null;
  cardTheme: string | null; cardBackdropUrl: string | null;
  rating: number | null; ratingType: string | null; rankTier: string; currentRankTier: string;
} | null;

type SharedChain = { id: string; title: string; description: string | null; movieCount: number; chainCount: number; posterUrl?: string | null } | null;

type ChatMessage = {
  id: string; conversationId: string; senderId: string;
  sender: MessageUser; content: string | null; imageUrl: string | null;
  sharedTicketId: string | null; sharedTicket: SharedTicket;
  sharedChainId: string | null; sharedChain: SharedChain;
  createdAt: string;
};

type Conversation = {
  id: string;
  isRequest: boolean;
  participants: MessageUser[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
};

function Avatar({ user, size = 36 }: { user: MessageUser; size?: number }) {
  const name = user.displayName || user.username || "?";
  if (user.avatarUrl) {
    const rounded = size >= 48 ? "rounded-2xl" : size >= 36 ? "rounded-xl" : "rounded-lg";
    return <img src={user.avatarUrl} alt={name} style={{ width: size, height: size }} className={`${rounded} object-cover flex-shrink-0`} />;
  }
  const rounded = size >= 48 ? "rounded-2xl" : size >= 36 ? "rounded-xl" : "rounded-lg";
  return (
    <div style={{ width: size, height: size }} className={`${rounded} bg-black flex items-center justify-center flex-shrink-0 border border-white/10`}>
      <span className="text-xs font-bold text-white">{name[0]?.toUpperCase()}</span>
    </div>
  );
}

function SharedTicketPreview({ ticket, ticketId }: { ticket: SharedTicket; ticketId?: string | null }) {
  const { t, lang } = useLang();
  if (!ticket) {
    if (!ticketId) return null;
    return (
      <div className="flex items-center gap-2.5 bg-secondary/80 rounded-2xl p-2.5 mt-1 border border-border/60 max-w-[220px]">
        <div className="w-10 h-14 bg-background rounded-lg flex-shrink-0 flex items-center justify-center">
          <Star className="w-4 h-4 text-muted-foreground opacity-40" />
        </div>
        <p className="text-xs text-muted-foreground">{t.deletedCard}</p>
      </div>
    );
  }
  const vis = getCardVisual(ticket.currentRankTier);
  const displayImg = (ticket.cardTheme === "poster" && ticket.cardBackdropUrl)
    ? ticket.cardBackdropUrl
    : ticket.posterUrl;
  return (
    <Link href={`/ticket/${ticket.id}`}>
      <div className="flex items-center gap-2.5 bg-secondary/80 rounded-2xl p-2.5 mt-1 border border-border/60 max-w-[220px]">
        {displayImg ? (
          <img src={displayImg} alt={ticket.movieTitle} className="w-10 h-14 object-cover rounded-lg flex-shrink-0" />
        ) : (
          <div className="w-10 h-14 bg-background rounded-lg flex-shrink-0 flex items-center justify-center">
            <Star className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground leading-tight truncate">{ticket.movieTitle}</p>
          {ticket.movieYear && <p className="text-[10px] text-muted-foreground">{displayYear(ticket.movieYear, lang)}</p>}
          {ticket.rating && (
            <div className="flex items-center gap-0.5 mt-1">
              {Array.from({ length: Math.min(Math.max(1, Math.round(ticket.rating)), 5) }, (_, i) => {
                const isBlackhole = ticket.ratingType === "blackhole";
                const starColor = isBlackhole ? "#22c55e" : "#fbbf24";
                return <Star key={i} className="w-2.5 h-2.5" style={{ fill: starColor, color: starColor }} />;
              })}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function SharedChainPreview({ chain, chainId }: { chain: SharedChain; chainId?: string | null }) {
  const { t } = useLang();
  if (!chain) {
    if (!chainId) return null;
    return (
      <div className="flex items-center gap-2.5 bg-secondary/80 rounded-2xl p-2.5 mt-1 border border-border/60 max-w-[220px]">
        <div className="w-10 h-10 bg-background rounded-xl flex-shrink-0 flex items-center justify-center border border-border/40">
          <Link2 className="w-4 h-4 text-muted-foreground opacity-40" strokeWidth={2.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-muted-foreground tracking-wider mb-0.5">Chains</p>
          <p className="text-xs text-muted-foreground">{t.deletedMsg}</p>
        </div>
      </div>
    );
  }
  return (
    <Link href={`/chain/${chain.id}`}>
      <div className="flex items-center gap-2.5 bg-secondary/80 rounded-2xl p-2.5 mt-1 border border-border/60 max-w-[220px]">
        <div className="w-10 h-10 bg-background rounded-xl flex-shrink-0 overflow-hidden border border-border/40">
          {chain.posterUrl ? (
            <img src={chain.posterUrl} alt={chain.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Link2 className="w-4 h-4 text-muted-foreground" strokeWidth={2.75} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-muted-foreground tracking-wider mb-0.5">Chains</p>
          <p className="text-xs font-bold text-foreground leading-tight truncate">{chain.title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Link2 className="w-3 h-3" strokeWidth={2.75} />
            {chain.chainCount}
          </p>
        </div>
      </div>
    </Link>
  );
}

function MessageBubble({ msg, isMine, onLongPress }: { msg: ChatMessage; isMine: boolean; onLongPress: (msg: ChatMessage) => void }) {
  const hasText = !!msg.content;
  const hasImage = !!msg.imageUrl;
  const hasTicket = !!(msg.sharedTicket || msg.sharedTicketId);
  const hasChain = !!(msg.sharedChain || msg.sharedChainId);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!hasText && !hasImage && !hasTicket && !hasChain) return null;

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => { onLongPress(msg); }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  return (
    <div
      className={cn("flex items-end gap-2 mb-1", isMine ? "flex-row-reverse" : "flex-row")}
      style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={e => e.preventDefault()}
    >
      {!isMine && <Avatar user={msg.sender} size={28} />}
      <div className={cn("max-w-[72%] flex flex-col", isMine ? "items-end" : "items-start")}>
        {hasImage && (
          <img
            src={msg.imageUrl!}
            alt="Chat image"
            className="rounded-2xl max-w-full max-h-64 object-cover mb-1 cursor-pointer"
            onClick={() => window.open(msg.imageUrl!, "_blank")}
          />
        )}
        {hasTicket && <SharedTicketPreview ticket={msg.sharedTicket} ticketId={msg.sharedTicketId} />}
        {hasChain && <SharedChainPreview chain={msg.sharedChain} chainId={msg.sharedChainId} />}
        {hasText && (
          <div className={cn(
            "px-4 py-2.5 rounded-3xl text-sm leading-relaxed select-none",
            isMine
              ? "bg-foreground text-background rounded-br-lg"
              : "bg-secondary text-foreground rounded-bl-lg border border-border/60"
          )}>
            {msg.content}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5 px-1">
          {new Date(msg.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function MessageContextMenu({ msg, isMine, onClose, onDeleted }: {
  msg: ChatMessage; isMine: boolean; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const { t } = useLang();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCopy = () => {
    if (msg.content) navigator.clipboard.writeText(msg.content);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/chat/messages/${msg.id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) onDeleted(msg.id);
    } catch {}
    setDeleting(false);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full bg-background rounded-t-3xl overflow-hidden"
        style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.22)", paddingBottom: "env(safe-area-inset-bottom, 8px)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {confirmDelete ? (
          <>
            <div className="flex items-center px-5 pb-4 pt-3 gap-3">
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4 h-4 text-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-foreground">{t.deleteMessageTitle}</p>
                <p className="text-xs text-muted-foreground">{t.deleteMessageDesc}</p>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold active:bg-secondary/70"
              >{t.cancelBtn}</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 h-11 rounded-2xl bg-foreground text-sm font-bold text-background active:bg-foreground/80 disabled:opacity-60"
              >{deleting ? t.deletingLabel : t.confirmBtn}</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pt-2 pb-1">
              <p className="font-display font-bold text-sm text-foreground">{t.messageOptions}</p>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="pb-2">
              {msg.content && (
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary"
                >
                  <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span>{t.copyMessage}</span>
                </button>
              )}
              {isMine && (
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary"
                >
                  <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span>{t.deleteMessage}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function ChatConversation() {
  const { t } = useLang();
  const [, params] = useRoute("/chat/:id");
  const conversationId = params?.id ?? "";
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [pendingSharedTicket, setPendingSharedTicket] = useState<{ id: string; title: string; posterUrl: string | null } | null>(null);
  const [contextMsg, setContextMsg] = useState<ChatMessage | null>(null);
  const [requestAction, setRequestAction] = useState<"idle" | "accepting" | "declining">("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handleMsgDeleted = (msgId: string) => {
    qc.setQueryData(
      ["/api/chat/conversations", conversationId, "messages"],
      (old: { messages: ChatMessage[] } | undefined) => ({
        ...old,
        messages: (old?.messages ?? []).filter(m => m.id !== msgId),
      })
    );
  };

  const { data: convData } = useQuery<Conversation>({
    queryKey: ["/api/chat/conversations", conversationId],
    initialData: () => {
      const cached = qc.getQueryData<{ conversations: Conversation[] }>(["/api/chat/conversations"]);
      return cached?.conversations?.find(c => c.id === conversationId);
    },
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations/${conversationId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  });

  const { data: messagesData, refetch: refetchMessages } = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ["/api/chat/conversations", conversationId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages?limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!conversationId,
  });

  const messages = useMemo(() => {
    const seen = new Set<string>();
    return [...(messagesData?.messages ?? [])]
      .reverse()
      .filter(m => seen.has(m.id) ? false : !!seen.add(m.id));
  }, [messagesData?.messages]);
  const lastMsgId = messages[messages.length - 1]?.id;

  // Poll for new messages every 2s
  useEffect(() => {
    if (!conversationId || !lastMsgId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages?after=${lastMsgId}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length > 0) {
          qc.setQueryData(
            ["/api/chat/conversations", conversationId, "messages"],
            (old: { messages: ChatMessage[] } | undefined) => {
              const existingIds = new Set((old?.messages ?? []).map((m: ChatMessage) => m.id));
              const newOnes = ([...data.messages] as ChatMessage[]).filter(m => !existingIds.has(m.id)).reverse();
              if (newOnes.length === 0) return old;
              return {
                messages: [...newOnes, ...(old?.messages ?? [])],
                hasMore: (old as any)?.hasMore ?? false,
                nextCursor: (old as any)?.nextCursor ?? null,
              };
            }
          );
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [conversationId, lastMsgId, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Dismiss any device push notifications for this conversation
  // when the user has the thread open or new messages arrive.
  useEffect(() => {
    if (!conversationId) return;
    clearPushByTag(`chat:${conversationId}`);
  }, [conversationId, messages.length]);

  const sendMutation = useMutation({
    mutationFn: async ({ content, imageUrl, sharedTicketId }: { content?: string; imageUrl?: string; sharedTicketId?: string }) => {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageUrl, sharedTicketId }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<ChatMessage>;
    },
    onSuccess: (msg) => {
      qc.setQueryData(
        ["/api/chat/conversations", conversationId, "messages"],
        (old: { messages: ChatMessage[] } | undefined) => {
          const existing = old?.messages ?? [];
          if (existing.some((m: ChatMessage) => m.id === msg.id)) return old;
          return {
            messages: [msg, ...existing],
            hasMore: (old as any)?.hasMore ?? false,
            nextCursor: (old as any)?.nextCursor ?? null,
          };
        }
      );
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"], exact: true });
      setText("");
      setPendingSharedTicket(null);
    },
  });

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !pendingSharedTicket && !pendingImage) return;
    setUploadError("");

    if (pendingImage) {
      setUploadingImage(true);
      try {
        const uploadRes = await fetch("/api/storage/uploads/proxy", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": pendingImage.file.type },
          body: pendingImage.file,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { objectPath } = await uploadRes.json();
        const imageUrl = `/api/storage${objectPath}`;
        await sendMutation.mutateAsync({
          content: trimmed || undefined,
          imageUrl,
          sharedTicketId: pendingSharedTicket?.id,
        });
        URL.revokeObjectURL(pendingImage.previewUrl);
        setPendingImage(null);
      } catch (err) {
        console.error("Image upload failed", err);
        setUploadError(t.uploadImageError);
      } finally {
        setUploadingImage(false);
      }
      return;
    }

    sendMutation.mutate({
      content: trimmed || undefined,
      sharedTicketId: pendingSharedTicket?.id,
    });
  };

  const handleFileSelected = async (file: File) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file, CHAT_COMPRESS);
      const previewUrl = URL.createObjectURL(compressed);
      setPendingImage({ file: compressed, previewUrl });
      setUploadError("");
    } catch {
      setUploadError(t.imageLoadError);
    }
  };

  const cancelPendingImage = () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    setUploadError("");
  };

  const canSend = !!(text.trim() || pendingSharedTicket || pendingImage);

  const other = convData?.participants.find(p => p.id !== user?.id) ?? convData?.participants[0];
  const isRequest = convData?.isRequest ?? false;
  // Banner shown only to receiver (the person who did NOT send the first message)
  const firstSenderId = messages[0]?.senderId;
  const iAmReceiver = !!firstSenderId && firstSenderId !== user?.id;
  const showRequestBanner = isRequest && iAmReceiver;

  const handleAcceptRequest = async () => {
    setRequestAction("accepting");
    try {
      await fetch(`/api/chat/conversations/${conversationId}/accept-request`, { method: "POST", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations", conversationId] });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    } catch {}
    setRequestAction("idle");
  };

  const handleDeclineRequest = async () => {
    setRequestAction("declining");
    try {
      await fetch(`/api/chat/conversations/${conversationId}/decline-request`, { method: "DELETE", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      navigate("/chat");
    } catch {}
    setRequestAction("idle");
  };

  return (
    <div className="flex justify-center overflow-hidden" style={{ height: "100dvh", background: "var(--app-chrome)" }}>
    <div className="relative w-full max-w-[430px] h-full bg-background flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.08)]">
      {/* Message request banner — pinned to the top edge */}
      {showRequestBanner && (
        <div
          className="flex-shrink-0 border-b border-border bg-secondary/40 px-4 pb-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <p className="text-xs text-muted-foreground text-center mb-2.5">
            {t.messageRequestFrom(other?.displayName || other?.username || "")}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeclineRequest}
              disabled={requestAction !== "idle"}
              className="flex-1 h-9 rounded-2xl border border-border text-sm font-semibold text-foreground bg-background active:bg-secondary transition-colors disabled:opacity-50"
            >
              {requestAction === "declining" ? "..." : t.declineBtn}
            </button>
            <button
              onClick={handleAcceptRequest}
              disabled={requestAction !== "idle"}
              className="flex-1 h-9 rounded-2xl text-sm font-semibold bg-foreground text-background active:bg-foreground/80 transition-colors disabled:opacity-50"
            >
              {requestAction === "accepting" ? "..." : t.acceptBtn}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-background border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button onClick={() => navigate("/chat")} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          {other && (
            <Link href={`/profile/${other.username}`} className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="relative">
                {other.avatarUrl ? (
                  <img src={other.avatarUrl} alt={other.displayName ?? ""} className="w-9 h-9 rounded-2xl object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-2xl bg-black border border-white/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-white">{(other.displayName || other.username)?.[0]?.toUpperCase()}</span>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="font-bold text-sm text-foreground truncate">{other.displayName || other.username}</p>
                  {isVerified(other.username) && <VerifiedBadge className="w-3.5 h-3.5 flex-shrink-0" />}
                  <BadgeIcon userId={other.id} />
                </div>
                <p className="text-xs text-muted-foreground">@{other.username}</p>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isMine={msg.senderId === user?.id}
            onLongPress={setContextMsg}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Message context menu */}
      {contextMsg && (
        <MessageContextMenu
          msg={contextMsg}
          isMine={contextMsg.senderId === user?.id}
          onClose={() => setContextMsg(null)}
          onDeleted={handleMsgDeleted}
        />
      )}

      {/* Pending shared ticket preview */}
      {pendingSharedTicket && (
        <div className="mx-4 mb-2 flex items-center gap-2 bg-secondary rounded-2xl p-3 border border-border">
          {pendingSharedTicket.posterUrl && (
            <img src={pendingSharedTicket.posterUrl} alt="" className="w-8 h-12 object-cover rounded-lg" />
          )}
          <Film className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <p className="text-xs font-medium text-foreground flex-1 truncate">{pendingSharedTicket.title}</p>
          <button onClick={() => setPendingSharedTicket(null)} className="p-1">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Pending image preview */}
      {pendingImage && (
        <div className="mx-4 mb-2 relative inline-flex">
          <div className="relative">
            <img
              src={pendingImage.previewUrl}
              alt="preview"
              className="h-24 rounded-2xl object-cover border border-border"
            />
            <button
              onClick={cancelPendingImage}
              className="absolute -top-2 -right-2 w-6 h-6 bg-foreground rounded-full flex items-center justify-center shadow"
            >
              <X className="w-3.5 h-3.5 text-background" />
            </button>
          </div>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="mx-4 mb-2">
          <p className="text-xs text-red-500 font-medium">{uploadError}</p>
        </div>
      )}

      {/* Input bar */}
      <div className="flex-shrink-0 px-4 py-3 pb-safe bg-background border-t border-border flex items-end gap-2">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingImage || !!pendingImage}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 disabled:opacity-50"
        >
          <Image className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="flex-1 bg-secondary rounded-3xl border border-transparent focus-within:border-border transition-colors flex items-end px-4 py-2.5 min-h-[42px]">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t.typePlaceholder}
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none max-h-32 leading-relaxed"
            style={{ minHeight: "20px" }}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!canSend || sendMutation.isPending || uploadingImage}
          className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
        >
          <Send className="w-4 h-4 text-background" />
        </button>
      </div>
    </div>
    </div>
  );
}
