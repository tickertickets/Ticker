/**
 * rank-hint-store.ts
 *
 * In-memory store สำหรับ rank-relevant fields ที่ได้จาก category/search API.
 * ใช้ให้ detail page อ่านค่าเดิมและคำนวณ rank จากข้อมูลชุดเดียวกับการ์ด
 * ทำให้ rank บนการ์ดและในหน้ารายละเอียดตรงกันเสมอ
 */

export type RankHint = {
  tmdbRating: string | null;
  voteCount: number;
  popularity: number;
  genreIds: number[];
  franchiseIds: number[];
  year: string | null;
  releaseDate: string | null;
};

const store = new Map<string, RankHint>();

export function setRankHint(imdbId: string, hint: RankHint): void {
  store.set(imdbId, hint);
}

export function getRankHint(imdbId: string): RankHint | null {
  return store.get(imdbId) ?? null;
}
