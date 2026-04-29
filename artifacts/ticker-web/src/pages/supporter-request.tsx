import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, CheckCircle, Clock, XCircle, Ticket, ImageIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { navBack } from "@/lib/nav-back";
import { compressImage } from "@/lib/image-compress";
import { useLang } from "@/lib/i18n";

const PROMPTPAY_NUMBER = import.meta.env.VITE_PROMPTPAY_NUMBER ?? "0925375441";
const SUPPORTER_AMOUNT = import.meta.env.VITE_SUPPORTER_AMOUNT ?? "99";

interface SupporterRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  slipImagePath: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

function useMyRequest() {
  return useQuery<{ request: SupporterRequest | null }>({
    queryKey: ["supporter-my-request"],
    queryFn: () => fetch("/api/supporter/my-request", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: (query) => {
      const status = query.state.data?.request?.status;
      return status === "pending" ? 15_000 : false;
    },
  });
}

export default function SupporterRequest() {
  const [, navigate] = useLocation();
  const { t } = useLang();
  const qc = useQueryClient();
  const { data, isLoading } = useMyRequest();
  const request = data?.request;

  const [slipImagePath, setSlipImagePath] = useState<string | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function goBack() {
    navBack(navigate, "/settings");
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/supporter/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slipImagePath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? t.errGeneric);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supporter-my-request"] });
    },
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.85 });
      const preview = URL.createObjectURL(compressed);
      setSlipPreview(preview);
      const res = await fetch("/api/storage/uploads/proxy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": compressed.type },
        body: compressed,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { objectPath } = await res.json() as { objectPath: string };
      setSlipImagePath(objectPath);
    } catch {
      alert(t.uploadSlipError);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (request?.status === "approved") {
      qc.invalidateQueries({ queryKey: ["badges-me"] });
      qc.invalidateQueries({ queryKey: ["supporter-status"] });
    }
  }, [request?.status, qc]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-safe-top pt-4 pb-3 border-b border-border">
        <button
          onClick={goBack}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary hover:bg-secondary/70 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-black text-base leading-tight">{t.supporterPageTitle}</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">{t.supporterPageSubtitle}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

        {/* Current request status */}
        {request && (
          <div className={`rounded-2xl p-4 border ${
            request.status === "pending"
              ? "bg-amber-500/10 border-amber-500/30"
              : request.status === "approved"
              ? "bg-green-500/10 border-green-500/30"
              : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className="flex items-center gap-3">
              {request.status === "pending" && <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />}
              {request.status === "approved" && <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />}
              {request.status === "rejected" && <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
              <div>
                <p className={`font-bold text-sm ${
                  request.status === "pending" ? "text-amber-400"
                  : request.status === "approved" ? "text-green-400"
                  : "text-red-400"
                }`}>
                  {request.status === "pending" && t.pendingStatus}
                  {request.status === "approved" && t.approvedStatus}
                  {request.status === "rejected" && t.rejectedStatus}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {request.status === "pending" && t.pendingStatusDesc}
                  {request.status === "approved" && t.approvedStatusDesc}
                  {request.status === "rejected" && t.rejectedStatusDesc}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Only show form if no pending/approved request */}
        {(!request || request.status === "rejected") && (
          <>
            {/* What you get */}
            <div className="rounded-2xl bg-secondary border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-pink-400" strokeWidth={2} />
                <p className="font-bold text-sm">Supporter Badge Lv5</p>
              </div>
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: "linear-gradient(135deg, #FDF4FF10 0%, #F0ABFC18 20%, #A78BFA18 40%, #67E8F918 60%, #86EFAC18 80%, #FDE68A18 100%)",
                  border: "1.5px solid #EC489950",
                }}
              >
                <p
                  className="font-black text-lg"
                  style={{
                    background: "linear-gradient(135deg, #F0ABFC, #A78BFA, #67E8F9, #86EFAC, #FDE68A)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  SUPPORTER
                </p>
                <p className="text-[11px] text-muted-foreground">{t.supporterBadgeDesc}</p>
              </div>
              <ul className="space-y-1.5">
                {t.supporterBenefits.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                    <span className="text-pink-400 mt-0.5">✦</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Payment info */}
            <div className="rounded-2xl bg-secondary border border-border p-4 space-y-3">
              <p className="font-bold text-sm">{t.howToSupportTitle}</p>
              <div className="rounded-xl bg-background p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-muted-foreground">{t.paymentMethod}</span>
                  <span className="text-[13px] font-bold text-foreground">PromptPay</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-muted-foreground">{t.paymentNumber}</span>
                  <span className="text-[11px] font-bold text-foreground">{PROMPTPAY_NUMBER}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-muted-foreground">{t.paymentAmount}</span>
                  <span className="text-[11px] font-bold text-foreground">฿{SUPPORTER_AMOUNT}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                {t.attachSlipNote}
              </p>
            </div>

            {/* Slip upload */}
            <div className="space-y-2">
              <p className="font-bold text-sm px-1">{t.uploadSlipTitle}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 p-6 active:scale-[0.98] transition-all"
                style={{
                  minHeight: slipPreview ? "auto" : 140,
                  background: slipPreview ? "transparent" : "var(--secondary)",
                }}
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                ) : slipPreview ? (
                  <img src={slipPreview} alt="slip" className="w-full rounded-xl object-contain max-h-64" />
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-muted-foreground opacity-50" />
                    <p className="text-[12px] text-muted-foreground">{t.tapToSelectSlip}</p>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {slipPreview && (
                <button
                  onClick={() => { setSlipPreview(null); setSlipImagePath(null); }}
                  className="text-[11px] text-muted-foreground underline w-full text-center"
                >
                  {t.changeSlip}
                </button>
              )}
            </div>

            {/* Submit */}
            {submitMutation.isError && (
              <p className="text-[12px] text-red-500 text-center">
                {submitMutation.error instanceof Error ? submitMutation.error.message : t.errGeneric}
              </p>
            )}
            <div>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || !slipImagePath}
                className="w-full h-12 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                style={{
                  background: "linear-gradient(135deg, #F0ABFC, #A78BFA, #67E8F9)",
                }}
              >
                {submitMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {submitMutation.isPending ? t.sendingRequest : t.submitRequest}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
