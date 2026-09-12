import type { TransferCheckResult } from "@gradevision/shared";

import { summariseHintEvidence, type HintEvidenceRow } from "./hint-policy.js";

/**
 * Transfer Check semantics, kept pure so they can be unit-tested and shared by
 * the student view, the student endpoints and the instructor breakdown.
 *
 *  - It becomes available once the source question is SOLVED: its latest
 *    evaluated attempt passed every test - the same `latestOutcome === "PASSED"`
 *    rule the hint policy already uses. Hints, queued or grader-failed runs
 *    never count.
 *  - It is one independent attempt: a transfer submission that was actually
 *    graded (PASSED or FAILED) is the attempt. A run the grader could not
 *    complete (NOT_EVALUATED) is not the student's doing and does not consume it.
 *  - The result is a factual reading of the persisted evaluation: PASSED /
 *    FAILED / PENDING / NOT_EVALUATED. No score, no mastery.
 */

export function isSourceSolved(sourceRows: readonly HintEvidenceRow[]): boolean {
  return summariseHintEvidence(sourceRows).latestOutcome === "PASSED";
}

/** Outcome of one transfer submission from its persisted evaluation run. */
export function transferResultOf(row: HintEvidenceRow): TransferCheckResult {
  const run = row.evaluationRuns[0];
  if (!run || run.status === "PENDING" || run.status === "RUNNING") {
    return row.status === "FAILED" ? "NOT_EVALUATED" : "PENDING";
  }
  if (run.status !== "COMPLETED") return "NOT_EVALUATED";
  const graded = run.testCaseResults.filter((r) => r.status !== "SKIPPED");
  return graded.length > 0 && graded.every((r) => r.status === "PASSED") ? "PASSED" : "FAILED";
}

/**
 * The transfer submission that counts as the student's attempt: the most recent
 * one that is pending or was graded. `null` when the student has not attempted
 * it, or every attempt so far failed on the grader's side.
 */
export function countedTransferAttempt<T extends HintEvidenceRow>(rows: readonly T[]): T | null {
  const newestFirst = [...rows].sort((a, b) => b.attemptNumber - a.attemptNumber);
  return newestFirst.find((row) => transferResultOf(row) !== "NOT_EVALUATED") ?? null;
}

export interface TransferGate {
  available: boolean;
  lockedReason: string | null;
}

/** Whether the transfer task may be viewed/started. Session liveness is checked separately. */
export function transferGate(solved: boolean): TransferGate {
  return solved
    ? { available: true, lockedReason: null }
    : { available: false, lockedReason: "Solve the original question first" };
}
