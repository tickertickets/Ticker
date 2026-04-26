import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, ArrowRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useLang, authErrorMessage } from "@/lib/i18n";

function isValidEmail(v: string): boolean {
  if (!v || v.length > 254) return false;
  const atIdx = v.lastIndexOf("@");
  if (atIdx < 1) return false;
  const local = v.slice(0, atIdx);
  const domain = v.slice(atIdx + 1);
  if (local.length > 64 || domain.length < 4) return false;
  if (!/^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return false;
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(domain)) return false;
  if (!/\.[a-zA-Z]{2,}$/.test(domain)) return false;
  return true;
}

type SubMode = "login" | "forgot" | "forgot-sent" | "reset-password" | "reset-done";

export default function AuthLogin() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { lang } = useLang();
  const tr = (th: string, en: string) => (lang === "th" ? th : en);
  const qc = useQueryClient();
  const BASE = import.meta.env.BASE_URL ?? "/";

  const [subMode, setSubMode] = useState<SubMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotResetUrl, setForgotResetUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [resetToken, setResetToken] = useState("");

  useEffect(() => {
    if (user) navigate(user.isOnboarded ? "/" : "/onboarding");
  }, [user, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("reset");
    if (r) {
      setResetToken(r);
      setSubMode("reset-password");
      window.history.replaceState({}, "", window.location.pathname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setError("");
    setLoading(true);
    try {
      let deviceId = localStorage.getItem("_tid");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("_tid", deviceId);
      }
      const res = await fetch(`${BASE}api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const localized = authErrorMessage(data.error, lang);
        setError(localized ?? tr("อีเมลหรือรหัสผ่านไม่ถูกต้อง", "Incorrect email or password"));
        return;
      }
      qc.invalidateQueries();
      navigate("/");
    } catch {
      setError(tr("Server กำลังตื่นนอน กรุณารอสักครู่แล้วลองใหม่", "Server is waking up, please try again in a moment"));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !isValidEmail(email)) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.token) {
        const base = import.meta.env.BASE_URL ?? "/";
        setForgotResetUrl(`${window.location.origin}${base}login?reset=${data.token}`);
      } else if (data.resetUrl) {
        setForgotResetUrl(data.resetUrl);
      }
      setSubMode("forgot-sent");
    } catch {
      setError(tr("เกิดข้อผิดพลาด กรุณาลองใหม่", "Something went wrong, please try again"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password || !resetToken) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const localized = authErrorMessage(data.error, lang);
        setError(localized ?? tr("เกิดข้อผิดพลาด", "Something went wrong"));
        return;
      }
      setSubMode("reset-done");
    } catch {
      setError(tr("เกิดข้อผิดพลาด กรุณาลองใหม่", "Something went wrong, please try again"));
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    if (subMode !== "login") {
      setSubMode("login");
      setError("");
    } else {
      navigate("/");
    }
  }

  return (
    <div
      className="flex justify-center"
      style={{ height: "100%", overflow: "hidden", background: "var(--app-chrome)" }}
    >
      <div
        className="relative w-full max-w-[430px] flex flex-col"
        style={{ height: "100%", overflow: "hidden", background: "#fff" }}
      >
        {/* Top bar */}
        <div
          className="flex items-center gap-3 px-5 pt-5 pb-4 flex-shrink-0"
        >
          <button
            onClick={handleBack}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "#f2f2f7" }}
          >
            <ChevronLeft className="w-5 h-5 text-[#111]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#111" }}>
              <span className="text-white font-black text-sm" style={{ fontFamily: "var(--font-display)" }}>T</span>
            </div>
            <span className="font-black text-xs tracking-[0.12em] text-black/30" style={{ fontFamily: "var(--font-display)" }}>Ticker</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-5 overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

          {/* ── Login form ── */}
          {subMode === "login" && (
            <form onSubmit={handleLogin} noValidate>
              <h1 className="font-black text-[26px] leading-[1.1] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                {tr("ยินดีต้อนรับกลับมา", "Welcome back")}
              </h1>
              <p className="text-[13.5px] text-[#888] mb-6 leading-relaxed">
                {tr("เข้าสู่ระบบเพื่อดูคอลเลกชันของคุณ", "Sign in to view your collection")}
              </p>

              <div className="mb-3">
                <label className="block text-[11px] font-bold text-[#111]/40 tracking-wide mb-1.5">{tr("อีเมล", "Email")}</label>
                <input
                  type="email" autoComplete="email" value={email} required
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder="ticker@gmail.com"
                  className="w-full h-[52px] rounded-xl px-4 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                  style={{ background: "#f5f5f7", border: "1.5px solid transparent" }}
                  onFocus={e => (e.target.style.borderColor = "#111")}
                  onBlur={e => (e.target.style.borderColor = "transparent")}
                />
              </div>

              <div className="mb-2">
                <label className="block text-[11px] font-bold text-[#111]/40 tracking-wide mb-1.5">{tr("รหัสผ่าน", "Password")}</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"} autoComplete="current-password" value={password} required
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder={tr("รหัสผ่าน", "Password")}
                    className="w-full h-[52px] rounded-xl px-4 pr-12 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                    style={{ background: "#f5f5f7", border: "1.5px solid transparent" }}
                    onFocus={e => (e.target.style.borderColor = "#111")}
                    onBlur={e => (e.target.style.borderColor = "transparent")}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#aaa]" tabIndex={-1}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="text-right mb-5">
                <button type="button" onClick={() => { setSubMode("forgot"); setError(""); }} className="text-[12px] text-[#888]">
                  {tr("ลืมรหัสผ่าน?", "Forgot password?")}
                </button>
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 mb-4 text-[13px] font-medium" style={{ background: "#fff0f0", color: "#c00", border: "1px solid #fecdd3" }}>
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading || !email || !password}
                className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                style={{ background: "#111", color: "#fff" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{tr("เข้าสู่ระบบ", "Sign in")} <ArrowRight className="w-4 h-4" /></>}
              </button>

            </form>
          )}

          {/* ── Forgot password form ── */}
          {subMode === "forgot" && (
            <form onSubmit={handleForgot} noValidate>
              <h1 className="font-black text-[26px] leading-[1.1] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                {tr("ลืมรหัสผ่าน?", "Forgot password?")}
              </h1>
              <p className="text-[13.5px] text-[#888] mb-6 leading-relaxed">
                {tr("กรอกอีเมลที่ใช้ลงทะเบียน เราจะส่งลิงก์รีเซ็ตให้คุณ", "Enter the email you registered with — we'll send you a reset link")}
              </p>

              <div className="mb-6">
                <label className="block text-[11px] font-bold text-[#111]/40 tracking-wide mb-1.5">{tr("อีเมล", "Email")}</label>
                <input
                  type="email" autoComplete="email" value={email} required
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder="ticker@gmail.com"
                  className="w-full h-[52px] rounded-xl px-4 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                  style={{ background: "#f5f5f7", border: "1.5px solid transparent" }}
                  onFocus={e => (e.target.style.borderColor = "#111")}
                  onBlur={e => (e.target.style.borderColor = "transparent")}
                />
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 mb-4 text-[13px] font-medium" style={{ background: "#fff0f0", color: "#c00", border: "1px solid #fecdd3" }}>
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading || !email}
                className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                style={{ background: "#111", color: "#fff" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : tr("ส่งลิงก์รีเซ็ต", "Send reset link")}
              </button>
            </form>
          )}

          {/* ── Forgot sent ── */}
          {subMode === "forgot-sent" && (
            <div>
              {forgotResetUrl ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-[#f0fff4] flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                  </div>
                  <h1 className="font-black text-[24px] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>{tr("ลิงก์รีเซ็ตรหัสผ่าน", "Password reset link")}</h1>
                  <p className="text-[12px] text-[#888] mb-4">{tr("คัดลอกลิงก์ด้านล่างแล้วเปิดในเบราว์เซอร์ · หมดอายุใน 1 ชั่วโมง", "Copy the link below and open it in your browser · expires in 1 hour")}</p>
                  <div className="rounded-xl px-3 py-3 mb-3 break-all text-[11px] font-mono text-[#444] select-all" style={{ background: "#f5f5f7", border: "1px solid #e0e0e0" }}>
                    {forgotResetUrl}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(forgotResetUrl).then(() => setCopied(true)); }}
                    className="w-full h-[48px] rounded-2xl font-bold text-[14px] mb-3 flex items-center justify-center gap-2 transition-opacity active:opacity-70"
                    style={{ background: copied ? "#16a34a" : "#111", color: "#fff" }}
                  >
                    {copied ? <><CheckCircle2 className="w-4 h-4" /> {tr("คัดลอกแล้ว!", "Copied!")}</> : tr("คัดลอกลิงก์", "Copy link")}
                  </button>
                  <div className="text-center">
                    <button onClick={() => { window.location.href = forgotResetUrl; }} className="text-[12px] text-[#888] underline underline-offset-2 mb-3 block mx-auto">
                      {tr("หรือคลิกเพื่อเปิดลิงก์เลย", "Or click to open the link now")}
                    </button>
                    <button onClick={() => setSubMode("login")} className="text-[12px] text-[#aaa]">← {tr("กลับเข้าสู่ระบบ", "Back to sign in")}</button>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <p className="text-[13px] text-[#666] mb-6">{tr("ไม่พบบัญชีที่ใช้อีเมลนี้", "No account found for this email")}</p>
                  <button onClick={() => setSubMode("forgot")} className="text-[12px] text-[#888] underline mb-3 block mx-auto">{tr("ลองอีเมลอื่น", "Try another email")}</button>
                  <button onClick={() => setSubMode("login")} className="text-[12px] text-[#aaa]">← {tr("กลับเข้าสู่ระบบ", "Back to sign in")}</button>
                </div>
              )}
            </div>
          )}

          {/* ── Reset password form ── */}
          {subMode === "reset-password" && (
            <form onSubmit={handleResetPassword} noValidate>
              <h1 className="font-black text-[26px] leading-[1.1] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                {tr("ตั้งรหัสผ่านใหม่", "Set a new password")}
              </h1>
              <p className="text-[13.5px] text-[#888] mb-6 leading-relaxed">{tr("สร้างรหัสผ่านใหม่ที่คุณจำได้", "Create a new password you'll remember")}</p>
              <div className="mb-6">
                <label className="block text-[11px] font-bold text-[#111]/40 tracking-wide mb-1.5">{tr("รหัสผ่านใหม่", "New password")}</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"} autoComplete="new-password" value={password} required minLength={8}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder={tr("อย่างน้อย 8 ตัวอักษร", "At least 8 characters")}
                    className="w-full h-[52px] rounded-xl px-4 pr-12 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                    style={{ background: "#f5f5f7", border: "1.5px solid transparent" }}
                    onFocus={e => (e.target.style.borderColor = "#111")}
                    onBlur={e => (e.target.style.borderColor = "transparent")}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#aaa]" tabIndex={-1}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="rounded-xl px-4 py-3 mb-4 text-[13px] font-medium" style={{ background: "#fff0f0", color: "#c00", border: "1px solid #fecdd3" }}>
                  {error}
                </div>
              )}
              <button
                type="submit" disabled={loading || !password}
                className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                style={{ background: "#111", color: "#fff" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{tr("บันทึกรหัสผ่าน", "Save password")} <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          )}

          {/* ── Reset done ── */}
          {subMode === "reset-done" && (
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#f0fff4] flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="font-black text-[24px] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>{tr("ตั้งรหัสผ่านใหม่สำเร็จ", "Password updated")}</h2>
              <p className="text-[13px] text-[#888] mb-7">{tr("ตอนนี้คุณสามารถเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้แล้ว", "You can now sign in with your new password")}</p>
              <button
                onClick={() => { setSubMode("login"); setPassword(""); }}
                className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2"
                style={{ background: "#111", color: "#fff" }}
              >
                {tr("เข้าสู่ระบบ", "Sign in")} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
