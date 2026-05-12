import { useRoute, Link, useLocation } from "wouter";
import { navBack } from "@/lib/nav-back";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Film, User, Loader2 } from "lucide-react";
import { useLang, displayYear } from "@/lib/i18n";
import { computeCardTier, computeEffectTags, type ScoreInput } from "@/lib/ranks";
import { MovieBadges } from "@/components/MovieBadges";
import { scrollStore } from "@/lib/scroll-store";

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
  name: string;
  description: string;
  imageUrl: string | null;
  filmography: CharacterFilm[];
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

  const srclang = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("srclang") ?? "";

  const { data, isLoading, isError } = useQuery<CharacterData>({
    queryKey: ["/api/character", wikidataId],
    queryFn: async () => {
      const res = await fetch(`/api/character/${encodeURIComponent(wikidataId)}`);
      if (!res.ok) throw new Error("Character not found");
      return res.json();
    },
    enabled: !!wikidataId,
    staleTime: 30 * 60 * 1000,
  });

  const notFound = isError && !isLoading;
  const bio = data?.description ?? "";

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
            {bio && (
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm text-foreground/80 leading-relaxed">{bio}</p>
              </div>
            )}

            {data.filmography.length > 0 && (
              <>
                <div className="mx-5 border-t border-border my-4" />
                <div className="px-5 mb-3 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex-1">
                    {lang === "th" ? "ปรากฏใน" : "Appears In"}
                  </p>
                  <span className="text-[10px] text-muted-foreground">{data.filmography.length}</span>
                </div>
                <div className="px-5 grid grid-cols-3 gap-2 pb-2">
                  {data.filmography.map((film, i) => (
                    <CharacterMovieCard key={film.imdbId ?? i} film={film} navSrclang={srclang} />
                  ))}
                </div>
              </>
            )}

            <div style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
