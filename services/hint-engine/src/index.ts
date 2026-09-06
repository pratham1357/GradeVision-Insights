import { createHintEngineServer, createProvider } from "./app.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const provider = createProvider();
const server = createHintEngineServer(provider);

server.listen(env.port, () => {
  logger.info(`hint-engine listening on http://0.0.0.0:${env.port}`, {
    env: env.NODE_ENV,
    provider: provider.name,
    configured: provider.isConfigured(),
  });
  if (!provider.isConfigured()) {
    logger.warn("no LLM provider configured - dynamic hint requests will return 503");
  }
});

function shutdown(signal: string): void {
  logger.info(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
