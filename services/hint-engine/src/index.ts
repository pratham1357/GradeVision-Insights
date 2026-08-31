import { createServer } from "node:http";

import { healthStatus } from "@gradevision/shared";

const SERVICE_NAME = "hint-engine";
const port = Number(process.env.HINT_ENGINE_PORT ?? 4200);

// Scaffold entry point. LLM provider abstraction is added in later tasks.
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(healthStatus(SERVICE_NAME)));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, () => {
  console.log(`[${SERVICE_NAME}] listening on http://0.0.0.0:${port}`);
});

function shutdown(signal: string): void {
  console.log(`[${SERVICE_NAME}] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
