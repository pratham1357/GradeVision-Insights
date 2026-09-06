import "dotenv/config";
import { z } from "zod";

/**
 * Validated configuration for the hint-engine. The one place `process.env` is
 * read. The LLM provider is entirely env-driven: no keys or model names are
 * hard-coded anywhere. When `GEMINI_API_KEY` is absent the service still serves
 * `/health` and returns a clear 503 for dynamic hint requests.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HINT_ENGINE_PORT: z.coerce.number().int().positive().max(65535).default(4200),

  // Optional shared secret. When set, `POST /hints` requires a matching bearer.
  INTERNAL_SERVICE_TOKEN: z.string().min(1).optional(),

  // Provider selection is implicit: Gemini is used when a key is present.
  LLM_PROVIDER: z.enum(["gemini", "none"]).default("gemini"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.0-flash"),
  GEMINI_BASE_URL: z.string().min(1).default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Invalid hint-engine configuration:\n" +
      JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
  );
  process.exit(1);
}

const raw = parsed.data;

export const env = Object.freeze({
  NODE_ENV: raw.NODE_ENV,
  isTest: raw.NODE_ENV === "test",
  port: raw.HINT_ENGINE_PORT,
  internalToken: raw.INTERNAL_SERVICE_TOKEN ?? null,
  provider: raw.LLM_PROVIDER,
  gemini: Object.freeze({
    apiKey: raw.GEMINI_API_KEY ?? null,
    model: raw.GEMINI_MODEL,
    baseUrl: raw.GEMINI_BASE_URL.replace(/\/+$/u, ""),
    timeoutMs: raw.GEMINI_TIMEOUT_MS,
  }),
});

export type HintEngineEnv = typeof env;
