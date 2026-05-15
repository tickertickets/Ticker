import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronLeft, Film, User, Loader2, Flag, Send } from "lucide-react";
import { useLang, displayYear } from "@/lib/i18n";
import { scrollStore } from "@/lib/scroll-store";

// ── AniList bio parser ────────────────────────────────────────────────────────
// AniList descriptions embed structured data as __Key:__ Value pairs.
// This parser extracts those pairs and returns the remaining plain text as bio.

function parseAniListDescription(raw: string): {
  info: { key: string; value: string }[];
  bio: string;
} {
  if (!raw) return { info: [], bio: "" };

  const info: { key: string; value: string }[] = [];
  const pattern = /__([^_\n]+):__\s*/g;
  const positions: { key: string; start: number; contentStart: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(raw)) !== null) {
    positions.push({
      key: m[1].trim(),
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }

  if (positions.length === 0) return { info: [], bio: raw.trim() };

  const preBio = raw.slice(0, positions[0].start).trim();
  let trailing = "";

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const nextStart =
      i + 1 < positions.length ? positions[i + 1]!.start : raw.length;
    let val = raw.slice(pos.contentStart, nextStart).trim();

    if (i === positions.length - 1) {
      const nl = val.indexOf("\n");
      if (nl > 0) {
        trailing = val.slice(nl).trim();
        val = val.slice(0, nl).trim();
      }
    }

    if (pos.key && val) info.push({ key: pos.key, value: val });
  }

  const bio = [preBio, trailing].filter(Boolean).join(" ").trim();
  return { info, bio };
}

