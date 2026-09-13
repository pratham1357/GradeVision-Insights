/**
 * Unit tests for the deterministic evidence report. Pure logic over replay
 * shapes - no database. Each fact must be reconcilable with its inputs.
 */
import type { ReplayAttempt, ReplayHint } from "@gradevision/shared";
import { describe, expect, it } from "vitest";

import type { HintEvidenceRow } from "../student/hint-policy.js";
import {
  buildQuestionCohortEvidence,
  buildQuestionEvidence,
  buildSessionEvidenceSummary,
  type ReplayQuestionInput,
} from "./evidence-summary.js";

function attempt(
  n: number,
  outcome: "pass" | "fail" | "queued" | "grader-failed",
  hintsBefore: ReplayHint[] = [],
): ReplayAttempt {
  const base = {
    attemptNumber: n,
    submissionId: `s${n}`,
    submittedAt: `2026-09-12T10:0${n}:00.000Z`,
    language: "PYTHON" as const,
    sourceCode: `print(${n})`,
    hintsBefore,
  };
  const evaluation = (testsPassed: number) => ({
    status: "COMPLETED" as const,
    score: testsPassed * 50,
    maxScore: 100,
    scorePercent: testsPassed * 50,
    testsPassed,
    testsTotal: 2,
    executionTimeMs: 1,
    memoryKb: null,
    error: null,
    completedAt: null,
    testResults: [],
    rubric: [],
    feedback: [],
  });
  switch (outcome) {
    case "pass":
      return { ...base, submissionStatus: "COMPLETED", evaluation: evaluation(2) };
    case "fail":
      return { ...base, submissionStatus: "COMPLETED", evaluation: evaluation(1) };
    case "queued":
      return { ...base, submissionStatus: "QUEUED", evaluation: null };
    case "grader-failed":
      return {
        ...base,
        submissionStatus: "FAILED",
        evaluation: {
          ...evaluation(0),
          status: "FAILED",
          error: { type: "EVALUATOR_ERROR", message: "x" },
        },
      };
  }
}

const hint = (stageNumber: number): ReplayHint => ({
  stageNumber,
  title: null,
  source: "static",
  requestedAt: "2026-09-12T10:00:30.000Z",
  content: null,
  grantedAfter: null,
});

function question(over: Partial<ReplayQuestionInput> = {}): ReplayQuestionInput {
  return {
    questionId: "q1",
    title: "Two Sum",
    position: 0,
    points: 100,
    concepts: ["Hash Maps", "Arrays"],
    scorePercent: 100,
    attempts: [],
    hintsAfterFinalAttempt: [],
    transferCheck: null,
    ...over,
  };
}

describe("buildQuestionEvidence", () => {
  it("counts attempts, unsuccessful attempts and attempts until the first pass", () => {
    const q = buildQuestionEvidence(
      question({
        attempts: [
          attempt(1, "fail"),
          attempt(2, "fail", [hint(1)]),
          attempt(3, "pass", [hint(2)]),
        ],
      }),
    );
    expect(q).toMatchObject({
      evaluatedAttempts: 3,
      unsuccessfulAttempts: 2,
      pendingAttempts: 0,
      notEvaluatedAttempts: 0,
      finalOutcome: "PASSED",
      attemptsUntilFirstPass: 3,
      unsuccessfulBeforeFirstPass: 2,
      hintStagesConsumed: 2,
      hintStagesBeforeFirstPass: 2,
    });
    expect(q.observations).toEqual([
      "Passed after 3 evaluated attempts (2 unsuccessful before the first pass).",
      "2 hint stages consumed (2 before the first passing attempt).",
    ]);
  });

  it("describes a first-attempt pass, a final failure, and no submission", () => {
    expect(buildQuestionEvidence(question({ attempts: [attempt(1, "pass")] }))).toMatchObject({
      finalOutcome: "PASSED",
      attemptsUntilFirstPass: 1,
      observations: ["Passed on the first evaluated attempt."],
    });
    expect(
      buildQuestionEvidence(question({ attempts: [attempt(1, "fail"), attempt(2, "fail")] })),
    ).toMatchObject({
      finalOutcome: "FAILED",
      attemptsUntilFirstPass: null,
      unsuccessfulBeforeFirstPass: null,
      observations: ["Final evaluated attempt failed (2 evaluated attempts, 2 unsuccessful)."],
    });
    expect(buildQuestionEvidence(question())).toMatchObject({
      finalOutcome: "NOT_ATTEMPTED",
      observations: ["No submission."],
    });
  });

  it("does not count pending or grader-failed attempts as evaluated, and reports them factually", () => {
    const pending = buildQuestionEvidence(
      question({ attempts: [attempt(1, "fail"), attempt(2, "queued")] }),
    );
    expect(pending).toMatchObject({
      evaluatedAttempts: 1,
      pendingAttempts: 1,
      finalOutcome: "FAILED",
    });
    const onlyQueued = buildQuestionEvidence(question({ attempts: [attempt(1, "queued")] }));
    expect(onlyQueued).toMatchObject({
      finalOutcome: "PENDING",
      observations: ["Latest attempt is still being evaluated."],
    });
    const onlyBroken = buildQuestionEvidence(question({ attempts: [attempt(1, "grader-failed")] }));
    expect(onlyBroken).toMatchObject({
      finalOutcome: "NOT_EVALUATED",
      notEvaluatedAttempts: 1,
      observations: ["Latest attempt could not be evaluated by the grader."],
    });
  });

  it("notes a pass that was later followed by a failing attempt", () => {
    const q = buildQuestionEvidence(
      question({ attempts: [attempt(1, "pass"), attempt(2, "fail")] }),
    );
    expect(q.finalOutcome).toBe("FAILED");
    expect(q.attemptsUntilFirstPass).toBe(1);
    expect(q.observations[0]).toBe(
      "Final evaluated attempt failed; evaluated attempt 1 had passed.",
    );
  });

  it("reports the transfer check beside the question, never as part of it", () => {
    const passed = buildQuestionEvidence(
      question({
        attempts: [attempt(1, "pass")],
        transferCheck: { title: "Contains Duplicate", attempted: true, result: "PASSED" },
      }),
    );
    expect(passed.observations).toContain(
      "Transfer Check (Contains Duplicate) passed without hints - not part of the score.",
    );
    const notAttempted = buildQuestionEvidence(
      question({
        attempts: [attempt(1, "pass")],
        transferCheck: { title: "Contains Duplicate", attempted: false, result: null },
      }),
    );
    expect(notAttempted.observations).toContain(
      "Transfer Check (Contains Duplicate) available but not attempted.",
    );
    const locked = buildQuestionEvidence(
      question({
        attempts: [attempt(1, "fail")],
        transferCheck: { title: "Contains Duplicate", attempted: false, result: null },
      }),
    );
    expect(locked.observations.some((o) => o.includes("Transfer"))).toBe(false);
  });
});

