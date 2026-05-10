import { useLang } from "@/lib/i18n";

export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  const isEn = lang === "en";
  return (
    <button
      type="button"
      onClick={() => setLang(isEn ? "th" : "en")}
      aria-label="Toggle language"
      className={`relative inline-flex items-center select-none ${className}`}
      style={{
        background: "#e5e5ea",
        border: "1px solid #d1d1d6",
        borderRadius: 999,
        padding: 2,
        height: 28,
        width: 64,
      }}
    >
      {/* Sliding pill */}
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-full transition-transform duration-200 ease-out"
        style={{
          background: "#111",
          width: 30,
          left: 2,
          transform: isEn ? "translateX(0)" : "translateX(30px)",
        }}
      />
      <span
        className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
        style={{ color: isEn ? "#fff" : "#888" }}
      >
        EN
      </span>
      <span
        className="relative z-10 flex-1 text-center text-[11px] font-bold tracking-wide"
        style={{ color: !isEn ? "#fff" : "#888" }}
      >
        TH
      </span>
    </button>
  );
}
