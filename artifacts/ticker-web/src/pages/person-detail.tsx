import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Film, User, Loader2, Bookmark, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, type ScoreInput } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { scrollStore } from "@/lib/scroll-store";
import { usePageScroll } from "@/hooks/use-page-scroll";

type PersonMovie = {
  imdbId: string;
  tmdbId: number;
  mediaType: string;
  title: string;
  year: string | null;
  releaseDate: string | null;
  posterUrl: string | null;
  tmdbRating: string | null;
  voteCount: number;
  genreIds: number[];
  popularity: number;
  franchiseIds: number[];
};

type PersonData = {
  id: number;
  name: string;
  biography: string | null;
  profileUrl: string | null;
  birthday: string | null;
  deathday: string | null;
  knownForDepartment: string | null;
  movies: PersonMovie[];
};

type AwardEntry = {
  year: string;
  award_category: string;
  participants?: Array<{ name: string }>;
};
type AwardResult = {
  department: string;
  name: string;
  winners: AwardEntry[];
  nominees: AwardEntry[];
};

function PersonMovieCard({ movie, navSrclang }: { movie: PersonMovie; navSrclang: string }) {
  const { lang } = useLang();
  const input: ScoreInput = {
    tmdbRating: parseFloat(movie.tmdbRating ?? "0"),
    voteCount: movie.voteCount ?? 0,
    genreIds: movie.genreIds ?? [],
    popularity: movie.popularity ?? 0,
    franchiseIds: movie.franchiseIds ?? [],
  };
  const tier = computeCardTier(input);
  const effects = computeEffectTags(input, tier);
  const href = navSrclang
    ? `/movie/${encodeURIComponent(movie.imdbId)}?srclang=${encodeURIComponent(navSrclang)}`
    : `/movie/${encodeURIComponent(movie.imdbId)}`;

  return (
    <Link href={href} onClick={() => scrollStore.delete(`movie-${movie.imdbId}`)}>
      <div
        className="relative rounded-xl overflow-hidden bg-zinc-900 border border-border shimmer-no-border w-full"
        style={{ aspectRatio: "2/3" }}
      >
        {movie.posterUrl
          ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><Film className="w-5 h-5 text-zinc-500" /></div>
        }
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80" />
        <div className="absolute" style={{ top: 6, right: 6 }}>
          <MovieBadges tier={tier} effects={effects} size="xs" layout="col" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-1.5">
          <p className="text-white text-[9px] font-bold line-clamp-2 leading-tight">{movie.title}</p>
          {movie.year && <p className="text-white/60 text-[8px]">{displayYear(movie.year, lang)}</p>}
        </div>
      </div>
    </Link>
  );
}

