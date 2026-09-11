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
  // Path to `python3` for the AST analyzer (and for local Python execution when
  // LOCAL_EXECUTION_ENABLED is on). Empty disables both.
  PYTHON_BIN: z.string().default("python3"),

  // Opt-in LOCAL execution: run student programs with toolchains on this host via
  // child processes (real execution, demo-grade isolation - see execution/local.ts).
  // Takes effect only while JUDGE0_URL is unset; wins over the Gemini fallback.
  // Never enable on a shared or production host. Default OFF.
  LOCAL_EXECUTION_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  // Wall-clock ceilings (ms) for the local provider: per case when the question
  // sets no time limit, and for the compile step of compiled languages.
  LOCAL_EXECUTION_DEFAULT_WALL_TIME_MS: z.coerce.number().int().positive().default(5_000),
  LOCAL_EXECUTION_COMPILE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Toolchain binaries for the local provider (names on PATH or absolute paths).
  // Python reuses PYTHON_BIN. Empty disables the languages that need the tool.
  LOCAL_NODE_BIN: z.string().default("node"),
  LOCAL_GCC_BIN: z.string().default("gcc"),
  LOCAL_GXX_BIN: z.string().default("g++"),
  LOCAL_JAVAC_BIN: z.string().default("javac"),
  LOCAL_JAVA_BIN: z.string().default("java"),

  // TEMPORARY demo/testing fallback. When Judge0 (JUDGE0_URL) is not configured
  // AND this is explicitly enabled AND GEMINI_API_KEY is present, the evaluator
  // uses a Gemini-backed execution-analysis provider instead of failing runs.
  // Judge0 remains the intended real sandbox; this is a config switch, not a
  // replacement. Default OFF. See docs/DEVELOPMENT.md.
  GEMINI_EXECUTION_FALLBACK_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.0-flash"),
  GEMINI_BASE_URL: z.string().min(1).default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
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
  // `null` unless local execution is explicitly enabled. Individual toolchains
  // may still be null (those languages disabled) - the provider checks per request.
  localExecution: raw.LOCAL_EXECUTION_ENABLED
    ? {
        bins: {
          python: raw.PYTHON_BIN.trim() || null,
          node: raw.LOCAL_NODE_BIN.trim() || null,
          gcc: raw.LOCAL_GCC_BIN.trim() || null,
          gxx: raw.LOCAL_GXX_BIN.trim() || null,
          javac: raw.LOCAL_JAVAC_BIN.trim() || null,
          java: raw.LOCAL_JAVA_BIN.trim() || null,
        },
        defaultWallTimeMs: raw.LOCAL_EXECUTION_DEFAULT_WALL_TIME_MS,
        compileTimeoutMs: raw.LOCAL_EXECUTION_COMPILE_TIMEOUT_MS,
      }
    : null,
  // `null` unless the temporary fallback is explicitly enabled. `apiKey` may
  // still be null here (enabled but unconfigured) - provider selection checks it.
  geminiExecution: raw.GEMINI_EXECUTION_FALLBACK_ENABLED
    ? {
        apiKey: raw.GEMINI_API_KEY,
        model: raw.GEMINI_MODEL,
        baseUrl: raw.GEMINI_BASE_URL.replace(/\/+$/u, ""),
        timeoutMs: raw.GEMINI_EXECUTION_TIMEOUT_MS,
      }
    : null,
});

export type EvaluatorEnv = typeof env;
