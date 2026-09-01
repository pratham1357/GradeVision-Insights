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
  // as a fallback for generic hosting platforms.
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65535).optional(),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
  API_CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => URL.canParse(value), "DATABASE_URL must be a valid connection URL"),

  // Authentication (first-stage access tokens; no refresh tokens yet).
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().min(1).default("15m"),
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

export const env = Object.freeze({
  NODE_ENV: nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  isTest: nodeEnv === "test",

  HOST: raw.API_HOST,
  PORT: raw.API_PORT ?? raw.PORT ?? 4000,

  /** Allowed CORS origins. A single `*` entry means "reflect any origin". */
  CORS_ORIGINS: raw.API_CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  DATABASE_URL: raw.DATABASE_URL,

  JWT_SECRET: raw.JWT_SECRET,
  JWT_EXPIRES_IN: raw.JWT_EXPIRES_IN,
});

export type Env = typeof env;
