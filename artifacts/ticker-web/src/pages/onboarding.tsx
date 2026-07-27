import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useCompleteOnboarding, useCheckUsername } from "@workspace/api-client-react";
import { useDebounceValue } from "usehooks-ts";
import { Check, ChevronLeft, ChevronRight, Loader2, AlertCircle, X } from "lucide-react";
import { useLocation } from "wouter";
import { useLang, type Lang } from "@/lib/i18n";

// Step definitions
const STEPS_TH = [
  { id: 1, title: "ชื่อผู้ใช้",     subtitle: "คนอื่นจะเจอคุณด้วยชื่อนี้" },
  { id: 2, title: "วันเกิด",        subtitle: "ต้องอายุ 13 ปีขึ้นไป เราจะไม่แชร์ข้อมูลนี้" },
  { id: 3, title: "ยืนยันข้อตกลง",  subtitle: "อ่านและยอมรับก่อนเริ่มใช้งาน" },
];
const STEPS_EN = [
  { id: 1, title: "Username",         subtitle: "Others will find you by this name" },
  { id: 2, title: "Date of Birth",    subtitle: "You must be 13+. We won't share this." },
  { id: 3, title: "Confirm Terms",    subtitle: "Read and accept before getting started" },
];
const getSteps = (lang: Lang) => (lang === "en" ? STEPS_EN : STEPS_TH);

// ── OTP-style Date Input (DD / MM / YYYY) ─────────────────────────────────────

