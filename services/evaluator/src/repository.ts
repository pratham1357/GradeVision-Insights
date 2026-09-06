import { Prisma, prisma } from "@gradevision/database";
import type {
  CriterionScoreResult,
  ExecutionResult,
  SemanticAnalysis,
  TestOutcome,
} from "@gradevision/grading";

const RUN_NUMBER = 1;

/** Serialises any value into JSON Prisma will accept for a `Json` column. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

const submissionBundleArgs = {
  include: {
    question: {
      include: {
        testCases: {
          where: { isActive: true },
          orderBy: { position: "asc" },
        },
        rubric: { include: { criteria: { orderBy: { position: "asc" } } } },
      },
    },
  },
} satisfies Prisma.SubmissionDefaultArgs;

export type SubmissionBundle = Prisma.SubmissionGetPayload<typeof submissionBundleArgs>;

/** Newly QUEUED submission ids (oldest first), for the polling fallback. */
export function listQueuedSubmissionIds(limit: number): Promise<{ id: string }[]> {
  return prisma.submission.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

/**
 * Atomically claims a submission for evaluation: `QUEUED -> RUNNING` plus a
 * RUNNING `EvaluationRun`. Returns the bundle only to the caller that won the
 * race; a second worker (or a retry of a finished submission) gets `null`.
 */
export async function claimSubmission(
  submissionId: string,
): Promise<{ bundle: SubmissionBundle; runId: string } | null> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.submission.updateMany({
      where: { id: submissionId, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
    if (claimed.count === 0) return null;

    const bundle = await tx.submission.findUniqueOrThrow({
      where: { id: submissionId },
      ...submissionBundleArgs,
    });

    const run = await tx.evaluationRun.upsert({
      where: { submissionId_runNumber: { submissionId, runNumber: RUN_NUMBER } },
      create: { submissionId, runNumber: RUN_NUMBER, status: "RUNNING", startedAt: new Date() },
      update: {
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
        errorType: null,
        errorMessage: null,
      },
    });
    return { bundle, runId: run.id };
  });
}

export function getEvaluationState(submissionId: string) {
  return prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      status: true,
      evaluationRuns: {
        where: { runNumber: RUN_NUMBER },
        select: { id: true, status: true, totalScore: true, maxScore: true },
      },
    },
  });
}

export interface PersistCompletedInput {
  runId: string;
  submissionId: string;
  outcomes: TestOutcome[];
  criterionScores: CriterionScoreResult[];
  totalScore: number;
  maxScore: number;
  execution: ExecutionResult;
  semantic: SemanticAnalysis;
  timing: { totalTimeMs: number | null; peakMemoryKb: number | null };
  scorePercent: number;
}

const OUTCOME_TO_RESULT_STATUS: Record<
  TestOutcome["status"],
  Prisma.TestCaseResultCreateManyInput["status"]
> = {
  PASSED: "PASSED",
  FAILED: "FAILED",
  ERROR: "ERROR",
  TIMEOUT: "TIMEOUT",
  SKIPPED: "SKIPPED",
};

export async function persistCompletedEvaluation(input: PersistCompletedInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const outcome of input.outcomes) {
      const data = {
        status: OUTCOME_TO_RESULT_STATUS[outcome.status],
        pointsAwarded: outcome.passed ? Math.max(0, outcome.weight) : 0,
        pointsPossible: Math.max(0, outcome.weight),
        executionTimeMs: outcome.timeMs,
        memoryKb: outcome.memoryKb,
        stdout: outcome.stdout.slice(0, 20_000),
        stderr: outcome.stderr.slice(0, 20_000),
        detail: toJson({ visibility: outcome.visibility }),
      };
      await tx.testCaseResult.upsert({
        where: {
          evaluationRunId_testCaseId: {
            evaluationRunId: input.runId,
            testCaseId: outcome.caseId,
          },
        },
        create: { evaluationRunId: input.runId, testCaseId: outcome.caseId, ...data },
        update: data,
      });
    }

    for (const score of input.criterionScores) {
      if (score.criterionId === "implicit-functional") continue;
      const data = {
        pointsAwarded: score.pointsAwarded,
        maxPoints: score.maxPoints,
        notes: score.summary,
        detail: toJson({ type: score.type, reasons: score.reasons }),
      };
      await tx.criterionScore.upsert({
        where: {
          evaluationRunId_rubricCriterionId: {
            evaluationRunId: input.runId,
            rubricCriterionId: score.criterionId,
          },
        },
        create: {
          evaluationRunId: input.runId,
          rubricCriterionId: score.criterionId,
          ...data,
        },
        update: data,
      });
    }

    await tx.evaluationRun.update({
      where: { id: input.runId },
      data: {
        status: "COMPLETED",
        totalScore: input.totalScore,
        maxScore: input.maxScore,
        executionTimeMs: input.timing.totalTimeMs,
        memoryKb: input.timing.peakMemoryKb,
        runtimeInfo: input.execution.runtimeInfo,
        errorType: null,
        errorMessage: null,
        providerMetadata: toJson({
          provider: input.execution.provider,
          meta: input.execution.meta,
          scorePercent: input.scorePercent,
          semantic: {
            analyzer: input.semantic.analyzer,
            available: input.semantic.available,
            error: input.semantic.error,
            metrics: input.semantic.metrics,
            findings: input.semantic.findings,
          },
        }),
        completedAt: new Date(),
      },
    });

    await tx.submission.update({
      where: { id: input.submissionId },
      data: { status: "COMPLETED" },
    });
  });
}

export async function persistFailedEvaluation(input: {
  runId: string;
  submissionId: string;
  errorType: string;
  errorMessage: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.evaluationRun.update({
      where: { id: input.runId },
      data: {
        status: "FAILED",
        errorType: input.errorType,
        errorMessage: input.errorMessage.slice(0, 2_000),
        completedAt: new Date(),
      },
    }),
    prisma.submission.update({
      where: { id: input.submissionId },
      data: { status: "FAILED" },
    }),
  ]);
}
