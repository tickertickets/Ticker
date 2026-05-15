import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronLeft, Film, User, Loader2, Flag, Send } from "lucide-react";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, type ScoreInput } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { scrollStore } from "@/lib/scroll-store";

function parseAniListDescription(raw: string): { info: { key: string; value: string }[]; bio: string } {
  if (!raw) return { info: [], bio: "" };

  const info: { key: string; value: string }[] = [];
  const keyPattern = /__([^_\n]+):__\s*/g;
  const positions: { key: string; start: number; contentStart: number }[] = [];

  let m;
  while ((m = keyPattern.exec(raw)) !== null) {
    positions.push({ key: m[1].trim(), start: m.index, contentStart: m.index + m[0].length });
  }

  if (positions.length === 0) return { info: [], bio: raw.trim() };

  const preBio = raw.slice(0, positions[0].start).trim();
  let trailing = "";

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const nextStart = i + 1 < positions.length ? positions[i + 1]!.start : raw.length;
    let val = raw.slice(pos.contentStart, nextStart).trim();

    if (i === positions.length - 1) {
      const nlIdx = val.indexOf("\n");
      if (nlIdx > 0) {
        trailing = val.slice(nlIdx).trim();
        val = val.slice(0, nlIdx).trim();
      }
    }

    if (pos.key && val) info.push({ key: pos.key, value: val });
  }

  const bio = [preBio, trailing].filter(Boolean).join(" ").trim();
  return { info, bio };
}

type CharacterFilm = {
  title: string;
  year: string | null;
  imdbId: string | null;
  posterUrl: string | null;
  tmdbRating: string | null;
  voteCount: number;
  genreIds: number[];
  popularity: number;
  franchiseIds: number[];
  mediaType: "movie" | "tv";
};

type CharacterData = {
  wikidataId: string;
  charId?: string;
  name: string;
  description: string;
  imageUrl: string | null;
  filmography: CharacterFilm[];
  source?: "anilist" | "tmdb";
};

