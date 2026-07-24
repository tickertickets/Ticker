import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRoute, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import {
  ChevronLeft, Loader2, MapPin, Calendar, X, Check, Film, Users, Search, Lock,
} from "lucide-react";
import { useGetTicket } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { useLang, displayYear } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";

interface UserSearchResult {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

interface ExistingInvitee {
  inviteId: string;
  inviteeId: string;
  username: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  status: "pending" | "accepted";
  assignedSeat: number | null;
}

export default function EditTicket() {
  const { t, lang } = useLang();
  const [, params] = useRoute("/ticket/:id/edit");
  const ticketId = params?.id ?? "";
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const goBack = useCallback(() => {
    // If we were launched from profile (TicketCard sets this key before navigating
    // here), return directly to that URL so the user lands on the exact tab/album/
    // scroll position they were at — identical pattern to edit-chain.tsx.
    const back = sessionStorage.getItem("ticker:edit-ticket-back");
    sessionStorage.removeItem("ticker:edit-ticket-back");
    if (back) {
      // Signal profile to preserve scroll position (don't reset to top).
      sessionStorage.setItem("ticker:back-from-edit", "1");
      navigate(back, { replace: true });
    } else {
      navBack(navigate);
    }
  }, [navigate]);

  // Read from cache synchronously — gives instant paint when navigating from ticket-detail.
  // We intentionally still fetch fresh detail data from the server so that rating/hideRating
  // and other fields always reflect DB state, not a potentially stale/partial list-shape object.
  const cached = queryClient.getQueryData<any>([`/api/tickets/${ticketId}`]);

  // Always fetch fresh detail — cache is used only for the initial synchronous paint.
  // staleTime:0 ensures the query fires immediately even when cache exists.
  const { data: ticket, isLoading } = useGetTicket(ticketId, {
    query: { enabled: !!ticketId, staleTime: 0 } as any,
  });

  // For initial render: use cache if available (instant UI), else whatever arrived already
  const src = cached ?? (ticket as unknown as Record<string, unknown>);

  const [rating, setRating] = useState(() => (src as any)?.rating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isDyingStar, setIsDyingStar] = useState(() => (src as any)?.ratingType === "blackhole");
  const [memoryNote, setMemoryNote] = useState(() => (src as any)?.memoryNote ?? "");
  const [caption, setCaption] = useState(() => (src as any)?.caption ?? "");
  const [captionAlign, setCaptionAlign] = useState<"left" | "center" | "right">(() => (src as any)?.captionAlign ?? "left");
  const [watchDate, setWatchDate] = useState(() => (src as any)?.watchedAt ?? "");
  const [watchLocation, setWatchLocation] = useState(() => (src as any)?.location ?? "");
  const [isSpoiler, setIsSpoiler] = useState(() => Boolean((src as any)?.isSpoiler));
  const [hideRating, setHideRating] = useState(() => Boolean((src as any)?.hideRating));
  const [cardTheme, setCardTheme] = useState<"classic" | "poster">(() => ((src as any)?.cardTheme ?? "classic") as "classic" | "poster");
  const [selectedBackdropUrl, setSelectedBackdropUrl] = useState<string | null>(() => (src as any)?.cardBackdropUrl ?? null);
  const [cardOffsetX, setCardOffsetX] = useState<number>(() => Number((src as any)?.cardBackdropOffsetX ?? 50));
  // Party mode state (seeded from ticket data)
  const [partyMode, setPartyMode] = useState(() => Boolean((src as any)?.partyMode));
  const [partySize, setPartySize] = useState(() => Number((src as any)?.partySize) || 2);
  const [partySeatNumber, setPartySeatNumber] = useState(() => Number((src as any)?.partySeatNumber) || 1);
  const [partyInvitees, setPartyInvitees] = useState<UserSearchResult[]>([]); // only newly-added in this edit session
  const [existingInvitees, setExistingInvitees] = useState<ExistingInvitee[]>([]);
  const [seededInvites, setSeededInvites] = useState(false);
  const [removedInviteIds, setRemovedInviteIds] = useState<Set<string>>(new Set());
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [debouncedUserSearch] = useDebounceValue(userSearchQuery, 400);

  const { user } = useAuth();

  const [saving, setSaving] = useState(false);
  const [showCommunityWarning, setShowCommunityWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // seeded tracks whether the form has been populated from the initial cache paint.
  // The fresh network response will always re-seed to correct any stale cached fields.
  const [seeded, setSeeded] = useState(!!cached);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(() => new Date().getMonth());
  const [yearEditMode, setYearEditMode] = useState(false);
  const [yearInputVal, setYearInputVal] = useState("");

  // Seed (or re-seed) form from fresh network data.
  // When cache existed: seeded=true skips the first run, but we still re-seed once the
  // background fetch completes, so rating/hideRating are always authoritative.
  // When no cache: seeded=false, we seed on first arrival (existing behaviour).
  useEffect(() => {
    if (!ticket) return;
    const tk = ticket as unknown as Record<string, unknown>;
    // Always re-seed sensitive fields from the fresh server response
    setRating((ticket.rating as number) ?? 0);
    setHideRating(Boolean(tk["hideRating"]));
    setIsDyingStar(tk["ratingType"] === "blackhole");
    if (!seeded) {
      // First-time seed: populate every field
      setMemoryNote((tk["memoryNote"] as string) ?? "");
      setCaption((tk["caption"] as string) ?? "");
      setCaptionAlign(((tk["captionAlign"] as string) ?? "left") as "left" | "center" | "right");
      setWatchDate((tk["watchedAt"] as string) ?? "");
      setWatchLocation((tk["location"] as string) ?? "");
      setIsSpoiler(Boolean(tk["isSpoiler"]));
      // Party fields — seed on first load; partyInvitees stays empty (user adds new ones only)
      setPartyMode(Boolean(tk["partyMode"]));
      setPartySize(Number(tk["partySize"]) || 2);
      setPartySeatNumber(Number(tk["partySeatNumber"]) || 1);
      setCardTheme(((tk["cardTheme"] as string) ?? "classic") as "classic" | "poster");
      setSelectedBackdropUrl((tk["cardBackdropUrl"] as string | null) ?? null);
      setCardOffsetX(Number(tk["cardBackdropOffsetX"] ?? 50));
      setSeeded(true);
    }
  }, [ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived: is the current viewer the ticket owner?
  const ticketOwnerId = (ticket as any)?.userId as string | undefined;
  const isOwner = !!user && !!ticketOwnerId && ticketOwnerId === user.id;
  const partyGroupIdVal = (ticket as any)?.partyGroupId as string | undefined;

  // Fetch existing party invites (owner only, when partyMode is on and group exists)
  const { data: existingInvitesData } = useQuery<{ invites: ExistingInvitee[] }>({
    queryKey: [`/api/tickets/${ticketId}/party-invites`],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/party-invites`, { credentials: "include" });
      if (!res.ok) return { invites: [] };
      return res.json();
    },
    enabled: partyMode && !!partyGroupIdVal && isOwner,
    staleTime: 30_000,
  });

  // Seed existing invites once after fetch
  useEffect(() => {
    if (!existingInvitesData || seededInvites) return;
    setExistingInvitees(existingInvitesData.invites);
    setSeededInvites(true);
  }, [existingInvitesData, seededInvites]);

  // Computed values for party state
  const visibleExisting = existingInvitees.filter(e => !removedInviteIds.has(e.inviteId));
  const acceptedInvitees = visibleExisting.filter(e => e.status === "accepted");
  const pendingInvitees = visibleExisting.filter(e => e.status === "pending");
  const acceptedSeats = new Set(acceptedInvitees.map(e => e.assignedSeat).filter((s): s is number => s !== null));
  const totalInvited = visibleExisting.length + partyInvitees.length;
  const minPartySize = acceptedInvitees.length + 1; // can't shrink below accepted count

  // User search for party invites
  const { data: userSearchResults, isLoading: userSearchLoading } = useQuery<{ users: UserSearchResult[] }>({
    queryKey: ["/api/users/search", debouncedUserSearch, "followingOnly"],
    queryFn: async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(debouncedUserSearch)}&limit=8&followingOnly=true`, { credentials: "include" });
      if (!res.ok) return { users: [] };
      return res.json();
    },
    enabled: debouncedUserSearch.length > 1 && partyMode,
  });

  // Backdrop images for Poster theme
  const isReel = (src as any)?.imdbId === "reel";
  const movieId = !isReel ? ((ticket as any)?.imdbId ?? null) : null;
  const { data: backdropsData, isLoading: backdropsLoading } = useQuery<{ backdrops: string[] }>({
    queryKey: ["/api/movies/backdrops", movieId],
    queryFn: async () => {
      const r = await fetch(`/api/movies/${encodeURIComponent(movieId!)}/backdrops`, { credentials: "include" });
      if (!r.ok) return { backdrops: [] };
      return r.json();
    },
    enabled: !!movieId && cardTheme === "poster",
    staleTime: 10 * 60 * 1000,
  });
  const backdrops = backdropsData?.backdrops ?? [];

  const addInvitee = useCallback((u: UserSearchResult) => {
    if (partyInvitees.find(p => p.id === u.id)) return;
    // also skip if already in existing invitees (pending or accepted)
    if (existingInvitees.filter(e => !removedInviteIds.has(e.inviteId)).find(e => e.inviteeId === u.id)) return;
    const currentVisible = existingInvitees.filter(e => !removedInviteIds.has(e.inviteId)).length;
    if (currentVisible + partyInvitees.length >= partySize - 1) return;
    setPartyInvitees(prev => [...prev, u]);
    setUserSearchQuery("");
  }, [partyInvitees, existingInvitees, removedInviteIds, partySize]);

  const removeInvitee = (id: string) => setPartyInvitees(prev => prev.filter(p => p.id !== id));
  const removePendingInvitee = (inviteId: string) =>
    setRemovedInviteIds(prev => new Set([...prev, inviteId]));

  const handlePartyModeToggle = () => {
    setPartyMode(v => {
      if (v) { setPartySize(2); setPartySeatNumber(1); setPartyInvitees([]); }
      return !v;
    });
  };

  const handlePartySizeChange = (newSize: number) => {
    // Cannot shrink below accepted members + 1 (owner)
    if (newSize < minPartySize) return;
    setPartySize(newSize);
    if (partySeatNumber > newSize) setPartySeatNumber(1);
    // Trim new invitees if slots are now full
    const maxNew = Math.max(0, newSize - 1 - visibleExisting.length);
    if (partyInvitees.length > maxNew) setPartyInvitees(prev => prev.slice(0, maxNew));
  };

  const handleSave = async () => {
    if (saving) return;
    const isReel = (src as any)?.imdbId === "reel";
    if (!isReel && rating === 0) {
      setError(t.errNoRating);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/content`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption, captionAlign, memoryNote,
          rating: rating > 0 ? rating : null,
          ratingType: isDyingStar ? "blackhole" : "star",
          watchedAt: watchDate || "",
          location: watchLocation,
          isSpoiler, hideRating,
          // Poster theme fields (server ignores these for reels)
          cardTheme, cardBackdropUrl: cardTheme === "poster" ? selectedBackdropUrl : null, cardBackdropOffsetX: cardOffsetX,
          // Party fields
          partyMode,
          partySize: partyMode ? partySize : undefined,
          partySeatNumber: partyMode ? partySeatNumber : undefined,
          partyInviteeIds: partyMode && partyInvitees.length > 0 ? partyInvitees.map(u => u.id) : undefined,
          removedInviteIds: removedInviteIds.size > 0 ? [...removedInviteIds] : undefined,
        }),
      });
      if (!res.ok) throw new Error(t.errSaveFailed);
      queryClient.removeQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      queryClient.invalidateQueries();
      goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errGeneric);
      setSaving(false);
    }
  };

  // Date picker helpers
  const openDatePicker = () => {
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
  };
  const prevMonth = () => {
    if (pickerMonth === 0) { setPickerYear(y => y - 1); setPickerMonth(11); }
    else setPickerMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (pickerMonth === 11) { setPickerYear(y => y + 1); setPickerMonth(0); }
    else setPickerMonth(m => m + 1);
  };
  const prevYear = () => setPickerYear(y => y - 1);
  const nextYear = () => { if (pickerYear < today.getFullYear()) setPickerYear(y => y + 1); };
  const selectDate = (day: number) => {
    const m = String(pickerMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    setWatchDate(`${pickerYear}-${m}-${d}`);
    setShowDatePicker(false);
  };
  const today = new Date();
  const daysInMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(pickerYear, pickerMonth, 1).getDay();
  const cells: (number | null)[] = [...Array(firstDayOfWeek).fill(null), ...Array.from({length: daysInMonth}, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const isToday = (day: number) => day === today.getDate() && pickerMonth === today.getMonth() && pickerYear === today.getFullYear();
  const isSelectedDate = (day: number) => {
    const m = String(pickerMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return watchDate === `${pickerYear}-${m}-${d}`;
  };
  const isFuture = (day: number) => new Date(pickerYear, pickerMonth, day) > today;

  if (isLoading && !seeded) return null;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={() => goBack()}
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-display font-bold text-base flex-1 text-foreground">{t.editCardTitle}</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">
      <div className="px-4 space-y-5 pt-5 pb-4">
        {/* Movie title */}
        {ticket?.movieTitle && (
          <div className="flex items-center gap-3 bg-secondary rounded-2xl px-4 py-3">
            <Film className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-foreground truncate">{ticket.movieTitle}</p>
              {ticket.movieYear && <p className="text-xs text-muted-foreground">{displayYear(ticket.movieYear, lang)}</p>}
            </div>
          </div>
        )}

        {/* Card Theme toggle (Classic / Poster) — hidden for reels */}
        {!isReel && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-black tracking-widest text-foreground">{lang === "th" ? "รูปแบบการ์ด" : "Card Style"}</p>
            <div className="flex rounded-2xl overflow-hidden border border-border text-xs font-bold">
              <button
                onClick={() => { setCardTheme("classic"); setSelectedBackdropUrl(null); }}
                className={cn("flex-1 flex items-center justify-center gap-1.5 px-4 py-3 transition-colors",
                  cardTheme === "classic" ? "bg-foreground text-background" : "bg-background text-muted-foreground")}
              >
                <Film className="w-4 h-4" /> {t.classicTheme}
              </button>
              <button
                onClick={() => setCardTheme("poster")}
                className={cn("flex-1 flex items-center justify-center gap-1.5 px-4 py-3 border-l border-border transition-colors",
                  cardTheme === "poster" ? "bg-foreground text-background" : "bg-background text-muted-foreground")}
              >
                <div className="w-4 h-4 rounded border-2 border-current flex-shrink-0" /> {t.posterTheme}
              </button>
            </div>
            {cardTheme === "poster" && (
              <>
                {backdropsLoading && (
                  <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                )}
                {!backdropsLoading && backdrops.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">{t.noBackdropFound}</p>
                )}
                {!backdropsLoading && backdrops.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {backdrops.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedBackdropUrl(url)}
                        className={cn("relative aspect-video rounded-xl overflow-hidden border-2 transition-all",
                          selectedBackdropUrl === url ? "border-foreground" : "border-transparent opacity-70 hover:opacity-100")}
                      >
                        <img src={url} alt={`backdrop ${i + 1}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Rating */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-center">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => {
                const active = s <= (hoverRating || rating);
                const fillColor = active ? (isDyingStar ? "#22c55e" : "#fbbf24") : "#6b7280";
                return (
                  <button key={s}
                    onMouseEnter={() => setHoverRating(s)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(s === rating ? 0 : s)}
                    className="p-1 transition-transform active:scale-90"
                  >
                    <svg width={36} height={36} viewBox="0 0 24 24" fill={fillColor} xmlns="http://www.w3.org/2000/svg" className="transition-all">
                      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Dying-star toggle */}
          <div
            role="switch"
            aria-checked={isDyingStar}
            onClick={() => setIsDyingStar(v => !v)}
            className="w-full flex items-center justify-between gap-3 py-3 px-4 bg-secondary rounded-2xl cursor-pointer select-none active:opacity-70"
          >
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground block">{t.dyingStarLabel}</span>
              <span className="text-xs text-muted-foreground mt-0.5 block">{t.dyingStarDesc}</span>
            </div>
            <div className={cn("w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0", isDyingStar ? "bg-foreground" : "bg-border")}>
              <div className={cn("w-5 h-5 rounded-full bg-white shadow transition-transform", isDyingStar ? "translate-x-5" : "translate-x-0")} />
            </div>
          </div>
          {/* Hide rating toggle */}
          <div
            role="switch"
            aria-checked={hideRating}
            onClick={() => setHideRating(v => !v)}
            className="w-full flex items-center justify-between gap-3 py-3 px-4 bg-secondary rounded-2xl cursor-pointer select-none active:opacity-70"
          >
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground block">{t.hideRatingLabel}</span>
              <span className="text-xs text-muted-foreground mt-0.5 block">{t.hideRatingDesc}</span>
            </div>
            <div className={cn("w-11 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0", hideRating ? "bg-foreground" : "bg-border")}>
              <div className={cn("w-5 h-5 rounded-full bg-white shadow transition-transform", hideRating ? "translate-x-5" : "translate-x-0")} />
            </div>
          </div>
        </div>

        {/* Memory */}
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

        {/* Caption */}
        <div>
          <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.captionLabel}</p>
          <textarea
            className={cn("w-full h-[88px] bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none",
              captionAlign === "center" && "text-center",
              captionAlign === "right" && "text-right"
            )}
            placeholder={t.captionPlaceholder}
            value={caption}
            maxLength={63206}
            onChange={(e) => setCaption(e.target.value)}
          />
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

        {/* Details */}
        <div>
          <p className="text-xs font-black tracking-widest text-foreground mb-2">{t.detailsLabel}</p>
          <div className="grid grid-cols-2 gap-2">
            <div
              role="button"
              tabIndex={0}
              onClick={openDatePicker}
              onKeyDown={(e) => e.key === "Enter" && openDatePicker()}
              className="flex items-center gap-2 bg-secondary rounded-2xl px-3 h-12 w-full cursor-pointer select-none"
            >
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className={cn("flex-1 text-sm", watchDate ? "text-foreground" : "text-muted-foreground")}>
                {watchDate ? new Date(watchDate + "T00:00:00").toLocaleDateString(t.dateLocale, { day: "numeric", month: "long", year: "numeric" }) : t.dateLabelPlaceholder}
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
                placeholder={t.locationPlaceholder} value={watchLocation} onChange={(e) => setWatchLocation(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Party mode */}
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
              {/* Party size */}
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t.partyTicketCount}</p>
                <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                  {[2,3,4,5,6,7,8,9,10].map(n => {
                    const tooSmall = n < minPartySize;
                    return (
                      <button key={n} onClick={() => handlePartySizeChange(n)}
                        disabled={tooSmall}
                        className={cn("w-9 h-9 rounded-xl text-sm font-bold transition-colors shrink-0",
                          partySize===n ? "bg-foreground text-background" :
                          tooSmall ? "bg-border/50 text-muted-foreground/40 cursor-not-allowed" :
                          "bg-secondary text-foreground")}>{n}</button>
                    );
                  })}
                </div>
              </div>
              {/* Seat picker — only available (non-accepted) seats */}
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t.yourTicketNum}</p>
                <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                  {Array.from({length:partySize},(_,i)=>i+1).map(n => {
                    const locked = acceptedSeats.has(n);
                    return (
                      <button key={n}
                        onClick={() => { if (!locked) setPartySeatNumber(n); }}
                        className={cn("w-9 h-9 rounded-xl text-sm font-bold transition-colors shrink-0",
                          partySeatNumber===n ? "bg-foreground text-background" :
                          locked ? "bg-border/50 text-muted-foreground/40 cursor-not-allowed" :
                          "bg-secondary text-foreground")}>#{n}</button>
                    );
                  })}
                </div>
              </div>
              {/* Invitees list + search (owner only) */}
              <div>
                <p className="text-xs font-bold text-foreground mb-2">
                  {t.inviteFriendsLabel(totalInvited)} / {partySize - 1}
                </p>
                {/* Chips: accepted (locked) + pending (removable) + new (removable) */}
                {(visibleExisting.length > 0 || partyInvitees.length > 0) && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {acceptedInvitees.map(e => (
                      <div key={e.inviteId} className="flex items-center gap-1.5 bg-secondary px-2.5 py-1.5 rounded-xl">
                        <span className="text-xs font-semibold">@{e.username}</span>
                        <Lock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ))}
                    {pendingInvitees.map(e => (
                      <div key={e.inviteId} className="flex items-center gap-1.5 bg-secondary px-2.5 py-1.5 rounded-xl">
                        <span className="text-xs font-semibold">@{e.username}</span>
                        {isOwner && (
                          <button onClick={() => removePendingInvitee(e.inviteId)}>
                            <X className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    ))}
                    {partyInvitees.map(u => (
                      <div key={u.id} className="flex items-center gap-1.5 bg-secondary px-2.5 py-1.5 rounded-xl">
                        <span className="text-xs font-semibold">@{u.username}</span>
                        <button onClick={() => removeInvitee(u.id)}>
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Search box: only for owner, only when slots still open */}
                {isOwner && totalInvited < partySize - 1 && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input className="w-full h-10 bg-secondary rounded-xl pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground"
                        placeholder={t.searchUsersPlaceholder} value={userSearchQuery} onChange={(e) => setUserSearchQuery(e.target.value)} />
                      {userSearchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>
                    {(userSearchResults?.users?.length ?? 0) > 0 && userSearchQuery && (
                      <div className="mt-1 bg-secondary rounded-xl overflow-hidden border border-border">
                        {(userSearchResults?.users ?? [])
                          .filter(u =>
                            !partyInvitees.find(p => p.id === u.id) &&
                            !existingInvitees.find(e => e.inviteeId === u.id)
                          )
                          .slice(0, 5)
                          .map(u => (
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

        {/* Spoiler alert toggle */}
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

        {error && <p className="text-sm text-red-500 text-center font-semibold">{error}</p>}

        {/* Save button */}
        <button onClick={() => { if (!saving) setShowCommunityWarning(true); }}
          disabled={saving}
          className="w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all bg-foreground text-background active:scale-[0.98]"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : t.saveBtn}
        </button>
      </div>

      {/* Date picker sheet */}
      {showDatePicker && createPortal(
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowDatePicker(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl border-t border-border"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(1.5rem, var(--sai-bottom) + 5rem)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            {/* Year navigation */}
            <div className="flex items-center justify-center gap-4 px-5 pb-0.5">
              <button onClick={prevYear} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center active:bg-border transition-colors font-bold text-foreground text-base">«</button>
              {yearEditMode ? (
                <input
                  autoFocus
                  type="number"
                  className="font-bold text-sm text-foreground bg-secondary rounded-lg w-16 text-center outline-none border-none py-1"
                  value={yearInputVal}
                  onChange={e => setYearInputVal(e.target.value)}
                  onBlur={() => {
                    const y = parseInt(yearInputVal, 10);
                    if (!isNaN(y) && y >= 1880 && y <= today.getFullYear()) setPickerYear(y);
                    setYearEditMode(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const y = parseInt(yearInputVal, 10);
                      if (!isNaN(y) && y >= 1880 && y <= today.getFullYear()) setPickerYear(y);
                      setYearEditMode(false);
                    } else if (e.key === "Escape") { setYearEditMode(false); }
                  }}
                />
              ) : (
                <button
                  onClick={() => { setYearInputVal(String(pickerYear)); setYearEditMode(true); }}
                  className="font-bold text-sm text-muted-foreground w-16 text-center rounded-lg py-1 hover:bg-secondary active:bg-border transition-colors"
                >
                  {pickerYear}
                </button>
              )}
              <button onClick={nextYear} disabled={pickerYear >= today.getFullYear()} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center active:bg-border transition-colors font-bold text-foreground text-base disabled:opacity-30">»</button>
            </div>
            {/* Month navigation */}
            <div className="flex items-center justify-between px-5 py-3">
              <button onClick={prevMonth} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:bg-border transition-colors">
                <ChevronLeft className="w-4 h-4 text-foreground" />
              </button>
              <span className="font-bold text-base text-foreground">{t.calMonths[pickerMonth]}</span>
              <button
                onClick={nextMonth}
                disabled={pickerYear === today.getFullYear() && pickerMonth === today.getMonth()}
                className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:bg-border transition-colors disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4 text-foreground rotate-180" />
              </button>
            </div>
            <div className="grid grid-cols-7 px-4 mb-1">
              {t.calDays.map(d => (
                <div key={d} className="flex items-center justify-center h-8">
                  <span className="text-[11px] font-semibold text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 px-4 pb-6 gap-y-1">
              {cells.map((day, i) => (
                day === null ? (
                  <div key={`empty-${i}`} />
                ) : (
                  <button
                    key={day}
                    onClick={() => !isFuture(day) && selectDate(day)}
                    disabled={isFuture(day)}
                    className={cn(
                      "mx-auto flex items-center justify-center w-9 h-9 rounded-xl text-sm font-semibold transition-colors",
                      isSelectedDate(day) && "bg-foreground text-background",
                      !isSelectedDate(day) && isToday(day) && "bg-secondary text-foreground ring-1 ring-foreground/30",
                      !isSelectedDate(day) && !isToday(day) && !isFuture(day) && "text-foreground hover:bg-secondary active:bg-border",
                      isFuture(day) && "text-muted-foreground/30 cursor-not-allowed",
                    )}
                  >
                    {day}
                  </button>
                )
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
      {showCommunityWarning && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end" onClick={() => setShowCommunityWarning(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl border-t border-border px-5 pt-5"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(1.5rem, var(--sai-bottom) + 1rem)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <p className="text-base font-bold text-foreground mb-3 text-center">{t.communityRulesTitle}</p>
            <p className="text-sm text-muted-foreground mb-5 text-center whitespace-pre-line">{t.communityRulesBody}</p>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed mb-3 px-1">
              {lang === "th"
                ? "ความคิดเห็น การรีวิว และการให้คะแนนเป็นของผู้ใช้แต่ละคน Ticker ขอไม่รับผิดชอบต่อเนื้อหาที่ผู้ใช้สร้างขึ้น"
                : "All reviews, ratings, and opinions are solely those of the users. Ticker is not responsible for user-generated content."}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowCommunityWarning(false); handleSave(); }}
                className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-sm"
              >
                {t.communityRulesConfirmSave}
              </button>
              <button
                onClick={() => setShowCommunityWarning(false)}
                className="w-full h-12 rounded-2xl text-muted-foreground font-semibold text-sm"
              >
                {t.communityRulesCancel}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      </div>{/* end scroll */}
    </div>
  );
}
