import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Film, Loader2, TrendingUp, Crown, Skull, Moon, Smile, Zap, AlertCircle,
  Clapperboard, X as XIcon, Sparkles, Globe, Wand2, Ghost, Sword,
  HeartCrack, Shield, Dice5, RefreshCw, ChevronRight, ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, TIER_VISUAL, type ScoreInput } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { useToast } from "@/hooks/use-toast";

export type RandomMovie = {
  imdbId: string;
  title: string;
  year: string | null;
  releaseDate?: string | null;
  posterUrl: string | null;
  tmdbRating?: string | null;
  voteCount?: number;
  genreIds?: number[];
  popularity?: number;
  franchiseIds?: number[];
  mediaType?: string;
};

type SectionConfig = { title: string; desc: string; icon: LucideIcon; color: string };

export const RANDOM_SECTION_META: Record<string, SectionConfig> = {
  trending:          { title: "ยอดนิยม",            desc: "ดูเถอะ จะได้คุยกับชาวบ้านเขารู้เรื่อง",                  icon: TrendingUp,   color: "text-red-500"    },
  now_playing:       { title: "กำลังฉาย",            desc: "กำเงินไปโรงหนังเดี๋ยวนี้เลย!",                          icon: Clapperboard, color: "text-blue-400"   },
  legendary:         { title: "LEGENDARY",           desc: "ดูแล้วเข้าใจว่าทำไมคนยังพูดถึง",                        icon: Crown,        color: "text-amber-400"  },
  cult_classic:      { title: "CULT CLASSIC",        desc: "พล็อตล้ำจนต้องร้อง ห้ะ?",                               icon: Skull,        color: "text-rose-400"   },
  "2am_deep_talk":   { title: "2 AM Deep Talk",      desc: "ตีสองแล้วยังไม่นอน มาหาเรื่องให้คิดจนเช้ากัน",          icon: Moon,         color: "text-indigo-400" },
  brain_rot:         { title: "Brain Rot",           desc: "ปล่อยสมองไหลไปกับหนัง พลังงานเหลือล้น",                 icon: Zap,          color: "text-orange-400" },
  main_character:    { title: "Main Character",      desc: "ดูจบแล้วรู้สึกเหมือนเป็นพระเอก... จนกว่าจะส่องกระจก",   icon: Smile,        color: "text-cyan-400"   },
  heartbreak:        { title: "อกหัก โรแมนติก",      desc: "เจ็บแล้วไม่จำ เดี๋ยวพี่ซ้ำให้เอง",                      icon: HeartCrack,   color: "text-rose-400"   },
  chaos_red_flags:   { title: "Chaos & Red Flags",   desc: "ประสาทกินอย่างมีสไตล์ ใครชอบแนวนี้คือพวกเดียวกัน",      icon: AlertCircle,  color: "text-pink-400"   },
  anime:             { title: "Anime",               desc: "เข้าแล้วออกยาก วงการนี้ไม่มีคำว่าพัก",                   icon: Sparkles,     color: "text-purple-400" },
  tokusatsu:         { title: "โทคุทัสสึ",            desc: "ระเบิดทุกตอน ไม่มีข้ออ้าง",                             icon: Sword,        color: "text-green-400"  },
  disney_dreamworks: { title: "Disney & DreamWorks", desc: "ใจฟูเบอร์แรก ดูแล้วเหมือนได้ชาร์จแบต",                 icon: Wand2,        color: "text-yellow-400" },
  k_wave:            { title: "K-Wave",              desc: "เตรียมรามยอนให้พร้อม แล้วไปโอปป้ากัน",                  icon: Globe,        color: "text-teal-400"   },
  midnight_horror:   { title: "Midnight Horror",     desc: "ไม่ได้น่ากลัวอย่างที่คิด... แต่นอนเปิดไฟด้วยก็ดี",      icon: Ghost,        color: "text-red-400"    },
  marvel_dc:         { title: "Marvel & DC",         desc: "ดูทุกภาค หรือไม่ต้องก็ยังได้",                          icon: Shield,       color: "text-sky-400"    },
};

