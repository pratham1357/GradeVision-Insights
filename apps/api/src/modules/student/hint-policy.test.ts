/**
 * Unit tests for the evidence-based hint escalation policy. Pure logic - no
 * database, no clock. Each case mirrors a requirement from the Step 2 brief.
 */
import { describe, expect, it } from "vitest";

import {
  decideHintStage,
  requiredUnsuccessfulAttempts,
  summariseHintEvidence,
  type HintEvidence,
  type HintEvidenceRow,
} from "./hint-policy.js";

type Outcome = "pass" | "fail" | "partial" | "queued" | "running" | "evaluator-failed";

/** Builds one submission row the way `listHintEvidence` returns it. */
function attempt(n: number, outcome: Outcome): HintEvidenceRow {
  switch (outcome) {
    case "queued":
      return { attemptNumber: n, status: "QUEUED", evaluationRuns: [] };
    case "running":
      return {
        attemptNumber: n,
        status: "RUNNING",
        evaluationRuns: [{ status: "RUNNING", testCaseResults: [] }],
      };
    case "evaluator-failed":
      return {
        attemptNumber: n,
        status: "FAILED",
        evaluationRuns: [{ status: "FAILED", testCaseResults: [] }],
      };
    case "pass":
      return {
        attemptNumber: n,
        status: "COMPLETED",
        evaluationRuns: [
          { status: "COMPLETED", testCaseResults: [{ status: "PASSED" }, { status: "PASSED" }] },
        ],
      };
    case "partial":
      return {
        attemptNumber: n,
        status: "COMPLETED",
        evaluationRuns: [
          { status: "COMPLETED", testCaseResults: [{ status: "PASSED" }, { status: "FAILED" }] },
        ],
      };
    case "fail":
      return {
        attemptNumber: n,
        status: "COMPLETED",
        evaluationRuns: [
          { status: "COMPLETED", testCaseResults: [{ status: "FAILED" }, { status: "ERROR" }] },
        ],
      };
  }
}

function history(...outcomes: Outcome[]): HintEvidence {
  return summariseHintEvidence(outcomes.map((o, i) => attempt(i + 1, o)));
}

function decide(stageNumber: number, evidence: HintEvidence, previousStageUsed = true) {
  return decideHintStage({ stageNumber, previousStageUsed, evidence });
}

describe("requiredUnsuccessfulAttempts", () => {
  it("asks for nothing at stage 1 and one more unsuccessful attempt per later stage", () => {
    expect([1, 2, 3, 4].map(requiredUnsuccessfulAttempts)).toEqual([0, 1, 2, 3]);
  });
});

describe("summariseHintEvidence", () => {
  it("returns empty evidence for no submissions", () => {
    expect(summariseHintEvidence([])).toEqual({
      evaluatedAttempts: 0,
      unsuccessfulAttempts: 0,
      pendingAttempts: 0,
      latestOutcome: null,
    });
  });

  it("counts only COMPLETED evaluation runs; pending and evaluator failures are not evidence", () => {
    const evidence = history("fail", "queued", "evaluator-failed", "running", "partial");
    expect(evidence).toEqual({
      evaluatedAttempts: 2,
      unsuccessfulAttempts: 2,
      pendingAttempts: 2,
      latestOutcome: "FAILED",
    });
  });

  it("orders by attempt number regardless of input order when picking the latest outcome", () => {
    const rows = [attempt(2, "pass"), attempt(1, "fail")];
    expect(summariseHintEvidence(rows).latestOutcome).toBe("PASSED");
    expect(summariseHintEvidence(rows.reverse()).latestOutcome).toBe("PASSED");
  });

  it("treats a completed run with no test-case results as not passed", () => {
    const row: HintEvidenceRow = {
      attemptNumber: 1,
      status: "COMPLETED",
      evaluationRuns: [{ status: "COMPLETED", testCaseResults: [] }],
    };
    expect(summariseHintEvidence([row]).unsuccessfulAttempts).toBe(1);
  });
});

