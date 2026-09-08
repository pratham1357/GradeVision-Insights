import type { ExecutionProvider } from "@gradevision/grading";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { GeminiExecutionProvider } from "./gemini.js";
import { Judge0Provider, UnconfiguredExecutionProvider } from "./judge0.js";

/**
 * Provider selection, in priority order:
 *  1. Judge0, when `JUDGE0_URL` is configured - the intended real sandbox.
 *  2. The TEMPORARY Gemini execution-analysis fallback, when Judge0 is absent,
 *     `GEMINI_EXECUTION_FALLBACK_ENABLED` is on, and `GEMINI_API_KEY` is set.
 *  3. Otherwise the unconfigured provider - preserving the existing
 *     EXECUTION_UNAVAILABLE / FAILED-run behaviour.
 */
export function createExecutionProvider(): ExecutionProvider {
  if (env.judge0) {
    logger.info("Execution provider: Judge0", { url: env.judge0.url });
    return new Judge0Provider(env.judge0);
  }

  if (env.geminiExecution?.apiKey) {
    logger.warn(
      "Execution provider: temporary Gemini analysis fallback - Judge0 remains the intended sandbox; " +
        "set JUDGE0_URL and unset GEMINI_EXECUTION_FALLBACK_ENABLED to switch back",
    );
    return new GeminiExecutionProvider(env.geminiExecution);
  }

  if (env.geminiExecution && !env.geminiExecution.apiKey) {
    logger.warn(
      "GEMINI_EXECUTION_FALLBACK_ENABLED is set but GEMINI_API_KEY is missing - evaluation will fail until one is configured",
    );
  }

  logger.warn("No JUDGE0_URL configured - submissions will fail evaluation until it is set");
  return new UnconfiguredExecutionProvider();
}
