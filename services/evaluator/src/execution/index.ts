import type { ExecutionProvider } from "@gradevision/grading";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { Judge0Provider, UnconfiguredExecutionProvider } from "./judge0.js";

export function createExecutionProvider(): ExecutionProvider {
  if (env.judge0) {
    logger.info("Execution provider: Judge0", { url: env.judge0.url });
    return new Judge0Provider(env.judge0);
  }
  logger.warn("No JUDGE0_URL configured - submissions will fail evaluation until it is set");
  return new UnconfiguredExecutionProvider();
}