// digits layout: [D0, D1, M0, M1, Y0, Y1, Y2, Y3]
function DateOtpInput({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
}) {
  const tr = (th: string, en: string) => (lang === "en" ? en : th);

  const parseToDigits = (v: string): string[] => {
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-");
      return [...d.split(""), ...m.split(""), ...y.split("")];
    }
    return Array(8).fill("");
  };

  const [digits, setDigits] = useState<string[]>(() => parseToDigits(value));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (i: number) => refs.current[i]?.focus();

  // Emit parsed date whenever digits change
  useEffect(() => {
    const dd = digits[0] + digits[1];
    const mm = digits[2] + digits[3];
    const yyyy = digits[4] + digits[5] + digits[6] + digits[7];
    if (!/^\d{2}$/.test(dd) || !/^\d{2}$/.test(mm) || !/^\d{4}$/.test(yyyy)) {
      onChange("");
      return;
    }
    const d = parseInt(dd, 10);
    const m = parseInt(mm, 10);
    const y = parseInt(yyyy, 10);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) {
      onChange("invalid"); // signal invalid date without clearing digits
      return;
    }
    onChange(`${yyyy}-${mm}-${dd}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const handleChange = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    setDigits(prev => { const n = [...prev]; n[i] = digit; return n; });
    if (i < 7) focusBox(i + 1);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i] !== "") {
        setDigits(prev => { const n = [...prev]; n[i] = ""; return n; });
      } else if (i > 0) {
        focusBox(i - 1);
        setDigits(prev => { const n = [...prev]; n[i - 1] = ""; return n; });
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight" && i < 7) {
      e.preventDefault();
      focusBox(i + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
    if (!text) return;
    e.preventDefault();
    setDigits(prev => {
      const next = [...prev];
      for (let j = 0; j < text.length; j++) next[j] = text[j];
      return next;
    });
    focusBox(Math.min(text.length, 7));
  };

  const BOX =
    "w-full h-12 min-w-0 rounded-xl text-center text-[18px] font-bold text-[#111] outline-none " +
    "bg-[#f2f2f7] border-[1.5px] border-transparent focus:border-[#111] transition-all caret-transparent select-none";
  const SEP = "text-[22px] font-light text-[#ccc] pb-1 self-end justify-self-center";

  // 10-column grid: 2 day digits, separator, 2 month digits, separator, 4 year digits.
  // Every digit column is an equal `1fr` share of the row's actual width, so the
  // whole thing always spans exactly the same width as the label row and the
  // "Day / Month / Year of birth" text above it — no fixed px widths that can
  // overflow the container and get clipped flush against the screen edge.
  const GRID_COLS = "repeat(2, minmax(0, 1fr)) auto repeat(2, minmax(0, 1fr)) auto repeat(4, minmax(0, 1fr))";
  const GAP = "0.375rem";

  const group = (indices: number[]) =>
    indices.map(i => (
      <input
        key={i}
        ref={el => { refs.current[i] = el; }}
        className={BOX}
        inputMode="numeric"
        maxLength={2}
        value={digits[i]}
        onChange={e => handleChange(i, e)}
        onKeyDown={e => handleKeyDown(i, e)}
        placeholder="0"
        autoComplete="off"
      />
    ));

  return (
    <div onPaste={handlePaste}>
      <div className="grid w-full" style={{ gridTemplateColumns: GRID_COLS, gap: GAP }}>
        {group([0, 1])}
        <span className={SEP}>/</span>
        {group([2, 3])}
        <span className={SEP}>/</span>
        {group([4, 5, 6, 7])}
      </div>
      <div className="grid w-full mt-2" style={{ gridTemplateColumns: GRID_COLS, gap: GAP }}>
        {/* Day label — spans 2 digit columns */}
        <div className="text-[10px] font-bold tracking-wide text-[#aaa] text-center" style={{ gridColumn: "span 2" }}>
          {tr("วัน", "Day")}
        </div>
        <div />
        {/* Month label */}
        <div className="text-[10px] font-bold tracking-wide text-[#aaa] text-center" style={{ gridColumn: "span 2" }}>
          {tr("เดือน", "Month")}
        </div>
        <div />
        {/* Year label */}
        <div className="text-[10px] font-bold tracking-wide text-[#aaa] text-center" style={{ gridColumn: "span 4" }}>
          {tr("ปี (ค.ศ.)", "Year (CE)")}
        </div>
      </div>
    </div>
  );
}

// ── Main Onboarding ─────────────────────────────────────────────────────────────

export default function Onboarding() {
  const { user, isLoading: authLoading, logout, refreshUser } = useAuth();
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const tr = (th: string, en: string) => (lang === "en" ? en : th);
  const STEPS = getSteps(lang);

  const [step, setStep]               = useState(1);
  const [dir, setDir]                 = useState<1 | -1>(1); // 1 = forward, -1 = backward
  const [username, setUsername]       = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthdate, setBirthdate]     = useState("");
  const [ageError, setAgeError]       = useState<string | null>(null);
  const [agreed, setAgreed]           = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [legalModal, setLegalModal]   = useState<"terms" | "privacy" | null>(null);

  const goStep = (n: number, direction: 1 | -1) => { setDir(direction); setStep(n); };

  const [debouncedUsername] = useDebounceValue(username, 480);

  const { data: usernameCheck, isLoading: checkingUsername } = useCheckUsername(
    { username: debouncedUsername },
    { query: { enabled: debouncedUsername.length >= 3 } as any },
  );

  const { mutate: completeOnboarding, isPending } = useCompleteOnboarding({
    mutation: {
      onSuccess: async () => {
        // Patching localStorage alone doesn't update the AuthProvider's live
        // `cachedUser` React state (it's only seeded from localStorage once,
        // at mount), so App.tsx's `!user.isOnboarded` guard kept rendering
        // this Onboarding screen forever after "Enter Ticker" — the user
        // looked "stuck" on the terms step even though onboarding had
        // already succeeded on the server. Re-fetch the real session via
        // refreshUser() so the in-memory user (and its isOnboarded flag) are
        // updated before we navigate, mirroring what onError already does.
        const fresh = await refreshUser();
        try {
          localStorage.setItem("_usr", JSON.stringify(fresh ?? { isOnboarded: true }));
        } catch { /* non-fatal */ }
        // Soft SPA navigate — avoids a full page reload which would briefly
        // show the address bar in PWA standalone mode.
        navigate("/");
      },
      onError: async (err: any) => {
        // The request may have actually succeeded on the server even though
        // it looks failed here (Render cold-start requests can outlast the
        // client's patience for a response). Re-check the real session
        // before telling the user anything went wrong — if they're already
        // onboarded, just send them in like a normal success.
        const fresh = await refreshUser();
        if (fresh?.isOnboarded) {
          try {
            localStorage.setItem("_usr", JSON.stringify(fresh));
          } catch { /* non-fatal */ }
          navigate("/");
          return;
        }

        const code = err?.data?.error;
        if (code === "username_taken") {
          setSubmitError(tr("ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น", "This username is already taken, please choose another"));
          setUsername("");
          goStep(1, -1);
        } else if (code === "age_restriction") {
          setSubmitError(tr("ต้องมีอายุอย่างน้อย 13 ปี", "You must be at least 13 years old"));
          goStep(2, -1);
        } else if (code === "invalid_username" || code === "bad_request") {
          setSubmitError(tr("ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "Some information is invalid, please check and try again"));
          goStep(1, -1);
        } else {
          // Network hiccup / cold start / unknown error — keep the form
          // filled in on this step so the user can just tap the button
          // again instead of retyping everything.
          setSubmitError(tr("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", "Something went wrong, please try again"));
        }
      },
    },
  });

  if (!user && authLoading) return (
    <div className="flex justify-center" style={{ height: "100dvh", background: "#fff" }}>
      <div className="flex items-center justify-center w-full max-w-[430px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
  if (!user) return null;

  const usernameValid =
    /^[a-zA-Z0-9_]{3,30}$/.test(username) &&
    debouncedUsername === username &&
    usernameCheck?.available === true;

  const canNext1 = usernameValid;
  const canNext2 = !!birthdate && birthdate !== "invalid" && !ageError;
  const canNext3 = agreed;

  const handleSubmit = () => {
    if (!canNext3) return;
    setSubmitError(null);
    completeOnboarding({ data: { username, displayName: displayName || username, birthdate, agreedToTerms: true } });
  };

  const handleDobChange = (v: string) => {
    setBirthdate(v);
    if (!v || v === "invalid") { setAgeError(null); return; }
    const now = new Date();
    const birth = new Date(v + "T00:00:00");
    const ageYears = (now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 13) {
      setAgeError(tr("ต้องมีอายุอย่างน้อย 13 ปี", "You must be at least 13 years old"));
    } else if (ageYears > 100) {
      setAgeError(tr("กรุณากรอกวันเกิดที่ถูกต้อง", "Please enter a valid date of birth"));
    } else {
      setAgeError(null);
    }
  };

  const handleBack = () => {
    if (step === 1) {
      logout();
      navigate("/login");
      return;
    }
    if (step === 2) goStep(1, -1);
    else goStep(2, -1);
  };

  return (
    <div
      className="flex justify-center"
      style={{ height: "100dvh", overflow: "hidden", background: "#fff" }}
    >
      <div
        className="relative w-full max-w-[430px] flex flex-col"
        style={{ height: "100dvh", overflow: "hidden", background: "#fff" }}
      >
        {/* Top bar */}
        <div
          className="relative z-20 flex items-center gap-3 px-5 pb-4 flex-shrink-0"
          style={{ paddingTop: "calc(var(--sai-top) + 1.75rem)" }}
        >
          <button
            onClick={handleBack}
            className="relative z-20 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "#f2f2f7" }}
          >
            <ChevronLeft className="w-5 h-5 text-[#111]" />
          </button>
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "#111" }}
            >
              <span className="text-white font-black text-sm" style={{ fontFamily: "var(--font-display)" }}>T</span>
            </div>
            <span className="font-black text-xs tracking-[0.12em] text-black/30" style={{ fontFamily: "var(--font-display)" }}>
              Ticker
            </span>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center gap-2 px-5 mb-6 flex-shrink-0">
          {STEPS.map(s => (
            <div
              key={s.id}
              className="h-1 rounded-full transition-all duration-400"
              style={{
                flex: step === s.id ? 3 : 1,
                background: step > s.id ? "rgba(0,0,0,0.5)" : step === s.id ? "#111" : "rgba(0,0,0,0.12)",
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 px-5 overflow-hidden flex flex-col">

          {/* Error banner */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4 text-[13px] flex-shrink-0"
              style={{ background: "rgba(220,0,0,0.08)", color: "#c00", border: "1px solid rgba(220,0,0,0.2)" }}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {submitError}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* ── Step 1: Username ── */}
            {step === 1 && (
              <motion.div
                key="s1"
                className="flex flex-col h-full"
                initial={{ opacity: 0, x: 24 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 * dir }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-black text-[26px] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  {STEPS[0].title}
                </h2>
                <p className="text-[13.5px] text-[#888] mb-6">{STEPS[0].subtitle}</p>

                <div className="space-y-4">
                  {/* Username field */}
                  <div>
                    <label className="block text-[11px] font-bold tracking-wide mb-1.5" style={{ color: "rgba(0,0,0,0.45)" }}>
                      {tr("ชื่อผู้ใช้", "Username")}
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-semibold" style={{ color: "rgba(0,0,0,0.35)" }}>@</span>
                      <input
                        className="w-full h-[52px] rounded-xl pl-8 pr-10 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                        style={{ background: "#f2f2f7", border: "1.5px solid transparent" }}
                        onFocus={e => (e.target.style.borderColor = "#111")}
                        onBlur={e => (e.target.style.borderColor = "transparent")}
                        value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                        placeholder="yourname"
                        maxLength={30}
                        autoFocus
                      />
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        {checkingUsername && <Loader2 className="w-4 h-4 text-[#bbb] animate-spin" />}
                        {!checkingUsername && usernameValid && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                    </div>
                    {username.length >= 3 && debouncedUsername === username && usernameCheck && (
                      <p className={`text-[11.5px] mt-1.5 font-medium ${usernameCheck.available ? "text-green-600" : "text-red-500"}`}>
                        {usernameCheck.available ? tr("✓ ชื่อนี้ใช้ได้", "✓ Username available") : tr("✗ มีคนใช้ชื่อนี้แล้ว", "✗ Username taken")}
                      </p>
                    )}
                    {username.length > 0 && username.length < 3 && (
                      <p className="text-[11.5px] mt-1.5 text-[#aaa]">{tr("อย่างน้อย 3 ตัวอักษร", "At least 3 characters")}</p>
                    )}
                  </div>

                  {/* Display name field */}
                  <div>
                    <label className="block text-[11px] font-bold tracking-wide mb-1.5" style={{ color: "rgba(0,0,0,0.45)" }}>
                      {tr("ชื่อที่แสดง", "Display name")}
                    </label>
                    <input
                      className="w-full h-[52px] rounded-xl px-4 text-[14px] text-[#111] placeholder:text-[#bbb] outline-none transition-all"
                      style={{ background: "#f2f2f7", border: "1.5px solid transparent" }}
                      onFocus={e => (e.target.style.borderColor = "#111")}
                      onBlur={e => (e.target.style.borderColor = "transparent")}
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      maxLength={50}
                      placeholder={username || tr("ชื่อของคุณ", "Your name")}
                    />
                  </div>
                </div>

                <div className="pt-6 pb-2">
                  <button
                    onClick={() => goStep(2, 1)}
                    disabled={!canNext1}
                    className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-30 active:opacity-75"
                    style={{ background: "#111", color: "#fff" }}
                  >
                    {tr("ต่อไป", "Continue")} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Birthday ── */}
            {step === 2 && (
              <motion.div
                key="s2"
                className="flex flex-col h-full"
                initial={{ opacity: 0, x: 24 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 * dir }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-black text-[26px] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  {STEPS[1].title}
                </h2>
                <p className="text-[13.5px] text-[#888] mb-6">{STEPS[1].subtitle}</p>

                <div>
                  <label className="block text-[11px] font-bold tracking-wide mb-3" style={{ color: "rgba(0,0,0,0.45)" }}>
                    {tr("วัน / เดือน / ปีเกิด", "Day / Month / Year of birth")}
                  </label>
                  <DateOtpInput
                    value={birthdate}
                    onChange={handleDobChange}
                    lang={lang}
                  />
                  {birthdate === "invalid" && (
                    <p className="text-[12px] text-red-500 mt-2">
                      {tr("วันที่ไม่ถูกต้อง", "Invalid date")}
                    </p>
                  )}
                  {ageError && (
                    <p className="text-[12px] text-red-500 mt-2">{ageError}</p>
                  )}
                  {birthdate && birthdate !== "invalid" && !ageError && (
                    <p className="text-center text-[13px] text-[#888] mt-3">
                      {new Date(birthdate + "T00:00:00").toLocaleDateString(
                        lang === "en" ? "en-US" : "th-TH",
                        { day: "numeric", month: "long", year: "numeric" }
                      )}
                    </p>
                  )}
                </div>

                <div className="pt-6 pb-2">
                  <button
                    onClick={() => goStep(3, 1)}
                    disabled={!canNext2}
                    className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-30 active:opacity-75"
                    style={{ background: "#111", color: "#fff" }}
                  >
                    {tr("ต่อไป", "Continue")} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Terms ── */}
            {step === 3 && (
              <motion.div
                key="s3"
                className="flex flex-col h-full"
                initial={{ opacity: 0, x: 24 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 * dir }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-black text-[26px] text-[#111] mb-1" style={{ fontFamily: "var(--font-display)" }}>
                  {STEPS[2].title}
                </h2>
                <p className="text-[13.5px] text-[#888] mb-6">{STEPS[2].subtitle}</p>

                {/* Profile preview */}
                <div
                  className="flex items-center gap-3 rounded-2xl px-4 py-3.5 mb-5"
                  style={{ background: "#f2f2f7" }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ background: "#e0e0e5" }}
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-black text-base text-[#999]">
                        {(displayName || username || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-[14px] text-[#111]">{displayName || username}</p>
                    <p className="text-[12px] text-[#999]">@{username}</p>
                  </div>
                </div>

                {/* Agreement */}
                <button
                  type="button"
                  onClick={() => setAgreed(v => !v)}
                  className="flex items-start gap-3 text-left w-full p-4 rounded-2xl transition-colors"
                  style={{
                    background: agreed ? "rgba(0,0,0,0.05)" : "#f2f2f7",
                    border: `1.5px solid ${agreed ? "#111" : "#e5e5e5"}`,
                  }}
                >
                  <div
                    className="mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-all"
                    style={{
                      background: agreed ? "#111" : "#e0e0e5",
                      border: "none",
                    }}
                  >
                    {agreed && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-[13px] text-[#555] leading-relaxed">
                    {tr("ฉันยอมรับ", "I accept")}{" "}
                    <button
                      type="button"
                      className="text-[#111] font-semibold underline"
                      onClick={e => { e.stopPropagation(); setLegalModal("terms"); }}
                    >
                      Terms of Service
                    </button>
                    {" "}{tr("และ", "and")}{" "}
                    <button
                      type="button"
                      className="text-[#111] font-semibold underline"
                      onClick={e => { e.stopPropagation(); setLegalModal("privacy"); }}
                    >
                      Privacy Policy
                    </button>
                  </span>
                </button>

                <div className="pt-6 pb-2">
                  <button
                    onClick={handleSubmit}
                    disabled={!canNext3 || isPending}
                    className="w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-opacity disabled:opacity-30 active:opacity-75"
                    style={{ background: "#111", color: "#fff" }}
                  >
                    {isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin text-white" />
                    ) : (
                      <>{tr("เข้าสู่ Ticker", "Enter Ticker")} <ChevronRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Legal Modal ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {legalModal && (
            <motion.div
              key="legal-modal"
              className="absolute inset-0 z-50 flex flex-col"
              style={{ background: "#fff" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              {/* Modal header */}
              <div className="flex items-center gap-3 px-5 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: "1px solid #f0f0f0" }}>
                <button
                  onClick={() => setLegalModal(null)}
                  className="w-9 h-9 rounded-full flex items-center justify-center active:opacity-60"
                  style={{ background: "#f2f2f7" }}
                >
                  <X className="w-4 h-4 text-[#111]" />
                </button>
                <h2 className="font-black text-[17px] text-[#111]">
                  {legalModal === "terms"
                    ? tr("ข้อกำหนดการให้บริการ", "Terms of Service")
                    : tr("นโยบายความเป็นส่วนตัว", "Privacy Policy")}
                </h2>
              </div>

              {/* Modal content */}
              <div className="flex-1 overflow-y-auto px-5 py-6 text-[14px] text-[#444] leading-relaxed space-y-5">
                <p className="text-[12px] text-[#aaa]">{tr("อัปเดตล่าสุด: 5 เมษายน 2568", "Last updated: April 5, 2025")}</p>

                {legalModal === "terms" ? (
                  <>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("1. การยอมรับข้อตกลง", "1. Acceptance of terms")}</h3>
                      <p>{tr("การใช้งาน Ticker ถือว่าคุณได้อ่านและยอมรับข้อกำหนดการให้บริการฉบับนี้ทุกประการ หากคุณไม่เห็นด้วยกับข้อกำหนดใดๆ โปรดหยุดใช้งานบริการ", "By using Ticker, you confirm that you have read and accepted these Terms of Service in full. If you do not agree with any part of the terms, please stop using the service.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("2. เงื่อนไขการใช้งาน", "2. Conditions of use")}</h3>
                      <p>{tr("คุณต้องมีอายุอย่างน้อย 13 ปีบริบูรณ์เพื่อใช้งาน Ticker", "You must be at least 13 years old to use Ticker.")}</p>
                      <p>{tr("คุณรับผิดชอบต่อเนื้อหาที่โพสต์และกิจกรรมทั้งหมดในบัญชีของคุณ", "You are responsible for the content you post and all activity in your account.")}</p>
                      <p>{tr("ห้ามใช้งานบริการเพื่อวัตถุประสงค์ที่ผิดกฎหมายหรือเป็นอันตราย", "You may not use the service for any unlawful or harmful purpose.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("3. เนื้อหาของผู้ใช้", "3. User content")}</h3>
                      <p>{tr("เนื้อหาที่คุณโพสต์บน Ticker ยังคงเป็นสิทธิ์ของคุณ แต่คุณมอบสิทธิ์การใช้งานแก่ Ticker เพื่อแสดงและเผยแพร่เนื้อหาภายในบริการ", "Content you post on Ticker remains yours, but you grant Ticker a license to display and distribute that content within the service.")}</p>
                      <p>{tr("Ticker ขอสงวนสิทธิ์ในการลบเนื้อหาที่ละเมิดข้อกำหนดหรือกฎหมายที่เกี่ยวข้อง", "Ticker reserves the right to remove any content that violates these terms or applicable laws.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("4. ทรัพย์สินทางปัญญา", "4. Intellectual property")}</h3>
                      <p>{tr("แบรนด์ โลโก้ และซอฟต์แวร์ของ Ticker เป็นทรัพย์สินทางปัญญาของเรา ห้ามทำซ้ำหรือดัดแปลงโดยไม่ได้รับอนุญาต", "The Ticker brand, logo, and software are our intellectual property. You may not copy or modify them without permission.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("5. การระงับบัญชี", "5. Account suspension")}</h3>
                      <p>{tr("Ticker ขอสงวนสิทธิ์ระงับหรือยกเลิกบัญชีของผู้ใช้ที่ละเมิดข้อกำหนดการให้บริการ โดยไม่จำเป็นต้องแจ้งล่วงหน้า", "Ticker may suspend or terminate any account that violates these Terms of Service, without prior notice.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("6. ข้อจำกัดความรับผิด", "6. Limitation of liability")}</h3>
                      <p>{tr("Ticker ให้บริการ \"ตามสภาพ\" โดยไม่มีการรับประกันใดๆ เราจะไม่รับผิดชอบต่อความเสียหายที่เกิดจากการใช้งานบริการ", "Ticker is provided \"as is\" without any warranty. We are not liable for any damages arising from your use of the service.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("7. การเปลี่ยนแปลงข้อกำหนด", "7. Changes to the terms")}</h3>
                      <p>{tr("เราอาจแก้ไขข้อกำหนดการให้บริการนี้ได้ตลอดเวลา การใช้งานต่อไปถือว่าคุณยอมรับข้อกำหนดฉบับที่แก้ไขแล้ว", "We may revise these Terms of Service at any time. Continued use of the service means you accept the revised terms.")}</p>
                    </section>
                  </>
                ) : (
                  <>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("1. ข้อมูลที่เรารวบรวม", "1. Information we collect")}</h3>
                      <p>{tr("เราเก็บข้อมูลที่คุณให้โดยตรง ได้แก่ ชื่อผู้ใช้ ชื่อที่แสดง อีเมล วันเกิด (เพื่อยืนยันอายุ) เนื้อหาที่คุณโพสต์ และข้อมูลการใช้งาน", "We collect the information you give us directly, including your username, display name, email, date of birth (for age verification), the content you post, and usage data.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("2. การใช้ข้อมูล", "2. How we use your information")}</h3>
                      <p>{tr("เราใช้ข้อมูลของคุณเพื่อให้บริการและปรับปรุงแพลตฟอร์ม แสดงเนื้อหาที่ตรงกับความสนใจ ติดต่อคุณเกี่ยวกับบัญชี และป้องกันการละเมิด", "We use your information to provide and improve the platform, show content that matches your interests, contact you about your account, and prevent abuse.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("3. การแชร์ข้อมูล", "3. Sharing your information")}</h3>
                      <p>{tr("เราไม่ขายข้อมูลส่วนตัวของคุณ เราอาจแชร์ข้อมูลกับผู้ให้บริการที่ช่วยเราดำเนินการแพลตฟอร์ม ซึ่งมีข้อผูกมัดในการปกป้องข้อมูลของคุณ", "We do not sell your personal information. We may share data with service providers that help us operate the platform, who are obligated to protect your information.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("4. ความปลอดภัยของข้อมูล", "4. Data security")}</h3>
                      <p>{tr("เราใช้มาตรการรักษาความปลอดภัยมาตรฐานอุตสาหกรรมเพื่อปกป้องข้อมูลของคุณ", "We use industry-standard security measures to protect your data.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("5. ข้อมูลวันเกิด", "5. Date of birth")}</h3>
                      <p>{tr("วันเกิดของคุณใช้เพื่อยืนยันว่าคุณมีอายุครบ 13 ปีเท่านั้น เราจะไม่เปิดเผยข้อมูลนี้แก่บุคคลภายนอก", "Your date of birth is used only to confirm that you are at least 13 years old. We will not share it with any third party.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("6. สิทธิ์ของคุณ", "6. Your rights")}</h3>
                      <p>{tr("คุณมีสิทธิ์เข้าถึงและแก้ไขข้อมูลส่วนตัว ขอลบบัญชีและข้อมูลของคุณ และปฏิเสธการรับการแจ้งเตือน", "You have the right to access and update your personal information, request deletion of your account and data, and opt out of notifications.")}</p>
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-bold text-[15px] text-[#111]">{tr("7. การเปลี่ยนแปลงนโยบาย", "7. Changes to this policy")}</h3>
                      <p>{tr("เราอาจอัปเดตนโยบายความเป็นส่วนตัวนี้ การใช้งานต่อไปหลังจากการอัปเดตถือว่าคุณยอมรับนโยบายที่แก้ไขแล้ว", "We may update this Privacy Policy. Continued use of the service after an update means you accept the revised policy.")}</p>
                    </section>
                  </>
                )}
              </div>

              {/* Close button at bottom */}
              <div className="flex-shrink-0 px-5 pb-10 pt-4" style={{ borderTop: "1px solid #f0f0f0" }}>
                <button
                  onClick={() => setLegalModal(null)}
                  className="w-full h-[52px] rounded-2xl font-bold text-[15px] active:opacity-75"
                  style={{ background: "#111", color: "#fff" }}
                >
                  {tr("ปิด", "Close")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
