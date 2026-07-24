/**
 * SplashScreen — แสดงทุกครั้งที่เปิดเว็บ
 *
 * ทำงานอย่างไร:
 *  1. แสดงโลโก้ T กระโดดพร้อมข้อความเป็นกันเอง
 *  2. ping /api/healthz ซ้ำๆ จนกว่าเซิร์ฟเวอร์จะตอบกลับ 2xx
 *  3. เมื่อพร้อมแล้ว → fade-out แล้ว unmount
 *
 * ภาษาจาก navigator.language (ของเครื่อง/browser) ไม่ใช่ lang setting ในแอพ
 */

import { useEffect, useState, useRef } from "react";

// ── ตรวจภาษา: ลำดับความสำคัญ ────────────────────────────────────────────────
// 1. ถ้าผู้ใช้เคยเลือก TH/EN ในแอพแล้ว → ใช้ค่านั้น
// 2. ภาษาเครื่อง/browser เป็นภาษาไทย → Thai
// 3. อื่นๆ → English (fallback)
function detectSplashLang(): "th" | "en" {
  try {
    const saved = localStorage.getItem("ticker_lang");
    if (saved === "th" || saved === "en") return saved;
  } catch { /* ignore */ }
  if (navigator.language.toLowerCase().startsWith("th")) return "th";
  return "en";
}
const isThai = detectSplashLang() === "th";

const KOFI_URL = "https://ko-fi.com/tickertickets";

const COPY = isThai
  ? {
      heading: "เดี๋ยวก่อนนะ",
      sub: "เซิร์ฟเวอร์กำลังตื่นนอน",
      supportBefore: "ขอโทษที่ให้รอนะ ซัพพอร์ตพวกเราได้นะที่",
      supportLink: "คลิก",
    }
  : {
      heading: "One moment",
      sub: "Our server is waking up",
      supportBefore: "Sorry for the wait. You can support us at",
      supportLink: "click here",
    };

// ── URL สำหรับ health-check ───────────────────────────────────────────────────
function getHealthUrl(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  return base
    ? `${base.replace(/\/$/, "")}/api/healthz`
    : "/api/healthz";
}

// ── Hook: poll จนกว่าจะได้ 2xx ───────────────────────────────────────────────
function useServerReady(): boolean {
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ping() {
      if (cancelled) return;
      try {
        abortRef.current = new AbortController();
        const res = await fetch(getHealthUrl(), {
          signal: abortRef.current.signal,
          cache: "no-store",
        });
        if (res.ok && !cancelled) {
          setReady(true);
          return;
        }
      } catch {
        // network error / abort → ลองใหม่
      }
      if (!cancelled) {
        timerRef.current = setTimeout(ping, 2_000);
      }
    }

    ping();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return ready;
}

// ── Component หลัก ────────────────────────────────────────────────────────────
interface SplashScreenProps {
  onDone: () => void;
}

export function SplashScreen({ onDone }: SplashScreenProps) {
  const serverReady = useServerReady();
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (!serverReady) return;
    setFadeOut(true);
    const t = setTimeout(onDone, 500); // รอ fade-out animation เสร็จ
    return () => clearTimeout(t);
  }, [serverReady, onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        transition: "opacity 0.5s ease",
        opacity: fadeOut ? 0 : 1,
        pointerEvents: fadeOut ? "none" : "auto",
        fontFamily:
          "'DM Sans Variable', 'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        @keyframes ticker-bounce {
          0%, 100% { transform: translateY(0);     animation-timing-function: cubic-bezier(0.8,0,1,1); }
          50%       { transform: translateY(-18px); animation-timing-function: cubic-bezier(0,0,0.2,1); }
        }
        @keyframes ticker-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ticker-splash-logo {
          animation: ticker-bounce 1.1s infinite;
        }
        .ticker-splash-text {
          animation: ticker-fade-in 0.5s ease 0.2s both;
        }
        .ticker-splash-support {
          animation: ticker-fade-in 0.5s ease 0.55s both;
        }
      `}</style>

      {/* โลโก้ T กระโดด */}
      <div className="ticker-splash-logo" style={{ marginBottom: 32 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: "#000000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily:
                "'Space Grotesk Variable', 'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 36,
              color: "#ffffff",
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            T
          </span>
        </div>
      </div>

      {/* ข้อความหลัก */}
      <div
        className="ticker-splash-text"
        style={{
          textAlign: "center",
          lineHeight: 1.4,
          padding: "0 32px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: "#0a0a0a",
            letterSpacing: "-0.01em",
          }}
        >
          {COPY.heading}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            color: "#6b7280",
            fontWeight: 400,
          }}
        >
          {COPY.sub}
        </p>
      </div>

      {/* ข้อความซัพพอร์ต */}
      <div
        className="ticker-splash-support"
        style={{
          position: "absolute",
          bottom: 48,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "0 40px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "#9ca3af",
            lineHeight: 1.6,
          }}
        >
          {COPY.supportBefore}{" "}
          <a
            href={KOFI_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#6b7280",
              textDecoration: "underline",
              textUnderlineOffset: 2,
              fontWeight: 500,
            }}
          >
            {COPY.supportLink}
          </a>
        </p>
      </div>
    </div>
  );
}
