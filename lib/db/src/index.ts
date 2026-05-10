import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // keepAlive prevents the OS/network from silently dropping idle TCP connections,
  // which would otherwise cause "stale connection" errors after long periods of inactivity.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// REQUIRED by pg: without this handler, idle-client errors become uncaught exceptions
// and crash the Node.js process. Log and continue instead.
pool.on("error", (err) => {
  console.error("[pg-pool] Unexpected error on idle client:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
