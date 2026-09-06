import "dotenv/config";
import { z } from "zod";

/**
 * Validated configuration for the evaluator. The one place `process.env` is read.
 * Judge0 and Redis are BOTH optional: without Judge0 the evaluator marks runs
 * FAILED with a clear reason; without Redis it polls PostgreSQL instead of BullMQ.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  EVALUATOR_PORT: z.coerce.number().int().positive().max(65535).default(4100),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().optional(),

  JUDGE0_URL: z.string().optional(),
  JUDGE0_TOKEN: z.string().optional(),
  // Judge0 CE language ids. Defaults target the common CE image.
  JUDGE0_LANG_C: z.coerce.number().int().positive().default(50),
  JUDGE0_LANG_CPP: z.coerce.number().int().positive().default(54),
  JUDGE0_LANG_JAVA: z.coerce.number().int().positive().default(62),
  JUDGE0_LANG_PYTHON: z.coerce.number().int().positive().default(71),
  JUDGE0_LANG_JAVASCRIPT: z.coerce.number().int().positive().default(63),

  EVALUATOR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  EVALUATOR_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  // Path to `python3` for the AST analyzer. Empty disables Python semantic analysis.
  PYTHON_BIN: z.string().default("python3"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Invalid evaluator configuration:\n" +
      JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
  );
  process.exit(1);
}

const raw = parsed.data;

export const env = Object.freeze({
  NODE_ENV: raw.NODE_ENV,
  isTest: raw.NODE_ENV === "test",
  port: raw.EVALUATOR_PORT,
  databaseUrl: raw.DATABASE_URL,
  redisUrl: raw.REDIS_URL ?? null,
  judge0: raw.JUDGE0_URL
    ? {
        url: raw.JUDGE0_URL.replace(/\/+$/u, ""),
        token: raw.JUDGE0_TOKEN ?? null,
        languageIds: {
          C: raw.JUDGE0_LANG_C,
          CPP: raw.JUDGE0_LANG_CPP,
          JAVA: raw.JUDGE0_LANG_JAVA,
          PYTHON: raw.JUDGE0_LANG_PYTHON,
          JAVASCRIPT: raw.JUDGE0_LANG_JAVASCRIPT,
        },
      }
    : null,
  pollIntervalMs: raw.EVALUATOR_POLL_INTERVAL_MS,
  concurrency: raw.EVALUATOR_CONCURRENCY,
  pythonBin: raw.PYTHON_BIN.trim() || null,
});

export type EvaluatorEnv = typeof env;
