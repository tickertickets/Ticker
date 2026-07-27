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
 *
 * Retries transient failures (network errors, timeouts, 429, 5xx) a couple of
 * times with a short backoff before giving up. Without this, a single blip
 * (TMDB rate limit burst, brief timeout) used to surface all the way up as an
 * empty movie list to users — and for cached endpoints, get baked into the
 * cache for hours. Non-transient client errors (4xx other than 429) fail fast
 * since retrying them can't help.
 */
export async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
    } catch (cause) {
      lastErr = new ExternalApiError(`TMDB request failed: ${path}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw lastErr;
    }

    if (!resp.ok) {
      const transient = resp.status === 429 || resp.status >= 500;
      lastErr = new ExternalApiError(`TMDB returned ${resp.status} for ${path}`);
      if (transient && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw lastErr;
    }

    return resp.json() as Promise<T>;
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
