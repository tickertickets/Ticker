import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, ArrowRight, ChevronLeft } from "lucide-react";
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

export default function AuthSignup() {
  const [, navigate] = useLocation();
  const { user, refreshUser } = useAuth();
  const { lang } = useLang();
  const tr = (th: string, en: string) => (lang === "th" ? th : en);
  const BASE = import.meta.env.BASE_URL ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) navigate(user.isOnboarded ? "/" : "/onboarding");
  }, [user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !isValidEmail(email)) return;
    setError("");
    setLoading(true);
    try {
      let deviceId = localStorage.getItem("_tid");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("_tid", deviceId);
      }
      const res = await fetch(`${BASE}api/auth/signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
        body: JSON.stringify({ email, password, _hp: "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const localized = authErrorMessage(data.error, lang);
        setError(localized ?? tr("เกิดข้อผิดพลาด", "Something went wrong"));
        return;
      }
      // 1) Confirm the new session and seed localStorage cache.
      const fresh = await refreshUser();
      if (!fresh) {
        setError(tr("สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่", "Sign-up failed, please try again"));
        return;
      }
      // 2) Soft SPA navigate — safe because refreshUser() already removed the
      //    stale 401 cache, fetched fresh user data, and updated AuthContext
      //    state directly (see auth-login.tsx for full explanation).
      //    Using wouter navigate() avoids a full page reload that would briefly
      //    show the address bar in PWA standalone mode.
      navigate("/onboarding");
      return;
    } catch {
      setError(tr("Server กำลังตื่นนอน กรุณารอสักครู่แล้วลองใหม่", "Server is waking up, please try again in a moment"));
    } finally {
      setLoading(false);
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
            onClick={() => navigate("/")}
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
            <form onSubmit={handleSubmit} noValidate>
              <h1 className="font-black text-[26px] leading-[1.1] text-[#111] mb-1 truncate" style={{ fontFamily: "var(--font-display)" }}>
                {tr("สร้างบัญชีใหม่", "Create your account")}
              </h1>
              <p className="text-[13px] text-[#888] mb-6 truncate">
                {tr("บันทึกหนังที่คุณรัก แชร์ให้คนที่คุณรัก", "Log movies. Share with people you care about.")}
              </p>

              <div className="mb-4">
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

              <div className="mb-4">
                <label className="block text-[11px] font-bold text-[#111]/40 tracking-wide mb-1.5">{tr("รหัสผ่าน", "Password")}</label>
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
                type="submit" disabled={loading || !email || !password}
                className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
                style={{ background: "#111", color: "#fff" }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{tr("สมัครสมาชิก", "Sign up")} <ArrowRight className="w-4 h-4" /></>}
              </button>

              <p className="text-center text-[11px] text-[#ccc] mt-4 truncate">
                {tr("การสมัครถือว่ายอมรับ Terms of Service และ Privacy Policy", "Signing up means you agree to Ticker's Terms of Service and Privacy Policy")}
              </p>
            </form>
        </div>
      </div>
    </div>
  );
}
