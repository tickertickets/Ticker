import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, CheckCircle, Clock, XCircle, ImageIcon, Loader2, Popcorn } from "lucide-react";
import { navBack } from "@/lib/nav-back";
import { compressImage } from "@/lib/image-compress";
import { useLang } from "@/lib/i18n";

interface PageVerifyRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  proofImagePath: string | null;
  pageName: string;
  pageUrl: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

function useMyRequest() {
  return useQuery<{ request: PageVerifyRequest | null }>({
    queryKey: ["page-verify-my-request"],
    queryFn: () => fetch("/api/page-verify/my-request", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: (query) => {
      const status = query.state.data?.request?.status;
      return status === "pending" ? 15_000 : false;
    },
  });
}

export default function PageVerificationRequest() {
  const [, navigate] = useLocation();
  const { t } = useLang();
  const qc = useQueryClient();
  const { data, isLoading } = useMyRequest();
  const request = data?.request;

  const [pageName, setPageName] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [proofImagePath, setProofImagePath] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function goBack() {
    navBack(navigate, "/settings");
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/page-verify/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofImagePath, pageName, pageUrl: pageUrl || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? t.errGeneric);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["page-verify-my-request"] });
    },
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.85 });
      const preview = URL.createObjectURL(compressed);
      setProofPreview(preview);
      const res = await fetch("/api/storage/uploads/proxy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": compressed.type },
        body: compressed,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { objectPath } = await res.json() as { objectPath: string };
      setProofImagePath(objectPath);
    } catch {
      alert(t.uploadSlipError);
    } finally {
      setUploading(false);
    }
  }

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
          <h1 className="font-black text-base leading-tight">{t.popcornPageTitle}</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">{t.popcornPageSubtitle}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

        {/* Status banner */}
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
                  {request.status === "pending" && t.popcornPendingDesc}
                  {request.status === "approved" && t.popcornApprovedDesc}
                  {request.status === "rejected" && t.popcornRejectedDesc}
                </p>
                {request.pageName && (
                  <p className="text-[11px] text-foreground mt-1 font-bold">{request.pageName}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {(!request || request.status === "rejected") && (
          <>
            {/* What you get */}
            <div className="rounded-2xl bg-secondary border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Popcorn className="w-5 h-5 text-amber-500" strokeWidth={2} />
                <p className="font-bold text-sm">{t.popcornBadgeName}</p>
              </div>
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: "linear-gradient(135deg, #FEF3C710 0%, #FDE68A18 50%, #FECACA18 100%)",
                  border: "1.5px solid #F59E0B50",
                }}
              >
                <p
                  className="font-black text-lg"
                  style={{
                    background: "linear-gradient(135deg, #F59E0B, #EF4444)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {t.popcornBadgeName.toUpperCase()}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">{t.popcornBadgeDesc}</p>
              </div>
              <ul className="space-y-1.5">
                {t.popcornBenefits.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                    <span className="text-amber-400 mt-0.5">✦</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* How to */}
            <div className="rounded-2xl bg-secondary border border-border p-4 space-y-3">
              <p className="font-bold text-sm">{t.popcornHowToTitle}</p>
              <ol className="space-y-2 text-[12px] text-muted-foreground">
                <li className="flex gap-2"><span className="text-amber-400 font-bold">1.</span><span>{t.popcornStep1}</span></li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold">2.</span><span>{t.popcornStep2}</span></li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold">3.</span><span>{t.popcornStep3}</span></li>
              </ol>
            </div>

            {/* Page name */}
            <div className="space-y-2">
              <p className="font-bold text-sm px-1">{t.popcornPageNameLabel}</p>
              <input
                type="text"
                value={pageName}
                onChange={e => setPageName(e.target.value)}
                placeholder={t.popcornPageNamePlaceholder}
                maxLength={120}
                className="w-full h-11 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-amber-400/50"
              />
            </div>

            {/* Page URL */}
            <div className="space-y-2">
              <p className="font-bold text-sm px-1">{t.popcornPageUrlLabel}</p>
              <input
                type="url"
                value={pageUrl}
                onChange={e => setPageUrl(e.target.value)}
                placeholder={t.popcornPageUrlPlaceholder}
                maxLength={500}
                className="w-full h-11 bg-secondary rounded-2xl px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-amber-400/50"
              />
            </div>

            {/* Proof upload */}
            <div className="space-y-2">
              <p className="font-bold text-sm px-1">{t.popcornUploadProofTitle}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 p-6 active:scale-[0.98] transition-all"
                style={{
                  minHeight: proofPreview ? "auto" : 140,
                  background: proofPreview ? "transparent" : "var(--secondary)",
                }}
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                ) : proofPreview ? (
                  <img src={proofPreview} alt="proof" className="w-full rounded-xl object-contain max-h-64" />
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-muted-foreground opacity-50" />
                    <p className="text-[12px] text-muted-foreground">{t.popcornTapToSelectProof}</p>
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
              {proofPreview && (
                <button
                  onClick={() => { setProofPreview(null); setProofImagePath(null); }}
                  className="text-[11px] text-muted-foreground underline w-full text-center"
                >
                  {t.popcornChangeProof}
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
                disabled={submitMutation.isPending || !proofImagePath || !pageName.trim()}
                className="w-full h-12 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                style={{
                  background: "linear-gradient(135deg, #F59E0B, #EF4444)",
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
