import { Router } from "express";
import { asyncHandler } from "../middlewares/error-handler";
import { tmdbFetch, posterUrl } from "../lib/tmdb-client";
import { queryAwardsByTmdbPersonId } from "../lib/wikipedia";
import { db } from "@workspace/db";
import { personBookmarksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { UnauthorizedError } from "../lib/errors";

const router = Router();

const PROFILE_BASE = "https://image.tmdb.org/t/p/w185";

function getUILang(req: any): string {
  const q = req.query?.lang as string;
  if (q) return q;
  const h = req.headers?.["x-ui-lang"] as string;
  if (h === "th") return "th";
  return "en-US";
}

// ── GET /person/bookmarked  (MUST be before /:personId) ───────────────────────
router.get(
  "/bookmarked",
  asyncHandler(async (req, res) => {
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) throw new UnauthorizedError();

    const rows = await db
      .select({ personId: personBookmarksTable.personId })
      .from(personBookmarksTable)
      .where(eq(personBookmarksTable.userId, userId))
      .orderBy(personBookmarksTable.createdAt);

    res.json({ personIds: rows.map(r => r.personId) });
  }),
);

// ── GET /person/:personId ─────────────────────────────────────────────────────
router.get(
  "/:personId",
  asyncHandler(async (req, res) => {
    const personId = parseInt(String(req.params["personId"]), 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: "Invalid person ID" });
      return;
    }
    const lang = getUILang(req);

    const [personData, creditsData] = await Promise.all([
      tmdbFetch<{
        id: number;
        name: string;
        biography?: string;
        profile_path?: string | null;
        birthday?: string | null;
        deathday?: string | null;
        known_for_department?: string;
      }>(`/person/${personId}`, { language: lang }),
      tmdbFetch<{
        cast?: Array<{
          id: number;
          title?: string;
          name?: string;
          media_type: string;
          release_date?: string;
          first_air_date?: string;
          poster_path?: string | null;
          vote_average?: number;
          vote_count?: number;
          popularity?: number;
          genre_ids?: number[];
          character?: string;
          belongs_to_collection?: { id: number } | null;
        }>;
        crew?: Array<{
          id: number;
          title?: string;
          name?: string;
          media_type: string;
          release_date?: string;
          first_air_date?: string;
          poster_path?: string | null;
          vote_average?: number;
          vote_count?: number;
          popularity?: number;
          genre_ids?: number[];
          job?: string;
          belongs_to_collection?: { id: number } | null;
        }>;
      }>(`/person/${personId}/combined_credits`, { language: lang }),
    ]);

    const seen = new Set<string>();
    const allMovies: {
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
    }[] = [];

    for (const item of [...(creditsData.cast ?? []), ...(creditsData.crew ?? [])]) {
      if ((item as any).adult === true) continue;
      const key = `${item.id}_${item.media_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = item.title || item.name || "";
      if (!title) continue;
      const releaseDate = item.release_date || item.first_air_date || null;
      const year = releaseDate ? releaseDate.slice(0, 4) : null;
      const imdbId = item.media_type === "tv" ? `tmdb_tv:${item.id}` : `tmdb:${item.id}`;
      const bc = (item as any).belongs_to_collection as { id: number } | null | undefined;
      allMovies.push({
        imdbId,
        tmdbId: item.id,
        mediaType: item.media_type,
        title,
        year,
        releaseDate,
        posterUrl: item.poster_path ? posterUrl(item.poster_path) : null,
        tmdbRating: item.vote_average != null ? String(item.vote_average) : null,
        voteCount: item.vote_count ?? 0,
        genreIds: item.genre_ids ?? [],
        popularity: item.popularity ?? 0,
        franchiseIds: bc ? [bc.id] : [],
      });
    }

    allMovies.sort((a, b) => {
      const popDiff = (b.popularity ?? 0) - (a.popularity ?? 0);
      if (Math.abs(popDiff) > 5) return popDiff;
      const aYear = parseInt(a.year ?? "0", 10);
      const bYear = parseInt(b.year ?? "0", 10);
      return bYear - aYear;
    });

    res.json({
      id: personData.id,
      name: personData.name,
      biography: personData.biography || null,
      profileUrl: personData.profile_path ? `${PROFILE_BASE}${personData.profile_path}` : null,
      birthday: personData.birthday || null,
      deathday: personData.deathday || null,
      knownForDepartment: personData.known_for_department || null,
      movies: allMovies,
    });
  }),
);

// ── GET /person/:personId/awards ──────────────────────────────────────────────
router.get(
  "/:personId/awards",
  asyncHandler(async (req, res) => {
    const personId = parseInt(String(req.params["personId"]), 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: "Invalid person ID" });
      return;
    }

    type AwardEntry = {
      year: string;
      status?: string;
      award_category: string;
      participants?: Array<{ person_id: number; name: string; character?: string }>;
    };
    type AwardResult = {
      department: string;
      name: string;
      winners: AwardEntry[];
      nominees: AwardEntry[];
    };

    const data = await tmdbFetch<{ id?: number; results?: AwardResult[] }>(
      `/person/${personId}/awards`,
    ).catch(() => ({ results: [] as AwardResult[] }));

    const results = (data.results ?? []).filter(
      r => (r.winners?.length ?? 0) > 0 || (r.nominees?.length ?? 0) > 0,
    );

    if (results.length === 0) {
      const wikidataResults = await queryAwardsByTmdbPersonId(personId).catch(() => []);
      if (wikidataResults.length > 0) {
        return res.json({ results: wikidataResults });
      }
    }

    res.json({ results });
  }),
);

// ── GET /person/:personId/bookmark ────────────────────────────────────────────
router.get(
  "/:personId/bookmark",
  asyncHandler(async (req, res) => {
    const personId = String(req.params["personId"]);
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) {
      res.json({ isBookmarked: false });
      return;
    }

    const [row] = await db
      .select()
      .from(personBookmarksTable)
      .where(
        and(
          eq(personBookmarksTable.userId, userId),
          eq(personBookmarksTable.personId, personId),
        ),
      )
      .limit(1);

    res.json({ isBookmarked: !!row });
  }),
);

// ── POST /person/:personId/bookmark ──────────────────────────────────────────
router.post(
  "/:personId/bookmark",
  asyncHandler(async (req, res) => {
    const personId = String(req.params["personId"]);
    const userId = (req as any).session?.userId as string | undefined;
    if (!userId) throw new UnauthorizedError();

    const [existing] = await db
      .select()
      .from(personBookmarksTable)
      .where(
        and(
          eq(personBookmarksTable.userId, userId),
          eq(personBookmarksTable.personId, personId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .delete(personBookmarksTable)
        .where(
          and(
            eq(personBookmarksTable.userId, userId),
            eq(personBookmarksTable.personId, personId),
          ),
        );
      res.json({ bookmarked: false });
    } else {
      await db
        .insert(personBookmarksTable)
        .values({ userId, personId });
      res.json({ bookmarked: true });
    }
  }),
);

export default router;
