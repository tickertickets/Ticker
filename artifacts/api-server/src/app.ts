import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { rateLimit } from "express-rate-limit";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";
import { config } from "./config";

const PgSession = connectPgSimple(session);

// Ensure the session table exists without relying on connect-pg-simple's table.sql
// (which is not accessible after esbuild bundling). The SQL matches the expected schema.
async function ensureSessionTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      ) WITH (OIDS=FALSE);
      CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");
    `);
  } catch (err) {
    logger.warn({ err }, "Session table setup warning (non-fatal)");
  }
}

// Fix: drizzle-kit push (without --force) may have renamed user_sessions → ticket_tag_ratings
// during a non-interactive Render deploy. This ensures ticket_tag_ratings has the correct schema.
async function ensureTicketTagRatingsTable(): Promise<void> {
  try {
    // Check if ticket_tag_ratings has the wrong schema (session columns from the rename)
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ticket_tag_ratings' AND column_name = 'sid'
    `);
    if (rows.length > 0) {
      logger.warn("ticket_tag_ratings has wrong schema (session columns) — dropping and recreating");
      await pool.query(`DROP TABLE IF EXISTS "ticket_tag_ratings" CASCADE`);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "ticket_tag_ratings" (
        "ticket_id" text NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "rating" numeric(3,1) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ticket_tag_ratings_ticket_user_uniq" UNIQUE ("ticket_id", "user_id")
      );
    `);
  } catch (err) {
    logger.warn({ err }, "ticket_tag_ratings setup warning (non-fatal)");
  }
}

// Fix: drizzle-kit push may have renamed user_sessions → badge_xp_log
// during a deploy when it couldn't match the new table to an existing one.
// This detects the wrong schema and recreates badge_xp_log correctly.
async function ensureBadgeXpLogTable(): Promise<void> {
  try {
    // Check if badge_xp_log has wrong schema (session columns: sid, sess, expire)
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'badge_xp_log' AND column_name = 'sid'
    `);
    if (rows.length > 0) {
      logger.warn("badge_xp_log has wrong schema (session columns from rename) — dropping and recreating");
      await pool.query(`DROP TABLE IF EXISTS "badge_xp_log" CASCADE`);
    }
    // Ensure badge_xp_action enum exists (drizzle push creates it, but just in case)
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "badge_xp_action" AS ENUM (
          'post_ticket','post_reel','receive_like','receive_comment',
          'tag_friend','get_tagged','daily_login','follow_user',
          'get_followed','post_chain','complete_chain','join_party'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "badge_xp_log" (
        "id" text NOT NULL PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "action" "badge_xp_action" NOT NULL,
        "xp_awarded" integer NOT NULL,
        "source_id" text NOT NULL,
        "source_user_id" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "badge_xp_log_source_unique_idx" UNIQUE ("user_id", "action", "source_id")
      );
      CREATE INDEX IF NOT EXISTS "badge_xp_log_user_id_idx" ON "badge_xp_log" ("user_id");
      CREATE INDEX IF NOT EXISTS "badge_xp_log_user_action_date_idx" ON "badge_xp_log" ("user_id", "action", "created_at");
    `);
  } catch (err) {
    logger.warn({ err }, "badge_xp_log setup warning (non-fatal)");
  }
}

// Fix: chain_movies may be missing columns added after the initial deploy
// (added_by_user_id, tmdb_snapshot, memory_note). Without these columns,
// INSERT on chain creation fails with "column does not exist".
async function ensureChainMoviesColumns(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE "chain_movies"
        ADD COLUMN IF NOT EXISTS "added_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "tmdb_snapshot" text,
        ADD COLUMN IF NOT EXISTS "memory_note" text;
    `);
  } catch (err) {
    logger.warn({ err }, "chain_movies column migration warning (non-fatal)");
  }
}

// Fix: user_badge table may not have been created by drizzle-kit if the deploy
// had ambiguous rename detection. Creates the table and required enum if missing.
async function ensureUserBadgeTable(): Promise<void> {
  try {
    // Ensure badge_xp_action enum has the correct values (matches badge.service.ts)
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "badge_xp_action" AS ENUM (
          'post_ticket', 'post_chain', 'tag_friend', 'party_accept'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user_badge" (
        "user_id" text NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "level" integer NOT NULL DEFAULT 0,
        "xp_current" integer NOT NULL DEFAULT 0,
        "xp_from_posts" integer NOT NULL DEFAULT 0,
        "xp_from_tags" integer NOT NULL DEFAULT 0,
        "xp_from_party" integer NOT NULL DEFAULT 0,
        "badge_hidden" boolean NOT NULL DEFAULT false,
        "display_level" integer,
        "claimed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  } catch (err) {
    logger.warn({ err }, "user_badge table setup warning (non-fatal)");
  }
}

// Fix: is_supporter_approved column may not exist on Render if the schema was
// updated after the initial deploy. Also migrates legacy level=5 rows.
async function ensureSupporterApprovedColumn(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE "user_badge"
        ADD COLUMN IF NOT EXISTS "is_supporter_approved" boolean NOT NULL DEFAULT false;
    `);
    // Migrate legacy rows: anyone with level=5 from old approve logic
    // → set is_supporter_approved=true and reset level to 1 (minimum earned)
    await pool.query(`
      UPDATE "user_badge"
        SET "is_supporter_approved" = true,
            "level" = GREATEST(1, CASE WHEN "level" = 5 THEN 1 ELSE "level" END),
            "claimed_at" = COALESCE("claimed_at", now())
        WHERE "level" = 5 AND "is_supporter_approved" = false;
    `);
  } catch (err) {
    logger.warn({ err }, "is_supporter_approved column migration warning (non-fatal)");
  }
}

// Fix: supporter_requests table and its enum may not exist on Render if
// drizzle-kit push was never run in production. Create them idempotently.
async function ensureSupporterRequestsTable(): Promise<void> {
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "supporter_request_status" AS ENUM ('pending', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "supporter_requests" (
        "id" text NOT NULL PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "slip_image_path" text,
        "status" "supporter_request_status" NOT NULL DEFAULT 'pending',
        "admin_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "reviewed_at" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "supporter_requests_user_id_idx" ON "supporter_requests" ("user_id");
      CREATE INDEX IF NOT EXISTS "supporter_requests_status_idx" ON "supporter_requests" ("status");
    `);
  } catch (err) {
    logger.warn({ err }, "supporter_requests table setup warning (non-fatal)");
  }
}

export { ensureSessionTable, ensureTicketTagRatingsTable, ensureBadgeXpLogTable, ensureChainMoviesColumns, ensureUserBadgeTable, ensureSupporterRequestsTable, ensureSupporterApprovedColumn };

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  }),
);

app.use(compression());

app.use(cors(config.cors));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false,
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: config.session.name,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? "none" : "lax",
      maxAge: config.session.maxAgeMs,
    },
  }),
);

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true }));

// ── Global request timeout — ป้องกัน request ค้างนานเกิน 30 วิ ──────────────
app.use((_req, res, next) => {
  res.setTimeout(30_000, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "timeout", message: "Request timed out" });
    }
  });
  next();
});

// ── Global rate limiter — ป้องกัน flooding ทุก endpoint ──────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
  skip: (req) => req.path === "/healthz",
});

app.use("/api", globalLimiter);
app.use("/api", router);

app.use(errorHandler);

export default app;
