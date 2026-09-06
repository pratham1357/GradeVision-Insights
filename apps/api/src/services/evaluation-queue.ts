/**
 * Producer side of the evaluation queue.
 *
 * Enqueueing is best-effort: when Redis is not configured (or is momentarily
 * unreachable) this is a no-op and the evaluator's PostgreSQL polling picks the
 * submission up instead. `submitCode` must never block or fail on this.
 */
import { createEvaluationQueue, type EvaluationQueue } from "@gradevision/queue";

import { env } from "../env.js";
import { logger } from "../utils/logger.js";

let queue: EvaluationQueue | null | undefined;

function getQueue(): EvaluationQueue | null {
  if (queue === undefined) {
    queue = createEvaluationQueue(env.REDIS_URL);
    if (queue) {
      queue.on("error", (error) => logger.warn("evaluation queue error", { error: error.message }));
      logger.info("evaluation queue enabled");
    }
  }
  return queue;
}

export async function enqueueEvaluation(submissionId: string): Promise<void> {
  const q = getQueue();
  if (!q) return;
  try {
    await q.add("evaluate", { submissionId }, { jobId: submissionId });
  } catch (error) {
    // The poller is the safety net - log and move on.
    logger.warn("failed to enqueue submission for evaluation", {
      submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** For graceful shutdown / tests. */
export async function closeEvaluationQueue(): Promise<void> {
  if (queue) await queue.close();
  queue = undefined;
}