describe("buildSessionEvidenceSummary", () => {
  it("aggregates questions, hints and transfers and groups the same facts by concept", () => {
    const summary = buildSessionEvidenceSummary({
      totalScore: 150,
      maxScore: 200,
      scorePercent: 75,
      questions: [
        question({
          attempts: [attempt(1, "fail"), attempt(2, "pass", [hint(1), hint(2)])],
          transferCheck: { title: "Contains Duplicate", attempted: true, result: "PASSED" },
        }),
        question({
          questionId: "q2",
          title: "Valid Parentheses",
          position: 1,
          concepts: ["Stacks"],
          scorePercent: 50,
          attempts: [attempt(1, "fail")],
        }),
        question({
          questionId: "q3",
          title: "Greet",
          position: 2,
          concepts: [],
          scorePercent: null,
        }),
      ],
    });
    expect(summary.score).toEqual({ totalScore: 150, maxScore: 200, scorePercent: 75 });
    expect(summary.questions).toEqual({
      total: 3,
      attempted: 2,
      passed: 1,
      failed: 1,
      pending: 0,
      notAttempted: 1,
    });
    expect(summary.hints).toEqual({ stagesConsumed: 2, questionsWithHints: 1 });
    expect(summary.transfer).toEqual({ available: 1, attempted: 1, passed: 1, failed: 0 });
    expect(summary.observations).toEqual([
      "1 of 3 questions passed; 1 failed on the final evaluated attempt; 1 without a submission.",
      "2 hint stages consumed across 1 question.",
      "Transfer Check Two Sum → Contains Duplicate: passed without hints - not part of the score.",
    ]);
    expect(summary.concepts.map((c) => c.name)).toEqual(["Arrays", "Hash Maps", "Stacks"]);
    expect(summary.concepts[1]).toMatchObject({
      name: "Hash Maps",
      observation:
        "1 assessed question tagged Hash Maps: Two Sum passed after 2 evaluated attempts.",
    });
    // Every summary number reconciles with the per-question evidence it was built from.
    expect(summary.questionEvidence.map((q) => q.evaluatedAttempts)).toEqual([2, 1, 0]);
  });

  it("uses only evidence vocabulary - no mastery, competence, risk or profile fields", () => {
    const summary = buildSessionEvidenceSummary({
      totalScore: 0,
      maxScore: 100,
      scorePercent: 0,
      questions: [question({ attempts: [attempt(1, "fail"), attempt(2, "fail")] })],
    });
    const text = JSON.stringify(summary).toLowerCase();
    for (const banned of [
      "mastery",
      "competen",
      "risk",
      "cheat",
      "probab",
      "struggl",
      "weak",
      "strong",
    ]) {
      expect(text).not.toContain(banned);
    }
    expect(summary.observations[1]).toBe("No hint stages consumed.");
  });
});

describe("buildQuestionCohortEvidence", () => {
  const row = (attemptNumber: number, status: "pass" | "fail" | "queued"): HintEvidenceRow =>
    status === "queued"
      ? { attemptNumber, status: "QUEUED", evaluationRuns: [] }
      : {
          attemptNumber,
          status: "COMPLETED",
          evaluationRuns: [
            {
              status: "COMPLETED",
              testCaseResults: [
                { status: "PASSED" },
                { status: status === "pass" ? "PASSED" : "FAILED" },
              ],
            },
          ],
        };

  it("counts students attempted, first-evaluated-attempt passes, eventual passes and the mean attempts", () => {
    const evidence = buildQuestionCohortEvidence([
      [row(1, "pass")], // first try
      [row(1, "fail"), row(2, "fail"), row(3, "pass")], // eventually, 3 attempts
      [row(1, "fail")], // never passed
      [row(1, "queued")], // attempted, nothing evaluated yet
      [], // never attempted
    ]);
    expect(evidence).toEqual({
      studentsAttempted: 4,
      firstEvaluatedAttemptPassed: 1,
      eventuallyPassed: 2,
      meanEvaluatedAttemptsAmongPassed: 2,
    });
  });

  it("is empty-safe", () => {
    expect(buildQuestionCohortEvidence([])).toEqual({
      studentsAttempted: 0,
      firstEvaluatedAttemptPassed: 0,
      eventuallyPassed: 0,
      meanEvaluatedAttemptsAmongPassed: null,
    });
  });
});
