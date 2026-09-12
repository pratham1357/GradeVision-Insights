/**
 * Unit tests for the sanitized execution evidence handed to hint generation.
 * Pure logic over persisted-row shapes - no database, no provider.
 */
import { describe, expect, it } from "vitest";

import { buildHintExecutionEvidence, type HintContextRow } from "./hint-context.js";

const HIDDEN_INPUT = "HIDDEN-INPUT-3f9";
const HIDDEN_EXPECTED = "HIDDEN-EXPECTED-3f9";
const HIDDEN_STDOUT = "HIDDEN-STDOUT-3f9";
const HIDDEN_STDERR = `ValueError: invalid literal for int(): '${HIDDEN_INPUT}'`;

type CaseStatus = HintContextRow["evaluationRuns"][number]["testCaseResults"][number]["status"];

/** Two visible + two hidden cases, statuses in position order. */
function completed(
  attemptNumber: number,
  statuses: [CaseStatus, CaseStatus, CaseStatus, CaseStatus],
  opts: { stderr?: string } = {},
): HintContextRow {
  const [v1, v2, h1, h2] = statuses;
  return {
    attemptNumber,
    status: "COMPLETED",
    evaluationRuns: [
      {
        status: "COMPLETED",
        testCaseResults: [
          {
            status: h2,
            stdout: HIDDEN_STDOUT,
            stderr: h2 === "PASSED" ? "" : HIDDEN_STDERR,
            testCase: {
              name: "hidden-big",
              visibility: "HIDDEN",
              input: HIDDEN_INPUT,
              expectedOutput: HIDDEN_EXPECTED,
              position: 3,
            },
          },
          {
            status: v1,
            stdout: v1 === "PASSED" ? "5\n" : "42\n",
            stderr: v1 === "ERROR" ? (opts.stderr ?? "Traceback: boom") : "",
            testCase: {
              name: "sample",
              visibility: "VISIBLE",
              input: "2 3\n",
              expectedOutput: "5\n",
              position: 0,
            },
          },
          {
            status: v2,
            stdout: v2 === "PASSED" ? "6\n" : "42\n",
            stderr: "",
            testCase: {
              name: "negative",
              visibility: "VISIBLE",
              input: "-4 10\n",
              expectedOutput: "6\n",
              position: 1,
            },
          },
          {
            status: h1,
            stdout: HIDDEN_STDOUT,
            stderr: "",
            testCase: {
              name: "hidden-zero",
              visibility: "HIDDEN",
              input: HIDDEN_INPUT,
              expectedOutput: HIDDEN_EXPECTED,
              position: 2,
            },
          },
        ],
      },
    ],
  };
}

const queued = (n: number): HintContextRow => ({
  attemptNumber: n,
  status: "QUEUED",
  evaluationRuns: [],
});
const evaluatorFailed = (n: number): HintContextRow => ({
  attemptNumber: n,
  status: "FAILED",
  evaluationRuns: [{ status: "FAILED", testCaseResults: [] }],
});

