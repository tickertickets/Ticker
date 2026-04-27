/**
 * profile.tsx
 *
 * Scroll strategy:
 * - ONE scrollable container ตลอดทั้งหน้า (header + tabs + content)
 * - key คงที่ = "profile_${username}" — ไม่เปลี่ยนเมื่อสลับ tab
 * - ซ่อน/แสดง tab content ด้วย CSS display — browser เก็บ scroll อัตโนมัติ
 */
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePageScroll } from "@/hooks/use-page-scroll";
import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { compressImage, AVATAR_COMPRESS } from "@/lib/image-compress";
import {
  useGetUserProfile,
  useFollowUser,
  useUnfollowUser,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketCard } from "@/components/TicketCard";
import { PosterCollage, ChainCommentSheet, ChainShareModal } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import {
  Loader2, Settings, Link2, Users, X, User as UserIcon,
  Camera, MessageCircle, Lock, Unlock, Flag, MoreHorizontal, ChevronLeft, Bookmark,
  Heart, Send, Pencil, Trash2, Ticket as TicketIcon, AtSign, Check, Search,
} from "lucide-react";
import { cn, fmtCount } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/i18n";
import type { Ticket } from "@workspace/api-client-react";
import { ReportSheet } from "@/components/ReportSheet";
import { VerifiedBadge, isVerified } from "@/components/VerifiedBadge";
import { BadgeIcon } from "@/components/BadgeIcon";
import { useToast } from "@/hooks/use-toast";

function formatRunDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Types ──────────────────────────────────────────────────────────────────

type ChainProfile = {
  id: string;
  title: string;
  description?: string | null;
  movieCount: number;
  chainCount: number;
  mode?: string | null;
  challengeDurationMs?: number | null;
  isPrivate?: boolean;
  hideComments?: boolean;
  hideLikes?: boolean;
  hideChainCount?: boolean;
  movies: { posterUrl?: string | null }[];
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  foundMovieCount?: number | null;
};

type RunProfile = {
  runId: string;
  status: string;
  completedCount: number;
  totalElapsedMs: number;
  startedAt: string;
  completedAt?: string | null;
  chain: { id: string; title: string; movieCount: number; chainCount?: number; mode?: string | null; challengeDurationMs?: number | null; movies: { posterUrl?: string | null }[]; likeCount?: number; commentCount?: number; isLiked?: boolean; isBookmarked?: boolean; foundMovieCount?: number | null; };
};

type FollowUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

// ── FollowListSheet ────────────────────────────────────────────────────────

