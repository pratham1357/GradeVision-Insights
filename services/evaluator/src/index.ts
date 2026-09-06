import { createServer } from "node:http";

import { prisma } from "@gradevision/database";
import { isQueueEnabled } from "@gradevision/queue";

import { env } from "./env.js";
import { createExecutionProvider } from "./execution/index.js";
import { logger } from "./logger.js";
import { EvaluationRunner } from "./runner.js";
import { createAnalyzerRegistry } from "./semantic/index.js";

const executionProvider = createExecutionProvider();
const analyzers = createAnalyzerRegistry();
const runner = new EvaluationRunner({ executionProvider, analyzers });

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        service: "evaluator",
        status: "ok",
        timestamp: new Date().toISOString(),
        execution: {
          provider: executionProvider.name,
          configured: executionProvider.isConfigured(),
        },
        queue: { redis: isQueueEnabled(env.redisUrl) },
        semantic: { python: env.pythonBin !== null },
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(env.port, () => {
  logger.info(`evaluator listening on http://0.0.0.0:${env.port}`, { env: env.NODE_ENV });
  runner.start();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, shutting down`);
  await runner.stop();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
