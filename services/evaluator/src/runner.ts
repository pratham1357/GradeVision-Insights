import { createEvaluationWorker, type EvaluationWorker } from "@gradevision/queue";

import { env } from "./env.js";
import { evaluateSubmission, type EvaluateDeps } from "./evaluate.js";
import { logger } from "./logger.js";
import { listQueuedSubmissionIds } from "./repository.js";

/**
 * Two ways a submission reaches `evaluateSubmission`:
 *  - a BullMQ worker (when `REDIS_URL` is set) - immediate.
 *  - a Postgres poll loop - always on, as the safety net / no-Redis fallback.
 * Both funnel through the same idempotent claim, so double processing is a no-op.
 */
export class EvaluationRunner {
  private worker: EvaluationWorker | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;

  constructor(private readonly deps: EvaluateDeps) {}

  start(): void {
    this.worker = createEvaluationWorker(
      env.redisUrl,
      async (job) => {
        await evaluateSubmission(job.data.submissionId, this.deps);
      },
      { concurrency: env.concurrency },
    );
    if (this.worker) {
      this.worker.on("failed", (job, err) =>
        logger.error("evaluation job failed", {
          submissionId: job?.data.submissionId,
          error: err.message,
        }),
      );
      logger.info("BullMQ worker started");
    } else {
      logger.info("Redis not configured - using Postgres polling only");
    }

    this.pollTimer = setInterval(() => void this.pollOnce(), env.pollIntervalMs);
    void this.pollOnce();
  }

  private async pollOnce(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const queued = await listQueuedSubmissionIds(env.concurrency);
      for (const { id } of queued) {
        const outcome = await evaluateSubmission(id, this.deps);
        if (outcome.status !== "skipped") {
          logger.debug("poll processed submission", { submissionId: id, status: outcome.status });
        }
      }
    } catch (error) {
      logger.error("poll loop error", { error: (error as Error).message });
    } finally {
      this.polling = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.worker) await this.worker.close();
  }
}
