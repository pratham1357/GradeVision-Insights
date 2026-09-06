import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { env } from "./env.js";
import { GeminiProvider } from "./gemini.js";
import { logger } from "./logger.js";
import { hintRequestSchema, UnconfiguredProvider, type LLMProvider } from "./provider.js";

export function createProvider(): LLMProvider {
  if (env.provider === "gemini") {
    const gemini = new GeminiProvider();
    if (gemini.isConfigured()) return gemini;
  }
  return new UnconfiguredProvider();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  if (!env.internalToken) return true;
  return req.headers.authorization === `Bearer ${env.internalToken}`;
}

/** The single request handler, exported so tests can drive it with a fake provider. */
export function createRequestListener(provider: LLMProvider) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, {
        service: "hint-engine",
        status: "ok",
        timestamp: new Date().toISOString(),
        provider: { name: provider.name, configured: provider.isConfigured() },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/hints") {
      if (!authorized(req)) {
        send(res, 401, { error: { code: "UNAUTHORIZED", message: "Missing or invalid token" } });
        return;
      }
      if (!provider.isConfigured()) {
        // Clear configuration error - never a fabricated hint.
        send(res, 503, {
          error: {
            code: "PROVIDER_NOT_CONFIGURED",
            message: "No AI hint provider is configured on this server",
          },
        });
        return;
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse((await readBody(req)) || "{}");
      } catch {
        send(res, 400, { error: { code: "BAD_JSON", message: "Request body is not valid JSON" } });
        return;
      }

      const result = hintRequestSchema.safeParse(parsedBody);
      if (!result.success) {
        send(res, 400, {
          error: { code: "VALIDATION_ERROR", message: "Invalid hint request" },
        });
        return;
      }

      try {
        const hint = await provider.generateHint(result.data);
        send(res, 200, { data: { hint } });
      } catch (error) {
        // Provider details stay server-side.
        logger.warn("hint generation failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        send(res, 502, {
          error: { code: "PROVIDER_ERROR", message: "The AI hint provider could not be reached" },
        });
      }
      return;
    }

    send(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
  };
}

export function createHintEngineServer(provider: LLMProvider = createProvider()): Server {
  return createServer((req, res) => {
    void createRequestListener(provider)(req, res);
  });
}