describe("decideHintStage", () => {
  it("case 1 - no evidence: stage 1 is available, nothing stronger is", () => {
    const none = history();
    expect(decide(1, none).eligible).toBe(true);
    for (const stage of [2, 3, 4]) {
      const d = decide(stage, none);
      expect(d.eligible).toBe(false);
      expect(d.lockedBy).toBe("EVIDENCE");
      expect(d.lockedReason).toBe("Submit an attempt first");
    }
  });

  it("case 2 - one persisted unsuccessful evaluation makes stage 2 eligible, not stage 3", () => {
    const one = history("fail");
    expect(decide(2, one).eligible).toBe(true);
    const d3 = decide(3, one);
    expect(d3.eligible).toBe(false);
    expect(d3.lockedReason).toBe("Available after 1 more unsuccessful attempt");
  });

  it("case 3 - repeated failures unlock stronger guidance one stage per attempt", () => {
    expect(decide(3, history("fail", "fail")).eligible).toBe(true);
    expect(decide(4, history("fail", "fail")).eligible).toBe(false);
    expect(decide(4, history("fail", "fail", "partial")).eligible).toBe(true);
  });

  it("case 4 - improvement between attempts is not read as extra difficulty", () => {
    const improving = history("fail", "partial"); // 0/2 -> 1/2
    const stuck = history("fail", "fail"); // 0/2 -> 0/2
    const regressing = history("partial", "fail"); // 1/2 -> 0/2
    expect(improving.unsuccessfulAttempts).toBe(stuck.unsuccessfulAttempts);
    expect(regressing.unsuccessfulAttempts).toBe(stuck.unsuccessfulAttempts);
    for (const stage of [1, 2, 3, 4]) {
      expect(decide(stage, improving).eligible).toBe(decide(stage, stuck).eligible);
      expect(decide(stage, regressing).eligible).toBe(decide(stage, stuck).eligible);
    }
  });

  it("case 5 - once the latest attempt passes, no further stage unlocks", () => {
    const solved = history("fail", "fail", "pass");
    for (const stage of [1, 2, 3, 4]) {
      const d = decide(stage, solved);
      expect(d.eligible).toBe(false);
      expect(d.lockedBy).toBe("SOLVED");
    }
    // A later failing attempt (e.g. a broken refactor) re-opens escalation on the evidence so far.
    const reopened = history("fail", "fail", "pass", "fail");
    expect(decide(4, reopened).eligible).toBe(true);
  });

  it("case 6 - the policy has no notion of time: identical evidence decides identically whenever asked", () => {
    // The decision is a pure function of evidence and order; there is no clock input at all.
    const inputs = { stageNumber: 4, previousStageUsed: true, evidence: history() };
    const first = decideHintStage(inputs);
    const later = decideHintStage({ ...inputs, evidence: { ...inputs.evidence } });
    expect(first).toEqual(later);
    expect(first.eligible).toBe(false);
  });

  it("case 7 - stage order still governs: the previous stage must be used first, whatever the evidence", () => {
    const plenty = history("fail", "fail", "fail");
    const d = decide(4, plenty, false);
    expect(d.eligible).toBe(false);
    expect(d.lockedBy).toBe("ORDER");
    expect(d.lockedReason).toBe("Use the previous hint first");
    expect(decide(4, plenty, true).eligible).toBe(true);
  });

  it("explains a pending grade so the student knows to wait, not to resubmit", () => {
    const d = decide(2, history("queued"));
    expect(d.eligible).toBe(false);
    expect(d.lockedReason).toBe("Submit an attempt first (an attempt is still being graded)");
    const d2 = decide(3, history("fail", "running"));
    expect(d2.lockedReason).toBe(
      "Available after 1 more unsuccessful attempt (an attempt is still being graded)",
    );
  });

  it("reports the requirement it applied", () => {
    expect(decide(3, history()).requiredUnsuccessfulAttempts).toBe(2);
  });
});