function stripMarkers(text: string): string {
  return text
    .replace(/__[^_\n]+:__\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CharFilm = {
  title: string;
  year: string | null;
  imdbId: string | null;
  posterUrl: string | null;
  mediaType: "movie" | "tv";
};

type CharData = {
  wikidataId: string;
  charId?: string;
  name: string;
  description: string | null;
  descriptionLang?: string;
  imageUrl: string | null;
  filmography: CharFilm[];
  source?: string;
  sourceUrl?: string;
};

// ── Filmography card ──────────────────────────────────────────────────────────

function FilmCard({
  film,
  navSrclang,
}: {
  film: CharFilm;
  navSrclang: string;
}) {
  const { lang } = useLang();
  const href = film.imdbId
    ? `/movie/${encodeURIComponent(film.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`
    : "#";

  return (
    <Link
      href={href}
      onClick={() => film.imdbId && scrollStore.delete(`movie-${film.imdbId}`)}
    >
      <div
        className="relative rounded-xl overflow-hidden bg-zinc-900 border border-border w-full"
        style={{ aspectRatio: "2/3" }}
      >
        {film.posterUrl ? (
          <img
            src={film.posterUrl}
            alt={film.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
            <Film className="w-5 h-5 text-zinc-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
        <div className="absolute inset-x-0 bottom-0 p-1.5">
          <p className="text-white text-[9px] font-bold line-clamp-2 leading-tight">
            {film.title}
          </p>
          {film.year && (
            <p className="text-white/60 text-[8px]">
              {displayYear(film.year, lang)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CharacterDetail() {
  const { lang } = useLang();
  const [, params] = useRoute("/character/:wikidataId");
  const [, navigate] = useLocation();

  const wikidataId = params?.wikidataId ?? "";

  // Read ?srclang from URL once on mount
  const srclang = useMemo(
    () =>
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("srclang") ?? ""
        : "",
    [],
  );

  const srcLangCode = useMemo(() => {
    const base = srclang.split("-")[0].toLowerCase();
    return base || "en";
  }, [srclang]);

  // Noindex for character pages
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // ── Primary data fetch ──────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery<CharData>({
    queryKey: ["/api/character", wikidataId],
    queryFn: async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const res = await fetch(
          `/api/character/${encodeURIComponent(wikidataId)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) throw new Error("not found");
        return res.json() as Promise<CharData>;
      } finally {
        clearTimeout(t);
      }
    },
    enabled: !!wikidataId,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  // ── Bio language state ──────────────────────────────────────────────────────
  // Default to the source language of the movie page that led here.
  // If srclang is "en" or unset, default to "en".
  const defaultBioLang = useMemo(() => {
    if (!srcLangCode || srcLangCode === "en") return "en";
    // For "th" show TH toggle active; for others (ja, ko, etc.) also use "en" as display
    // since AniList only has English — but we still honor TH preference
    return srcLangCode;
  }, [srcLangCode]);

  const [bioLang, setBioLang] = useState<string>(() => defaultBioLang);

  // Secondary fetch for non-EN bio (e.g. Thai)
  const { data: altData, isLoading: altLoading } = useQuery<CharData>({
    queryKey: ["/api/character", wikidataId, "lang", bioLang],
    queryFn: async () => {
      const res = await fetch(
        `/api/character/${encodeURIComponent(wikidataId)}?lang=${encodeURIComponent(bioLang)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) throw new Error("not found");
      return res.json() as Promise<CharData>;
    },
    enabled: bioLang !== "en" && !!wikidataId,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  // ── Bio parsing ─────────────────────────────────────────────────────────────

  const rawBioEn = data?.description ?? "";
  const parsedEn = useMemo(() => parseAniListDescription(rawBioEn), [rawBioEn]);

  // When bioLang !== "en", the backend returns description: null for AniList chars
  // (since AniList only has English). We detect this and show a fallback note.
  const altDescriptionAvailable = useMemo(() => {
    if (bioLang === "en") return true;
    if (altLoading) return null; // still loading
    return altData?.description != null && altData.description !== "";
  }, [bioLang, altLoading, altData]);

  const { displayInfo, displayBio } = useMemo(() => {
    if (bioLang === "en") {
      return { displayInfo: parsedEn.info, displayBio: parsedEn.bio };
    }
    // Non-EN: use altData if available, otherwise fall back to English
    const altRaw = altData?.description ?? null;
    if (altRaw) {
      const parsed = parseAniListDescription(altRaw);
      return {
        displayInfo: parsed.info.length > 0 ? parsed.info : parsedEn.info,
        displayBio: parsed.bio || stripMarkers(altRaw),
      };
    }
    // No translation available — show English content
    return { displayInfo: parsedEn.info, displayBio: parsedEn.bio };
  }, [bioLang, parsedEn, altData]);

  // Show original-language button only if srclang is not EN (TH always shows, others show as label)
  const showThToggle = true; // TH always visible
  const hasOrigLang = srcLangCode !== "en" && srcLangCode !== "th";
  const origLabel = srcLangCode.toUpperCase().slice(0, 3);

  // ── Source credit ───────────────────────────────────────────────────────────
  const sourceIsAniList = data?.source === "anilist";
  const sourceIsComicVine = data?.source === "comicvine";
  const sourceLabel = sourceIsAniList ? "AniList" : sourceIsComicVine ? "Comic Vine" : null;
  const sourceHref = data?.sourceUrl
    ? data.sourceUrl
    : sourceIsAniList
      ? "https://anilist.co"
      : sourceIsComicVine
        ? "https://comicvine.gamespot.com"
        : null;

  // ── Report modal state ──────────────────────────────────────────────────────

  const [showReport, setShowReport] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const closeReport = useCallback(() => {
    setShowReport(false);
    setTimeout(() => {
      setSubmitted(false);
      setReason("");
      setDetails("");
    }, 300);
  }, []);

  const submitReport = useCallback(async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await fetch(
        `/api/reports/character/${encodeURIComponent(data?.charId ?? wikidataId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            details: details.trim() || null,
            characterName: data?.name ?? wikidataId,
          }),
        },
      );
    } catch {
      // show success regardless
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }, [reason, details, data, wikidataId, submitting]);

  const REASONS =
    lang === "th"
      ? [
          { value: "wrong_info", label: "ข้อมูลไม่ถูกต้อง" },
          { value: "wrong_image", label: "รูปผิด / ไม่ใช่ตัวละครนี้" },
          { value: "not_this_character", label: "ตัวละครไม่ตรงกับสื่อนี้" },
          { value: "offensive", label: "เนื้อหาไม่เหมาะสม" },
          { value: "other", label: "อื่นๆ" },
        ]
      : [
          { value: "wrong_info", label: "Wrong information" },
          { value: "wrong_image", label: "Wrong or incorrect image" },
          { value: "not_this_character", label: "Wrong character for this media" },
          { value: "offensive", label: "Offensive content" },
          { value: "other", label: "Other issue" },
        ];

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasBioContent = !!(rawBioEn || (bioLang !== "en" && altData?.description));

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden">
      {/* Back button */}
      <button
        onClick={() => navBack(navigate)}
        className="absolute z-20 left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        aria-label="Back"
      >
        <ChevronLeft
          className="w-5 h-5 text-white"
          style={{ transform: "translateX(-1px)" }}
        />
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">
        {/* ── Hero ── */}
        <div
          className="relative w-full bg-secondary overflow-hidden"
          style={{ height: 280 }}
        >
          {data?.imageUrl && (
            <>
              <img
                src={data.imageUrl}
                alt={data.name}
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  filter: "blur(22px)",
                  transform: "scale(1.15)",
                  objectPosition: "center top",
                }}
              />
              <div className="absolute inset-0 bg-black/35" />
            </>
          )}
          {!data?.imageUrl && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <User className="w-20 h-20 text-muted-foreground opacity-20" />
            </div>
          )}
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div
            className="absolute inset-x-0 bottom-0"
            style={{
              height: "60%",
              background:
                "linear-gradient(to top, hsl(var(--background)) 20%, transparent 100%)",
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
            <div className="flex items-end gap-3">
              {data?.imageUrl ? (
                <img
                  src={data.imageUrl}
                  alt={data.name}
                  className="flex-shrink-0 rounded-2xl object-cover border-2 border-white/20 shadow-xl"
                  style={{ width: 68, height: 102 }}
                />
              ) : (
                !isLoading && (
                  <div
                    className="flex-shrink-0 rounded-2xl bg-muted border border-border flex items-center justify-center"
                    style={{ width: 68, height: 102 }}
                  >
                    <User className="w-8 h-8 text-muted-foreground opacity-40" />
                  </div>
                )
              )}
              <div className="flex-1 min-w-0 pb-1">
                {isLoading ? (
                  <div className="h-7 bg-muted/30 rounded-lg w-44 animate-pulse" />
                ) : (
                  <h1 className="font-display font-bold text-2xl text-foreground leading-tight">
                    {data?.name ?? ""}
                  </h1>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lang === "th" ? "ตัวละคร" : "Fictional Character"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ── Not found ── */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
            <User className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              {lang === "th" ? "ไม่พบข้อมูลตัวละคร" : "Character not found"}
            </p>
          </div>
        )}

        {/* ── Content ── */}
        {data && (
          <div>
            {/* AniList structured info */}
            {displayInfo.length > 0 && (
              <div className="px-5 pt-4 pb-1">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                  {displayInfo.map(({ key, value }) => (
                    <div key={key} className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground leading-none mb-1">
                        {key}
                      </p>
                      <p className="text-xs text-foreground leading-snug">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bio + language toggle */}
            {hasBioContent && (
              <div className="px-5 pt-4 pb-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {altLoading && bioLang !== "en" ? (
                      <p className="text-sm text-muted-foreground">
                        {lang === "th" ? "กำลังโหลด…" : "Loading…"}
                      </p>
                    ) : (
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {displayBio || stripMarkers(rawBioEn)}
                      </p>
                    )}

                    {/* Note when bio is shown in EN because requested lang has no data */}
                    {bioLang !== "en" && !altLoading && altDescriptionAvailable === false && (
                      <p className="text-xs text-muted-foreground/60 mt-1.5 italic">
                        {lang === "th"
                          ? "ยังไม่มีข้อมูลภาษาไทย — แสดงภาษาอังกฤษแทน"
                          : "Not available in this language — showing English"}
                      </p>
                    )}
                  </div>

                  {/* Language toggle pill */}
                  <div
                    className="relative inline-flex items-center select-none shrink-0 mt-0.5"
                    style={{
                      background: "#e5e5ea",
                      border: "1px solid #d1d1d6",
                      borderRadius: 999,
                      padding: 2,
                    }}
                  >
                    {hasOrigLang && (
                      <button
                        type="button"
                        onClick={() => setBioLang(srcLangCode)}
                        aria-label={`Bio in ${origLabel}`}
                        className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                        style={{
                          background:
                            bioLang === srcLangCode ? "#111" : "transparent",
                          color: bioLang === srcLangCode ? "#fff" : "#888",
                          minWidth: 28,
                        }}
                      >
                        {origLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setBioLang("en")}
                      aria-label="Bio in English"
                      className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                      style={{
                        background: bioLang === "en" ? "#111" : "transparent",
                        color: bioLang === "en" ? "#fff" : "#888",
                        minWidth: 28,
                      }}
                    >
                      EN
                    </button>
                    {showThToggle && (
                      <button
                        type="button"
                        onClick={() => setBioLang("th")}
                        aria-label="Bio in Thai"
                        className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                        style={{
                          background: bioLang === "th" ? "#111" : "transparent",
                          color: bioLang === "th" ? "#fff" : "#888",
                          minWidth: 28,
                        }}
                      >
                        TH
                      </button>
                    )}
                  </div>
                </div>

                {/* Source credit — AniList or Comic Vine only, with direct link */}
                {sourceLabel && sourceHref && (
                  <p className="text-[10px] text-muted-foreground/60 mt-2">
                    {lang === "th" ? "ที่มา: " : "Source: "}
                    <a
                      href={sourceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {sourceLabel}
                    </a>
                  </p>
                )}
              </div>
            )}

            {/* Filmography */}
            {data.filmography.length > 0 && (
              <>
                <div className="mx-5 border-t border-border my-4" />
                <div className="px-5 mb-3 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground flex-1">
                    {lang === "th" ? "ปรากฏใน" : "Appears In"}
                  </p>
                </div>
                <div className="px-5 grid grid-cols-3 gap-2 pb-2">
                  {data.filmography.map((film, i) => (
                    <FilmCard
                      key={film.imdbId ?? i}
                      film={film}
                      navSrclang={srclang}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Report button */}
            <div className="px-5 pt-2 pb-4">
              <button
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <Flag className="w-3 h-3" />
                {lang === "th"
                  ? "แจ้งปัญหา / ขอลบข้อมูล"
                  : "Report / Request Removal"}
              </button>
            </div>
            <div
              style={{
                height: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
              }}
              aria-hidden
            />
          </div>
        )}
      </div>

      {/* ── Report modal ── */}
      {showReport && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={closeReport}
        >
          <div
            className="bg-background rounded-t-3xl px-6 pt-6 w-full max-w-lg"
            style={{
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
            </div>

            {submitted ? (
              <div className="text-center py-2 pb-4">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                  <Send className="w-5 h-5 text-green-500" />
                </div>
                <h3 className="font-bold text-base mb-2">
                  {lang === "th" ? "รับรายงานแล้ว" : "Report submitted"}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {lang === "th"
                    ? "ขอบคุณที่แจ้งปัญหา เราจะตรวจสอบและแก้ไขโดยเร็ว"
                    : "Thank you for your report. We will review it shortly."}
                </p>
                <button
                  onClick={closeReport}
                  className="mt-4 text-sm font-semibold text-foreground"
                >
                  {lang === "th" ? "ปิด" : "Close"}
                </button>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-base mb-4">
                  {lang === "th" ? "แจ้งปัญหา" : "Report Issue"}
                </h3>
                <div className="space-y-2 mb-4">
                  {REASONS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setReason(r.value)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                        reason === r.value
                          ? "border-foreground bg-foreground/5 font-semibold"
                          : "border-border"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={
                    lang === "th"
                      ? "รายละเอียดเพิ่มเติม (ไม่บังคับ)"
                      : "Additional details (optional)"
                  }
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background resize-none mb-4 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  rows={3}
                />
                <button
                  onClick={submitReport}
                  disabled={!reason || submitting}
                  className="w-full py-3 rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 transition-opacity"
                >
                  {submitting
                    ? lang === "th" ? "กำลังส่ง…" : "Sending…"
                    : lang === "th" ? "ส่งรายงาน" : "Submit Report"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
