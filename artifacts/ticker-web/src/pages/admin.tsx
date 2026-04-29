import { useState, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, XCircle, Trash2, ExternalLink, Clock, Megaphone, Send, Popcorn, Settings, QrCode, Upload } from "lucide-react";
import { Loader2 } from "lucide-react";
import { navBack } from "@/lib/nav-back";
import { useAuth } from "@/hooks/use-auth";

interface SupporterRequestRow {
  request: {
    id: string;
    userId: string;
    slipImagePath: string | null;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
    reviewedAt: string | null;
  };
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

type FilterStatus = "pending" | "approved" | "rejected" | "all";
type Tab = "supporter" | "verify" | "broadcast" | "settings";

class AdminForbiddenError extends Error {
  constructor() { super("forbidden"); }
}

function useAdminRequests(status: FilterStatus) {
  return useQuery<{ requests: SupporterRequestRow[] }>({
    queryKey: ["admin-supporter-requests", status],
    queryFn: () =>
      fetch(`/api/supporter/admin/requests?status=${status}`, { credentials: "include" }).then(r => {
        if (r.status === 403) throw new AdminForbiddenError();
        if (!r.ok) throw new Error(`server_error:${r.status}`);
        return r.json();
      }),
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err instanceof AdminForbiddenError) return false;
      return failureCount < 12;
    },
    retryDelay: (attemptIndex) => Math.min(3000 + attemptIndex * 2000, 10_000),
    refetchOnWindowFocus: false,
  });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_PILL: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
};
const STATUS_TH: Record<string, string> = {
  pending: "รอ",
  approved: "อนุมัติ",
  rejected: "ปฏิเสธ",
};
const FILTER_TH: Record<FilterStatus, string> = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติ",
  rejected: "ปฏิเสธ",
  all: "ทั้งหมด",
};