// All categories by id → metadata (for lookup)
const ALL_CAT_META: Record<string, { label: string; icon: LucideIcon }> = {
  trending:          { label: "ยอดนิยม",            icon: TrendingUp   },
  now_playing:       { label: "กำลังฉาย",            icon: Clapperboard },
  legendary:         { label: "LEGENDARY",          icon: Crown        },
  cult_classic:      { label: "CULT CLASSIC",       icon: Skull        },
  "2am_deep_talk":   { label: "2 AM Deep Talk",     icon: Moon         },
  brain_rot:         { label: "Brain Rot",          icon: Zap          },
  main_character:    { label: "Main Character",     icon: Smile        },
  heartbreak:        { label: "อกหัก โรแมนติก",     icon: HeartCrack   },
  chaos_red_flags:   { label: "Chaos & Red Flags",  icon: AlertCircle  },
  anime:             { label: "Anime",              icon: Sparkles     },
  disney_dreamworks: { label: "Disney & DreamWorks",icon: Wand2        },
  k_wave:            { label: "K-Wave",             icon: Globe        },
  midnight_horror:   { label: "Midnight Horror",    icon: Ghost        },
  marvel_dc:         { label: "Marvel & DC",        icon: Shield       },
  tokusatsu:         { label: "โทคุทัสสึ",           icon: Sword        },
};

// Middle categories ordered by time-of-day — same logic as search.tsx pills
function getTimedMiddleIds(): string[] {
  const h = new Date().getHours();
  if (h < 6)  return ["2am_deep_talk","heartbreak","midnight_horror","anime","k_wave","chaos_red_flags","brain_rot","main_character","disney_dreamworks","marvel_dc","tokusatsu"];
  if (h < 12) return ["disney_dreamworks","marvel_dc","anime","main_character","brain_rot","k_wave","tokusatsu","heartbreak","chaos_red_flags","2am_deep_talk","midnight_horror"];
  if (h < 18) return ["brain_rot","anime","disney_dreamworks","k_wave","main_character","tokusatsu","marvel_dc","heartbreak","chaos_red_flags","2am_deep_talk","midnight_horror"];
  return             ["chaos_red_flags","heartbreak","main_character","marvel_dc","k_wave","anime","brain_rot","disney_dreamworks","2am_deep_talk","midnight_horror","tokusatsu"];
}

// Dynamically ordered category list (matches pill order in search page)
export function getTimedPickerCategories(): { id: string; label: string; icon: LucideIcon }[] {
  const ordered = [
    "trending",
    "now_playing",
    ...getTimedMiddleIds(),
    "legendary",
    "cult_classic",
  ];
  return ordered.map(id => ({ id, ...ALL_CAT_META[id] }));
}

// Static export kept for backwards-compat (used externally if any)
export const PICKER_CATEGORIES: { id: string; label: string; icon: LucideIcon }[] =
  getTimedPickerCategories();

const DAILY_LIMIT = 5;

function getDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getUsedCount(catId: string): number {
  try {
    const raw = localStorage.getItem(`random_cnt_${catId}_${getDayKey()}`);
    return raw ? parseInt(raw, 10) : 0;
  } catch { return 0; }
}

function incrementUsedCount(catId: string): number {
  try {
    const next = getUsedCount(catId) + 1;
    localStorage.setItem(`random_cnt_${catId}_${getDayKey()}`, String(next));
    return next;
  } catch { return 0; }
}