export default function PersonDetail() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, params] = useRoute("/person/:personId");
  const [, navigate] = useLocation();
  const personId = params?.personId ?? "";

  // Save and restore scroll position so "back" returns to where the user was
  const scrollRef = usePageScroll(`person-${personId}`);

  const [bioExpanded, setBioExpanded] = useState(false);
  const [showAwards, setShowAwards] = useState(false);

  const srclang = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("srclang") ?? "";

  const apiLang = lang === "en" ? "en-US" : "th-TH";

  const { data, isLoading, isError } = useQuery<PersonData>({
    queryKey: ["/api/person", personId, apiLang],
    queryFn: async () => {
      const res = await fetch(`/api/person/${encodeURIComponent(personId)}?lang=${apiLang}`);
      if (!res.ok) throw new Error("Person not found");
      return res.json();
    },
    enabled: !!personId,
    staleTime: 0,
  });

  const { data: awardsData } = useQuery<{ results: AwardResult[] }>({
    queryKey: ["/api/person", personId, "awards"],
    queryFn: async () => {
      const res = await fetch(`/api/person/${encodeURIComponent(personId)}/awards`);
      if (!res.ok) return { results: [] };
      return res.json();
    },
    enabled: !!personId,
    staleTime: 0,
  });

  const { data: bookmarkData } = useQuery<{ isBookmarked: boolean }>({
    queryKey: ["/api/person", personId, "bookmark"],
    queryFn: async () => {
      const res = await fetch(`/api/person/${encodeURIComponent(personId)}/bookmark`, {
        credentials: "include",
      });
      if (!res.ok) return { isBookmarked: false };
      return res.json();
    },
    enabled: !!personId && !!user,
    staleTime: 0,
  });

  const isBookmarked = bookmarkData?.isBookmarked ?? false;

  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/person/${encodeURIComponent(personId)}/bookmark`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ bookmarked: boolean }>;
    },
    onSuccess: (result) => {
      qc.setQueryData(["/api/person", personId, "bookmark"], { isBookmarked: result.bookmarked });
      qc.invalidateQueries({ queryKey: ["/api/person", "bookmarked"] });
    },
  });

  const handleBookmark = () => {
    if (!user) {
      toast({
        title: lang === "th" ? "เข้าสู่ระบบเพื่อบุ๊กมาร์ก" : "Sign in to bookmark",
        duration: 1500,
      });
      return;
    }
    bookmarkMutation.mutate();
  };

  const BIO_LIMIT = 320;
  const bio = data?.biography ?? "";
  const bioShown = bio.length > BIO_LIMIT && !bioExpanded ? bio.slice(0, BIO_LIMIT) : bio;
  const showBioToggle = bio.length > BIO_LIMIT;

  const awards = awardsData?.results ?? [];

  const fmtDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(
        lang === "th" ? "th-TH" : "en-US",
        { year: "numeric", month: "long", day: "numeric" },
      );
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden">
      {/* ── Overlay nav buttons ── */}
      <button
        onClick={() => navBack(navigate)}
        className="absolute z-20 left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
        aria-label="Back"
      >
        <ChevronLeft className="w-5 h-5 text-white" style={{ transform: "translateX(-1px)" }} />
      </button>

      {user !== undefined && (
        <button
          onClick={handleBookmark}
          disabled={bookmarkMutation.isPending}
          className="absolute z-20 right-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
        >
          <Bookmark
            className={cn("w-4.5 h-4.5 transition-all", isBookmarked ? "fill-white text-white" : "text-white")}
          />
        </button>
      )}

      {/* ── Scrollable body ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">

        {/* ── Hero ── */}
        <div className="relative w-full bg-secondary overflow-hidden" style={{ height: 280 }}>
          {data?.profileUrl && (
            <>
              <img
                src={data.profileUrl}
                alt={data.name}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: "blur(22px)", transform: "scale(1.15)", objectPosition: "center top" }}
              />
              <div className="absolute inset-0 bg-black/35" />
            </>
          )}
          {!data?.profileUrl && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <User className="w-20 h-20 text-muted-foreground opacity-20" />
            </div>
          )}
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0" style={{ height: "60%", background: "linear-gradient(to top, hsl(var(--background)) 20%, transparent 100%)" }} />

          {/* Name + thumbnail at bottom of hero */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
            <div className="flex items-end gap-3">
              {data?.profileUrl ? (
                <img
                  src={data.profileUrl}
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
                {data?.knownForDepartment && (
                  <p className="text-sm text-muted-foreground mt-0.5">{data.knownForDepartment}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Loading / Error ── */}
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
            <User className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">{t.personNotFound}</p>
          </div>
        )}

        {/* ── Main content ── */}
        {data && (
          <div>

            {/* Bio + dates */}
            {(data.birthday || data.deathday || bio) && (
              <div className="px-5 pt-4 pb-2">
                {/* Dates */}
                {(data.birthday || data.deathday) && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
                    {data.birthday && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {lang === "th" ? "เกิด" : "Born"}
                        </span>{" "}
                        {fmtDate(data.birthday)}
                      </p>
                    )}
                    {data.deathday && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {lang === "th" ? "เสียชีวิต" : "Died"}
                        </span>{" "}
                        {fmtDate(data.deathday)}
                      </p>
                    )}
                  </div>
                )}
                {/* Bio */}
                {bio && (
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {bioShown}
                    {!bioExpanded && showBioToggle && (
                      <>
                        {"... "}
                        <button
                          onClick={() => setBioExpanded(true)}
                          className="text-muted-foreground underline"
                        >
                          {lang === "th" ? "ดูเพิ่มเติม" : "see more"}
                        </button>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Awards section */}
            {awards.length > 0 && (
              <div className="px-5 pt-3">
                <button
                  className="w-full flex items-center gap-2 text-left py-1.5"
                  onClick={() => setShowAwards(v => !v)}
                >
                  <Trophy className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                    {t.awardsLabel}
                  </p>
                  <span className="text-[10px] text-muted-foreground mr-1">{awards.length}</span>
                  {showAwards
                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                </button>
                {showAwards && (
                  <div className="mt-2 flex flex-col gap-3 pb-2">
                    {awards.map((award, i) => (
                      <div key={i}>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                          {award.name}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {award.winners.map((w, j) => (
                            <span
                              key={`w-${j}`}
                              className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold"
                            >
                              🏆 {w.award_category}{w.year ? ` (${w.year})` : ""}
                            </span>
                          ))}
                          {award.nominees.map((n, j) => (
                            <span
                              key={`n-${j}`}
                              className="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full"
                            >
                              ✦ {n.award_category}{n.year ? ` (${n.year})` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            {data.movies.length > 0 && (
              <div className="mx-5 border-t border-border my-4" />
            )}

            {/* All works — 3-column grid with main movie cards */}
            {data.movies.length > 0 && (
              <>
                <div className="px-5 mb-3 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                    {t.allWorksLabel}
                  </p>
                  <span className="text-[10px] text-muted-foreground">{data.movies.length}</span>
                </div>
                <div className="px-5 grid grid-cols-3 gap-2 pb-2">
                  {data.movies.map(m => (
                    <PersonMovieCard key={m.imdbId} movie={m} navSrclang={srclang} />
                  ))}
                </div>
              </>
            )}
            <div style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
