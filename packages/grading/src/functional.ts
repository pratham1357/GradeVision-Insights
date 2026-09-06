import type { ExecutionCaseRun } from "./execution.js";
import { outputsMatch } from "./normalize.js";

export type TestCaseVisibility = "VISIBLE" | "HIDDEN";

/** One expected test case, independent of any run. */
export interface FunctionalCase {
  caseId: string;
  weight: number;
  expectedOutput: string;
  visibility: TestCaseVisibility;
}

export type TestOutcomeStatus = "PASSED" | "FAILED" | "ERROR" | "TIMEOUT" | "SKIPPED";

export interface TestOutcome {
  caseId: string;
  visibility: TestCaseVisibility;
  weight: number;
  status: TestOutcomeStatus;
  passed: boolean;
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface FunctionalResult {
  outcomes: TestOutcome[];
  passedCount: number;
  totalCount: number;
  weightedEarned: number;
  weightedTotal: number;
  /** Functional correctness in [0, 1]. Weighted when weights exist, else by count. */
  ratio: number;
  compileFailed: boolean;
  hadError: boolean;
}

function statusFromRun(run: ExecutionCaseRun, expectedOutput: string): TestOutcomeStatus {
  switch (run.runStatus) {
    case "COMPILE_ERROR":
      return "ERROR";
    case "TIMEOUT":
      return "TIMEOUT";
    case "RUNTIME_ERROR":
    case "INTERNAL_ERROR":
      return "ERROR";
    case "COMPLETED":
      return outputsMatch(run.stdout, expectedOutput) ? "PASSED" : "FAILED";
  }
}

/**
 * Compares each expected case against its run. Behavioural: a program that prints
 * the right answer PASSES regardless of how it computed it.
 */
export function evaluateFunctional(
  cases: FunctionalCase[],
  runs: ExecutionCaseRun[],
): FunctionalResult {
  const runById = new Map(runs.map((r) => [r.caseId, r]));
  let compileFailed = false;
  let hadError = false;

  const outcomes: TestOutcome[] = cases.map((testCase) => {
    const run = runById.get(testCase.caseId);
    if (!run) {
      return {
        caseId: testCase.caseId,
        visibility: testCase.visibility,
        weight: testCase.weight,
        status: "SKIPPED",
        passed: false,
        stdout: "",
        stderr: "",
        timeMs: null,
        memoryKb: null,
      };
    }
    if (run.runStatus === "COMPILE_ERROR") compileFailed = true;
    const status = statusFromRun(run, testCase.expectedOutput);
    if (status === "ERROR" || status === "TIMEOUT") hadError = true;
    return {
      caseId: testCase.caseId,
      visibility: testCase.visibility,
      weight: testCase.weight,
      status,
      passed: status === "PASSED",
      stdout: run.stdout,
      stderr: run.stderr,
      timeMs: run.timeMs,
      memoryKb: run.memoryKb,
    };
  });

  const passedCount = outcomes.filter((o) => o.passed).length;
  const totalCount = outcomes.length;

  const weightedTotal = outcomes.reduce((sum, o) => sum + Math.max(0, o.weight), 0);
  const weightedEarned = outcomes.reduce(
    (sum, o) => sum + (o.passed ? Math.max(0, o.weight) : 0),
    0,
  );

  const ratio =
    weightedTotal > 0
      ? weightedEarned / weightedTotal
      : totalCount > 0
        ? passedCount / totalCount
        : 0;

  return {
    outcomes,
    passedCount,
    totalCount,
    weightedEarned,
    weightedTotal,
    ratio,
    compileFailed,
    hadError,
  };
}

export interface FunctionalTiming {
  fastestCaseMs: number | null;
  slowestCaseMs: number | null;
  totalTimeMs: number | null;
  peakMemoryKb: number | null;
}

export function summariseTiming(outcomes: TestOutcome[]): FunctionalTiming {
  const times = outcomes.map((o) => o.timeMs).filter((t): t is number => typeof t === "number");
  const mems = outcomes.map((o) => o.memoryKb).filter((m): m is number => typeof m === "number");
  return {
    fastestCaseMs: times.length ? Math.min(...times) : null,
    slowestCaseMs: times.length ? Math.max(...times) : null,
    totalTimeMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0)) : null,
    peakMemoryKb: mems.length ? Math.max(...mems) : null,
  };
}
