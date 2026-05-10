import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Flag, Send, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type ReportType = "ticket" | "user" | "comment" | "contact";

interface ReportSheetProps {
  type: ReportType;
  targetId: string;
  onClose: () => void;
}

export function ReportSheet({ type, targetId, onClose }: ReportSheetProps) {
  const { t } = useLang();
  const [step, setStep] = useState<"reason" | "details" | "done">("reason");
  const [selectedReason, setSelectedReason] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isContact = type === "contact";

  const REPORT_REASONS: Record<ReportType, { key: string; label: string }[]> = {
    ticket: [
      { key: "spam",          label: t.reasonSpam },
      { key: "inappropriate", label: t.reasonInappropriate },
      { key: "harassment",    label: t.reasonHarassment },
      { key: "other",         label: t.reasonOther },
    ],
    user: [
      { key: "spam",          label: t.reasonSpam },
      { key: "harassment",    label: t.reasonHarassment },
      { key: "impersonation", label: t.reasonImpersonation },
      { key: "inappropriate", label: t.reasonInappropriate },
      { key: "other",         label: t.reasonOther },
    ],
    comment: [
      { key: "spam",          label: t.reasonSpam },
      { key: "inappropriate", label: t.reasonInappropriate },
      { key: "harassment",    label: t.reasonHarassment },
      { key: "other",         label: t.reasonOther },
    ],
    contact: [
      { key: "bug",     label: t.contactBug },
      { key: "feature", label: t.contactFeature },
      { key: "account", label: t.contactAccount },
      { key: "content", label: t.contactContent },
      { key: "general", label: t.contactGeneral },
    ],
  };

  const TYPE_CONFIG: Record<ReportType, { title: string; subtitle: string; apiPath: (id: string) => string; color: string }> = {
    ticket:  { title: t.reportTicketTitle,   subtitle: t.reportSelectReason, apiPath: (id) => `/api/tickets/${id}/report`,    color: "text-muted-foreground" },
    user:    { title: t.reportUserTitle,      subtitle: t.reportSelectReason, apiPath: (id) => `/api/reports/user/${id}`,       color: "text-muted-foreground" },
    comment: { title: t.reportCommentTitle,   subtitle: t.reportSelectReason, apiPath: (id) => `/api/reports/comment/${id}`,    color: "text-muted-foreground" },
    contact: { title: t.contactTicker,        subtitle: t.contactReplyPromise, apiPath: () => `/api/reports/contact`,            color: "text-foreground" },
  };

  const config = TYPE_CONFIG[type];
  const reasons = REPORT_REASONS[type];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleSubmit() {
    if (!selectedReason) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, string> = { reason: selectedReason };
      if (details.trim()) body["details"] = details.trim();
      if (isContact && email.trim()) body["email"] = email.trim();

      const res = await fetch(config.apiPath(targetId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status === 409) {
        setStep("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? t.errGenericRetry);
      }
    } catch {
      setError(t.errGenericRetry);
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm cursor-pointer"
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed bottom-0 z-[100] bg-background rounded-t-3xl border-t border-border"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(100%, 430px)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center px-5 pb-4 pt-2 gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-secondary">
            <Flag className={cn("w-4 h-4", config.color)} />
          </div>
          <div className="flex-1">
            <h2 className="font-display font-bold text-base text-foreground">{config.title}</h2>
            <p className="text-xs text-muted-foreground">{config.subtitle}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        {step === "done" ? (
          <div className="flex flex-col items-center gap-3 px-6 pt-4 pb-8">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-foreground" />
            </div>
            <p className="font-display font-bold text-base text-foreground text-center">
              {isContact ? t.contactSentTitle : t.reportedTitle}
            </p>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              {isContact ? t.contactSentDesc : t.reportedDesc}
            </p>
            <button
              onClick={onClose}
              className="mt-2 w-full h-11 bg-foreground text-background rounded-2xl text-sm font-bold"
            >
              {t.closeBtn}
            </button>
          </div>
        ) : step === "reason" ? (
          <div className="px-4 pb-4">
            <div className="space-y-2">
              {reasons.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setSelectedReason(r.key)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left",
                    selectedReason === r.key
                      ? "border-foreground bg-secondary"
                      : "border-border bg-background active:bg-secondary"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors",
                    selectedReason === r.key ? "border-foreground bg-foreground" : "border-border"
                  )} />
                  <span className="text-sm font-medium text-foreground">{r.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => selectedReason && setStep("details")}
              disabled={!selectedReason}
              className="mt-4 w-full h-11 bg-foreground text-background rounded-2xl text-sm font-bold disabled:opacity-40 transition-opacity"
            >
              {t.nextBtn}
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-3">
            {isContact && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">{t.emailOptionalLabel}</label>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-transparent focus:border-border"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                {isContact ? t.detailsRequiredLabel : t.detailsOptionalLabel}
              </label>
              <textarea
                placeholder={isContact ? t.describeIssuePlaceholder : t.tellUsMorePlaceholder}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                className="w-full bg-secondary rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-transparent focus:border-border resize-none"
              />
            </div>
            {error && <p className="text-xs text-destructive font-medium">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStep("reason")}
                className="flex-1 h-11 rounded-2xl border border-border text-foreground text-sm font-bold active:bg-secondary transition-colors"
              >
                {t.backBtn}
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || (isContact && !details.trim())}
                className="flex-1 h-11 bg-foreground text-background rounded-2xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t.sendBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
