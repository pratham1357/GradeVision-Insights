/**
 * Shared shaping of a persisted `EvaluationRun` into API response types.
 *
 * Deterministic and auditable: every number here comes straight from a stored
 * `EvaluationRun` / `TestCaseResult` / `CriterionScore` row. Hidden test-case
 * identity (name, input, expected/actual output) is stripped for students.
 */
import type { Prisma } from "@gradevision/database";
import type {
  EvaluationRunStatus,
  RubricBreakdownItem,
  RubricCriterionType,
  StudentTestResult,
  SubmissionEvaluationDetail,
  SubmissionEvaluationSummary,
  TestCaseResultStatus,
} from "@gradevision/shared";

const runWithResultsArgs = {
  include: {
    testCaseResults: { include: { testCase: true } },
    criterionScores: { include: { rubricCriterion: true } },
  },
} satisfies Prisma.EvaluationRunDefaultArgs;

export type EvaluationRunWithResults = Prisma.EvaluationRunGetPayload<typeof runWithResultsArgs>;

const PASSING: TestCaseResultStatus = "PASSED";

/**
 * Curated, client-safe text for a failed evaluation. The evaluator's raw
 * `errorMessage` (which can contain provider / stack details) is NEVER sent to
 * a student or instructor - it stays in the server logs. Only the stable
 * machine `type` and one of these sentences are exposed.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  NO_TEST_CASES: "This question has no active test cases, so it could not be graded automatically.",
  EXECUTION_UNAVAILABLE:
    "Automated grading is temporarily unavailable. Your instructor can still review this submission.",
  EVALUATOR_ERROR:
    "The automated grader could not finish this submission. Your instructor can still review it.",
  TIMEOUT: "The automated grader timed out on this submission.",
};

function safeFailureMessage(errorType: string | null): string {
  return (
    (errorType && FAILURE_MESSAGES[errorType]) ??
    "The automated grader could not finish this submission. Your instructor can still review it."
  );
}

function toNumber(value: Prisma.Decimal | number | null): number | null {
  return value === null ? null : Number(value);
}

function percent(total: number | null, max: number | null): number | null {
  if (total === null || max === null || max <= 0) return null;
  return Math.round((total / max) * 100);
}

function countTests(run: EvaluationRunWithResults): { passed: number; total: number } {
  const graded = run.testCaseResults.filter((r) => r.status !== "SKIPPED");
  return {
    passed: graded.filter((r) => r.status === PASSING).length,
    total: graded.length,
  };
}

export function summariseRun(
  run: EvaluationRunWithResults | null,
): SubmissionEvaluationSummary | null {
  if (!run) return null;
  const total = toNumber(run.totalScore);
  const max = toNumber(run.maxScore);
  const { passed, total: testsTotal } = countTests(run);
  return {
    status: run.status as EvaluationRunStatus,
    score: total,
    maxScore: max,
    scorePercent: percent(total, max),
    testsPassed: passed,
    testsTotal,
  };
}

/** Parsed `detail` JSON persisted by the evaluator alongside a criterion score. */
function criterionReasons(detail: Prisma.JsonValue | null): string[] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
  const reasons = (detail as Record<string, unknown>).reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.filter((r): r is string => typeof r === "string");
}

function toRubricBreakdown(run: EvaluationRunWithResults): RubricBreakdownItem[] {
  return run.criterionScores
    .slice()
    .sort((a, b) => a.rubricCriterion.position - b.rubricCriterion.position)
    .map((score) => ({
      name: score.rubricCriterion.name,
      type: score.rubricCriterion.type as RubricCriterionType,
      pointsAwarded: Number(score.pointsAwarded),
      maxPoints: Number(score.maxPoints),
      notes: score.notes,
      reasons: criterionReasons(score.detail),
    }));
}

function toStudentTestResults(run: EvaluationRunWithResults): StudentTestResult[] {
  return run.testCaseResults
    .slice()
    .sort((a, b) => a.testCase.position - b.testCase.position)
    .map((result, i) => {
      const hidden = result.testCase.visibility === "HIDDEN";
      return {
        index: i + 1,
        name: hidden ? null : result.testCase.name,
        visibility: result.testCase.visibility,
        hidden,
        status: result.status as TestCaseResultStatus,
        passed: result.status === PASSING,
        executionTimeMs: result.executionTimeMs,
        // HIDDEN cases: never expose input / expected / actual output.
        input: hidden ? null : result.testCase.input,
        expectedOutput: hidden ? null : result.testCase.expectedOutput,
        actualOutput: hidden ? null : result.stdout,
      };
    });
}

function buildFeedback(run: EvaluationRunWithResults, rubric: RubricBreakdownItem[]): string[] {
  const feedback: string[] = [];
  const { passed, total } = countTests(run);
  if (total > 0) {
    feedback.push(
      passed === total
        ? `All ${total} test cases passed.`
        : `${passed} of ${total} test cases passed.`,
    );
  }
  if (run.status === "FAILED") {
    feedback.push(safeFailureMessage(run.errorType));
  }
  for (const item of rubric) {
    if (item.pointsAwarded < item.maxPoints && item.notes) {
      feedback.push(`${item.name}: ${item.notes}`);
    }
  }
  return feedback;
}

export function toEvaluationDetail(
  run: EvaluationRunWithResults | null,
): SubmissionEvaluationDetail | null {
  if (!run) return null;
  const total = toNumber(run.totalScore);
  const max = toNumber(run.maxScore);
  const { passed, total: testsTotal } = countTests(run);
  const rubric = toRubricBreakdown(run);
  return {
    status: run.status as EvaluationRunStatus,
    score: total,
    maxScore: max,
    scorePercent: percent(total, max),
    testsPassed: passed,
    testsTotal,
    executionTimeMs: run.executionTimeMs,
    memoryKb: run.memoryKb,
    error:
      run.status === "FAILED"
        ? {
            // `type` is a stable machine code (safe); `message` is curated -
            // the evaluator's raw errorMessage is never surfaced to clients.
            type: run.errorType ?? "EVALUATION_FAILED",
            message: safeFailureMessage(run.errorType),
          }
        : null,
    completedAt: run.completedAt?.toISOString() ?? null,
    testResults: toStudentTestResults(run),
    rubric,
    feedback: buildFeedback(run, rubric),
  };
}

export { runWithResultsArgs, percent };
