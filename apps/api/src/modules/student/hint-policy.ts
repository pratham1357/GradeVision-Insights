import type {
  EvaluationRunStatus,
  SubmissionStatus,
  TestCaseResultStatus,
} from "@gradevision/shared";

/**
 * Evidence-based hint escalation policy. Pure and deterministic: no clock, no
 * LLM, no integrity telemetry - only what the student's own submissions have
 * already produced. Assistance is observed, never penalised; this module only
 * decides *when* an existing hint stage becomes available.
 *
 * Rule (stage numbers are the question's existing `HintStage.stageNumber`s):
 *   - Stage 1 is initial assistance: available without any evidence.
 *   - Stage N (N >= 2) requires the previous stage to have been used AND at
 *     least N-1 persisted, evaluated, unsuccessful attempts on this question.
 *   - Once the latest evaluated attempt passes every test, no further stages
 *     unlock (already-delivered hints stay readable).
 *   - Elapsed time is not an input. `HintStage.unlockDelaySeconds` is legacy
 *     configuration and no longer gates anything.
 *
 * "Unsuccessful evaluated attempt" = a submission whose evaluation run reached
 * COMPLETED with at least one test case not PASSED. Runs that never evaluated
 * (QUEUED/RUNNING) or failed for infrastructure reasons (FAILED evaluation run:
 * sandbox down, no test cases, evaluator error) are not evidence about the
 * student and never count.
 */

/** The slice of a submission the policy reads (see `listHintEvidence`). */
export interface HintEvidenceRow {
  attemptNumber: number;
  status: SubmissionStatus;
  evaluationRuns: {
    status: EvaluationRunStatus;
    testCaseResults: { status: TestCaseResultStatus }[];
  }[];
}

export interface HintEvidence {
  /** Attempts whose evaluation run COMPLETED (whatever the outcome). */
  evaluatedAttempts: number;
  /** Evaluated attempts with at least one test case not PASSED. */
  unsuccessfulAttempts: number;
  /** Attempts still QUEUED/RUNNING - not evidence yet, but worth telling the student. */
  pendingAttempts: number;
  /** Outcome of the most recent evaluated attempt; `null` when none has completed. */
  latestOutcome: "PASSED" | "FAILED" | null;
}

export type HintLockReason = "ORDER" | "EVIDENCE" | "SOLVED";

export interface HintStageDecision {
  eligible: boolean;
  /** Why the stage is not eligible; `null` when it is. */
  lockedBy: HintLockReason | null;
  /** Student-facing explanation; `null` when eligible. Never mentions thresholds as jargon. */
  lockedReason: string | null;
  /** Unsuccessful evaluated attempts this stage requires (0 for stage 1). */
  requiredUnsuccessfulAttempts: number;
}

const NO_EVIDENCE = Object.freeze<HintEvidence>({
  evaluatedAttempts: 0,
  unsuccessfulAttempts: 0,
  pendingAttempts: 0,
  latestOutcome: null,
});

/** `true` when a COMPLETED run passed every case (a run with no cases did not pass). */
function runPassed(results: { status: TestCaseResultStatus }[]): boolean {
  return results.length > 0 && results.every((r) => r.status === "PASSED");
}

/** Folds a session+question's submissions (any order) into the counts the policy needs. */
export function summariseHintEvidence(rows: readonly HintEvidenceRow[]): HintEvidence {
  if (rows.length === 0) return NO_EVIDENCE;
  const ordered = [...rows].sort((a, b) => a.attemptNumber - b.attemptNumber);

  let evaluatedAttempts = 0;
  let unsuccessfulAttempts = 0;
  let pendingAttempts = 0;
  let latestOutcome: HintEvidence["latestOutcome"] = null;

  for (const row of ordered) {
    const run = row.evaluationRuns[0];
    if (!run || run.status === "PENDING" || run.status === "RUNNING") {
      if (row.status === "QUEUED" || row.status === "RUNNING") pendingAttempts += 1;
      continue;
    }
    if (run.status !== "COMPLETED") continue; // FAILED / CANCELLED: not student evidence
    evaluatedAttempts += 1;
    const passed = runPassed(run.testCaseResults);
    if (!passed) unsuccessfulAttempts += 1;
    latestOutcome = passed ? "PASSED" : "FAILED";
  }

  return { evaluatedAttempts, unsuccessfulAttempts, pendingAttempts, latestOutcome };
}

/** Evidence a stage demands: none for stage 1, one more unsuccessful attempt per stage after it. */
export function requiredUnsuccessfulAttempts(stageNumber: number): number {
  return Math.max(0, Math.floor(stageNumber) - 1);
}

export interface HintStageDecisionInput {
  stageNumber: number;
  /** Stage 1, or the previous stage already has a `HintUsage` for this session. */
  previousStageUsed: boolean;
  evidence: HintEvidence;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The single eligibility decision used by both the hint listing and a hint
 * request. Order is checked first so an out-of-sequence request is explained
 * as such regardless of evidence.
 */
export function decideHintStage(input: HintStageDecisionInput): HintStageDecision {
  const required = requiredUnsuccessfulAttempts(input.stageNumber);
  const { evidence } = input;

  if (!input.previousStageUsed) {
    return {
      eligible: false,
      lockedBy: "ORDER",
      lockedReason: "Use the previous hint first",
      requiredUnsuccessfulAttempts: required,
    };
  }

  if (evidence.latestOutcome === "PASSED") {
    return {
      eligible: false,
      lockedBy: "SOLVED",
      lockedReason: "Your latest attempt passed every test - no further hints are needed",
      requiredUnsuccessfulAttempts: required,
    };
  }

  if (evidence.unsuccessfulAttempts >= required) {
    return {
      eligible: true,
      lockedBy: null,
      lockedReason: null,
      requiredUnsuccessfulAttempts: required,
    };
  }

  const missing = required - evidence.unsuccessfulAttempts;
  const grading = evidence.pendingAttempts > 0 ? " (an attempt is still being graded)" : "";
  const lockedReason =
    evidence.unsuccessfulAttempts === 0
      ? `Submit an attempt first${grading}`
      : `Available after ${plural(missing, "more unsuccessful attempt")}${grading}`;

  return {
    eligible: false,
    lockedBy: "EVIDENCE",
    lockedReason,
    requiredUnsuccessfulAttempts: required,
  };
}
