/**
 * Centralized configuration with strict environment variable validation.
 *
 * All env access should go through this module — never read process.env directly
 * in route/service code. This makes it easy to audit what the app needs to run
 * and prevents silent failures from missing variables in production.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

const isProduction = process.env.NODE_ENV === "production";

const sessionSecret = isProduction
  ? requireEnv("SESSION_SECRET")
  : optionalEnv("SESSION_SECRET", "ticker_dev_secret_do_not_use_in_production");

// In production, CORS_ORIGIN must be set explicitly — never default to wildcard.
const corsOrigin: string | boolean | RegExp = isProduction
  ? requireEnv("CORS_ORIGIN")
  : true;

export const config = {
  isProduction,
  port: Number(requireEnv("PORT")),

  database: {
    url: requireEnv("DATABASE_URL"),
  },

  session: {
    secret: sessionSecret,
    name: "ticker_session",
    maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },

  supabase: {
    url: optionalEnv("SUPABASE_URL", ""),
    anonKey: optionalEnv("SUPABASE_ANON_KEY", ""),
    serviceRoleKey: optionalEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
  },

  tmdb: {
    apiKey: optionalEnv("TMDB_API_KEY", ""),
    baseUrl: "https://api.themoviedb.org/3",
    imageBaseUrl: "https://image.tmdb.org/t/p",
  },

  cors: {
    origin: corsOrigin,
    credentials: true,
  },

  log: {
    level: optionalEnv("LOG_LEVEL", "info"),
  },
} as const;
