/**
 * @gradevision/queue
 *
 * Shared BullMQ wiring for asynchronous submission evaluation.
 *
 * The queue is an *accelerator*, not a hard dependency: when `REDIS_URL` is not
 * configured the factory functions return `null` and the evaluator falls back to
 * polling PostgreSQL for `QUEUED` submissions. Either way the API stays
 * non-blocking - `submitCode` writes the row and returns.
 */
import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from "bullmq";

export const EVALUATION_QUEUE_NAME = "submission-evaluation";

export interface EvaluationJobData {
  submissionId: string;
}

export type EvaluationQueue = Queue<EvaluationJobData>;
export type EvaluationWorker = Worker<EvaluationJobData>;
export type EvaluationJob = Job<EvaluationJobData>;

function parseConnection(redisUrl: string | undefined | null): ConnectionOptions | null {
  if (!redisUrl) return null;
  try {
    const url = new URL(redisUrl);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") return null;
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === "rediss:" ? {} : undefined,
      // BullMQ requires this for blocking commands.
      maxRetriesPerRequest: null,
    };
  } catch {
    return null;
  }
}

export function isQueueEnabled(redisUrl: string | undefined | null): boolean {
  return parseConnection(redisUrl) !== null;
}

/** Producer side (API). Returns `null` when Redis is not configured. */
export function createEvaluationQueue(redisUrl: string | undefined | null): EvaluationQueue | null {
  const connection = parseConnection(redisUrl);
  if (!connection) return null;
  return new Queue<EvaluationJobData>(EVALUATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
}

/** Consumer side (evaluator). Returns `null` when Redis is not configured. */
export function createEvaluationWorker(
  redisUrl: string | undefined | null,
  processor: Processor<EvaluationJobData>,
  options: { concurrency?: number } = {},
): EvaluationWorker | null {
  const connection = parseConnection(redisUrl);
  if (!connection) return null;
  return new Worker<EvaluationJobData>(EVALUATION_QUEUE_NAME, processor, {
    connection,
    concurrency: options.concurrency ?? 2,
  });
}
