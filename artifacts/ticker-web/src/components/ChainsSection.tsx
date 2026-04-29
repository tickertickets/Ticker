import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import { Loader2, Link2, Heart, MessagesSquare, Share2, X, Trash2, Users, Search, Bookmark, Flag, Send, MessageCircle, Check } from "lucide-react";
import { useModalBackButton } from "@/hooks/use-modal-back-button";
import { cn, fmtCount } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";

export type ChainItem = {
  id: string;
  title: string;
  description?: string | null;
  descriptionAlign?: "left" | "center" | "right" | null;
  movieCount: number;
  chainCount: number;
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  isPrivate?: boolean;
  hideComments?: boolean;
  hideLikes?: boolean;
  hideChainCount?: boolean;
  mode?: string | null;
  challengeDurationMs?: number | null;
  movies: { posterUrl?: string | null; genre?: string | null }[];
  user?: { id?: string; username?: string | null; displayName?: string | null; avatarUrl?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
  foundMovieIds?: string[] | null;
  foundMovieCount?: number | null;
};

type ChainComment = {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

// ── Chain Comment Sheet ─────────────────────────────────────────────────────

export function ChainCommentSheet({ chainId, onClose, commentCount: initialCommentCount = 1, onCommentAdded, onCommentDeleted }: { chainId: string; onClose: () => void; commentCount?: number; onCommentAdded?: () => void; onCommentDeleted?: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  useModalBackButton(onClose);

  const { data, refetch, isLoading: commentsLoading } = useQuery<{ comments: ChainComment[] }>({
    queryKey: [`chain-comments-${chainId}`],
    queryFn: async () => {
      const res = await fetch(`/api/chains/${chainId}/comments`);
      if (!res.ok) return { comments: [] };
      return res.json();
    },
  });

  const comments = data?.comments ?? [];

  const qc = useQueryClient();

  const handleSubmit = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/chains/${chainId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: comment.trim() }),
      });
      setComment("");
      refetch();
      onCommentAdded?.();
      // Invalidate feed caches so counts refresh when sheet is closed
      qc.invalidateQueries({ queryKey: ["chains-recent"] });
      qc.invalidateQueries({ queryKey: ["chains-hot"] });
      qc.invalidateQueries({ queryKey: ["home-mixed-feed"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-created"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
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
            {t.commentsLabel}{comments.length > 0 ? ` (${comments.length})` : ""}
          </p>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-3 min-h-0">
          {commentsLoading ? (
            <div className="flex flex-col px-4 py-2">
              {Array.from({ length: Math.min(Math.max(initialCommentCount, 1), 8) }).map((_, i) => (
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
          ) : comments.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">{t.beFirstToComment}</p>
          ) : (
            comments.map(c => {
              const timeStr = t.relativeTimeShort(Date.now() - new Date(c.createdAt).getTime());
              return (
                <div key={c.id} className="flex gap-3 px-4 py-2.5">
                  <div className="w-8 h-8 rounded-2xl bg-black flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/10">
                    {c.avatarUrl
                      ? <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-white">{(c.displayName || c.username || "?")?.[0]?.toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-bold text-foreground">{c.displayName || c.username}</span>
                      <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                      {user && user.id === c.userId && (
                        <button
                          onClick={async () => {
                            // Optimistic: remove immediately from UI
                            qc.setQueryData<{ comments: ChainComment[] }>([`chain-comments-${chainId}`], old =>
                              old ? { comments: old.comments.filter(x => x.id !== c.id) } : old
                            );
                            onCommentDeleted?.();
                            try {
                              await fetch(`/api/chains/${chainId}/comments/${c.id}`, { method: "DELETE", credentials: "include" });
                              qc.invalidateQueries({ queryKey: ["chains-recent"] });
                              qc.invalidateQueries({ queryKey: ["chains-hot"] });
                              qc.invalidateQueries({ queryKey: ["home-mixed-feed"] });
                              qc.invalidateQueries({ queryKey: ["profile-chains-created"] });
                              qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
                            } catch {
                              // Restore on failure
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
                : <span className="text-xs font-bold text-white">{(user.displayName || user.username || "?")?.[0]?.toUpperCase()}</span>
              }
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

// ── Chain Comment Bubble (cycling preview on card front) ─────────────────────
function ChainCommentBubble({ chainId, commentCount }: { chainId: string; commentCount: number }) {
  const { data } = useQuery<{ comments: ChainComment[] }>({
    queryKey: [`chain-comments-preview-${chainId}`],
    queryFn: async () => {
      const res = await fetch(`/api/chains/${chainId}/comments?limit=6`);
      if (!res.ok) return { comments: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: commentCount > 0,
  });

  const comments = data?.comments ?? [];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (comments.length <= 1) return;
    const t = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % comments.length);
        setShow(true);
      }, 300);
    }, 3500);
    return () => clearInterval(t);
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
        <span className="font-semibold text-foreground/85">{c.displayName || c.username || ""}</span>
        {" "}{c.content}
      </p>
    </div>
  );
}

// ── Genre tag helpers ───────────────────────────────────────────────────────

function getGenreTags(movies: { genre?: string | null }[]): string[] {
  const genres = new Set<string>();
  movies.forEach(m => {
    if (m.genre) {
      m.genre.split(",").map(g => g.trim()).filter(Boolean).forEach(g => genres.add(g));
    }
  });
  return Array.from(genres).slice(0, 4);
}

// ── Poster collage (160×240 centered, matching TCG card area) ──────────────

export function PosterCollage({ posters, emptyIcon }: { posters: string[]; emptyIcon?: React.ReactNode }) {
  const count = posters.length;

  if (count === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-secondary">
        {emptyIcon ?? <Link2 className="w-8 h-8 text-muted-foreground/40" />}
      </div>
    );
  }

  if (count === 1) {
    return <img src={posters[0]} alt="" className="absolute inset-0 w-full h-full object-cover" />;
  }

  if (count <= 3) {
    return (
      <div className="absolute inset-0 flex gap-px bg-black">
        {posters.map((url, i) => (
          <div key={i} className="flex-1 relative overflow-hidden">
            <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-black">
      {posters.map((url, i) => (
        <div key={i} className="relative overflow-hidden">
          <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
}

// ── ChainShareModal — two-step (entry sheet → chat picker) ──────────────────
// Mirrors the Ticket share flow: a small entry sheet with two side-by-side
// buttons ("Send in Chat" + "Copy Link"). "Send in Chat" opens the full
// ChainSendToChatModal chat picker; "Copy Link" copies the chain URL inline.

type ConvParticipant = { id: string; username: string; displayName: string | null; avatarUrl: string | null };
type Conversation = { id: string; participants: ConvParticipant[]; unreadCount: number };

export function ChainShareModal({ chain, onClose }: { chain: ChainItem; onClose: () => void }) {
  const { t } = useLang();
  const [linkCopied, setLinkCopied] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useModalBackButton(onClose);

  // Slide-in animation
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Lock background scroll while the entry sheet is open
  useEffect(() => {
    if (chatPickerOpen) return;
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
  }, [chatPickerOpen]);

  const handleCopyLink = useCallback(async () => {
    const link = `${window.location.origin}/chain/${chain.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement("textarea");
      el.value = link;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2_000);
  }, [chain.id]);

  // When user picks "Send in Chat", swap to the full chat picker. The picker
  // owns its own portal/backdrop and closes back to the parent (onClose) when
  // sent — so we don't need to render the entry sheet underneath.
  if (chatPickerOpen) {
    return <ChainSendToChatModal chain={chain} onClose={onClose} />;
  }

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
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
          transform: `translateX(-50%) translateY(${visible ? "0" : "100%"})`,
          transition: "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.22)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag pill */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-2 pb-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground">{t.sendToFriend}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1.5">
              <Link2 className="w-3 h-3 flex-shrink-0" strokeWidth={2.75} />
              <span className="truncate">{chain.title}</span>
            </p>
          </div>
          <button onPointerDown={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary flex-shrink-0">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Action buttons row — same layout as ShareStoryModal */}
        <div className="px-5 pt-5">
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setChatPickerOpen(true)}
              className="flex items-center gap-2 border border-border text-foreground text-sm font-medium px-5 py-3 rounded-2xl active:scale-95 hover:bg-secondary transition-all"
            >
              <MessageCircle className="w-4 h-4" />
              {t.sendInChatBtn}
            </button>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 border border-border text-foreground text-sm font-medium px-5 py-3 rounded-2xl active:scale-95 hover:bg-secondary transition-all"
            >
              {linkCopied
                ? <><Check className="w-4 h-4 text-green-500" /> {t.copiedLabel}</>
                : <><Link2 className="w-4 h-4" /> {t.copyLinkBtn}</>}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── ChainSendToChatModal — full chat-picker sheet ───────────────────────────
// (Internal — opened from ChainShareModal when user picks "Send in Chat".)

function ChainSendToChatModal({ chain, onClose }: { chain: ChainItem; onClose: () => void }) {
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
  const searchResults = (usersData?.users ?? []).filter((u: ConvParticipant) => u.id !== user?.id);

  const handleSendToConversation = async (convId: string) => {
    setSending(convId);
    try {
      await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedChainId: chain.id }),
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
      if (!res.ok) throw new Error("failed");
      const conv = await res.json();
      await handleSendToConversation(conv.id);
    } catch {} finally {
      setSending(null);
    }
  };

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
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <div className="flex items-center gap-3 px-4 pt-2 pb-3 border-b border-border flex-shrink-0">
          <div className="flex-1">
            <p className="font-bold text-sm text-foreground">{t.sendToFriend}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1.5">
              <Link2 className="w-3 h-3 flex-shrink-0" strokeWidth={2.75} />
              {chain.title}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

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

        <div className="overflow-y-auto flex-1">
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
                    <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center">
                      {isSent
                        ? <span className="text-xs text-background">✓</span>
                        : sending === conv.id
                        ? <Loader2 className="w-3.5 h-3.5 text-background animate-spin" />
                        : <Send className="w-3.5 h-3.5 text-background" />}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {!search.trim() && filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t.noChats}</p>
          )}
          {search.trim() && filtered.length === 0 && searchResults.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t.noUsersFoundShort}</p>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}


// ── Description block — "ดูเพิ่มเติม" navigates to chain detail ──────────────
function ChainDescBlock({ text, chainId, align }: { text: string; chainId: string; align?: "left" | "center" | "right" | null }) {
  const [, navigate] = useLocation();
  const { t } = useLang();
  const isLong = text.length > 80 || text.includes("\n");
  const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
  return (
    <div className={cn("w-full", alignClass)}>
      <p
        className={cn(
          "mt-1 text-xs text-muted-foreground leading-relaxed break-words whitespace-pre-wrap",
          isLong && "max-h-[60px] overflow-hidden"
        )}
        style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
      >
        {text}
      </p>
      {isLong && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/chain/${chainId}`); }}
          className="mt-1 text-[11px] font-semibold text-muted-foreground"
        >
          {t.readMore}
        </button>
      )}
    </div>
  );
}

// ── ChainReportButton ─────────────────────────────────────────────────────────
function ChainReportButton({ chainId, className }: { chainId: string; className?: string }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const handleReport = async (reason: string) => {
    try {
      const res = await fetch(`/api/chains/${chainId}/report`, {
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

// ── ChainCard — matches FeedCard layout exactly ─────────────────────────────

export function ChainCard({ chain }: { chain: ChainItem }) {
  const { t } = useLang();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [liked, setLiked] = useState(chain.isLiked ?? false);
  const [likeCount, setLikeCount] = useState(chain.likeCount ?? 0);
  const [bookmarked, setBookmarked] = useState(chain.isBookmarked ?? false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(chain.commentCount ?? 0);
  const [deleting, setDeleting] = useState(false);

  // Sync local state when cache updates from another tab/component
  useEffect(() => { setLiked(chain.isLiked ?? false); }, [chain.isLiked]);
  useEffect(() => { setLikeCount(chain.likeCount ?? 0); }, [chain.likeCount]);
  useEffect(() => { setBookmarked(chain.isBookmarked ?? false); }, [chain.isBookmarked]);
  useEffect(() => { setCommentCount(chain.commentCount ?? 0); }, [chain.commentCount]);

  const isOwner = user?.id === chain.user?.id;

  const avatarUrl = chain.user?.avatarUrl;
  const posters = chain.movies.slice(0, 4).map(m => m.posterUrl).filter(Boolean) as string[];
  const tags = getGenreTags(chain.movies);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; }
    const next = !liked;
    setLiked(next);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    const patchChainList = (old: { chains: ChainItem[] } | undefined) => ({
      ...old,
      chains: (old?.chains ?? []).map((c: ChainItem) =>
        c.id === chain.id ? { ...c, isLiked: next, likeCount: next ? (c.likeCount ?? 0) + 1 : Math.max(0, (c.likeCount ?? 0) - 1) } : c
      ),
    });
    const patchMixedFeed = (old: any) => {
      if (!old?.items) return old;
      return {
        ...old,
        items: old.items.map((item: any) =>
          item.type === "chain" && item.chain?.id === chain.id
            ? { ...item, chain: { ...item.chain, isLiked: next, likeCount: next ? (item.chain.likeCount ?? 0) + 1 : Math.max(0, (item.chain.likeCount ?? 0) - 1) } }
            : item
        ),
      };
    };
    qc.setQueryData(["chains-recent"], patchChainList);
    qc.setQueryData(["chains-hot"], patchChainList);
    qc.setQueriesData({ queryKey: ["home-mixed-feed"] }, patchMixedFeed);
    qc.invalidateQueries({ queryKey: ["profile-chains-created"] });
    qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
    try {
      await fetch(`/api/chains/${chain.id}/like`, {
        method: next ? "POST" : "DELETE",
        credentials: "include",
      });
    } catch {
      setLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShareOpen(true);
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; }
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await fetch(`/api/chains/${chain.id}/bookmark`, {
        method: next ? "POST" : "DELETE",
        credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["/api/chains/bookmarked"] });
    } catch {
      setBookmarked(!next);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await fetch(`/api/chains/${chain.id}`, { method: "DELETE", credentials: "include" });
      const removeChain = (old: { chains: ChainItem[] } | undefined) =>
        ({ ...old, chains: (old?.chains ?? []).filter((c: ChainItem) => c.id !== chain.id) });
      qc.setQueryData(["chains-own-following", user?.id], removeChain);
      qc.setQueryData(["chains-hot-following"], removeChain);
      qc.setQueryData(["chains-recent"], removeChain);
      qc.setQueryData(["chains-hot"], removeChain);
      qc.invalidateQueries({ queryKey: ["chains-own-following"] });
      qc.invalidateQueries({ queryKey: ["chains-hot-following"] });
      qc.invalidateQueries({ queryKey: ["home-mixed-feed"] });
    } catch {}
    setDeleting(false);
  };

  return (
    <>
      <div className="bg-background pb-4 border-b border-border/50">
        {/* Creator row */}
        <div className="flex items-center gap-2.5 pl-0 pr-4 pt-3 pb-3">
          <Link href={`/profile/${chain.user?.username}`}>
            <div className="flex items-end gap-2 bg-secondary rounded-r-2xl pl-3 pr-3 py-1.5 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg overflow-hidden bg-black border border-white/10 flex items-center justify-center flex-shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={chain.user?.displayName ?? ""} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-white">
                    {chain.user?.displayName?.[0]?.toUpperCase() ?? "T"}
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <p className="text-[13px] font-bold text-foreground leading-none">{chain.user?.displayName || chain.user?.username || "Unknown"}</p>
                  {isVerified(chain.user?.username) && <VerifiedBadge className="w-[13px] h-[13px]" />}
                  {chain.user?.id && <BadgeIcon userId={chain.user.id} size={13} />}
                </div>
                <div className="flex items-center gap-[3px] mt-[2px]">
                  <div className="w-[13px] h-[13px] rounded-[3px] bg-foreground flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-[8px] h-[8px] text-background" />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium leading-none">Chains</span>
                </div>
              </div>
            </div>
          </Link>
          {isOwner ? (
            <button
              onClick={handleDelete}
              className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {deleting
                ? <span className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin block" />
                : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          ) : !isVerified(chain.user?.username) ? (
            <ChainReportButton chainId={chain.id} className="ml-auto" />
          ) : null}
        </div>

        {/* Poster collage — centered 160px wide, 2:3 ratio (same as TCG card) */}
        <Link href={`/chain/${chain.id}`}>
          <div className="flex justify-center px-4">
            <div
              style={{ width: 160, aspectRatio: "2/3", position: "relative", overflow: "hidden", borderRadius: "0.75rem" }}
            >
              {chain.mode === "hunt" ? (
                <div className="hunt-cover-bg absolute inset-0 flex items-center justify-center">
                  <Search className="hunt-cover-icon w-10 h-10" />
                </div>
              ) : (
                <PosterCollage posters={posters} />
              )}
              {/* Mode badge overlay */}
              {(() => {
                const isHunt = chain.mode === "hunt";
                const isCommunity = chain.mode === "community";
                const isChallenge = !!chain.challengeDurationMs;
                const isFound = isHunt && (chain.foundMovieIds?.length ?? chain.foundMovieCount ?? 0) > 0;
                if (!isHunt && !isCommunity && !isChallenge) return null;
                const bgColor = isFound ? "#a855f7" : isHunt ? "#6b7280" : isChallenge ? "#ef4444" : "#3b82f6";
                const label = isFound ? "FOUND" : isHunt ? "HUNT" : isChallenge ? "CHALLENGE" : "COMMUNITY";
                return (
                  <div style={{ position: "absolute", top: 4, right: 6, zIndex: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 6px", backgroundColor: bgColor, borderRadius: 999 }}>
                      <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", letterSpacing: "0.1em" }}>{label}</span>
                    </span>
                  </div>
                );
              })()}
              {/* Movie count badge */}
              {chain.movieCount > 0 && (
                <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm rounded-lg px-1.5 py-0.5 flex items-center gap-1">
                  <span className="text-[9px] font-bold text-white">{t.moviesCount(chain.movieCount)}</span>
                </div>
              )}
            </div>
          </div>
        </Link>

        {/* Title + description + tags (caption area) */}
        <div className="px-4 mt-5 text-center flex flex-col items-center">
          <p className="text-sm font-bold text-foreground leading-snug text-center break-words whitespace-pre-wrap w-full">
            {chain.title}
          </p>
          {!chain.hideChainCount && (
            <div className="flex items-center justify-center gap-1 mt-1">
              <Link2 className="w-3 h-3 text-muted-foreground" strokeWidth={2.75} />
              <span className="text-[11px] font-bold text-muted-foreground tabular-nums">{fmtCount(chain.chainCount)}</span>
            </div>
          )}
          {chain.description && (
            <div className="w-full mt-1">
              <ChainDescBlock text={chain.description} chainId={chain.id} align={chain.descriptionAlign} />
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5 mt-2">
              {tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-secondary text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {commentCount > 0 && (
          <div className="mt-3">
            <ChainCommentBubble chainId={chain.id} commentCount={commentCount} />
          </div>
        )}

        {/* Action bar — identical to FeedCard */}
        <div className="flex items-center justify-center gap-8 mt-4">
          <button
            onClick={handleLike}
            className="flex items-center gap-1.5 transition-all duration-100 active:scale-75 active:opacity-50 group outline-none focus:outline-none focus-visible:outline-none"
            style={{ WebkitTapHighlightColor: "transparent", outline: "none" }}
          >
            <Heart className={cn("w-[20px] h-[20px] transition-colors", liked ? "fill-foreground text-foreground" : "text-muted-foreground/60 group-hover:text-foreground")} />
            {likeCount > 0 && !chain.hideLikes && (
              <span className={cn("text-xs font-semibold tabular-nums leading-5", liked ? "text-foreground" : "text-muted-foreground/60")}>{fmtCount(likeCount)}</span>
            )}
          </button>

          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; } setCommentOpen(true); }}
            className="flex items-center gap-1.5 transition-all duration-100 active:scale-75 active:opacity-50 group"
          >
            <MessagesSquare className="w-[20px] h-[20px] text-muted-foreground/60 group-hover:text-foreground transition-colors" />
            {commentCount > 0 && (
              <span className="text-xs font-semibold tabular-nums leading-5 text-muted-foreground">{fmtCount(commentCount)}</span>
            )}
          </button>

          <button
            onClick={handleBookmark}
            className="flex items-center gap-1.5 transition-all duration-100 active:scale-75 active:opacity-50 group"
          >
            <Bookmark className={cn("w-[20px] h-[20px] transition-colors", bookmarked ? "fill-foreground text-foreground" : "text-muted-foreground/60 group-hover:text-foreground")} />
          </button>

          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); if (!user) { toast({ title: t.signInToLike, duration: 1500 }); return; } handleShare(e); }}
            className="flex items-center gap-1.5 transition-all duration-100 active:scale-75 active:opacity-50 group"
          >
            <Share2 className="w-[20px] h-[20px] text-muted-foreground/60 group-hover:text-foreground transition-colors" />
          </button>
        </div>

      </div>

      {commentOpen && (
        <ChainCommentSheet chainId={chain.id} onClose={() => setCommentOpen(false)} commentCount={commentCount} onCommentAdded={() => setCommentCount(c => c + 1)} onCommentDeleted={() => setCommentCount(c => Math.max(0, c - 1))} />
      )}
      {shareOpen && (
        <ChainShareModal chain={chain} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}

// ── Smart feed algorithm — Tier 1 (≤24 h, recency) / Tier 2 (hot score) ────
//
// Design: latest posts from the last 24 h always surface above older ones,
// sorted purely by age (newest first).  Posts older than 24 h fall into
// Tier 2 where engagement/time^1.5 determines rank.

function smartScore(chain: ChainItem): number {
  const ageHours = chain.createdAt
    ? (Date.now() - new Date(chain.createdAt).getTime()) / (1000 * 60 * 60)
    : 48;
  const engagement = (chain.likeCount ?? 0) + (chain.commentCount ?? 0) * 2 + (chain.chainCount ?? 0) * 3;

  if (ageHours <= 24) {
    // Tier 1 — floor is 9 000; newest chain ≈ 10 000, 24 h-old ≈ 9 760.
    // Engagement adds a tiny tiebreaker nudge so two equal-age chains
    // with different activity aren't totally identical.
    const ageMinutes = ageHours * 60;
    return 10_000 - ageMinutes + engagement * 0.01;
  }

  // Tier 2 — hot score (always < 500, never overlaps Tier 1)
  const hoursAfterGrace = ageHours - 22;          // smooth boundary
  return (Math.max(1, engagement) / Math.pow(hoursAfterGrace, 1.5)) * 100;
}

// ── ChainsSection (unified smart feed — no new/popular split) ───────────────

export function ChainsSection() {
  const { t } = useLang();
  const { data: recentData, isLoading: recentLoading } = useQuery<{ chains: ChainItem[] }>({
    queryKey: ["chains-recent"],
    queryFn: async () => {
      const res = await fetch("/api/chains?limit=15");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 60 * 2,
  });

  const { data: hotData, isLoading: hotLoading } = useQuery<{ chains: ChainItem[] }>({
    queryKey: ["chains-hot"],
    queryFn: async () => {
      const res = await fetch("/api/chains/hot?limit=15");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 60 * 2,
  });

  const isLoading = recentLoading || hotLoading;

  const chains: ChainItem[] = (() => {
    const all = [...(recentData?.chains ?? []), ...(hotData?.chains ?? [])];
    const seen = new Set<string>();
    const deduped = all.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return deduped.sort((a, b) => smartScore(b) - smartScore(a));
  })();

  return (
    <div className="pb-4">
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : chains.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t.noChainsFeed}</div>
      ) : (
        <div className="flex flex-col">
          {chains.map(c => (
            <ChainCard key={c.id} chain={c} />
          ))}
        </div>
      )}
    </div>
  );
}
