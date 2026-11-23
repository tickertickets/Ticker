// Wikipedia/Wikidata search removed. Award stubs kept for backward compat.

export type WikiAwardResult = {
  awardName: string;
  year: string;
  outcome: "won" | "nominated";
  category?: string;
};

export async function queryAwardsByImdbId(_imdbId: string): Promise<WikiAwardResult[]> {
  return [];
}

export async function queryAwardsByTmdbPersonId(_personId: number): Promise<WikiAwardResult[]> {
  return [];
}
