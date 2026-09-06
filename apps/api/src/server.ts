import { createApp } from "./app.js";
import { env } from "./env.js";
import { disconnectDatabase } from "./services/database.js";
import { closeEvaluationQueue } from "./services/evaluation-queue.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(`API listening on http://${env.HOST}:${env.PORT}`, { env: env.NODE_ENV });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  server.close(async (closeError) => {
    if (closeError) logger.error("Error while closing HTTP server", { error: closeError.message });
    await closeEvaluationQueue();
    await disconnectDatabase();
    process.exit(closeError ? 1 : 0);
  });

  // Don't hang forever if connections refuse to drain.
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
});
