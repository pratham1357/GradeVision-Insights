import "dotenv/config";
import { z } from "zod";

/**
 * The single validated source of environment configuration for the API.
 *
 * Nothing else in the codebase should read `process.env` directly - import `env`
 * from here instead. Parsing fails fast on startup with a readable message.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // The repo established API_HOST / API_PORT / API_CORS_ORIGIN; PORT is accepted
  // as a fallback for generic hosting platforms. Loopback by default; a hosted
  // deployment sets it explicitly (behind TLS termination).
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().max(65535).optional(),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
  API_CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => URL.canParse(value), "DATABASE_URL must be a valid connection URL"),

  // Server-side sessions (HttpOnly cookie, opaque id). SESSION_SECRET keys the
  // CSRF tokens; JWT_SECRET is accepted as the legacy name for the same value.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(7 * 24)
    .default(12),
  // Default: Secure cookies in production (HTTPS), plain on http://localhost.
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  SESSION_COOKIE_SAMESITE: z.enum(["strict", "lax"]).default("strict"),
  // `token` login mode (opaque session token in the response body, for scripts
  // and API clients). Off by default in production.
  AUTH_TOKEN_LOGIN: z.enum(["true", "false"]).optional(),
  // Email + password sign-in. Kept for local/dev use; a production deployment
  // with an identity provider turns it off.
  PASSWORD_LOGIN_ENABLED: z.enum(["true", "false"]).default("true"),

  // Optional Redis; when set, submissions are enqueued for the evaluator instead
  // of relying on its PostgreSQL polling fallback. The API never blocks on it.
  REDIS_URL: z.string().min(1).optional(),

  // Backend-only AI hint provider (the hint-engine service). Never called from
  // the browser; the API proxies interactive hint requests to it.
  HINT_ENGINE_URL: z.string().min(1).default("http://127.0.0.1:4200"),
  // Upper bound for one interactive hint round trip. A CPU-only local model
  // needs more than a hosted one; the hint-engine's own provider timeout is shorter.
  HINT_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().max(180_000).default(20_000),

  // Shared secret sent as a bearer token on API -> internal service calls. The
  // hint-engine refuses to start without one, so interactive hints need it here too.
  INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Reported directly (the logger depends on this module).
  console.error(
    "Invalid API environment configuration:\n" +
      JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
  );
  process.exit(1);
}

const raw = parsed.data;
const nodeEnv = raw.NODE_ENV;

const sessionSecret = raw.SESSION_SECRET ?? raw.JWT_SECRET;
if (!sessionSecret) {
  console.error("Invalid API environment configuration: SESSION_SECRET (>= 32 chars) is required");
  process.exit(1);
}

const corsOrigins = raw.API_CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// Credentialed CORS: every origin must be an exact http(s) origin - never "*".
const badOrigin = corsOrigins.find((origin) => {
  if (!URL.canParse(origin)) return true;
  const url = new URL(origin);
  return (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin;
});
if (badOrigin !== undefined || corsOrigins.length === 0) {
  console.error(
    `Invalid API environment configuration: API_CORS_ORIGIN must list exact origins like https://app.example.com (got '${badOrigin ?? ""}')`,
  );
  process.exit(1);
}

export const env = Object.freeze({
  NODE_ENV: nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  isTest: nodeEnv === "test",

  HOST: raw.API_HOST,
  PORT: raw.API_PORT ?? raw.PORT ?? 4000,

  /** Exact allowed browser origins (credentialed CORS + CSRF origin check). */
  CORS_ORIGINS: corsOrigins,

  DATABASE_URL: raw.DATABASE_URL,

  SESSION_SECRET: sessionSecret,
  SESSION_IDLE_MS: raw.SESSION_IDLE_MINUTES * 60_000,
  SESSION_ABSOLUTE_MS: raw.SESSION_ABSOLUTE_HOURS * 3_600_000,
  SESSION_COOKIE_SECURE:
    (raw.SESSION_COOKIE_SECURE ?? (nodeEnv === "production" ? "true" : "false")) === "true",
  SESSION_COOKIE_SAMESITE: raw.SESSION_COOKIE_SAMESITE,
  AUTH_TOKEN_LOGIN:
    (raw.AUTH_TOKEN_LOGIN ?? (nodeEnv === "production" ? "false" : "true")) === "true",
  PASSWORD_LOGIN_ENABLED: raw.PASSWORD_LOGIN_ENABLED === "true",

  REDIS_URL: raw.REDIS_URL ?? null,
  HINT_ENGINE_URL: raw.HINT_ENGINE_URL.replace(/\/+$/, ""),
  HINT_ENGINE_TIMEOUT_MS: raw.HINT_ENGINE_TIMEOUT_MS,
  INTERNAL_SERVICE_TOKEN: raw.INTERNAL_SERVICE_TOKEN ?? null,
});

export type Env = typeof env;
