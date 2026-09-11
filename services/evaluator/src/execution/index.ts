import type { ExecutionProvider } from "@gradevision/grading";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { GeminiExecutionProvider } from "./gemini.js";
import { Judge0Provider, UnconfiguredExecutionProvider } from "./judge0.js";
import { LocalExecutionProvider } from "./local.js";

/**
 * Provider selection, in priority order:
 *  1. Judge0, when `JUDGE0_URL` is configured - the intended real sandbox.
 *  2. Local child-process execution, when `LOCAL_EXECUTION_ENABLED` is on and at
 *     least one language toolchain is configured - real execution, demo-grade
 *     isolation. Explicitly opt-in; never the default.
 *  3. The TEMPORARY Gemini execution-analysis fallback, when Judge0 is absent,
 *     `GEMINI_EXECUTION_FALLBACK_ENABLED` is on, and `GEMINI_API_KEY` is set.
 *  4. Otherwise the unconfigured provider - preserving the existing
 *     EXECUTION_UNAVAILABLE / FAILED-run behaviour.
 */
export function createExecutionProvider(): ExecutionProvider {
  if (env.judge0) {
    logger.info("Execution provider: Judge0", { url: env.judge0.url });
    return new Judge0Provider(env.judge0);
  }

  if (env.localExecution) {
    const local = new LocalExecutionProvider(env.localExecution);
    if (local.isConfigured()) {
      logger.warn(
        "Execution provider: local child processes (no sandbox isolation) - for local development/demo only",
        { languages: local.enabledLanguages() },
      );
      return local;
    }
    logger.warn(
      "LOCAL_EXECUTION_ENABLED is set but no language toolchain is configured - falling through",
    );
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
