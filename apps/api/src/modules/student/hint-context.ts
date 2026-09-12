import type {
  HintAttemptEvidence,
  HintExecutionEvidence,
  HintVisibleFailure,
  TestCaseResultStatus,
  TestCaseVisibility,
} from "@gradevision/shared";

import { summariseHintEvidence, type HintEvidenceRow } from "./hint-policy.js";

/**
 * Builds the sanitized execution evidence the hint generator may see, from the
 * same persisted rows the Step 2 escalation policy reads (`listHintEvidence`).
 *
 * Redaction follows the student result view exactly (`results/mapper.ts`):
 *  - VISIBLE cases: name, input, expected output and the program's own output
 *    may be shown (the student already sees all of it) - plus a bounded excerpt
 *    of the program's stderr for that visible input;
 *  - HIDDEN cases: a count of how many did not pass, nothing else - never the
 *    input, expected output, the program's output, or stderr (a traceback can
 *    echo the hidden input).
 * Runs the grader could not complete are reported as NOT_EVALUATED so they are
 * never mistaken for a failed attempt by the student. Everything is bounded so
 * the model is never handed a submission history dump.
 */

/** Row shape the builder needs - a superset of what the policy reads. */
export interface HintContextRow extends HintEvidenceRow {
  evaluationRuns: {
    status: HintEvidenceRow["evaluationRuns"][number]["status"];
    testCaseResults: {
      status: TestCaseResultStatus;
      stdout: string | null;
      stderr: string | null;
      testCase: {
        name: string | null;
        visibility: TestCaseVisibility;
        input: string;
        expectedOutput: string;
        position: number;
      };
    }[];
  }[];
}

export interface HintContextLimits {
  /** Most recent attempts to describe. */
  maxAttempts: number;
  /** Visible failing cases of the latest attempt to detail. */
  maxVisibleFailures: number;
  /** Characters kept per text field (input / expected / output / stderr). */
  maxTextChars: number;
}

export const DEFAULT_HINT_CONTEXT_LIMITS: HintContextLimits = {
  maxAttempts: 5,
  maxVisibleFailures: 3,
  maxTextChars: 300,
};

function clip(value: string | null | undefined, max: number): string {
  const text = value ?? "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Graded cases exclude SKIPPED, matching `countTests` in the result mapper. */
function graded<T extends { status: TestCaseResultStatus }>(results: T[]): T[] {
  return results.filter((r) => r.status !== "SKIPPED");
}

function toAttempt(row: HintContextRow): HintAttemptEvidence {
  const run = row.evaluationRuns[0];
  const base = {
    attemptNumber: row.attemptNumber,
    testsPassed: null,
    testsTotal: null,
    hiddenTestsFailed: null,
  };
  if (!run || run.status === "PENDING" || run.status === "RUNNING") {
    return { ...base, outcome: row.status === "FAILED" ? "NOT_EVALUATED" : "PENDING" };
  }
  if (run.status !== "COMPLETED") {
    return { ...base, outcome: "NOT_EVALUATED" };
  }
  const cases = graded(run.testCaseResults);
  const passed = cases.filter((r) => r.status === "PASSED").length;
  const hiddenFailed = cases.filter(
    (r) => r.testCase.visibility === "HIDDEN" && r.status !== "PASSED",
  ).length;
  return {
    attemptNumber: row.attemptNumber,
    outcome: cases.length > 0 && passed === cases.length ? "PASSED" : "FAILED",
    testsPassed: passed,
    testsTotal: cases.length,
    hiddenTestsFailed: hiddenFailed,
  };
}

function visibleFailures(row: HintContextRow, limits: HintContextLimits): HintVisibleFailure[] {
  const run = row.evaluationRuns[0];
  if (!run || run.status !== "COMPLETED") return [];
  return run.testCaseResults
    .filter((r) => r.testCase.visibility === "VISIBLE" && r.status !== "PASSED")
    .sort((a, b) => a.testCase.position - b.testCase.position)
    .slice(0, limits.maxVisibleFailures)
    .map((r) => ({
      name: r.testCase.name,
      status: r.status as HintVisibleFailure["status"],
      input: clip(r.testCase.input, limits.maxTextChars),
      expectedOutput: clip(r.testCase.expectedOutput, limits.maxTextChars),
      actualOutput: clip(r.stdout, limits.maxTextChars),
      errorOutput: r.stderr?.trim() ? clip(r.stderr.trim(), limits.maxTextChars) : null,
    }));
}

export function buildHintExecutionEvidence(
  rows: readonly HintContextRow[],
  limits: HintContextLimits = DEFAULT_HINT_CONTEXT_LIMITS,
): HintExecutionEvidence {
  const summary = summariseHintEvidence(rows);
  const ordered = [...rows].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const attempts = ordered.map(toAttempt);
  const latestEvaluated = [...ordered]
    .reverse()
    .find((row) => row.evaluationRuns[0]?.status === "COMPLETED");

  return {
    evaluatedAttempts: summary.evaluatedAttempts,
    unsuccessfulAttempts: summary.unsuccessfulAttempts,
    pendingAttempts: summary.pendingAttempts,
    notEvaluatedAttempts: attempts.filter((a) => a.outcome === "NOT_EVALUATED").length,
    latestOutcome: summary.latestOutcome,
    attempts: attempts.slice(-limits.maxAttempts),
    latestVisibleFailures: latestEvaluated ? visibleFailures(latestEvaluated, limits) : [],
  };
}
