import { createServer } from "http";
import app, { ensureSessionTable, ensureTicketTagRatingsTable, ensureBadgeXpLogTable, ensureChainMoviesColumns, ensureUserBadgeTable, ensureSupporterRequestsTable, ensureSupporterApprovedColumn } from "./app";
import { initSocket } from "./lib/socket";
import { logger } from "./lib/logger";
import { scheduleCleanup } from "./jobs/cleanChatImages";
import { scheduleWarmMovieCache } from "./jobs/warmMovieCache";
import { scheduleTimedRecommendation } from "./jobs/timedRecommendation";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Global error guards — prevent a single unhandled error from crashing the process ──
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[process] Uncaught exception — continuing");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[process] Unhandled promise rejection — continuing");
});

await ensureSessionTable();
await ensureTicketTagRatingsTable();
await ensureBadgeXpLogTable();
await ensureChainMoviesColumns();
await ensureUserBadgeTable();
await ensureSupporterRequestsTable();
await ensureSupporterApprovedColumn();

scheduleCleanup();
scheduleWarmMovieCache();
scheduleTimedRecommendation();

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
