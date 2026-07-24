import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Flag, Send, CheckCircle2, Loader2, Ban, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type ReportType = "ticket" | "user" | "comment" | "contact" | "chain";

interface ReportSheetProps {
  type: ReportType;
  targetId: string;
  onClose: () => void;
  /** For type="user": whether the viewer owns this profile. Hides block/remove on own profile. */
  isOwnProfile?: boolean;
}

export function ReportSheet({ type, targetId, onClose, isOwnProfile = false }: ReportSheetProps) {
  const { t, lang } = useLang();
  const [step, setStep] = useState<"reason" | "details" | "done">("reason");
  const [selectedReason, setSelectedReason] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Block / remove-follower action state (separate from the report flow)
  const [blockStatus, setBlockStatus]   = useState<"idle" | "loading" | "done">("idle");
  const [removeStatus, setRemoveStatus] = useState<"idle" | "loading" | "done">("idle");
  const [actionError, setActionError]   = useState("");

  const isContact = type === "contact";
  const isCopyright = type === "ticket" && selectedReason === "copyright_infringement";

  const REPORT_REASONS: Record<ReportType, { key: string; label: string }[]> = {
    ticket: [
      { key: "spam",                  label: t.reasonSpam },
      { key: "inappropriate",         label: t.reasonInappropriate },
      { key: "harassment",            label: t.reasonHarassment },
      { key: "copyright_infringement", label: lang === "th" ? "ละเมิดลิขสิทธิ์ / DMCA" : "Copyright Infringement / DMCA" },
      { key: "other",                 label: t.reasonOther },
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
    chain: [
      { key: "spam",          label: t.reasonSpam },
      { key: "inappropriate", label: t.reasonInappropriate },
      { key: "harassment",    label: t.reasonHarassment },
      { key: "other",         label: t.reasonOther },
    ],
  };

  const TYPE_CONFIG: Record<ReportType, { title: string; subtitle: string; apiPath: (id: string) => string; color: string }> = {
    ticket:  { title: t.reportTicketTitle,   subtitle: t.reportSelectReason, apiPath: (id) => `/api/tickets/${id}/report`,    color: "text-muted-foreground" },
    user:    { title: t.reportUserTitle,      subtitle: t.reportSelectReason, apiPath: (id) => `/api/reports/user/${id}`,       color: "text-muted-foreground" },
    comment: { title: t.reportCommentTitle,   subtitle: t.reportSelectReason, apiPath: (id) => `/api/reports/comment/${id}`,    color: "text-muted-foreground" },
    contact: { title: t.contactTicker,        subtitle: t.contactReplyPromise, apiPath: () => `/api/reports/contact`,            color: "text-foreground" },
    chain:   { title: t.reportCommentTitle,   subtitle: t.reportSelectReason, apiPath: (id) => `/api/reports/chain/${id}`,       color: "text-muted-foreground" },
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
      if ((isContact || isCopyright) && email.trim()) body["email"] = email.trim();

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

  async function handleBlock() {
    if (blockStatus !== "idle") return;
    setBlockStatus("loading");
    setActionError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(targetId)}/block`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setBlockStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.message ?? (lang === "th" ? "เกิดข้อผิดพลาด" : "Something went wrong"));
        setBlockStatus("idle");
      }
    } catch {
      setActionError(lang === "th" ? "เกิดข้อผิดพลาด" : "Something went wrong");
      setBlockStatus("idle");
    }
  }

  async function handleRemoveFollower() {
    if (removeStatus !== "idle") return;
    setRemoveStatus("loading");
    setActionError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(targetId)}/remove-follower`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setRemoveStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.message ?? (lang === "th" ? "เกิดข้อผิดพลาด" : "Something went wrong"));
        setRemoveStatus("idle");
      }
    } catch {
      setActionError(lang === "th" ? "เกิดข้อผิดพลาด" : "Something went wrong");
      setRemoveStatus("idle");
    }
  }

  const showUserActions = type === "user" && !isOwnProfile;

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
          paddingBottom: "max(var(--sai-bottom), 20px)",
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

            {/* ── Quick user actions (Block / Remove Follower) ── */}
            {showUserActions && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {lang === "th" ? "หรือดำเนินการ" : "or take action"}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {actionError && (
                  <p className="text-xs text-destructive font-medium text-center mb-2">{actionError}</p>
                )}

                <div className="space-y-2">
                  {/* Block */}
                  <button
                    onClick={handleBlock}
                    disabled={blockStatus !== "idle"}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left",
                      blockStatus === "done"
                        ? "border-green-600/40 bg-green-600/10"
                        : "border-red-500/30 bg-background active:bg-secondary disabled:opacity-60"
                    )}
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-red-500/10 flex-shrink-0">
                      {blockStatus === "loading"
                        ? <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                        : blockStatus === "done"
                          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                          : <Ban className="w-4 h-4 text-red-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {blockStatus === "done"
                          ? (lang === "th" ? "บล็อกแล้ว" : "Blocked")
                          : (lang === "th" ? `บล็อก @${targetId}` : `Block @${targetId}`)
                        }
                      </p>
                      {blockStatus !== "done" && (
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                          {lang === "th"
                            ? "ซ่อนคนนี้จากฟีดและป้องกันการติดต่อ"
                            : "Hide this person from your feed and prevent contact"}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Remove Follower */}
                  <button
                    onClick={handleRemoveFollower}
                    disabled={removeStatus !== "idle"}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left",
                      removeStatus === "done"
                        ? "border-green-600/40 bg-green-600/10"
                        : "border-border bg-background active:bg-secondary disabled:opacity-60"
                    )}
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-secondary flex-shrink-0">
                      {removeStatus === "loading"
                        ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        : removeStatus === "done"
                          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                          : <UserMinus className="w-4 h-4 text-muted-foreground" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {removeStatus === "done"
                          ? (lang === "th" ? "นำออกแล้ว" : "Removed")
                          : (lang === "th" ? "นำออกจาก Followers" : "Remove from Followers")
                        }
                      </p>
                      {removeStatus !== "done" && (
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                          {lang === "th"
                            ? "คนนี้จะหยุดติดตามคุณ"
                            : "This person will stop following you"}
                        </p>
                      )}
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-3">
            {(isContact || isCopyright) && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                  {isCopyright
                    ? (lang === "th" ? "อีเมลติดต่อของคุณ (สำหรับรับการแจ้งกลับ) *" : "Your contact email (for follow-up) *")
                    : t.emailOptionalLabel}
                </label>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-transparent focus:border-border"
                />
              </div>
            )}
            {isCopyright && (
              <div className="text-[11px] text-muted-foreground bg-secondary rounded-xl px-3 py-2.5 leading-relaxed">
                {lang === "th"
                  ? "กรุณาระบุในช่องด้านล่างว่างานที่ถูกละเมิดคืออะไร และยืนยันว่าคุณเป็นเจ้าของสิทธิ์หรือผู้ได้รับมอบหมายอำนาจในการยื่นคำร้องนี้"
                  : "Please describe below the copyrighted work being infringed and confirm that you are the rights holder or authorized to act on their behalf."}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                {isCopyright
                  ? (lang === "th" ? "อธิบายงานที่ถูกละเมิดและยืนยันการเป็นเจ้าของสิทธิ์ *" : "Describe the infringed work and confirm ownership *")
                  : isContact ? t.detailsRequiredLabel : t.detailsOptionalLabel}
              </label>
              <textarea
                placeholder={isCopyright
                  ? (lang === "th" ? "เช่น: ชื่องาน, ปีที่สร้าง, ลิงก์ต้นฉบับ, และฉันขอยืนยันโดยสุจริตว่าการใช้งานนี้ไม่ได้รับอนุญาต..." : "e.g.: Name of work, year created, original source URL, and I confirm in good faith that the use is not authorised...")
                  : isContact ? t.describeIssuePlaceholder : t.tellUsMorePlaceholder}
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
                disabled={loading || (isContact && !details.trim()) || (isCopyright && (!details.trim() || !email.trim()))}
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