function CharacterMovieCard({ film, navSrclang }: { film: CharacterFilm; navSrclang: string }) {
  const { lang } = useLang();
  const input: ScoreInput = {
    tmdbRating: parseFloat(film.tmdbRating ?? "0"),
    voteCount: film.voteCount ?? 0,
    genreIds: film.genreIds ?? [],
    popularity: film.popularity ?? 0,
    franchiseIds: film.franchiseIds ?? [],
  };
  const tier = computeCardTier(input);
  const effects = computeEffectTags(input, tier);
  const href = film.imdbId
    ? (navSrclang
        ? `/movie/${encodeURIComponent(film.imdbId)}?srclang=${encodeURIComponent(navSrclang)}`
        : `/movie/${encodeURIComponent(film.imdbId)}`)
    : "#";

  return (
    <Link href={href} onClick={() => film.imdbId && scrollStore.delete(`movie-${film.imdbId}`)}>
      <div
        className="relative rounded-xl overflow-hidden bg-zinc-900 border border-border shimmer-no-border w-full"
        style={{ aspectRatio: "2/3" }}
      >
        {film.posterUrl
          ? <img src={film.posterUrl} alt={film.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><Film className="w-5 h-5 text-zinc-500" /></div>
        }
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80" />
        <div className="absolute" style={{ top: 6, right: 6 }}>
          <MovieBadges tier={tier} effects={effects} size="xs" layout="col" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-1.5">
          <p className="text-white text-[9px] font-bold line-clamp-2 leading-tight">{film.title}</p>
          {film.year && <p className="text-white/60 text-[8px]">{displayYear(film.year, lang)}</p>}
        </div>
      </div>
    </Link>
  );
}

export default function CharacterDetail() {
  const { lang } = useLang();
  const [, params] = useRoute("/character/:wikidataId");
  const [, navigate] = useLocation();
  const wikidataId = params?.wikidataId ?? "";

  const srclang = useMemo(() =>
    new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    ).get("srclang") ?? "",
  []);

  const srcLangCode = useMemo(() => {
    const base = srclang.split("-")[0].toLowerCase();
    return base || "en";
  }, [srclang]);

  const { data, isLoading, isError } = useQuery<CharacterData>({
    queryKey: ["/api/character", wikidataId],
    queryFn: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`/api/character/${encodeURIComponent(wikidataId)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Character not found");
        return res.json() as Promise<CharacterData>;
      } finally {
        clearTimeout(timeout);
      }
    },
    enabled: !!wikidataId,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  const [bioLang, setBioLang] = useState<string>(() => srcLangCode);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const { data: altBioData, isLoading: altBioLoading } = useQuery<CharacterData>({
    queryKey: ["/api/character", wikidataId, "lang", bioLang],
    queryFn: async () => {
      const res = await fetch(
        `/api/character/${encodeURIComponent(wikidataId)}?lang=${encodeURIComponent(bioLang)}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<CharacterData>;
    },
    enabled: bioLang !== "en" && !!wikidataId,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  const notFound = isError && !isLoading;
  const rawBio = data?.description ?? "";
  const { info, bio } = useMemo(() => parseAniListDescription(rawBio), [rawBio]);

  const displayRawBio = bioLang === "en"
    ? rawBio
    : (altBioLoading ? rawBio : (altBioData?.description ?? rawBio));

  const displayBioText = useMemo(() => {
    if (bioLang === "en") return bio;
    const alt = altBioLoading ? rawBio : (altBioData?.description ?? rawBio);
    return parseAniListDescription(alt).bio || alt;
  }, [bioLang, bio, rawBio, altBioData, altBioLoading]);

  const displayInfo = useMemo(() => {
    if (bioLang === "en") return info;
    const alt = altBioLoading ? rawBio : (altBioData?.description ?? rawBio);
    const parsed = parseAniListDescription(alt);
    return parsed.info.length > 0 ? parsed.info : info;
  }, [bioLang, info, rawBio, altBioData, altBioLoading]);

  const hasOrigLang = srcLangCode !== "en" && srcLangCode !== "th";
  const origLangLabel = srcLangCode.toUpperCase().slice(0, 3);

  const submitReport = useCallback(async () => {
    if (!reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await fetch(`/api/reports/character/${encodeURIComponent(data?.charId ?? wikidataId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          details: reportDetails.trim() || null,
          characterName: data?.name ?? wikidataId,
        }),
      });
      setReportSuccess(true);
    } catch {
      setReportSuccess(true);
    } finally {
      setReportSubmitting(false);
    }
  }, [reportReason, reportDetails, data, wikidataId, reportSubmitting]);

  const closeReport = useCallback(() => {
    setShowReport(false);
    setTimeout(() => { setReportSuccess(false); setReportReason(""); setReportDetails(""); }, 300);
  }, []);

  const REPORT_REASONS = lang === "th"
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

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden">
      <button
        onClick={() => navBack(navigate)}
        className="absolute z-20 left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        aria-label="Back"
      >
        <ChevronLeft className="w-5 h-5 text-white" style={{ transform: "translateX(-1px)" }} />
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">
        {/* Hero */}
        <div className="relative w-full bg-secondary overflow-hidden" style={{ height: 280 }}>
          {data?.imageUrl && (
            <>
              <img
                src={data.imageUrl}
                alt={data.name}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: "blur(22px)", transform: "scale(1.15)", objectPosition: "center top" }}
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
            style={{ height: "60%", background: "linear-gradient(to top, hsl(var(--background)) 20%, transparent 100%)" }}
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

        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {notFound && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
            <User className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              {lang === "th" ? "ไม่พบข้อมูลตัวละคร" : "Character not found"}
            </p>
          </div>
        )}

        {data && (
          <div>
            {/* ── Info section (AniList structured data) ── */}
            {displayInfo.length > 0 && (
              <div className="px-5 pt-4 pb-1">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                  {displayInfo.map(({ key, value }) => (
                    <div key={key} className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground leading-none mb-1">{key}</p>
                      <p className="text-xs text-foreground leading-snug">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Biography ── */}
            {(displayBioText || (displayInfo.length === 0 && displayRawBio)) && (
              <div className="px-5 pt-4 pb-2">
                <div className="flex items-start gap-3">
                  <p className="text-sm text-foreground/80 leading-relaxed flex-1">
                    {displayBioText || displayRawBio}
                  </p>
                  {/* Language toggle */}
                  <div
                    className="relative inline-flex items-center select-none shrink-0 mt-0.5 gap-0"
                    style={{ background: "#e5e5ea", border: "1px solid #d1d1d6", borderRadius: 999, padding: 2 }}
                  >
                    {hasOrigLang && (
                      <button
                        type="button"
                        onClick={() => setBioLang(srcLangCode)}
                        aria-label={`Show bio in ${origLangLabel}`}
                        className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                        style={{
                          background: bioLang === srcLangCode ? "#111" : "transparent",
                          color: bioLang === srcLangCode ? "#fff" : "#888",
                          minWidth: 28,
                        }}
                      >
                        {origLangLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setBioLang("en")}
                      aria-label="Show bio in English"
                      className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                      style={{
                        background: bioLang === "en" ? "#111" : "transparent",
                        color: bioLang === "en" ? "#fff" : "#888",
                        minWidth: 28,
                      }}
                    >
                      EN
                    </button>
                    <button
                      type="button"
                      onClick={() => setBioLang("th")}
                      aria-label="Show bio in Thai"
                      className="relative z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors"
                      style={{
                        background: bioLang === "th" ? "#111" : "transparent",
                        color: bioLang === "th" ? "#fff" : "#888",
                        minWidth: 28,
                      }}
                    >
                      TH
                    </button>
                  </div>
                </div>
                {bioLang !== "en" && altBioLoading && (
                  <p className="text-xs text-muted-foreground mt-2">{lang === "th" ? "กำลังโหลด…" : "Loading…"}</p>
                )}
                {bioLang !== "en" && !altBioLoading && !altBioData?.description && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {lang === "th" ? "ยังไม่มีข้อมูลภาษานี้" : "Bio not available in this language"}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  {lang === "th" ? "ที่มา: " : "Source: "}
                  {data?.source === "anilist" ? (
                    <a href="https://anilist.co" target="_blank" rel="noopener noreferrer" className="underline" onClick={e => e.stopPropagation()}>AniList</a>
                  ) : (
                    <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="underline" onClick={e => e.stopPropagation()}>TMDB</a>
                  )}
                </p>
              </div>
            )}

            {/* ── Filmography ── */}
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
                    <CharacterMovieCard key={film.imdbId ?? i} film={film} navSrclang={srclang} />
                  ))}
                </div>
              </>
            )}

            {/* ── Report button ── */}
            <div className="px-5 pt-2 pb-4">
              <button
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <Flag className="w-3 h-3" />
                {lang === "th" ? "แจ้งปัญหา / ขอลบข้อมูล" : "Report / Request Removal"}
              </button>
            </div>
            <div style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }} aria-hidden />
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
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
            </div>

            {reportSuccess ? (
              <div className="text-center py-2 pb-4">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                  <Send className="w-5 h-5 text-green-500" />
                </div>
                <h3 className="font-bold text-base mb-2">
                  {lang === "th" ? "รับรายงานแล้ว" : "Report submitted"}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {lang === "th"
                    ? "ขอบคุณ เราจะตรวจสอบและดำเนินการภายใน 5 วันทำการ"
                    : "Thank you. We'll review and process your request within 5 business days."}
                </p>
                <button
                  onClick={closeReport}
                  className="mt-5 w-full py-2.5 rounded-xl bg-secondary text-sm font-semibold"
                >
                  {lang === "th" ? "ปิด" : "Close"}
                </button>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-base mb-1">
                  {lang === "th" ? "แจ้งปัญหา / ขอลบข้อมูล" : "Report / Request Removal"}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {data?.name && <span className="font-medium text-foreground">{data.name}</span>}
                </p>

                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  {lang === "th" ? "เหตุผล" : "Reason"}
                </p>
                <div className="flex flex-col gap-2 mb-4">
                  {REPORT_REASONS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setReportReason(r.value)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-colors ${
                        reportReason === r.value
                          ? "border-foreground bg-secondary font-semibold"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                        reportReason === r.value ? "border-foreground" : "border-muted-foreground/40"
                      }`}>
                        {reportReason === r.value && <div className="w-2 h-2 rounded-full bg-foreground" />}
                      </div>
                      {r.label}
                    </button>
                  ))}
                </div>

                <textarea
                  className="w-full h-20 bg-secondary rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none border border-border outline-none focus:border-muted-foreground transition-colors"
                  placeholder={lang === "th" ? "รายละเอียดเพิ่มเติม (ไม่บังคับ)" : "Additional details (optional)"}
                  value={reportDetails}
                  onChange={e => setReportDetails(e.target.value)}
                  maxLength={400}
                />

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={closeReport}
                    className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground"
                  >
                    {lang === "th" ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={!reportReason || reportSubmitting}
                    className="flex-[2] py-2.5 rounded-xl bg-foreground text-background text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity active:opacity-70"
                  >
                    {reportSubmitting
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <><Send className="w-3.5 h-3.5" />{lang === "th" ? "ส่งรายงาน" : "Submit"}</>
                    }
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
