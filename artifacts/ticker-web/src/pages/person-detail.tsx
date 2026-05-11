import { useRoute, Link } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Film, User, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, TIER_VISUAL } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";

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
  knownForDepartment: string | null;
  movies: PersonMovie[];
};

function MovieCard({ movie, navSrclang }: { movie: PersonMovie; navSrclang: string }) {
  const { lang } = useLang();
  const tier = computeCardTier({
    tmdbRating: parseFloat(movie.tmdbRating ?? "0"),
    voteCount: movie.voteCount ?? 0,
    genreIds: movie.genreIds ?? [],
    popularity: movie.popularity ?? 0,
    franchiseIds: movie.franchiseIds ?? [],
  });
  const visual = TIER_VISUAL[tier];
  const glowStyle = visual?.glow
    ? { boxShadow: `0 0 8px 2px ${visual.glow}40` }
    : {};

  return (
    <Link href={`/movie/${encodeURIComponent(movie.imdbId)}${navSrclang ? `?srclang=${encodeURIComponent(navSrclang)}` : ""}`}>
      <div
        className="flex-shrink-0 w-[72px] rounded-xl overflow-hidden bg-secondary border border-border transition-opacity active:opacity-70"
        style={glowStyle}
      >
        <div className="relative" style={{ aspectRatio: "2/3" }}>
          {movie.posterUrl
            ? <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center bg-zinc-900"><Film className="w-4 h-4 text-muted-foreground" /></div>
          }
        </div>
        <div className="p-1.5 pb-2 h-[44px] overflow-hidden">
          <p className="text-[9px] font-bold text-foreground line-clamp-2 leading-tight">{movie.title}</p>
          {movie.year && <p className="text-[8px] text-muted-foreground mt-0.5">{displayYear(movie.year, lang)}</p>}
        </div>
      </div>
    </Link>
  );
}

export default function PersonDetail() {
  const { t, lang } = useLang();
  const [, params] = useRoute("/person/:personId");
  const personId = params?.personId ?? "";
  const [bioExpanded, setBioExpanded] = useState(false);

  const srclang = new URLSearchParams(window.location.search).get("srclang") ?? "";
  const navSrclang = srclang;
  const apiLang = lang === "en" ? "en-US" : "th-TH";

  const { data, isLoading, isError } = useQuery<PersonData>({
    queryKey: ["/api/person", personId, apiLang],
    queryFn: async () => {
      const res = await fetch(`/api/person/${encodeURIComponent(personId)}?lang=${apiLang}`);
      if (!res.ok) throw new Error("Person not found");
      return res.json();
    },
    enabled: !!personId,
    staleTime: 30 * 60 * 1000,
  });

  const BIO_LIMIT = 220;
  const bio = data?.biography ?? "";
  const bioTruncated = bio.length > BIO_LIMIT && !bioExpanded ? bio.slice(0, BIO_LIMIT) : bio;
  const showBioToggle = bio.length > BIO_LIMIT;

  return (
    <div className="h-full bg-background overflow-y-auto overscroll-y-none">
      {/* ── Header ── */}
      <div
        className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            onClick={() => navBack("/")}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:opacity-70 flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4 text-foreground" />
          </button>
          <p className="font-display font-bold text-sm text-foreground truncate flex-1">
            {data?.name ?? ""}
          </p>
        </div>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex justify-center items-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Error ── */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
          <User className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t.personNotFound}</p>
        </div>
      )}

      {/* ── Person content ── */}
      {data && (
        <div className="pb-10">
          {/* Profile section */}
          <div className="flex items-start gap-4 px-5 pt-5 pb-4">
            <div className="flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden bg-secondary border border-border">
              {data.profileUrl
                ? <img src={data.profileUrl} alt={data.name} className="w-full h-full object-cover" />
                : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User className="w-8 h-8 text-muted-foreground" />
                  </div>
                )
              }
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <h1 className="font-display font-black text-xl text-foreground leading-tight">{data.name}</h1>
              {data.knownForDepartment && (
                <p className="text-xs text-muted-foreground mt-1">
                  {lang === "th" ? "รู้จักในฐานะ" : "Known For"}{" "}
                  <span className="font-semibold text-foreground">{data.knownForDepartment}</span>
                </p>
              )}
              {data.birthday && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(data.birthday).toLocaleDateString(lang === "th" ? "th-TH-u-ca-buddhist" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
                </p>
              )}
            </div>
          </div>

          {/* Bio */}
          {bio && (
            <div className="px-5 pb-4">
              <p className="text-sm text-foreground/80 leading-relaxed">
                {bioTruncated}
                {!bioExpanded && showBioToggle && (
                  <button
                    onClick={() => setBioExpanded(true)}
                    className="text-muted-foreground ml-1 inline"
                  >
                    {t.seeMore}
                  </button>
                )}
              </p>
            </div>
          )}

          {/* Divider */}
          {data.movies.length > 0 && (
            <div className="mx-5 border-t border-border mb-4" />
          )}

          {/* All works */}
          {data.movies.length > 0 && (
            <>
              <div className="px-5 mb-3 flex items-center gap-2">
                <Film className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                  {t.allWorksLabel}
                </p>
                <span className="text-[10px] text-muted-foreground">{data.movies.length}</span>
              </div>
              <div
                className="flex overflow-x-auto gap-2.5 px-5 pb-1 scrollbar-hide"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {data.movies.map(m => (
                  <MovieCard key={m.imdbId} movie={m} navSrclang={navSrclang} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
