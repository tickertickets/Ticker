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

// ── Custom Date Picker ─────────────────────────────────────────────────────────

const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];
const EN_MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const ITEM_H = 48;
const VISIBLE = 5;

function WheelColumn({
  items,
  selectedIndex,
  onSelect,
  dark,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  dark?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSettling = useRef(false);

  // Scroll to initial position on mount (no animation)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = selectedIndex * ITEM_H;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snap to nearest item after flick settles
  const handleScroll = () => {
    if (isSettling.current) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.round(el.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      isSettling.current = true;
      el.scrollTo({ top: clamped * ITEM_H, behavior: "smooth" });
      onSelect(clamped);
      setTimeout(() => { isSettling.current = false; }, 300);
    }, 80);
  };

  return (
    <div className="relative flex-1 overflow-hidden" style={{ height: ITEM_H * VISIBLE }}>
      {/* Selection highlight */}
      <div
        className="absolute inset-x-0 pointer-events-none z-10"
        style={{
          top: ITEM_H * 2,
          height: ITEM_H,
          background: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
          borderRadius: 12,
        }}
      />
      {/* Top/bottom fade */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none z-10"
        style={{
          height: ITEM_H * 2,
          background: dark
            ? "linear-gradient(to bottom, #1c1c1e 60%, transparent)"
            : "linear-gradient(to bottom, #fff 60%, transparent)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
        style={{
          height: ITEM_H * 2,
          background: dark
            ? "linear-gradient(to top, #1c1c1e 60%, transparent)"
            : "linear-gradient(to top, #fff 60%, transparent)",
        }}
      />
      {/* Scroll container — free inertia scroll, snap after settle */}
      <div
        ref={ref}
        onScroll={handleScroll}
        style={{
          height: "100%",
          overflowY: "scroll",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          paddingTop: ITEM_H * 2,
          paddingBottom: ITEM_H * 2,
        }}
        className="[&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => {
              onSelect(i);
              if (ref.current) ref.current.scrollTo({ top: i * ITEM_H, behavior: "smooth" });
            }}
            style={{
              height: ITEM_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: i === selectedIndex ? 16 : 14,
              fontWeight: i === selectedIndex ? 700 : 400,
              color: i === selectedIndex
                ? (dark ? "#fff" : "#111")
                : (dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.28)"),
              transition: "color 0.15s, font-size 0.15s, font-weight 0.15s",
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function DatePickerWheel({
  value,
  onChange,
  max,
  dark,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  max: string;
  dark?: boolean;
  lang: Lang;
}) {
  const maxDate = new Date(max);
  const maxYear = maxDate.getFullYear();
  const minYear = 1920;

  const parsed = value ? new Date(value) : null;
  const [day, setDay] = useState(parsed ? parsed.getDate() - 1 : 0);
  const [month, setMonth] = useState(parsed ? parsed.getMonth() : 0);
  const [year, setYear] = useState(parsed ? parsed.getFullYear() - minYear : 0);

  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(minYear + i));
  const daysInMonth = new Date(minYear + year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0"));

  const clampedDay = Math.min(day, daysInMonth - 1);

  useEffect(() => {
    const d = String(clampedDay + 1).padStart(2, "0");
    const m = String(month + 1).padStart(2, "0");
    const y = String(minYear + year);
    onChange(`${y}-${m}-${d}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedDay, month, year]);

  return (
    <div className="flex gap-1" style={{ height: ITEM_H * VISIBLE }}>
      <WheelColumn items={days} selectedIndex={clampedDay} onSelect={setDay} dark={dark} />
      <WheelColumn items={lang === "en" ? EN_MONTHS : THAI_MONTHS} selectedIndex={month} onSelect={setMonth} dark={dark} />
      <WheelColumn items={years} selectedIndex={year} onSelect={setYear} dark={dark} />
    </div>
  );
}

// ── Main Onboarding ─────────────────────────────────────────────────────────────

export default function Onboarding() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const tr = (th: string, en: string) => (lang === "en" ? en : th);
  const STEPS = getSteps(lang);

  const [step, setStep]               = useState(1);
  const [dir, setDir]                 = useState<1 | -1>(1); // 1 = forward, -1 = backward
  const [username, setUsername]       = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthdate, setBirthdate]     = useState("");
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
      onSuccess: () => {
        // Update localStorage cache so the reload sees isOnboarded:true immediately
        try {
          const cached = localStorage.getItem("_usr");
          if (cached) {
            const parsed = JSON.parse(cached);
            parsed.isOnboarded = true;
            localStorage.setItem("_usr", JSON.stringify(parsed));
          }
        } catch { /* non-fatal */ }
        window.location.href = import.meta.env.BASE_URL;
      },
      onError: () => {
        setSubmitError(tr("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", "Something went wrong, please try again"));
        setStep(1);
        setUsername(""); setDisplayName(""); setBirthdate(""); setAgreed(false);
      },
    },
  });

  if (!user) return null;

  const usernameValid =
    /^[a-zA-Z0-9_]{3,30}$/.test(username) &&
    debouncedUsername === username &&
    usernameCheck?.available === true;

  const canNext1 = usernameValid;
  const canNext2 = !!birthdate;
  const canNext3 = agreed;

  const handleSubmit = () => {
    if (!canNext3) return;
    setSubmitError(null);
    completeOnboarding({ data: { username, displayName: displayName || username, birthdate, agreedToTerms: true } });
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

  const maxDate = new Date(Date.now() - 13 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

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
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.75rem)" }}
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
                      {tr("ชื่อที่แสดง", "Display name")} <span className="normal-case font-normal text-[#bbb]">{tr("(ไม่บังคับ)", "(optional)")}</span>
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

                <div className="pt-8 pb-2">
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
                  <DatePickerWheel
                    value={birthdate}
                    onChange={setBirthdate}
                    max={maxDate}
                    lang={lang}
                  />
                  {birthdate && (
                    <p className="text-center text-[13px] text-[#888] mt-3">
                      {new Date(birthdate).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </div>

                <div className="pt-8 pb-2">
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
                    {tr(" และยืนยันว่าฉันมีอายุ 13 ปีขึ้นไป", ", and confirm I am 13 or older")}
                  </span>
                </button>

                <div className="pt-8 pb-2">
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
