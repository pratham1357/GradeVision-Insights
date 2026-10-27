import "dotenv/config";
import { z } from "zod";

/**
 * Validated configuration for the hint-engine. The one place `process.env` is
 * read. The LLM provider is entirely env-driven (`LLM_PROVIDER`). When the
 * selected provider is unconfigured the service still serves `/health` and
 * returns a clear 503 for dynamic hint requests.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HINT_ENGINE_PORT: z.coerce.number().int().positive().max(65535).default(4200),
  // Loopback by default: only the API (same host) ever calls this service.
  HINT_ENGINE_HOST: z.string().min(1).default("127.0.0.1"),

  // Shared secret the API sends as a bearer on `POST /hints`. Required outside
  // tests (checked below) so no other local process or LAN peer can drive the LLM.
  INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),

  // Exactly one provider is used - the one named here. There is no fallback
  // between providers: an unavailable provider means a clear 503/502, never a
  // silent switch to a cloud model. `ollama` keeps inference on this machine.
  LLM_PROVIDER: z.enum(["ollama", "gemini", "none"]).default("ollama"),

  // Local Ollama. Must be a loopback URL (checked below): the model server is
  // never reached over the network and never exposed beyond this host.
  OLLAMA_BASE_URL: z.string().min(1).default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:1.5b-instruct"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().max(170_000).default(60_000),
  // How long Ollama keeps the model loaded after a request (Ollama duration syntax).
  OLLAMA_KEEP_ALIVE: z.string().min(1).default("30m"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(512).max(8_192).default(2_048),

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

if (raw.NODE_ENV !== "test" && !raw.INTERNAL_SERVICE_TOKEN) {
  console.error(
    "Invalid hint-engine configuration:\n" +
      "INTERNAL_SERVICE_TOKEN is required (>= 32 chars) and must match the API's value.\n" +
      "Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
  process.exit(1);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname)
  );
}

/**
 * Ollama can proxy "cloud" model tags (e.g. `gpt-oss:120b-cloud`) to a hosted
 * service. Those would turn the local provider into a silent cloud call.
 */
export function isCloudModelTag(model: string): boolean {
  return /(^|[:\-_/])cloud$/iu.test(model.trim());
}

if (raw.LLM_PROVIDER === "ollama" && isCloudModelTag(raw.OLLAMA_MODEL)) {
  console.error(
    "Invalid hint-engine configuration:\n" +
      "OLLAMA_MODEL names an Ollama cloud model; only locally pulled models are allowed.",
  );
  process.exit(1);
}

if (raw.LLM_PROVIDER === "ollama" && !isLoopbackUrl(raw.OLLAMA_BASE_URL)) {
  console.error(
    "Invalid hint-engine configuration:\n" +
      "OLLAMA_BASE_URL must point at this machine (127.0.0.1 / localhost / ::1).",
  );
  process.exit(1);
}

export const env = Object.freeze({
  NODE_ENV: raw.NODE_ENV,
  isTest: raw.NODE_ENV === "test",
  port: raw.HINT_ENGINE_PORT,
  host: raw.HINT_ENGINE_HOST,
  internalToken: raw.INTERNAL_SERVICE_TOKEN ?? null,
  provider: raw.LLM_PROVIDER,
  ollama: Object.freeze({
    baseUrl: raw.OLLAMA_BASE_URL.replace(/\/+$/u, ""),
    model: raw.OLLAMA_MODEL,
    timeoutMs: raw.OLLAMA_TIMEOUT_MS,
    keepAlive: raw.OLLAMA_KEEP_ALIVE,
    numCtx: raw.OLLAMA_NUM_CTX,
  }),
  gemini: Object.freeze({
    apiKey: raw.GEMINI_API_KEY ?? null,
    model: raw.GEMINI_MODEL,
    baseUrl: raw.GEMINI_BASE_URL.replace(/\/+$/u, ""),
    timeoutMs: raw.GEMINI_TIMEOUT_MS,
  }),
});

export type HintEngineEnv = typeof env;