function FilterBar({ filter, setFilter }: { filter: FilterStatus; setFilter: (f: FilterStatus) => void }) {
  return (
    <div className="flex gap-1 px-4 py-3 border-b border-border overflow-x-auto">
      {(["pending", "approved", "rejected", "all"] as FilterStatus[]).map(f => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all ${
            filter === f ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"
          }`}
        >
          {FILTER_TH[f]}
        </button>
      ))}
    </div>
  );
}

function UserAvatar({ user }: { user: { avatarUrl: string | null; username: string | null; displayName: string | null } }) {
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt={user.username ?? ""} className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
  ) : (
    <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
      <span className="text-[13px] font-bold text-muted-foreground">{(user.username ?? "?")[0]?.toUpperCase()}</span>
    </div>
  );
}

type VerifyRequestRow = {
  request: {
    id: string;
    userId: string;
    proofImagePath: string | null;
    pageName: string;
    pageUrl: string | null;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
    reviewedAt: string | null;
  };
  user: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null };
};

function VerifyPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [openImg, setOpenImg] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ requests: VerifyRequestRow[] }>({
    queryKey: ["admin-page-verify-requests", filter],
    queryFn: () =>
      fetch(`/api/page-verify/admin/requests?status=${filter}`, { credentials: "include" })
        .then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }),
    staleTime: 60_000,
  });

  const approve    = useMutation({ mutationFn: (id: string) => fetch(`/api/page-verify/admin/requests/${id}/approve`, { method: "POST", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-page-verify-requests"] }) });
  const reject     = useMutation({ mutationFn: (id: string) => fetch(`/api/page-verify/admin/requests/${id}/reject`,  { method: "POST", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-page-verify-requests"] }) });
  const revoke     = useMutation({ mutationFn: (uid: string) => fetch(`/api/page-verify/admin/users/${uid}/revoke`,   { method: "POST", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-page-verify-requests"] }) });
  const deleteRow  = useMutation({ mutationFn: (id: string) => fetch(`/api/page-verify/admin/requests/${id}`,         { method: "DELETE", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-page-verify-requests"] }) });

  const requests = data?.requests ?? [];

  return (
    <>
      <FilterBar filter={filter} setFilter={setFilter} />
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {!isLoading && requests.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Clock className="w-8 h-8 text-muted-foreground opacity-30" />
            <p className="text-[13px] text-muted-foreground">ไม่มีคำขอ</p>
          </div>
        )}
        {!isLoading && requests.length > 0 && (
          <div className="divide-y divide-border">
            {requests.map(({ request, user: u }) => {
              const proofUrl = request.proofImagePath?.startsWith("/objects/")
                ? `/api/storage${request.proofImagePath}` : request.proofImagePath;
              return (
                <div key={request.id} className="px-4 py-3 space-y-2.5">
                  {/* Row 1: avatar · name · info chips · delete */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar user={u} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-bold text-[13px] truncate shrink">{u.displayName || u.username}</p>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_PILL[request.status]}`}>{STATUS_TH[request.status]}</span>
                      </div>
                      {/* Single-line supplementary info */}
                      <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                        <span className="text-[11px] text-muted-foreground truncate shrink">{request.pageName}</span>
                        {request.pageUrl && (
                          <>
                            <span className="text-muted-foreground/40 flex-shrink-0">·</span>
                            <a href={request.pageUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex items-center gap-0.5 text-[11px] text-blue-400">
                              <ExternalLink className="w-2.5 h-2.5" />URL
                            </a>
                          </>
                        )}
                        {proofUrl && (
                          <>
                            <span className="text-muted-foreground/40 flex-shrink-0">·</span>
                            <button onClick={() => setOpenImg(proofUrl)} className="flex-shrink-0 flex items-center gap-0.5 text-[11px] text-blue-400">
                              <ExternalLink className="w-2.5 h-2.5" />หลักฐาน
                            </button>
                          </>
                        )}
                        <span className="text-muted-foreground/40 flex-shrink-0">·</span>
                        <span className="flex-shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(request.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { if (confirm("ลบรายการนี้?")) deleteRow.mutate(request.id); }}
                      disabled={deleteRow.isPending}
                      className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      {deleteRow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {/* Row 2: action buttons */}
                  <div className="flex gap-2">
                    {request.status === "pending" && (
                      <>
                        <button onClick={() => approve.mutate(request.id)} disabled={approve.isPending} className="flex-1 h-8 rounded-xl font-bold text-xs text-white bg-green-600 hover:bg-green-500 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                          {approve.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}อนุมัติ
                        </button>
                        <button onClick={() => reject.mutate(request.id)} disabled={reject.isPending} className="flex-1 h-8 rounded-xl font-bold text-xs text-white bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                          {reject.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}ปฏิเสธ
                        </button>
                      </>
                    )}
                    {request.status === "approved" && (
                      <button onClick={() => { if (confirm("ถอน Badge ถังป็อปคอร์นของผู้ใช้นี้?")) revoke.mutate(request.userId); }} disabled={revoke.isPending} className="h-8 px-3 rounded-xl font-bold text-xs text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {revoke.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}ถอน Badge
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {openImg && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setOpenImg(null)}>
          <img src={openImg} alt="proof" className="max-w-full max-h-[80vh] rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}

function BroadcastPanel() {
  const [target, setTarget] = useState<"all" | "usernames">("all");
  const [usernames, setUsernames] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const broadcast = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { target, title, body };
      if (url) payload.url = url;
      if (target === "usernames") payload.usernames = usernames.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      const r = await fetch("/api/admin/broadcast", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const t = await r.text(); throw new Error(t || `error_${r.status}`); }
      return r.json() as Promise<{ recipients: number; pushed: number }>;
    },
    onSuccess: (data) => {
      setResult(`ส่งสำเร็จ — ผู้รับ ${data.recipients} คน, ส่งแจ้งเตือน ${data.pushed} เครื่อง`);
      setTitle(""); setBody(""); setUrl(""); setUsernames("");
    },
    onError: (e: Error) => setResult(`ผิดพลาด: ${e.message}`),
  });

  const canSend = title.trim().length > 0 && body.trim().length > 0
    && (target === "all" || usernames.trim().length > 0)
    && !broadcast.isPending;

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-secondary rounded-2xl p-4 space-y-3 border border-border">
        <div>
          <p className="text-[12px] font-bold text-muted-foreground mb-2">ส่งถึง</p>
          <div className="flex gap-2">
            {(["all", "usernames"] as const).map(opt => (
              <button key={opt} onClick={() => setTarget(opt)} className={`flex-1 h-9 rounded-xl text-[12px] font-bold transition-all ${target === opt ? "bg-foreground text-background" : "bg-background text-muted-foreground border border-border"}`}>
                {opt === "all" ? "ผู้ใช้ทั้งหมด" : "เลือกผู้ใช้"}
              </button>
            ))}
          </div>
        </div>
        {target === "usernames" && (
          <div>
            <p className="text-[12px] font-bold text-muted-foreground mb-1.5">Usernames (เว้นวรรค หรือ comma)</p>
            <textarea value={usernames} onChange={e => setUsernames(e.target.value)} placeholder="alice, bob, charlie" rows={2} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-[13px] resize-none focus:outline-none focus:border-foreground" />
          </div>
        )}
        <div>
          <p className="text-[12px] font-bold text-muted-foreground mb-1.5">หัวข้อ</p>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="ประกาศจากทีม Ticker" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-foreground" />
        </div>
        <div>
          <p className="text-[12px] font-bold text-muted-foreground mb-1.5">ข้อความ</p>
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={500} rows={4} placeholder="เนื้อหาประกาศ" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-[13px] resize-none focus:outline-none focus:border-foreground" />
          <p className="text-[10px] text-muted-foreground mt-1 text-right">{body.length}/500</p>
        </div>
        <div>
          <p className="text-[12px] font-bold text-muted-foreground mb-1.5">ลิงก์ (ไม่บังคับ)</p>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="/notifications" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-foreground" />
        </div>
        <button onClick={() => broadcast.mutate()} disabled={!canSend} className="w-full h-11 rounded-xl font-bold text-sm text-background bg-foreground hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {broadcast.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}ส่งประกาศ
        </button>
        {result && (
          <div className={`text-[12px] px-3 py-2 rounded-xl ${result.startsWith("ผิด") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>{result}</div>
        )}
      </div>
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
        <p className="text-[11px] text-amber-400 whitespace-nowrap overflow-x-auto">ประกาศจะถูกบันทึกในการแจ้งเตือนของผู้รับ และส่ง push ถึงเครื่องที่เปิดการแจ้งเตือนไว้</p>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["admin-settings-qr"],
    queryFn: () => fetch("/api/admin/settings/promptpay_qr_url", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
  });

  const currentPath = data?.value ?? null;
  const previewUrl = currentPath?.startsWith("/objects/") ? `/api/storage${currentPath}` : currentPath;

  async function handleFile(file: File) {
    setUploading(true);
    setMsg(null);
    try {
      const uploadRes = await fetch("/api/storage/uploads/proxy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(`upload_failed:${uploadRes.status}`);
      const { objectPath } = await uploadRes.json() as { objectPath: string };

      const saveRes = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "promptpay_qr_url", value: objectPath }),
      });
      if (!saveRes.ok) throw new Error(`save_failed:${saveRes.status}`);

      await qc.invalidateQueries({ queryKey: ["admin-settings-qr"] });
      setMsg("อัปเดต QR สำเร็จ");
    } catch (e: unknown) {
      setMsg(`ผิดพลาด: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      <div className="bg-secondary rounded-2xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-4 h-4 text-muted-foreground" />
          <p className="text-[13px] font-bold">QR PromptPay</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : previewUrl ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-44 h-44 rounded-2xl overflow-hidden bg-white p-2 border border-border">
              <img src={previewUrl} alt="PromptPay QR" className="w-full h-full object-contain" />
            </div>
            <p className="text-[11px] text-green-400">QR ปัจจุบัน</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <QrCode className="w-8 h-8 opacity-30" />
            <p className="text-[12px]">ยังไม่มี QR</p>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full h-11 rounded-xl font-bold text-sm bg-foreground text-background hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {previewUrl ? "เปลี่ยน QR" : "อัปโหลด QR"}
        </button>

        {msg && (
          <div className={`text-[12px] px-3 py-2 rounded-xl ${msg.startsWith("ผิด") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
            {msg}
          </div>
        )}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
        <p className="text-[11px] text-amber-400">รูป QR จะแสดงในหน้า Supporter ทันทีหลังอัปเดต</p>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("supporter");
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [openImg, setOpenImg] = useState<string | null>(null);

  const { data, isLoading, error } = useAdminRequests(filter);

  const approveMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/supporter/admin/requests/${id}/approve`, { method: "POST", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-supporter-requests"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/supporter/admin/requests/${id}/reject`, { method: "POST", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-supporter-requests"] }),
  });
  const deleteRowMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/supporter/admin/requests/${id}`, { method: "DELETE", credentials: "include" }).then(r => { if (!r.ok) throw new Error("failed"); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-supporter-requests"] }),
  });

  if (!user || (isLoading && !data)) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
          {isLoading && <p className="text-[12px] text-muted-foreground">กำลังเชื่อมต่อเซิร์ฟเวอร์…</p>}
        </div>
      </div>
    );
  }

  if (error && !data) {
    const isForbidden = error instanceof AdminForbiddenError;
    return (
      <div className="min-h-full flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="font-bold text-red-400">{isForbidden ? "ไม่มีสิทธิ์เข้าถึง" : "เชื่อมต่อไม่ได้"}</p>
          <p className="text-[12px] text-muted-foreground">{isForbidden ? "หน้านี้สำหรับผู้ดูแลระบบเท่านั้น" : "เซิร์ฟเวอร์ไม่ตอบสนอง ลองใหม่อีกครั้ง"}</p>
        </div>
      </div>
    );
  }

  const requests = data?.requests ?? [];

  return (
    <div className="h-full bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-safe-top pt-4 pb-3 border-b border-border">
        <button onClick={() => navBack(navigate, "/settings")} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base leading-tight">Admin</h1>
          <p className="text-[11px] text-muted-foreground leading-tight truncate">
            {tab === "supporter" && "ตรวจสอบคำขอ Supporter Badge"}
            {tab === "verify" && "ตรวจสอบคำขอ Badge ถังป็อปคอร์น"}
            {tab === "broadcast" && "ส่งประกาศถึงผู้ใช้"}
          </p>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 px-4 py-3 border-b border-border">
        {([["supporter", <CheckCircle className="w-3.5 h-3.5" />, "Supporter"], ["verify", <Popcorn className="w-3.5 h-3.5" />, "Verify"], ["broadcast", <Megaphone className="w-3.5 h-3.5" />, "ประกาศ"]] as [Tab, ReactNode, string][]).map(([id, icon, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 h-9 rounded-xl text-[12px] font-bold transition-all flex items-center justify-center gap-1.5 ${tab === id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "broadcast" ? (
        <div className="flex-1 overflow-y-auto"><BroadcastPanel /></div>
      ) : tab === "verify" ? (
        <VerifyPanel />
      ) : (
        <>
          <FilterBar filter={filter} setFilter={setFilter} />
          <div className="flex-1 overflow-y-auto">
            {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
            {!isLoading && requests.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Clock className="w-8 h-8 text-muted-foreground opacity-30" />
                <p className="text-[13px] text-muted-foreground">ไม่มีคำขอ</p>
              </div>
            )}
            {!isLoading && requests.length > 0 && (
              <div className="divide-y divide-border">
                {requests.map(({ request, user: u }) => {
                  const slipUrl = request.slipImagePath?.startsWith("/objects/")
                    ? `/api/storage${request.slipImagePath}` : request.slipImagePath;
                  return (
                    <div key={request.id} className="px-4 py-3 space-y-2.5">
                      {/* Row 1: avatar · name · chips · delete */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar user={u} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="font-bold text-[13px] truncate shrink">{u.displayName || u.username}</p>
                            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_PILL[request.status]}`}>{STATUS_TH[request.status]}</span>
                          </div>
                          {/* Single-line supplementary info */}
                          <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                            <span className="flex-shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(request.createdAt)}</span>
                            {slipUrl && (
                              <>
                                <span className="text-muted-foreground/40 flex-shrink-0">·</span>
                                <button onClick={() => setOpenImg(slipUrl)} className="flex-shrink-0 flex items-center gap-0.5 text-[11px] text-blue-400">
                                  <ExternalLink className="w-2.5 h-2.5" />สลิป
                                </button>
                              </>
                            )}
                            {!slipUrl && <><span className="text-muted-foreground/40 flex-shrink-0">·</span><span className="text-[11px] text-muted-foreground/50 flex-shrink-0 italic">ไม่มีสลิป</span></>}
                          </div>
                        </div>
                        <button
                          onClick={() => { if (confirm("ลบรายการนี้?")) deleteRowMutation.mutate(request.id); }}
                          disabled={deleteRowMutation.isPending}
                          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          {deleteRowMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      {/* Row 2: action buttons */}
                      <div className="flex gap-2">
                        {request.status === "pending" && (
                          <>
                            <button onClick={() => approveMutation.mutate(request.id)} disabled={approveMutation.isPending} className="flex-1 h-8 rounded-xl font-bold text-xs text-white bg-green-600 hover:bg-green-500 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                              {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}อนุมัติ
                            </button>
                            <button onClick={() => rejectMutation.mutate(request.id)} disabled={rejectMutation.isPending} className="flex-1 h-8 rounded-xl font-bold text-xs text-white bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                              {rejectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}ปฏิเสธ
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {openImg && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setOpenImg(null)}>
          <img src={openImg} alt="slip" className="max-w-full max-h-[80vh] rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