function FollowListSheet({
  username, type, onClose,
}: { username: string; type: "followers" | "following"; onClose: () => void }) {
  const { t } = useLang();
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/users/${username}/${type}?limit=50`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { users: FollowUser[] }) => {
        if (!cancelled) { setUsers(d.users ?? []); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [username, type]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed bottom-0 z-[70] bg-background rounded-t-3xl flex flex-col"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(100%, 430px)",
          height: "80svh",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h2 className="font-display font-bold text-base text-foreground">
            {type === "followers" ? t.followers : t.followingLabel}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary">
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1" style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2">
              <Users className="w-8 h-8 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">{type === "followers" ? t.noFollowers : t.noFollowing}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-4 py-2">
              {users.map(u => (
                <button
                  key={u.id}
                  className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border active:bg-secondary transition-colors w-full text-left"
                  onClick={() => { onClose(); navigate(`/profile/${u.username}`); }}
                >
                  <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-border bg-secondary flex items-center justify-center">
                    {u.avatarUrl
                      ? <img src={u.avatarUrl} alt={u.displayName ?? u.username} className="w-full h-full object-cover" />
                      : <UserIcon className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-0.5 min-w-0">
                      <p className="font-bold text-sm text-foreground leading-tight truncate">{u.displayName ?? u.username}</p>
                      {isVerified(u.username) && <VerifiedBadge className="flex-shrink-0" />}
                      {u.id && <BadgeIcon userId={u.id} />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── EditProfileSheet ───────────────────────────────────────────────────────

function EditProfileSheet({
  profile, onClose, onUpdated,
}: {
  profile: { displayName?: string | null; bio?: string | null; avatarUrl?: string | null; username?: string | null };
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useLang();
  const qcEdit = useQueryClient();
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [avatarPreview, setAvatarPreview] = useState(profile.avatarUrl ?? "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [usernameValue, setUsernameValue] = useState(profile.username ?? "");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isUsernameValid = /^[a-zA-Z0-9_]{3,30}$/.test(usernameValue);
  const isUsernameUnchanged = usernameValue.toLowerCase() === (profile.username ?? "").toLowerCase();

  useEffect(() => {
    if (!isUsernameValid || isUsernameUnchanged) { setUsernameAvailable(null); setUsernameChecking(false); return; }
    setUsernameChecking(true);
    setUsernameAvailable(null);
    if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);
    usernameDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/check-username?username=${encodeURIComponent(usernameValue)}`);
        const data = await res.json();
        setUsernameAvailable(data.available);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setUsernameChecking(false);
      }
    }, 400);
    return () => { if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current); };
  }, [usernameValue, isUsernameValid, isUsernameUnchanged]);

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      document.documentElement.style.overflow = prev;
      document.body.style.overflow = "";
      document.removeEventListener("touchmove", block);
    };
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingAvatar(true);
    setError("");
    try {
      const compressed = await compressImage(file, AVATAR_COMPRESS);
      const preview = URL.createObjectURL(compressed);
      setAvatarPreview(preview);
      const uploadRes = await fetch("/api/storage/uploads/proxy", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": compressed.type }, body: compressed,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { objectPath } = await uploadRes.json();
      setAvatarUrl(`/api/storage${objectPath}`);
    } catch {
      setError(t.errUploadAvatar);
      setAvatarPreview(profile.avatarUrl ?? "");
    } finally {
      setUploadingAvatar(false);
    }
  };

  async function handleSave() {
    if (!displayName.trim()) { setError(t.errDisplayNameEmpty); return; }
    if (!isUsernameUnchanged && !isUsernameValid) { setError(t.errUsernameInvalid); return; }
    if (!isUsernameUnchanged && usernameAvailable === false) { setError(t.usernameTakenLabel); return; }
    setSaving(true);
    setError("");
    setUsernameError(null);
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl: avatarUrl || undefined }),
      });
      if (!res.ok) throw new Error("Failed");

      if (!isUsernameUnchanged && isUsernameValid && usernameAvailable !== false) {
        const uRes = await fetch("/api/users/me/username", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernameValue }),
        });
        const uData = await uRes.json();
        if (!uRes.ok) {
          setUsernameError(uData.message ?? t.errUsernameChangeFailed);
          setSaving(false);
          return;
        }
        try {
          const cached = localStorage.getItem("_usr");
          if (cached) {
            const parsed = JSON.parse(cached);
            parsed.username = uData.username;
            localStorage.setItem("_usr", JSON.stringify(parsed));
          }
        } catch { /* non-fatal */ }
        qcEdit.invalidateQueries({ queryKey: [`/api/users/${profile.username}`] });
      }

      // Sync localStorage cache immediately so useAuth shows updated name right away
      try {
        const cached = localStorage.getItem("_usr");
        if (cached) {
          const parsed = JSON.parse(cached);
          parsed.displayName = displayName.trim();
          if (avatarUrl) parsed.avatarUrl = avatarUrl;
          localStorage.setItem("_usr", JSON.stringify(parsed));
        }
      } catch { /* non-fatal */ }
      qcEdit.invalidateQueries({ queryKey: ["/api/auth/me"] });
      onUpdated();
      onClose();
    } catch {
      setError(t.errSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed bottom-0 z-[201] bg-background rounded-t-3xl overflow-hidden"
        style={{ left: "50%", transform: "translateX(-50%)", width: "min(100%, 430px)" }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <button onClick={onClose} className="text-sm text-muted-foreground font-medium">{t.cancelBtn}</button>
          <h2 className="font-display font-bold text-base text-foreground">{t.editProfile}</h2>
          <button onClick={handleSave} disabled={saving || uploadingAvatar} className="text-sm font-bold text-foreground disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t.saveBtn}
          </button>
        </div>
        <div
          className="px-6 pt-6 space-y-6 overflow-y-auto"
          style={{ maxHeight: "92vh", paddingBottom: "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 24px)" }}
        >
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <div className="flex flex-col items-center gap-2">
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}
              className="relative w-20 h-20 rounded-2xl overflow-hidden bg-secondary border-2 border-border flex items-center justify-center group">
              {avatarPreview ? <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" /> : <UserIcon className="w-8 h-8 text-muted-foreground" />}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingAvatar ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
              </div>
              {uploadingAvatar && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-5 h-5 text-white animate-spin" /></div>}
            </button>
            <p className="text-[11px] text-muted-foreground">{t.tapToChangeAvatar}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-widest">{t.displayNameLabel}</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={t.displayNamePlaceholder} maxLength={50}
              className="w-full px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-widest">{t.bioLabel}</label>
            <div className="relative">
              <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder={t.bioPlaceholder} maxLength={200} rows={3}
                className="w-full px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-none" />
              {bio.length >= 150 && (
                <p className={`absolute bottom-2 right-3 text-[10px] font-medium ${bio.length >= 200 ? "text-red-500" : "text-muted-foreground"}`}>
                  {bio.length}/200
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-widest">{t.usernameLabel}</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none pointer-events-none">@</span>
              <input
                value={usernameValue}
                onChange={e => { setUsernameValue(e.target.value.replace(/\s/g, "")); setUsernameError(null); }}
                placeholder="username"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full h-11 px-4 pl-7 pr-10 rounded-2xl border border-border bg-secondary text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center">
                {usernameChecking && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                {!usernameChecking && !isUsernameUnchanged && isUsernameValid && usernameAvailable === true && <Check className="w-3.5 h-3.5 text-green-500" />}
                {!usernameChecking && !isUsernameUnchanged && isUsernameValid && usernameAvailable === false && <X className="w-3.5 h-3.5 text-red-500" />}
              </div>
            </div>
            {!isUsernameValid && usernameValue.length > 0 && (
              <p className="text-[11px] text-muted-foreground px-1">{t.usernameFormatHint}</p>
            )}
            {!usernameChecking && !isUsernameUnchanged && isUsernameValid && usernameAvailable === false && (
              <p className="text-[11px] text-red-500 px-1">{t.usernameTakenLabel}</p>
            )}
            {!usernameChecking && !isUsernameUnchanged && isUsernameValid && usernameAvailable === true && (
              <p className="text-[11px] text-green-500 px-1">{t.usernameAvailableLabel}</p>
            )}
            {usernameError && <p className="text-[11px] text-red-500 px-1">{usernameError}</p>}
            <p className="text-[11px] text-muted-foreground px-1">{t.usernameChangeCooldown}</p>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── FilmsGrid ──────────────────────────────────────────────────────────────

function FilmsGrid({ tickets, isOwn }: { tickets: Ticket[]; isOwn: boolean }) {
  const { t } = useLang();
  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-3 text-center">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
          <TicketIcon className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-display font-bold text-base text-foreground">{t.noMovieCards}</p>
        {isOwn && (
          <Link href="/ticket/new">
            <div className="px-5 py-2.5 bg-foreground text-background rounded-2xl text-sm font-bold">{t.createCard}</div>
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap justify-center gap-2.5 px-3 pt-2 pb-8">
      {tickets.map(ticket => (
        <div key={String(ticket.id)} style={{ width: "calc(33.333% - 7px)" }}>
          <TicketCard ticket={ticket} compact />
        </div>
      ))}
    </div>
  );
}

// ── Chain context menu (bottom sheet, owner only) ────────────────────────────

function ChainContextMenu({
  chain, onClose, profileUserId,
}: {
  chain: ChainProfile;
  onClose: () => void;
  profileUserId?: string;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [visible, setVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-scroll-lock", "true");
    const id = requestAnimationFrame(() => setVisible(true));
    return () => {
      document.documentElement.removeAttribute("data-scroll-lock");
      cancelAnimationFrame(id);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClose = () => {
    if (timerRef.current !== null) return;
    setVisible(false);
    timerRef.current = setTimeout(onClose, 300);
  };

  const handleTogglePrivate = async () => {
    try {
      await fetch(`/api/chains/${chain.id}/privacy`, { method: "PATCH", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["profile-chains-created", profileUserId] });
      qc.invalidateQueries({ queryKey: ["home-mixed-feed"] });
      qc.invalidateQueries({ queryKey: ["chains-recent"] });
      qc.invalidateQueries({ queryKey: ["chains-hot"] });
      qc.invalidateQueries({ queryKey: ["chains-own-following"] });
      qc.invalidateQueries({ queryKey: ["chains-hot-following"] });
    } catch {}
    handleClose();
  };

  const handleToggleHideComments = async () => {
    try {
      await fetch(`/api/chains/${chain.id}/hide-comments`, { method: "PATCH", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["profile-chains-created", profileUserId] });
    } catch {}
    handleClose();
  };

  const handleToggleHideLikes = async () => {
    try {
      await fetch(`/api/chains/${chain.id}/hide-likes`, { method: "PATCH", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["profile-chains-created", profileUserId] });
    } catch {}
    handleClose();
  };

  const handleToggleHideChainCount = async () => {
    try {
      await fetch(`/api/chains/${chain.id}/hide-chain-count`, { method: "PATCH", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["profile-chains-created", profileUserId] });
    } catch {}
    handleClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    // Optimistic removal — remove immediately from all caches before the request
    const removeChain = (old: { chains: any[] } | undefined) =>
      old ? { ...old, chains: old.chains.filter((c: any) => c.id !== chain.id) } : old;
    const removeFromRuns = (old: { runs: any[] } | undefined) =>
      old ? { ...old, runs: old.runs.filter((r: any) => r.chain?.id !== chain.id) } : old;
    const removeFromMixed = (old: any) =>
      old?.items ? { ...old, items: old.items.filter((item: any) => !(item.type === "chain" && item.chain?.id === chain.id)) } : old;
    qc.setQueriesData({ queryKey: ["profile-chains-created"], exact: false }, removeChain);
    qc.setQueriesData({ queryKey: ["profile-chains-played"], exact: false }, removeFromRuns);
    qc.setQueryData(["chains-recent"], removeChain);
    qc.setQueryData(["chains-hot"], removeChain);
    qc.setQueriesData({ queryKey: ["chains-own-following"] }, removeChain);
    qc.setQueriesData({ queryKey: ["home-mixed-feed"] }, removeFromMixed);
    handleClose();
    try {
      await fetch(`/api/chains/${chain.id}`, { method: "DELETE", credentials: "include" });
      // Confirm removal with server refetch
      qc.invalidateQueries({ queryKey: ["profile-chains-created", profileUserId] });
      qc.invalidateQueries({ queryKey: ["profile-chains-played", profileUserId] });
      qc.invalidateQueries({ queryKey: ["chains-recent"] });
      qc.invalidateQueries({ queryKey: ["chains-hot"] });
    } catch {
      // Revert on failure by invalidating (will refetch original data)
      qc.invalidateQueries({ queryKey: ["profile-chains-created"] });
      qc.invalidateQueries({ queryKey: ["profile-chains-played"] });
      qc.invalidateQueries({ queryKey: ["chains-recent"] });
      qc.invalidateQueries({ queryKey: ["chains-hot"] });
    }
    setDeleting(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={cn(
          "relative w-full bg-background rounded-t-3xl transition-transform duration-300 ease-out",
          visible ? "translate-y-0" : "translate-y-full",
        )}
        style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <div className="px-5 pt-3 pb-3 border-b border-border/60">
          <p className="font-bold text-base text-foreground truncate">{chain.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t.moviesCount(chain.movieCount)}</p>
        </div>

        {confirmDelete ? (
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
              >{t.cancelBtn}</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-2xl bg-foreground text-sm font-semibold text-background transition-colors active:bg-foreground/80 disabled:opacity-60"
              >{deleting ? t.deletingLabel : t.confirmDeleteLabel}</button>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={() => {
                const partial = {
                  id: chain.id,
                  userId: "",
                  title: chain.title,
                  description: chain.description ?? null,
                  descriptionAlign: chain.descriptionAlign ?? null,
                  mode: chain.mode ?? "standard",
                  challengeDurationMs: chain.challengeDurationMs ?? null,
                  movies: [],
                  _partial: true,
                };
                qc.setQueryData(["/api/chains", chain.id], (old: any) => old ?? partial);
                // Store current path so edit-chain can navigate() back (avoids popstate/reload)
                sessionStorage.setItem("ticker:edit-chain-back", window.location.pathname + window.location.search);
                handleClose();
                setTimeout(() => navigate(`/chain/${chain.id}/edit`), 200);
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
              {chain.isPrivate ? (
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
                <Heart className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{chain.hideLikes ? t.showLikes : t.hideLikes}</span>
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleToggleHideComments}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{chain.hideComments ? t.enableComments : t.disableComments}</span>
            </button>
            <button
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-secondary transition-colors"
              onClick={handleToggleHideChainCount}
            >
              <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <Link2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <span>{chain.hideChainCount ? t.showChainCountLabel : t.hideChainCountLabel}</span>
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

// ── Compact 3-column chain card for profile (with action buttons) ───────────

function ProfileChainCard({
  chain,
  statusBadge,
  onLongPress,
  onLongPressEnd,
}: {
  chain: ChainItem;
  statusBadge?: React.ReactNode;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
}) {
  const isHunt = chain.mode === "hunt";
  const posters = isHunt ? [] : chain.movies.slice(0, 4).map(m => m.posterUrl).filter(Boolean) as string[];
  const [liked, setLiked] = useState(chain.isLiked ?? false);
  const [likeCount, setLikeCount] = useState(chain.likeCount ?? 0);
  const [commentCount, setCommentCount] = useState(chain.commentCount ?? 0);
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { t } = useLang();
  const { toast } = useToast();
  const [commentOpen, setCommentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  // Sync local state when cache updates from another tab/component
  useEffect(() => { setLiked(chain.isLiked ?? false); }, [chain.isLiked]);
  useEffect(() => { setLikeCount(chain.likeCount ?? 0); }, [chain.likeCount]);
  useEffect(() => { setCommentCount(chain.commentCount ?? 0); }, [chain.commentCount]);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; }
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
    const patchRunsList = (old: any) => {
      if (!old?.runs) return old;
      return {
        ...old,
        runs: old.runs.map((r: any) =>
          r.chain?.id === chain.id
            ? { ...r, chain: { ...r.chain, isLiked: next, likeCount: next ? (r.chain.likeCount ?? 0) + 1 : Math.max(0, (r.chain.likeCount ?? 0) - 1) } }
            : r
        ),
      };
    };
    qc.setQueryData(["chains-recent"], patchChainList);
    qc.setQueryData(["chains-hot"], patchChainList);
    qc.setQueriesData({ queryKey: ["home-mixed-feed"] }, patchMixedFeed);
    qc.setQueriesData({ queryKey: ["profile-chains-created"], exact: false }, patchChainList);
    qc.setQueriesData({ queryKey: ["profile-chains-played"], exact: false }, patchRunsList);
    try {
      await fetch(`/api/chains/${chain.id}/like`, { method: next ? "POST" : "DELETE", credentials: "include" });
      qc.invalidateQueries({ queryKey: ["/api/users"] });
    } catch {
      setLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    }
  };

  const handlePointerDown = () => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      onLongPress?.();
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (didLongPress.current) { onLongPressEnd?.(); didLongPress.current = false; }
  };

  return (
    <>
      <div
        className="bg-background rounded-2xl border border-border overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        <Link href={`/chain/${chain.id}`} onClick={e => { if (didLongPress.current) e.preventDefault(); }}>
          <div className="active:opacity-75 transition-opacity">
            <div className="relative" style={{ aspectRatio: "2/3" }}>
              {isHunt ? (
                <div className="hunt-cover-bg absolute inset-0 flex items-center justify-center">
                  <Search className="hunt-cover-icon w-8 h-8" />
                </div>
              ) : (
                <PosterCollage posters={posters} />
              )}
              {statusBadge && <div className="absolute top-1.5 right-1.5">{statusBadge}</div>}
              {chain.isPrivate && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-black/50 rounded-full flex items-center justify-center z-10">
                  <Lock className="w-2.5 h-2.5 text-white/70" />
                </div>
              )}
              {chain.movieCount > 0 && (
                <span className="absolute bottom-1.5 right-1.5 text-[10px] font-black text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{chain.movieCount}</span>
              )}
            </div>
            <div className="px-2 pt-1.5 pb-0.5 text-center">
              <p className="text-[11px] font-bold text-foreground line-clamp-1 leading-tight">{chain.title}</p>
              {!chain.hideChainCount && (
                <div className="flex items-center justify-center gap-0.5 mt-0.5">
                  <Link2 className="w-2.5 h-2.5 text-muted-foreground" strokeWidth={2.5} />
                  <span className="text-[10px] text-muted-foreground tabular-nums">{fmtCount(chain.chainCount ?? 0)}</span>
                </div>
              )}
            </div>
          </div>
        </Link>
        <div className="flex items-center justify-around px-1 pb-1.5 pt-0.5">
          <button onClick={handleLike} className="flex items-center gap-1 p-1 active:opacity-50" type="button">
            <Heart className={cn("w-3.5 h-3.5 transition-colors", liked ? "fill-foreground text-foreground" : "text-muted-foreground")} />
            {likeCount > 0 && !chain.hideLikes && <span className={cn("text-[9px] tabular-nums leading-none", liked ? "text-foreground" : "text-muted-foreground")}>{fmtCount(likeCount)}</span>}
          </button>
          <button onClick={e => { e.preventDefault(); e.stopPropagation(); if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; } setCommentOpen(true); }} className="flex items-center gap-1 p-1 active:opacity-50" type="button">
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
            {commentCount > 0 && <span className="text-[9px] text-muted-foreground tabular-nums leading-none">{fmtCount(commentCount)}</span>}
          </button>
          <button onClick={e => { e.preventDefault(); e.stopPropagation(); if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; } setShareOpen(true); }} className="p-1 active:opacity-50" type="button">
            <Send className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {commentOpen && <ChainCommentSheet chainId={chain.id} onClose={() => setCommentOpen(false)} commentCount={commentCount} onCommentAdded={() => setCommentCount(c => c + 1)} onCommentDeleted={() => setCommentCount(c => Math.max(0, c - 1))} />}
      {shareOpen && <ChainShareModal chain={chain} onClose={() => setShareOpen(false)} />}
    </>
  );
}

// ── Chain tab content ──────────────────────────────────────────────────────

function ChainTabContent({
  username, profileUserId, isOwn, displayName, profileLoaded, chainSubTab, avatarUrl,
}: {
  username: string; profileUserId?: string; isOwn: boolean; displayName?: string | null; profileLoaded: boolean;
  chainSubTab: "played" | "created"; avatarUrl?: string | null;
}) {
  const { t } = useLang();
  const [, navigate] = useLocation();
  const { data: createdChainsData, isLoading: createdLoading } = useQuery({
    queryKey: ["profile-chains-created", profileUserId],
    queryFn: async () => {
      const res = await fetch(`/api/chains?userId=${profileUserId}&limit=20`);
      if (!res.ok) return { chains: [] };
      return res.json() as Promise<{ chains: ChainProfile[] }>;
    },
    enabled: !!profileUserId && profileLoaded,
    staleTime: 0,
  });

  const { data: playedRunsData, isLoading: playedLoading } = useQuery({
    queryKey: ["profile-chains-played", profileUserId],
    queryFn: async () => {
      const res = await fetch(`/api/chains/runs?userId=${profileUserId}`);
      if (!res.ok) return { runs: [] };
      return res.json() as Promise<{ runs: RunProfile[] }>;
    },
    enabled: !!profileUserId && profileLoaded,
  });

  const [chainMenu, setChainMenu] = useState<ChainProfile | null>(null);

  const handleChainLongPress = (chain: ChainProfile) => {
    if (isOwn) setChainMenu(chain);
  };

  return (
    <>
    <div>
      {/* played sub-tab */}
      <div style={{ display: chainSubTab === "played" ? "block" : "none" }}>
        {(playedRunsData?.runs ?? []).length === 0 && !playedLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
              <Link2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="font-bold text-sm text-foreground">{isOwn ? t.noChainPlayedOwn : t.noChainPlayedOther(displayName ?? "")}</p>
            {isOwn && <button onClick={() => navigate("/following?tab=chains")} className="px-5 py-2.5 bg-foreground text-background rounded-2xl text-sm font-bold">{t.exploreChainsBtn}</button>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-3 pt-2 pb-8">
            {(playedRunsData?.runs ?? []).map(run => {
              const isChallenge = !!run.chain.challengeDurationMs;
              const ms = run.totalElapsedMs;
              const isLive = run.status === "live";
              const chainItem: ChainItem = {
                id: run.chain.id,
                title: run.chain.title,
                movieCount: run.chain.movieCount,
                chainCount: run.chain.chainCount ?? 0,
                movies: run.chain.movies,
                likeCount: run.chain.likeCount ?? 0,
                commentCount: run.chain.commentCount ?? 0,
                isLiked: run.chain.isLiked ?? false,
                isBookmarked: run.chain.isBookmarked ?? false,
              };
              const isCommunity = run.chain.mode === "community";
              const isHunt = run.chain.mode === "hunt";
              const isFound = isHunt && (run.chain.foundMovieCount ?? 0) > 0;
              const badge = isHunt ? (
                <span className="flex items-center px-1.5 py-0.5 rounded-full" style={{ backgroundColor: isFound ? "#a855f7" : "#6b7280" }}>
                  <span className="text-[9px] font-black text-white tracking-widest">{isFound ? "FOUND" : "HUNT"}</span>
                </span>
              ) : isCommunity ? (
                <span className="flex items-center px-1.5 py-0.5 bg-blue-500 rounded-full">
                  <span className="text-[9px] font-black text-white tracking-widest">COMMUNITY</span>
                </span>
              ) : !isChallenge ? undefined : isLive ? (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-500 rounded-full">
                  <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                  <span className="text-[9px] font-black text-white tracking-widest">LIVE</span>
                </span>
              ) : run.status === "completed" && ms > 0 ? (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-500/90 backdrop-blur-sm rounded-full">
                  <span className="text-[9px] font-bold text-white tabular-nums">{formatRunDuration(ms)}</span>
                </span>
              ) : undefined;
              return (
                <ProfileChainCard key={run.runId} chain={chainItem} statusBadge={badge} />
              );
            })}
          </div>
        )}
      </div>

      {/* created sub-tab */}
      <div style={{ display: chainSubTab === "created" ? "block" : "none" }}>
        {(createdChainsData?.chains ?? []).length === 0 && !createdLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center">
              <Link2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="font-bold text-sm text-foreground">{isOwn ? t.noChainCreatedOwn : t.noChainCreatedOther(displayName ?? "")}</p>
            {isOwn && <Link href="/chain/new"><div className="px-5 py-2.5 bg-foreground text-background rounded-2xl text-sm font-bold">{t.createNewChainBtn}</div></Link>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-3 pt-2 pb-8">
            {(createdChainsData?.chains ?? []).map(chain => (
              <ProfileChainCard
                key={chain.id}
                chain={{
                  ...chain,
                  movies: chain.movies.map(m => ({ posterUrl: m.posterUrl, genre: null })),
                }}
                statusBadge={chain.mode === "hunt" ? (
                  <span className="flex items-center px-1.5 py-0.5 rounded-full" style={{ backgroundColor: (chain.foundMovieCount ?? 0) > 0 ? "#a855f7" : "#6b7280" }}>
                    <span className="text-[9px] font-black text-white tracking-widest">{(chain.foundMovieCount ?? 0) > 0 ? "FOUND" : "HUNT"}</span>
                  </span>
                ) : chain.mode === "community" ? (
                  <span className="flex items-center px-1.5 py-0.5 bg-blue-500 rounded-full">
                    <span className="text-[9px] font-black text-white tracking-widest">COMMUNITY</span>
                  </span>
                ) : chain.challengeDurationMs ? (
                  <span className="flex items-center px-1.5 py-0.5 bg-red-500 rounded-full">
                    <span className="text-[9px] font-black text-white tracking-widest">CHALLENGE</span>
                  </span>
                ) : undefined}
                onLongPress={() => handleChainLongPress(chain)}
                onLongPressEnd={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>

    {chainMenu && (
      <ChainContextMenu
        chain={chainMenu}
        onClose={() => setChainMenu(null)}
        profileUserId={profileUserId}
      />
    )}

    </>
  );
}

// ── Profile page ───────────────────────────────────────────────────────────

export default function Profile() {
  const { t } = useLang();
  const [, params] = useRoute("/profile/:username");
  const username = params?.username ?? "";
  const { user: me } = useAuth();
  const queryClient = useQueryClient();

  // key คงที่ = ไม่เปลี่ยนเมื่อสลับ tab — scroll position ถูกเก็บระดับหน้า
  const scrollRef = usePageScroll(`profile_${username}`);

  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const [activeTab, setActiveTab] = useState<"films" | "chain">(() => {
    if (urlTab === "films" || urlTab === "chain") return urlTab;
    const saved = sessionStorage.getItem(`profile_tab_${username}`);
    if (saved === "films" || saved === "chain") return saved;
    return "films";
  });
  const urlSubTab = new URLSearchParams(window.location.search).get("subtab");
  const [chainSubTab, setChainSubTab] = useState<"played" | "created">(() => {
    if (urlSubTab === "played" || urlSubTab === "created") return urlSubTab;
    const saved = sessionStorage.getItem(`profile_subtab_${username}`);
    return saved === "created" ? "created" : "played";
  });

  const handleTabChange = (tab: "films" | "chain") => {
    setActiveTab(tab);
    sessionStorage.setItem(`profile_tab_${username}`, tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  const handleSubTabChange = (sub: "played" | "created") => {
    setChainSubTab(sub);
    sessionStorage.setItem(`profile_subtab_${username}`, sub);
    const url = new URL(window.location.href);
    url.searchParams.set("subtab", sub);
    window.history.replaceState({}, "", url.pathname + url.search);
  };
  const [followModal, setFollowModal] = useState<null | "followers" | "following">(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [messagingError, setMessagingError] = useState("");
  const [reportUserOpen, setReportUserOpen] = useState(false);

  const isOwn = me?.username === username;
  const [, navigate] = useLocation();

  const { data: profileData, isLoading: profileLoading } = useGetUserProfile(username, {
    query: {
      staleTime: 0,
      refetchOnMount: true,
      refetchInterval: 30_000,
    } as any,
  });
  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ["profile-tickets-popular", username],
    queryFn: async () => {
      const res = await fetch(`/api/users/${username}/tickets?limit=100&sortBy=popular`, { credentials: "include" });
      if (!res.ok) return { tickets: [], hasMore: false, nextCursor: null };
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const followMutation   = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const profile  = profileData;
  const tickets  = ticketsData?.tickets ?? [];
  const profileUserId = ((profile as unknown) as Record<string, unknown>)?.["id"] as string | undefined;

  const coverPosters = tickets
    .slice(0, 6)
    .map(t => {
      const cardTheme = (((t as unknown) as Record<string, unknown>)["cardTheme"] as string | undefined);
      const cardBackdropUrl = (((t as unknown) as Record<string, unknown>)["cardBackdropUrl"] as string | undefined);
      if (cardTheme === "poster" && cardBackdropUrl) return cardBackdropUrl;
      return t.posterUrl || (((t as unknown) as Record<string, unknown>)["posterPath"] ? `https://image.tmdb.org/t/p/w200${((t as unknown) as Record<string, unknown>)["posterPath"]}` : "");
    })
    .filter(Boolean);

  const { toast } = useToast();

  const handleFollow = async () => {
    if (!profile) return;
    if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; }
    try {
      // Handle: following → unfollow, pending request → cancel, not following → follow/request
      const isPending = (profile as unknown as Record<string,unknown>).followRequestPending;
      const isUnfollowing = profile.isFollowing || isPending;
      // Optimistic update — change count & state immediately before API responds
      const queryKey = [`/api/users/${username}`];
      queryClient.setQueryData(queryKey, (old: any) => old ? {
        ...old,
        isFollowing: !isUnfollowing,
        followRequestPending: false,
        followerCount: Math.max(0, (old.followerCount ?? 0) + (isUnfollowing ? -1 : 1)),
      } : old);
      if (me?.username) {
        queryClient.setQueryData([`/api/users/${me.username}`], (old: any) => old ? {
          ...old,
          followingCount: Math.max(0, (old.followingCount ?? 0) + (isUnfollowing ? -1 : 1)),
        } : old);
      }
      if (isUnfollowing) await unfollowMutation.mutateAsync({ username });
      else await followMutation.mutateAsync({ username });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${username}`] });
      if (me?.username) queryClient.invalidateQueries({ queryKey: [`/api/users/${me.username}`] });
      // Refresh feeds so posts from newly followed/unfollowed users appear immediately
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["chains-hot-following"] });
      queryClient.invalidateQueries({ queryKey: ["chains-own-following"] });
    } catch {}
  };

  const handleMessage = async () => {
    if (!profile) return;
    if (!me) { toast({ title: t.signInToLike, duration: 1500 }); return; }
    setMessagingError("");
    try {
      const res = await fetch("/api/chat/start", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: profile.id }),
      });
      if (!res.ok) { setMessagingError(t.errGenericRetry); return; }
      const conv = await res.json();
      queryClient.removeQueries({ queryKey: ["/api/chat/conversations", conv.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      navigate(`/chat/${conv.id}`);
    } catch {
      setMessagingError(t.errGenericRetry);
    }
  };

  if (!profile) {
    if (profileLoading) return null;
    return (
      <div className="h-full flex flex-col items-center justify-center py-32 gap-3 px-6 text-center">
        <p className="font-display font-bold text-lg text-foreground">User not found</p>
        <Link href="/"><div className="px-5 py-2.5 bg-foreground text-background rounded-2xl text-sm font-semibold">Go Home</div></Link>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-none">
      {/* Mosaic Cover */}
      <div
        className="relative w-full overflow-hidden bg-secondary"
        style={{ height: "calc(200px + env(safe-area-inset-top, 0px))" }}
      >
        {coverPosters.length > 0 ? (
          <div className="absolute inset-0 grid grid-cols-3">
            {[...coverPosters, ...coverPosters].slice(0, 6).map((url, i) => (
              <div key={i} className="relative overflow-hidden">
                <img src={url} alt="" className="w-full h-full object-cover scale-110" />
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-secondary to-accent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
        <div
          className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
        >
          {isOwn ? (
            <Link href="/bookmarks"><button className="w-9 h-9 flex items-center justify-center"><Bookmark className="w-6 h-6 text-white" /></button></Link>
          ) : (
            <button onClick={() => navBack(navigate)} className="w-9 h-9 flex items-center justify-center">
              <ChevronLeft className="w-7 h-7 text-white" />
            </button>
          )}
          <span className="font-display font-bold text-white text-xl tracking-tight">Ticker</span>
          {isOwn ? (
            <Link href="/settings"><button className="w-9 h-9 flex items-center justify-center"><Settings className="w-6 h-6 text-white" /></button></Link>
          ) : me && !isVerified(profile.username) ? (
            <button onClick={() => setReportUserOpen(true)} className="w-9 h-9 flex items-center justify-center">
              <Flag className="w-6 h-6 text-white/70" />
            </button>
          ) : <div className="w-9 h-9" />}
        </div>
      </div>

      {/* Profile info */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-foreground border-4 border-background shadow-lg flex-shrink-0 -mt-8 relative z-10">
            {profile.avatarUrl
              ? <img src={profile.avatarUrl ?? undefined} alt={profile.displayName ?? undefined} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-xl font-bold text-background">{profile.displayName?.[0]?.toUpperCase() ?? "?"}</div>}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center" style={{ minHeight: 32, marginTop: "-10px" }}>
            <div className="flex items-center gap-1">
              <h2 className="font-display font-bold text-lg text-foreground leading-tight truncate">{profile.displayName}</h2>
              {isVerified(profile.username) && <VerifiedBadge className="w-[18px] h-[18px]" />}
              {profile.id && <BadgeIcon userId={profile.id} size={18} nudge={1.2} />}
            </div>
            <p className="text-xs text-muted-foreground">@{profile.username}</p>
          </div>
        </div>

        {profile.bio && <p className="text-sm text-muted-foreground mb-3 leading-relaxed whitespace-pre-wrap">{profile.bio}</p>}

        <div className="grid grid-cols-4 divide-x divide-border py-3 border-t border-border">
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-display font-bold text-base text-foreground">{fmtCount(tickets.length)}</span>
            <span className="text-[11px] text-muted-foreground">Tickets</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-display font-bold text-base text-foreground">{fmtCount((profile as any).chainCount ?? 0)}</span>
            <span className="text-[11px] text-muted-foreground">Chains</span>
          </div>
          {profile.username === "tickerofficial" ? (
            <>
              <div className="flex flex-col items-center gap-0.5 py-0.5">
                <span className="font-display font-bold text-base text-foreground">-</span>
                <span className="text-[11px] text-muted-foreground">{t.followers}</span>
              </div>
              <div className="flex flex-col items-center gap-0.5 py-0.5">
                <span className="font-display font-bold text-base text-foreground">-</span>
                <span className="text-[11px] text-muted-foreground">{t.followingLabel}</span>
              </div>
            </>
          ) : (
            <>
              <button onClick={() => setFollowModal("followers")} className="flex flex-col items-center gap-0.5 active:bg-secondary transition-colors rounded-lg py-0.5">
                <span className="font-display font-bold text-base text-foreground">{fmtCount(profile.followerCount ?? 0)}</span>
                <span className="text-[11px] text-muted-foreground">{t.followers}</span>
              </button>
              <button onClick={() => setFollowModal("following")} className="flex flex-col items-center gap-0.5 active:bg-secondary transition-colors rounded-lg py-0.5">
                <span className="font-display font-bold text-base text-foreground">{fmtCount(profile.followingCount ?? 0)}</span>
                <span className="text-[11px] text-muted-foreground">{t.followingLabel}</span>
              </button>
            </>
          )}
        </div>
        {!isOwn && (
          <div className="space-y-2 mb-2">
            <div className="flex gap-2">
              <button
                onClick={handleFollow}
                disabled={followMutation.isPending || unfollowMutation.isPending}
                className={`flex-1 h-11 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-60 ${
                  profile.isFollowing
                    ? "border border-border text-foreground bg-background"
                    : (profile as unknown as Record<string,unknown>).followRequestPending
                      ? "border border-border text-muted-foreground bg-background"
                      : "bg-foreground text-background"
                }`}
              >
                {followMutation.isPending || unfollowMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /></>
                ) : profile.isFollowing
                  ? t.followingBtn
                  : (profile as unknown as Record<string,unknown>).followRequestPending
                    ? t.requested
                    : profile.isPrivate
                      ? t.requestFollow
                      : t.follow}
              </button>
              <button onClick={handleMessage}
                className="h-11 px-4 rounded-2xl border border-border text-foreground bg-background text-sm font-bold flex items-center gap-1.5 active:bg-secondary transition-colors">
                {profile.isPrivate && !profile.isFollowing ? <Lock className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
                <span>{t.message}</span>
              </button>
            </div>
            {messagingError && <p className="text-xs text-red-500 font-medium">{messagingError}</p>}
          </div>
        )}
        {isOwn && (
          <button onClick={() => setShowEditProfile(true)}
            className="w-full h-11 rounded-2xl text-sm font-bold border border-border text-foreground bg-background active:bg-secondary transition-colors mb-2">
            {t.editProfile}
          </button>
        )}
      </div>

      {/* Private profile lock screen — shown to non-followers */}
      {profile.isPrivate && !profile.isFollowing && !isOwn ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 gap-4 text-center border-t border-border">
          <div className="w-16 h-16 rounded-full border-2 border-border flex items-center justify-center bg-secondary">
            <Lock className="w-7 h-7 text-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-display font-bold text-base text-foreground">{t.privateAccountTitle}</p>
            <p className="text-sm text-muted-foreground">{t.privateAccountDesc}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs selector + sub-tabs in same CSS grid for center alignment */}
          <div className="px-4 pb-3" style={{ display: "grid", gridTemplateColumns: "auto auto", justifyContent: "start", justifyItems: "center", gap: "6px 8px" }}>
            <button onClick={() => handleTabChange("films")} className={`filter-pill ${activeTab === "films" ? "active" : ""}`}>Tickets</button>
            <button onClick={() => handleTabChange("chain")} className={`filter-pill ${activeTab === "chain" ? "active" : ""} flex items-center gap-1`}>
              <Link2 className="w-3 h-3" /> Chains
            </button>
            {activeTab === "chain" && (
              <>
                <button onClick={() => handleSubTabChange("played")} className={cn("text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors", chainSubTab === "played" ? "bg-foreground text-background" : "text-muted-foreground")}>
                  {t.chainSubTabPlayed}
                </button>
                <button onClick={() => handleSubTabChange("created")} className={cn("text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors", chainSubTab === "created" ? "bg-foreground text-background" : "text-muted-foreground")}>
                  {t.chainSubTabCreated}
                </button>
              </>
            )}
          </div>

          {/* Tab content — CSS toggle, ไม่ unmount */}
          <div style={{ display: activeTab === "films" ? "block" : "none" }}>
            <FilmsGrid tickets={tickets} isOwn={isOwn} />
          </div>

          <div style={{ display: activeTab === "chain" ? "block" : "none" }}>
            <ChainTabContent
              username={username}
              profileUserId={profileUserId}
              isOwn={isOwn}
              displayName={profile.displayName}
              profileLoaded={!profileLoading}
              chainSubTab={chainSubTab}
              avatarUrl={profile.avatarUrl}
            />
          </div>
        </>
      )}

      {/* Modals */}
      {followModal && (
        <FollowListSheet username={username} type={followModal} onClose={() => setFollowModal(null)} />
      )}
      {showEditProfile && (
        <EditProfileSheet
          profile={{ ...profile, username }}
          onClose={() => setShowEditProfile(false)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: [`/api/users/${username}`] })}
        />
      )}
      {reportUserOpen && (
        <ReportSheet
          type="user"
          targetId={username}
          onClose={() => setReportUserOpen(false)}
        />
      )}
    </div>
  );
}
