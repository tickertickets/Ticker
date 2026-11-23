/**
 * useEnsureMovieCores — pre-loads rank-relevant fields for a list of movies
 * and seeds the React Query cache so badge/rank visuals on cards reflect the
 * REAL TMDB values immediately, without the user needing to open the movie
 * detail page first.
 *
 * Cards across the app read from queryKey ["/api/movies", imdbId]. By writing
 * core fields (tmdbRating, voteCount, popularity, genreIds, releaseDate,
 * franchiseIds) into that key, every card re-renders with the correct rank.
 *
 * `_coreSeeded: true` is a sentinel written only by this hook so subsequent
 * renders know we already fetched the authoritative /movies/core data.
 * Without it, an empty `franchiseIds: []` from a list endpoint would look the
 * same as a confirmed "not a franchise" result and we'd skip the refetch.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type MovieCore = {
  tmdbRating: string | null;
  voteCount: number;
  popularity: number;
  genreIds: number[];
  releaseDate: string | null;
  franchiseIds: number[];
};

export function useEnsureMovieCores(
  imdbIds: ReadonlyArray<string | undefined | null>,
): void {
  const qc = useQueryClient();

  const ids = useMemo(
    () => Array.from(new Set(imdbIds.filter((x): x is string => !!x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imdbIds.join(",")],
  );

  // Determine which ids don't yet have authoritative core fields in cache.
  // A cache entry is considered "good" only when it was seeded by this hook
  // (indicated by `_coreSeeded: true`) OR when it comes from the movie detail
  // page (which always includes full TMDB data including franchiseIds).
  // We deliberately do NOT trust `franchiseIds: []` from list endpoints —
  // that value may be empty because the TMDB collection lookup failed, not
  // because the movie genuinely has no franchise.
  const missing = useMemo(
    () =>
      ids.filter((id) => {
        const cached = qc.getQueryData<any>(["/api/movies", id]);
        if (!cached) return true;
        // If the detail page already loaded this movie, it has full TMDB data.
        if (cached._detailLoaded) return false;
        // If our hook already seeded this entry, skip it.
        if (cached._coreSeeded) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(","), qc],
  );

  const key = missing.join(",");
  const { data } = useQuery({
    queryKey: ["movies-core-batch", key],
    enabled: missing.length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const url = `/api/movies/core?ids=${encodeURIComponent(missing.join(","))}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { cores: {} as Record<string, MovieCore> };
      return res.json() as Promise<{ cores: Record<string, MovieCore> }>;
    },
  });

  useEffect(() => {
    if (!data?.cores) return;
    for (const [imdbId, core] of Object.entries(data.cores)) {
      qc.setQueryData<any>(["/api/movies", imdbId], (old: any) => ({
        ...(old ?? {}),
        ...core,
        _coreSeeded: true,
      }));
    }
  }, [data, qc]);
}
