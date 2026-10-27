import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { env } from "./env.js";
import { GeminiProvider } from "./gemini.js";
import { logger } from "./logger.js";
import { OllamaProvider } from "./ollama.js";
import { hintRequestSchema, UnconfiguredProvider, type LLMProvider } from "./provider.js";
import { HINT_VALIDATOR_VERSION, validateHintOutput } from "./validate.js";

/**
 * Exactly the provider `LLM_PROVIDER` names. There is deliberately no fallback
 * chain: if the local model is down the hint request fails clearly instead of
 * quietly going to a cloud service.
 */
export function createProvider(): LLMProvider {
  switch (env.provider) {
    case "ollama":
      return new OllamaProvider();
    case "gemini": {
      const gemini = new GeminiProvider();
      return gemini.isConfigured() ? gemini : new UnconfiguredProvider();
    }
    default:
      return new UnconfiguredProvider();
  }
}

export const MAX_BODY_BYTES = 256_000;

class PayloadTooLargeError extends Error {}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit the rest is drained, not buffered, so the 413 reaches the caller.
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) reject(new PayloadTooLargeError());
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) return true; // only reachable in tests: env.ts requires a token otherwise
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface HintEngineOptions {
  /** Bearer the caller must present on `POST /hints`; defaults to INTERNAL_SERVICE_TOKEN. */
  internalToken?: string | null;
}

/** The single request handler, exported so tests can drive it with a fake provider. */
export function createRequestListener(provider: LLMProvider, options: HintEngineOptions = {}) {
  const token = options.internalToken === undefined ? env.internalToken : options.internalToken;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === "GET" && req.url === "/health") {
      const probe = provider instanceof OllamaProvider ? await provider.probe() : null;
      send(res, 200, {
        service: "hint-engine",
        status: "ok",
        timestamp: new Date().toISOString(),
        provider: {
          name: provider.name,
          model: provider.model,
          configured: provider.isConfigured(),
          ...(probe ? { reachable: probe.reachable, modelAvailable: probe.modelAvailable } : {}),
        },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/hints") {
      if (!authorized(req, token)) {
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
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          send(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request too large" } });
          return;
        }
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

      let generated: string;
      try {
        generated = await provider.generateHint(result.data);
      } catch (error) {
        // Provider details stay server-side.
        logger.warn("hint generation failed", {
          provider: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
        send(res, 502, {
          error: { code: "PROVIDER_ERROR", message: "The AI hint provider could not be reached" },
        });
        return;
      }

      const validation = validateHintOutput(generated);
      if (!validation.ok) {
        logger.warn("generated hint rejected", {
          provider: provider.name,
          model: provider.model,
          reason: validation.reason,
        });
        send(res, 502, {
          error: {
            code: "INVALID_OUTPUT",
            message: "The AI hint provider returned an unusable hint",
          },
        });
        return;
      }

      send(res, 200, {
        data: {
          hint: validation.text,
          provider: provider.name,
          model: provider.model,
          validator: HINT_VALIDATOR_VERSION,
        },
      });
      return;
    }

    send(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
  };
}

export function createHintEngineServer(
  provider: LLMProvider = createProvider(),
  options: HintEngineOptions = {},
): Server {
  const listener = createRequestListener(provider, options);
  return createServer((req, res) => {
    void listener(req, res);
  });
}
