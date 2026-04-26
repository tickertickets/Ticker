import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRoute, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import {
  ChevronLeft, Loader2, MapPin, Calendar, X, Check, Film,
} from "lucide-react";
import { useGetTicket } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useLang, displayYear } from "@/lib/i18n";

export default function EditTicket() {
  const { t, lang } = useLang();
  const [, params] = useRoute("/ticket/:id/edit");
  const ticketId = params?.id ?? "";
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const goBack = useCallback(() => {
    const back = sessionStorage.getItem("ticker:edit-ticket-back");
    sessionStorage.removeItem("ticker:edit-ticket-back");
    if (back) navigate(back);
    else navBack(navigate);
  }, [navigate]);

  // Read from cache synchronously — no spinner when navigating from ticket-detail
  const cached = queryClient.getQueryData<any>([`/api/tickets/${ticketId}`]);

  const { data: ticket, isLoading } = useGetTicket(ticketId, {
    query: { enabled: !!ticketId && !cached },
  });

  const src = cached ?? (ticket as unknown as Record<string, unknown>);

  const [rating, setRating] = useState(() => (src as any)?.rating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [memoryNote, setMemoryNote] = useState(() => (src as any)?.memoryNote ?? "");
  const [caption, setCaption] = useState(() => (src as any)?.caption ?? "");
  const [captionAlign, setCaptionAlign] = useState<"left" | "center" | "right">(() => (src as any)?.captionAlign ?? "left");
  const [watchDate, setWatchDate] = useState(() => (src as any)?.watchedAt ?? "");
  const [watchLocation, setWatchLocation] = useState(() => (src as any)?.location ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(!!cached);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(() => new Date().getMonth());

  // Seed form once if we had no cache on mount and data arrives later
  useEffect(() => {
    if (!ticket || seeded) return;
    const tk = ticket as unknown as Record<string, unknown>;
    setRating((ticket.rating as number) ?? 0);
    setMemoryNote((tk["memoryNote"] as string) ?? "");
    setCaption((tk["caption"] as string) ?? "");
    setCaptionAlign(((tk["captionAlign"] as string) ?? "left") as "left" | "center" | "right");
    setWatchDate((tk["watchedAt"] as string) ?? "");
    setWatchLocation((tk["location"] as string) ?? "");
    setSeeded(true);
  }, [ticket, seeded]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/content`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, captionAlign, memoryNote, rating, watchedAt: watchDate || "", location: watchLocation }),
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
        <div className="flex items-center gap-3 px-4 h-14">
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

        {/* Rating */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((s) => {
              const active = s <= (hoverRating || rating);
              return (
                <button key={s}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(s)}
                  className="p-1 transition-transform active:scale-90"
                >
                  <svg width={36} height={36} viewBox="0 0 24 24" fill={active ? "#fbbf24" : "#6b7280"} xmlns="http://www.w3.org/2000/svg" className="transition-all">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                  </svg>
                </button>
              );
            })}
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

        {error && <p className="text-sm text-red-500 text-center font-semibold">{error}</p>}

        {/* Save button */}
        <button onClick={handleSave}
          disabled={saving || rating < 1}
          className={cn("w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all",
            rating >= 1 ? "bg-foreground text-background active:scale-[0.98]" : "bg-border text-muted-foreground cursor-not-allowed"
          )}
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : t.saveBtn}
        </button>
      </div>

      {/* Date picker sheet */}
      {showDatePicker && createPortal(
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowDatePicker(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-background rounded-t-3xl"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.18)", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px) + 5rem)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <button onClick={prevMonth} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:bg-border transition-colors">
                <ChevronLeft className="w-4 h-4 text-foreground" />
              </button>
              <span className="font-bold text-base text-foreground">{t.calMonths[pickerMonth]} {pickerYear}</span>
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
      </div>{/* end scroll */}
    </div>
  );
}