function useCountdownToMidnight() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      setSecs(Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RandomMoviePicker({ onClose, isGuest = false }: { onClose: () => void; isGuest?: boolean }) {
  const { t, lang } = useLang();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"pick" | "loading" | "result">("pick");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [result, setResult] = useState<RandomMovie | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const countdown = useCountdownToMidnight();

  const fetchRandom = async (catId: string) => {
    if (isGuest) { toast({ title: t.signInToRoll, duration: 1500 }); return; }
    const used = getUsedCount(catId);
    if (used >= DAILY_LIMIT) return;
    setSelectedCat(catId);
    setStep("loading");
    setError(null);
    try {
      const apiLang = lang === "en" ? "en-US" : "th";
      const r = await fetch(`/api/movies/random?category=${encodeURIComponent(catId)}&lang=${apiLang}`, {
        credentials: "include",
        headers: { "x-ui-lang": lang === "en" ? "en" : "th" },
      });
      if (!r.ok) throw new Error("ไม่พบหนัง");
      const data = await r.json();
      incrementUsedCount(catId);
      forceUpdate(v => v + 1);
      setResult(data.movie);
      setStep("result");
    } catch {
      setError(lang === "th" ? "โหลดไม่ได้ ลองใหม่อีกครั้ง" : "Failed to load. Try again.");
      setStep("pick");
    }
  };

  const goToMovie = () => {
    if (!result) return;
    onClose();
    navigate(`/movie/${encodeURIComponent(result.imdbId)}`);
  };

  // Prefer translated section title from i18n (covers EN + TH). ALL_CAT_META labels are Thai-only.
  const catLabel = selectedCat
    ? (t.sections[selectedCat]?.title ?? PICKER_CATEGORIES.find(c => c.id === selectedCat)?.label ?? selectedCat)
    : "";

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />


      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-background border-t border-border overflow-hidden" style={{ maxHeight: "85vh" }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {step === "loading" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center">
              <Dice5 className="w-10 h-10 text-foreground animate-bounce" />
            </div>
            <div className="text-center">
              <p className="font-bold text-foreground text-base">{lang === "th" ? "กำลังสุ่ม..." : "Rolling..."}</p>
              <p className="text-xs text-muted-foreground mt-1">{lang === "th" ? `จาก ${catLabel}` : `From ${catLabel}`}</p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {step === "result" && result && (() => {
          const tier = computeCardTier({ tmdbRating: parseFloat(result.tmdbRating ?? "0"), voteCount: result.voteCount ?? 0, genreIds: result.genreIds ?? [], popularity: result.popularity ?? 0, franchiseIds: result.franchiseIds ?? [] });
          const effects = computeEffectTags({ tmdbRating: parseFloat(result.tmdbRating ?? "0"), voteCount: result.voteCount ?? 0, genreIds: result.genreIds ?? [], popularity: result.popularity ?? 0, franchiseIds: result.franchiseIds ?? [] }, tier);
          const usedNow = selectedCat ? getUsedCount(selectedCat) : 0;
          const atLimit = usedNow >= DAILY_LIMIT;
          return (
            <div className="flex flex-col" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
              <div className="relative flex items-center justify-center px-4 pt-2 pb-3">
                <button onClick={() => setStep("pick")} className="absolute left-4 flex items-center gap-1 text-xs text-muted-foreground active:opacity-70">
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {lang === "th" ? "หมวด" : "Categories"}
                </button>
                {(() => {
                  const catMeta = selectedCat ? ALL_CAT_META[selectedCat] : null;
                  const CatIcon = catMeta?.icon;
                  const catColor = RANDOM_SECTION_META[selectedCat ?? ""]?.color ?? "text-muted-foreground";
                  return (
                    <div className="flex items-center justify-center gap-1.5 pointer-events-none">
                      {CatIcon && <CatIcon className={cn("w-3.5 h-3.5 flex-shrink-0", catColor)} />}
                      <p className="text-xs font-semibold text-muted-foreground">{catLabel}</p>
                    </div>
                  );
                })()}
                <button onClick={onClose} className="absolute right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:opacity-70">
                  <XIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="px-4">
                <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-border" style={{ aspectRatio: "16/9" }}>
                  {result.posterUrl
                    ? <img src={result.posterUrl} alt={result.title} className="w-full h-full object-cover" style={{ objectPosition: "center 20%" }} />
                    : <div className="w-full h-full flex items-center justify-center"><Film className="w-10 h-10 text-zinc-600" /></div>
                  }
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-end gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-bold text-white text-xl leading-tight line-clamp-2">{result.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {result.year && <p className="text-white/60 text-sm">{displayYear(result.year, lang)}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <MovieBadges tier={tier} effects={effects} size="sm" layout="row" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 px-4 mt-4 pb-0">
                {atLimit ? (
                  <div className="flex-1 flex flex-col items-center justify-center h-12 rounded-2xl bg-secondary border border-border text-center px-3">
                    <p className="text-[10px] text-muted-foreground leading-tight">{lang === "th" ? "ใช้ครบ 5 ครั้งวันนี้" : "Daily limit reached"}</p>
                    <p className="text-[10px] font-semibold text-foreground leading-tight">{countdown}</p>
                  </div>
                ) : (
                  <button onClick={() => selectedCat && fetchRandom(selectedCat)} className="flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl bg-secondary border border-border font-semibold text-sm text-foreground active:opacity-70 transition-opacity">
                    <RefreshCw className="w-4 h-4 flex-shrink-0" />
                    <span className="whitespace-nowrap">{lang === "th" ? "สุ่มใหม่" : "Re-roll"}</span>
                  </button>
                )}
                <button onClick={goToMovie} className="flex-[2] flex items-center justify-center gap-2 h-12 rounded-2xl bg-foreground text-background font-bold text-sm active:opacity-70 transition-opacity">
                  <span className="whitespace-nowrap">{lang === "th" ? "ดูรายละเอียด" : "View detail"}</span>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                </button>
              </div>
            </div>
          );
        })()}

        {step === "pick" && (
          <div className="flex flex-col overflow-y-auto" style={{ maxHeight: "calc(85vh - 40px)" }}>
            <div className="px-4 pt-2 pb-4">
              <div className="relative flex items-center justify-center mb-4 pt-1">
                <div className="text-center">
                  <h2 className="font-display font-bold text-lg text-foreground">{lang === "th" ? "สุ่มหนังให้เลย" : "Roll a Movie"}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{lang === "th" ? "เลือกหมวดที่ชอบ แล้วให้เราเซอร์ไพรส์คุณ" : "Pick a category and let us surprise you"}</p>
                </div>
                <button onClick={onClose} className="absolute right-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:opacity-70">
                  <XIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              {error && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">{error}</div>
              )}
              <div className="flex flex-col gap-2">
                {getTimedPickerCategories().map(cat => {
                  const Icon = cat.icon;
                  const meta = RANDOM_SECTION_META[cat.id];
                  const used = getUsedCount(cat.id);
                  const remaining = DAILY_LIMIT - used;
                  const exhausted = remaining <= 0;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => !exhausted && fetchRandom(cat.id)}
                      disabled={exhausted}
                      className={cn(
                        "flex items-center gap-3 w-full text-left px-4 py-3 rounded-2xl bg-secondary border border-border transition-opacity",
                        exhausted ? "opacity-40 cursor-not-allowed" : "active:opacity-60"
                      )}
                    >
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-background border border-border">
                        <Icon className={cn("w-4.5 h-4.5", meta?.color ?? "text-foreground")} style={{ width: 18, height: 18 }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground leading-tight">{t.sections[cat.id]?.title ?? cat.label}</p>
                        {(t.sections[cat.id]?.desc ?? meta?.desc) && <p className="text-xs text-muted-foreground leading-snug line-clamp-1 mt-0.5">{t.sections[cat.id]?.desc ?? meta?.desc}</p>}
                      </div>
                      {exhausted ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-muted-foreground">{lang === "th" ? "หมดแล้ว" : "Done"}</p>
                          <p className="text-[10px] font-semibold text-muted-foreground">{countdown}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold text-muted-foreground flex-shrink-0">{remaining}/{DAILY_LIMIT}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