describe("buildHintExecutionEvidence", () => {
  it("case 1 - no execution history is represented as no evaluated attempts", () => {
    expect(buildHintExecutionEvidence([])).toEqual({
      evaluatedAttempts: 0,
      unsuccessfulAttempts: 0,
      pendingAttempts: 0,
      notEvaluatedAttempts: 0,
      latestOutcome: null,
      attempts: [],
      latestVisibleFailures: [],
    });
  });

  it("case 2 - a failed attempt yields counts plus the visible failures the student already sees", () => {
    const ev = buildHintExecutionEvidence([completed(1, ["FAILED", "FAILED", "FAILED", "FAILED"])]);
    expect(ev).toMatchObject({
      evaluatedAttempts: 1,
      unsuccessfulAttempts: 1,
      latestOutcome: "FAILED",
    });
    expect(ev.attempts).toEqual([
      { attemptNumber: 1, outcome: "FAILED", testsPassed: 0, testsTotal: 4, hiddenTestsFailed: 2 },
    ]);
    expect(ev.latestVisibleFailures).toEqual([
      {
        name: "sample",
        status: "FAILED",
        input: "2 3\n",
        expectedOutput: "5\n",
        actualOutput: "42\n",
        errorOutput: null,
      },
      {
        name: "negative",
        status: "FAILED",
        input: "-4 10\n",
        expectedOutput: "6\n",
        actualOutput: "42\n",
        errorOutput: null,
      },
    ]);
  });

  it("case 3 - multiple attempts are listed oldest first with per-attempt counts", () => {
    const ev = buildHintExecutionEvidence([
      completed(3, ["PASSED", "PASSED", "PASSED", "PASSED"]),
      completed(1, ["FAILED", "FAILED", "FAILED", "FAILED"]),
      completed(2, ["PASSED", "FAILED", "FAILED", "FAILED"]),
    ]);
    expect(ev.attempts.map((a) => [a.attemptNumber, a.testsPassed, a.outcome])).toEqual([
      [1, 0, "FAILED"],
      [2, 1, "FAILED"],
      [3, 4, "PASSED"],
    ]);
  });

  it("case 4 - improvement (0/4 -> 1/4) is visible as progression, not as extra failure", () => {
    const ev = buildHintExecutionEvidence([
      completed(1, ["FAILED", "FAILED", "FAILED", "FAILED"]),
      completed(2, ["PASSED", "FAILED", "FAILED", "FAILED"]),
    ]);
    expect(ev.attempts.map((a) => `${a.testsPassed}/${a.testsTotal}`)).toEqual(["0/4", "1/4"]);
    expect(ev.unsuccessfulAttempts).toBe(2);
    // Only the still-failing visible case of the LATEST attempt is detailed.
    expect(ev.latestVisibleFailures.map((f) => f.name)).toEqual(["negative"]);
  });

  it("case 5 - a passing latest attempt is reflected and carries no failure detail", () => {
    const ev = buildHintExecutionEvidence([
      completed(1, ["FAILED", "FAILED", "FAILED", "FAILED"]),
      completed(2, ["PASSED", "PASSED", "PASSED", "PASSED"]),
    ]);
    expect(ev.latestOutcome).toBe("PASSED");
    expect(ev.attempts[1]).toMatchObject({
      outcome: "PASSED",
      testsPassed: 4,
      hiddenTestsFailed: 0,
    });
    expect(ev.latestVisibleFailures).toEqual([]);
  });

  it("case 6 - hidden test input, expected output, program output and stderr never appear", () => {
    const ev = buildHintExecutionEvidence([completed(1, ["PASSED", "PASSED", "FAILED", "ERROR"])]);
    // Only hidden cases failed: the student sees the count, nothing else.
    expect(ev.attempts[0]).toMatchObject({ testsPassed: 2, testsTotal: 4, hiddenTestsFailed: 2 });
    expect(ev.latestVisibleFailures).toEqual([]);
    const serialized = JSON.stringify(ev);
    for (const secret of [HIDDEN_INPUT, HIDDEN_EXPECTED, HIDDEN_STDOUT, HIDDEN_STDERR, "hidden-"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("case 8 - infrastructure failures and pending grades are not student failures", () => {
    const ev = buildHintExecutionEvidence([
      completed(1, ["FAILED", "FAILED", "FAILED", "FAILED"]),
      evaluatorFailed(2),
      queued(3),
    ]);
    expect(ev).toMatchObject({
      evaluatedAttempts: 1,
      unsuccessfulAttempts: 1,
      pendingAttempts: 1,
      notEvaluatedAttempts: 1,
      latestOutcome: "FAILED",
    });
    expect(ev.attempts.map((a) => a.outcome)).toEqual(["FAILED", "NOT_EVALUATED", "PENDING"]);
    expect(ev.attempts[1]).toMatchObject({ testsPassed: null, testsTotal: null });
    // The latest EVALUATED attempt's visible failures are still what is detailed.
    expect(ev.latestVisibleFailures).toHaveLength(2);
  });

  it("includes a bounded stderr excerpt only for visible failing cases", () => {
    const ev = buildHintExecutionEvidence([
      completed(1, ["ERROR", "PASSED", "PASSED", "PASSED"], { stderr: "x".repeat(1_000) }),
    ]);
    expect(ev.latestVisibleFailures).toHaveLength(1);
    const failure = ev.latestVisibleFailures[0]!;
    expect(failure.status).toBe("ERROR");
    expect(failure.errorOutput?.length).toBe(301); // 300 chars + ellipsis
  });

  it("bounds the number of attempts and visible failures it describes", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      completed(i + 1, ["FAILED", "FAILED", "FAILED", "FAILED"]),
    );
    const ev = buildHintExecutionEvidence(rows, {
      maxAttempts: 3,
      maxVisibleFailures: 1,
      maxTextChars: 300,
    });
    expect(ev.evaluatedAttempts).toBe(8);
    expect(ev.attempts.map((a) => a.attemptNumber)).toEqual([6, 7, 8]);
    expect(ev.latestVisibleFailures).toHaveLength(1);
  });
});
