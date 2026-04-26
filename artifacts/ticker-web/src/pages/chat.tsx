import { useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Search, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/utils";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { BadgeIcon } from "@/components/BadgeIcon";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { useLang } from "@/lib/i18n";

type ConvParticipant = {
  id: string; username: string; displayName: string | null; avatarUrl: string | null;
};

type SharedTicket = {
  id: string; movieTitle: string; posterUrl: string | null; rating: number | null; ratingType: string | null;
} | null;

type LastMessage = {
  id: string; senderId: string; content: string | null; imageUrl: string | null;
  sharedTicket: SharedTicket; createdAt: string;
} | null;

type Conversation = {
  id: string;
  isRequest: boolean;
  participants: ConvParticipant[];
  lastMessage: LastMessage;
  unreadCount: number;
  updatedAt: string;
};

function ConvAvatar({ user, size = 40 }: { user: ConvParticipant; size?: number }) {
  const name = user.displayName || user.username || "?";
  if (user.avatarUrl) {
    const rounded = size >= 48 ? "rounded-2xl" : size >= 36 ? "rounded-xl" : "rounded-lg";
    return <img src={user.avatarUrl} alt={name} style={{ width: size, height: size }} className={`${rounded} object-cover flex-shrink-0`} />;
  }
  const rounded = size >= 48 ? "rounded-2xl" : size >= 36 ? "rounded-xl" : "rounded-lg";
  return (
    <div style={{ width: size, height: size }} className={`${rounded} bg-black flex items-center justify-center flex-shrink-0 border border-white/10`}>
      <span className="text-sm font-bold text-white">{name[0]?.toUpperCase()}</span>
    </div>
  );
}

function lastMsgPreview(msg: LastMessage, myId: string, noMsg: string, imageMsg: string, youPrefix: string): string {
  if (!msg) return noMsg;
  const prefix = msg.senderId === myId ? youPrefix : "";
  if (msg.imageUrl) return prefix + imageMsg;
  if (msg.sharedTicket) return prefix + msg.sharedTicket.movieTitle;
  return prefix + (msg.content ?? "");
}

function ConvContextMenu({ convId, onClose }: { convId: string; onClose: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/chat/conversations/${convId}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        qc.setQueryData<{ conversations: Conversation[] }>(
          ["/api/chat/conversations"],
          old => ({ conversations: (old?.conversations ?? []).filter(c => c.id !== convId) })
        );
        qc.removeQueries({ queryKey: ["/api/chat/conversations", convId] });
        qc.removeQueries({ queryKey: ["/api/chat/conversations", convId, "messages"] });
      }
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
                <p className="font-bold text-sm text-foreground">{t.leaveConvTitle}</p>
                <p className="text-xs text-muted-foreground">{t.leaveConvDesc}</p>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold active:bg-secondary/70">{t.cancelBtn}</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 h-11 rounded-2xl bg-foreground text-sm font-bold text-background active:bg-foreground/80 disabled:opacity-60">{deleting ? t.deletingLabel : t.confirmBtn}</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pt-2 pb-1">
              <p className="font-display font-bold text-sm text-foreground">{t.manageChat}</p>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="pb-2">
              <button onClick={handleDelete} className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary">
                <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center"><Trash2 className="w-4 h-4 text-muted-foreground" /></div>
                <span>{t.leaveConv}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function ConvRow({ conv, userId, onLongPress, isRequest = false }: {
  conv: Conversation; userId: string;
  onLongPress: (id: string) => void; isRequest?: boolean;
}) {
  const { t } = useLang();
  const other = conv.participants.find(p => p.id !== userId) ?? conv.participants[0]!;
  const hasUnread = conv.unreadCount > 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  const startPress = () => { longPressTimer = setTimeout(() => onLongPress(conv.id), 500); };
  const cancelPress = () => { if (longPressTimer) clearTimeout(longPressTimer); };
  return (
    <div
      className="relative"
      onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress}
      onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
    >
      <Link href={`/chat/${conv.id}`}>
        <div className={`flex items-center gap-3 bg-background rounded-2xl p-3 border border-border active:bg-secondary transition-colors ${isRequest ? "opacity-75" : ""}`}>
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-border bg-secondary">
              <ConvAvatar user={other} size={40} />
            </div>
            {hasUnread && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-foreground rounded-full border-2 border-background z-10" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0 mb-0.5">
              <span className={`text-sm leading-tight truncate ${hasUnread ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>
                {other.displayName || other.username}
              </span>
              {isVerified(other.username) && <VerifiedBadge className="w-3.5 h-3.5 flex-shrink-0" />}
              <BadgeIcon userId={other.id} />
            </div>
            <p className={`text-xs truncate ${hasUnread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {lastMsgPreview(conv.lastMessage, userId, t.noMessages, t.imageMsg, t.youPrefix)}
            </p>
          </div>
          {hasUnread && conv.unreadCount > 0 && (
            <span className="min-w-[20px] h-5 bg-foreground rounded-full flex items-center justify-center px-1.5 flex-shrink-0">
              <span className="text-[10px] font-black text-background">{conv.unreadCount}</span>
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}

export default function ChatList() {
  const { t } = useLang();
  const scrollRef = usePageScroll("chat-list");
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextConvId, setContextConvId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["/api/chat/conversations"],
    queryFn: async () => {
      const res = await fetch("/api/chat/conversations", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const conversations = data?.conversations ?? [];

  const filtered = conversations.filter(conv => {
    if (!searchQuery) return true;
    const other = conv.participants.find(p => p.id !== user?.id);
    const name = (other?.displayName || other?.username || "").toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const regularConvs = filtered.filter(c => !c.isRequest);
  const requestConvs = filtered.filter(c => c.isRequest);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button onClick={() => navigate("/")} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground flex-1">{t.chatTitle}</h1>
          <button
            onClick={() => setSearchOpen(v => !v)}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
          >
            <Search className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {searchOpen && (
          <div className="px-4 pb-3">
            <input
              type="text"
              placeholder={t.searchNamePlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
              className="w-full h-10 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-transparent focus:border-border"
            />
          </div>
        )}
      </div>

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-6 gap-4">
          <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
            <MessageCircle className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-display font-bold text-foreground">{t.noChats}</p>
            <p className="text-sm text-muted-foreground">{t.noChatsDesc}</p>
          </div>
        </div>
      )}

      {/* Message requests section */}
      {requestConvs.length > 0 && (
        <div>
          <div className="px-4 py-2.5 border-b border-border/40 bg-secondary/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t.messageRequestsLabel(requestConvs.length)}</p>
          </div>
          <div className="flex flex-col gap-2 pt-2 pb-0 px-4">
            {requestConvs.map(conv => <ConvRow key={conv.id} conv={conv} userId={user?.id ?? ""} onLongPress={setContextConvId} isRequest />)}
          </div>
          {regularConvs.length > 0 && (
            <div className="px-4 py-2.5 border-b border-border/40 bg-secondary/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t.messagesLabel}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 py-2 px-4">
        {regularConvs.map(conv => <ConvRow key={conv.id} conv={conv} userId={user?.id ?? ""} onLongPress={setContextConvId} />)}
      </div>

      {contextConvId && (
        <ConvContextMenu convId={contextConvId} onClose={() => setContextConvId(null)} />
      )}
    </div>
  );
}
