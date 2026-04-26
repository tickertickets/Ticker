/**
 * Shared TMDB API client.
 *
 * Single source of truth for all TMDB HTTP calls.
 * Previously, TMDB_API_KEY and TMDB_BASE were duplicated in every route file.
 * Now all TMDB access flows through this module.
 */
import { config } from "../config";
import { ExternalApiError } from "./errors";

const { apiKey, baseUrl, imageBaseUrl } = config.tmdb;

export const TMDB_IMG = `${imageBaseUrl}/w500`;
export const TMDB_IMG_WIDE = `${imageBaseUrl}/w1280`;
export const TMDB_IMG_SMALL = `${imageBaseUrl}/w92`;

/**
 * Thin fetch wrapper around the TMDB REST API.
 * Appends api_key automatically and throws ExternalApiError on non-200.
 */
export async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let resp: Response;
  try {
    resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
  } catch (cause) {
    throw new ExternalApiError(`TMDB request failed: ${path}`);
  }

  if (!resp.ok) {
    throw new ExternalApiError(`TMDB returned ${resp.status} for ${path}`);
  }

  return resp.json() as Promise<T>;
}

/**
 * Build a fully-qualified TMDB poster/image URL.
 * Returns null if path is falsy.
 */
export function posterUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${TMDB_IMG}${path}`;
}

/**
 * Build a wide backdrop URL (1280px).
 */
export function backdropUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${TMDB_IMG_WIDE}${path}`;
}

/**
 * Build a small logo URL (92px — used for streaming providers).
 */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${TMDB_IMG_SMALL}${path}`;
}

/**
 * ISO date string for today ± offsetDays.
 */
export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
