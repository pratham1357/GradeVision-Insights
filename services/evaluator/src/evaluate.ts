import type { ExecutionProvider, FunctionalCase, GradingLanguage } from "@gradevision/grading";
import { computeEvaluation, parseCriterionConfig, unavailableAnalysis } from "@gradevision/grading";

import { logger } from "./logger.js";
import {
  claimSubmission,
  getEvaluationState,
  persistCompletedEvaluation,
  persistFailedEvaluation,
  type SubmissionBundle,
} from "./repository.js";
import type { SemanticAnalysisService } from "./semantic/index.js";

export type EvaluationOutcome =
  | { status: "skipped"; reason: string }
  | { status: "failed"; errorType: string; errorMessage: string }
  | { status: "completed"; totalScore: number; maxScore: number; scorePercent: number };

export interface EvaluateDeps {
  executionProvider: ExecutionProvider;
  analyzers: SemanticAnalysisService;
}

function toFunctionalCases(bundle: SubmissionBundle): FunctionalCase[] {
  return bundle.question.testCases.map((tc) => ({
    caseId: tc.id,
    weight: Number(tc.weight),
    expectedOutput: tc.expectedOutput,
    visibility: tc.visibility,
  }));
}

/**
 * Evaluate one submission. Idempotent: only the caller that flips `QUEUED ->
 * RUNNING` does the work; anyone else (a retry, a second worker, a re-poll of a
 * finished submission) gets `{ status: "skipped" }`.
 */
export async function evaluateSubmission(
  submissionId: string,
  deps: EvaluateDeps,
): Promise<EvaluationOutcome> {
  const claim = await claimSubmission(submissionId);
  if (!claim) {
    const state = await getEvaluationState(submissionId);
    return { status: "skipped", reason: `submission is ${state?.status ?? "unknown"}` };
  }

  const { bundle, runId } = claim;
  const language = bundle.language as GradingLanguage;
  logger.info("evaluating submission", { submissionId, runId, language });

  if (bundle.question.testCases.length === 0) {
    await persistFailedEvaluation({
      runId,
      submissionId,
      errorType: "NO_TEST_CASES",
      errorMessage: "The question has no active test cases to evaluate against.",
    });
    return {
      status: "failed",
      errorType: "NO_TEST_CASES",
      errorMessage: "no active test cases",
    };
  }

  if (!deps.executionProvider.isConfigured()) {
    await persistFailedEvaluation({
      runId,
      submissionId,
      errorType: "EXECUTION_UNAVAILABLE",
      errorMessage: "Automated evaluation is not configured (no execution sandbox).",
    });
    return {
      status: "failed",
      errorType: "EXECUTION_UNAVAILABLE",
      errorMessage: "execution sandbox not configured",
    };
  }

  let execution;
  try {
    execution = await deps.executionProvider.execute({
      language,
      sourceCode: bundle.sourceCode,
      cases: bundle.question.testCases.map((tc) => ({
        id: tc.id,
        stdin: tc.input,
        expectedOutput: tc.expectedOutput,
      })),
      limits: {
        cpuTimeMs: bundle.question.timeLimitMs,
        memoryMb: bundle.question.memoryLimitMb,
      },
      // Optional context; Judge0 ignores it, an analysis-based provider may use it.
      problem: {
        title: bundle.question.title,
        statement: bundle.question.statement,
        constraints: bundle.question.constraints,
        inputFormat: bundle.question.inputFormat,
        outputFormat: bundle.question.outputFormat,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("execution provider failed", { submissionId, error: message });
    await persistFailedEvaluation({
      runId,
      submissionId,
      errorType: "EVALUATOR_ERROR",
      errorMessage: message,
    });
    return { status: "failed", errorType: "EVALUATOR_ERROR", errorMessage: message };
  }

  const semantic = await deps.analyzers
    .analyze(language, bundle.sourceCode)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("semantic analysis threw", { error: message });
      return unavailableAnalysis(language, `analyzer error: ${message}`);
    });

  const criteria = (bundle.question.rubric?.criteria ?? []).map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    maxPoints: Number(c.maxPoints),
    config: parseCriterionConfig(c.config),
  }));

  const computation = computeEvaluation({
    language,
    criteria,
    cases: toFunctionalCases(bundle),
    execution,
    semantic,
  });

  await persistCompletedEvaluation({
    runId,
    submissionId,
    outcomes: computation.functional.outcomes,
    criterionScores: computation.rubric.criterionScores,
    totalScore: computation.rubric.totalScore,
    maxScore: computation.rubric.maxScore,
    execution,
    semantic,
    timing: {
      totalTimeMs: computation.timing.totalTimeMs,
      peakMemoryKb: computation.timing.peakMemoryKb,
    },
    scorePercent: computation.scorePercent,
  });

  logger.info("submission evaluated", {
    submissionId,
    score: `${computation.rubric.totalScore}/${computation.rubric.maxScore}`,
  });

  return {
    status: "completed",
    totalScore: computation.rubric.totalScore,
    maxScore: computation.rubric.maxScore,
    scorePercent: computation.scorePercent,
  };
}
