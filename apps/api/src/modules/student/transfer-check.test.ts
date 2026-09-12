/**
 * Unit tests for the pure Transfer Check semantics (availability, the single
 * counted attempt, and the factual result). No database.
 */
import { describe, expect, it } from "vitest";

import type { HintEvidenceRow } from "./hint-policy.js";
import {
  countedTransferAttempt,
  isSourceSolved,
  transferGate,
  transferResultOf,
} from "./transfer-check.js";

type Outcome = "pass" | "fail" | "queued" | "evaluator-failed";

function row(attemptNumber: number, outcome: Outcome): HintEvidenceRow {
  switch (outcome) {
    case "queued":
      return { attemptNumber, status: "QUEUED", evaluationRuns: [] };
    case "evaluator-failed":
      return {
        attemptNumber,
        status: "FAILED",
        evaluationRuns: [{ status: "FAILED", testCaseResults: [] }],
      };
    case "pass":
      return {
        attemptNumber,
        status: "COMPLETED",
        evaluationRuns: [
          { status: "COMPLETED", testCaseResults: [{ status: "PASSED" }, { status: "PASSED" }] },
        ],
      };
    case "fail":
      return {
        attemptNumber,
        status: "COMPLETED",
        evaluationRuns: [
          { status: "COMPLETED", testCaseResults: [{ status: "PASSED" }, { status: "FAILED" }] },
        ],
      };
  }
}

describe("isSourceSolved / transferGate", () => {
  it("is unavailable with no attempts, queued attempts, failures or grader errors", () => {
    for (const rows of [
      [],
      [row(1, "queued")],
      [row(1, "fail")],
      [row(1, "evaluator-failed")],
      [row(1, "pass"), row(2, "fail")], // latest evaluated attempt did not pass
    ]) {
      expect(isSourceSolved(rows)).toBe(false);
      expect(transferGate(isSourceSolved(rows))).toEqual({
        available: false,
        lockedReason: "Solve the original question first",
      });
    }
  });

  it("becomes available once the latest evaluated attempt passes every test", () => {
    expect(isSourceSolved([row(1, "fail"), row(2, "pass")])).toBe(true);
    // A later queued attempt does not un-solve it; a later grader failure neither.
    expect(isSourceSolved([row(1, "pass"), row(2, "queued")])).toBe(true);
    expect(isSourceSolved([row(1, "pass"), row(2, "evaluator-failed")])).toBe(true);
    expect(transferGate(true)).toEqual({ available: true, lockedReason: null });
  });
});

describe("transferResultOf", () => {
  it("reads the persisted evaluation factually", () => {
    expect(transferResultOf(row(1, "pass"))).toBe("PASSED");
    expect(transferResultOf(row(1, "fail"))).toBe("FAILED");
    expect(transferResultOf(row(1, "queued"))).toBe("PENDING");
    expect(transferResultOf(row(1, "evaluator-failed"))).toBe("NOT_EVALUATED");
  });

  it("treats a completed run with no graded cases as not passed", () => {
    expect(
      transferResultOf({
        attemptNumber: 1,
        status: "COMPLETED",
        evaluationRuns: [{ status: "COMPLETED", testCaseResults: [{ status: "SKIPPED" }] }],
      }),
    ).toBe("FAILED");
  });
});

describe("countedTransferAttempt", () => {
  it("is null before any attempt and after only grader-side failures", () => {
    expect(countedTransferAttempt([])).toBeNull();
    expect(countedTransferAttempt([row(1, "evaluator-failed")])).toBeNull();
  });

  it("counts a pending or graded attempt, newest first", () => {
    expect(countedTransferAttempt([row(1, "queued")])?.attemptNumber).toBe(1);
    expect(
      countedTransferAttempt([row(1, "evaluator-failed"), row(2, "fail")])?.attemptNumber,
    ).toBe(2);
    expect(
      countedTransferAttempt([row(1, "fail"), row(2, "evaluator-failed")])?.attemptNumber,
    ).toBe(1);
  });
});
