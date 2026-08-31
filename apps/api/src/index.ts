import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();

const server = app.listen(env.port, env.host, () => {
  console.log(`[api] listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
});

function shutdown(signal: string): void {
  console.log(`[api] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
