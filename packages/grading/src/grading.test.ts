import { describe, expect, it } from "vitest";

import {
  computeEvaluation,
  evaluateFunctional,
  gradeRubric,
  normalizeOutput,
  parseCriterionConfig,
  summariseTiming,
  unavailableAnalysis,
  type ExecutionCaseRun,
  type ExecutionResult,
  type FunctionalCase,
  type RubricCriterionInput,
  type SemanticAnalysis,
} from "./index.js";

function run(over: Partial<ExecutionCaseRun> & { caseId: string }): ExecutionCaseRun {
  return {
    runStatus: "COMPLETED",
    stdout: "",
    stderr: "",
    compileOutput: null,
    timeMs: 10,
    memoryKb: 1000,
    exitCode: 0,
    ...over,
  };
}

function exec(cases: ExecutionCaseRun[]): ExecutionResult {
  return { provider: "mock", cases, runtimeInfo: "mock", meta: {} };
}

const pythonAnalysis = (over: Partial<SemanticAnalysis> = {}): SemanticAnalysis => ({
  language: "PYTHON",
  available: true,
  error: null,
  analyzer: "python-ast",
  metrics: {
    lineCount: 3,
    functionCount: 1,
    maxFunctionLength: 3,
    branchCount: 0,
    loopCount: 0,
    maxNestingDepth: 1,
    hasRecursion: false,
  },
  findings: [],
  ...over,
});

describe("normalizeOutput", () => {
  it("ignores trailing whitespace and trailing newlines", () => {
    expect(normalizeOutput("5  \n")).toBe(normalizeOutput("5\n\n\n"));
    expect(normalizeOutput("a\r\nb\r\n")).toBe("a\nb");
  });
});

describe("evaluateFunctional", () => {
  const cases: FunctionalCase[] = [
    { caseId: "v1", weight: 1, expectedOutput: "5\n", visibility: "VISIBLE" },
    { caseId: "h1", weight: 2, expectedOutput: "0\n", visibility: "HIDDEN" },
    { caseId: "h2", weight: 3, expectedOutput: "2000000000\n", visibility: "HIDDEN" },
  ];

  it("passes a behaviourally-correct program regardless of formatting", () => {
    const result = evaluateFunctional(cases, [
      run({ caseId: "v1", stdout: "5" }),
      run({ caseId: "h1", stdout: "0\n\n" }),
      run({ caseId: "h2", stdout: "2000000000  " }),
    ]);
    expect(result.passedCount).toBe(3);
    expect(result.ratio).toBe(1);
  });

  it("computes a weighted partial ratio", () => {
    const result = evaluateFunctional(cases, [
      run({ caseId: "v1", stdout: "5" }),
      run({ caseId: "h1", stdout: "9" }),
      run({ caseId: "h2", stdout: "2000000000" }),
    ]);
    // earned weight 1 + 3 of 6
    expect(result.weightedEarned).toBe(4);
    expect(result.weightedTotal).toBe(6);
    expect(result.ratio).toBeCloseTo(4 / 6);
  });

  it("classifies timeout, runtime error and compile error", () => {
    const result = evaluateFunctional(cases, [
      run({ caseId: "v1", runStatus: "TIMEOUT" }),
      run({ caseId: "h1", runStatus: "RUNTIME_ERROR", stderr: "boom" }),
      run({ caseId: "h2", runStatus: "COMPILE_ERROR", compileOutput: "bad" }),
    ]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["TIMEOUT", "ERROR", "ERROR"]);
    expect(result.compileFailed).toBe(true);
    expect(result.ratio).toBe(0);
  });

  it("marks a missing run as SKIPPED", () => {
    const result = evaluateFunctional(cases, [run({ caseId: "v1", stdout: "5" })]);
    expect(result.outcomes.filter((o) => o.status === "SKIPPED")).toHaveLength(2);
  });
});

describe("gradeRubric - partial credit & alternative implementations", () => {
  const criteria: RubricCriterionInput[] = [
    { id: "fc", type: "FUNCTIONAL_CORRECTNESS", name: "Functional", maxPoints: 70, config: null },
    {
      id: "ap",
      type: "ALGORITHMIC_APPROACH",
      name: "Approach",
      maxPoints: 20,
      config: { forbidden: ["eval"] },
    },
    {
      id: "cq",
      type: "CODE_QUALITY",
      name: "Quality",
      maxPoints: 10,
      config: { maxFunctionLength: 40 },
    },
  ];
  const cases: FunctionalCase[] = [
    { caseId: "a", weight: 1, expectedOutput: "1\n", visibility: "HIDDEN" },
    { caseId: "b", weight: 1, expectedOutput: "2\n", visibility: "HIDDEN" },
  ];

  it("gives an alternative but fully-correct solution full marks on every criterion", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "1" }),
      run({ caseId: "b", stdout: "2" }),
    ]);
    const result = gradeRubric({
      criteria,
      functional,
      timing: summariseTiming(functional.outcomes),
      // uses a loop where the "expected" answer might use recursion - no forbidden constructs
      semantic: pythonAnalysis({
        findings: [{ id: "uses_loop", kind: "info", label: "uses a loop", detail: "" }],
      }),
    });
    expect(result.totalScore).toBe(100);
    expect(result.maxScore).toBe(100);
  });

  it("awards weighted partial credit for a half-correct solution", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "1" }),
      run({ caseId: "b", stdout: "WRONG" }),
    ]);
    const result = gradeRubric({
      criteria,
      functional,
      timing: summariseTiming(functional.outcomes),
      semantic: pythonAnalysis(),
    });
    const fc = result.criterionScores.find((c) => c.criterionId === "fc");
    expect(fc?.pointsAwarded).toBe(35); // 70 * 0.5
    // qualitative criteria are scaled by correctness, not zeroed
    expect(result.criterionScores.find((c) => c.criterionId === "ap")?.pointsAwarded).toBe(10);
    expect(result.totalScore).toBeGreaterThan(35);
    expect(result.totalScore).toBeLessThan(100);
  });

  it("penalises a forbidden construct even on a correct solution", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "1" }),
      run({ caseId: "b", stdout: "2" }),
    ]);
    const result = gradeRubric({
      criteria,
      functional,
      timing: summariseTiming(functional.outcomes),
      semantic: pythonAnalysis({
        findings: [{ id: "eval", kind: "forbidden", label: "eval()", detail: "eval() call" }],
      }),
    });
    const approach = result.criterionScores.find((c) => c.criterionId === "ap");
    expect(approach?.pointsAwarded).toBe(10); // 20 - 20*0.5
    expect(approach?.reasons.join(" ")).toMatch(/disallowed construct/i);
  });

  it("falls back to functional score when semantic analysis is unavailable (e.g. JavaScript)", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "1" }),
      run({ caseId: "b", stdout: "2" }),
    ]);
    const result = gradeRubric({
      criteria,
      functional,
      timing: summariseTiming(functional.outcomes),
      semantic: unavailableAnalysis("JAVASCRIPT", "no analyzer for JAVASCRIPT"),
    });
    expect(result.totalScore).toBe(100);
  });

  it("uses an implicit 100-point functional criterion when there is no rubric", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "1" }),
      run({ caseId: "b", stdout: "WRONG" }),
    ]);
    const result = gradeRubric({
      criteria: [],
      functional,
      timing: summariseTiming(functional.outcomes),
      semantic: unavailableAnalysis("PYTHON", "x"),
    });
    expect(result.isImplicit).toBe(true);
    expect(result.totalScore).toBe(50);
    expect(result.maxScore).toBe(100);
  });
});

describe("PERFORMANCE criterion", () => {
  const perf: RubricCriterionInput = {
    id: "pf",
    type: "PERFORMANCE",
    name: "Performance",
    maxPoints: 10,
    config: { targetTimeMs: 100 },
  };
  const cases: FunctionalCase[] = [
    { caseId: "a", weight: 1, expectedOutput: "1\n", visibility: "HIDDEN" },
  ];

  it("is zero when the solution is not functionally correct", () => {
    const functional = evaluateFunctional(cases, [
      run({ caseId: "a", stdout: "WRONG", timeMs: 10 }),
    ]);
    const result = gradeRubric({
      criteria: [perf],
      functional,
      timing: summariseTiming(functional.outcomes),
      semantic: pythonAnalysis(),
    });
    expect(result.criterionScores[0]?.pointsAwarded).toBe(0);
  });

  it("is full when fast and correct, reduced when slow", () => {
    const fast = evaluateFunctional(cases, [run({ caseId: "a", stdout: "1", timeMs: 50 })]);
    const slow = evaluateFunctional(cases, [run({ caseId: "a", stdout: "1", timeMs: 400 })]);
    const timingFor = (f: ReturnType<typeof evaluateFunctional>) =>
      gradeRubric({
        criteria: [perf],
        functional: f,
        timing: summariseTiming(f.outcomes),
        semantic: pythonAnalysis(),
      }).criterionScores[0]?.pointsAwarded;
    expect(timingFor(fast)).toBe(10);
    expect(timingFor(slow)).toBe(0); // 400 >= 3 * 100
  });
});

describe("computeEvaluation + parseCriterionConfig", () => {
  it("produces a score percentage and a per-case outcome list", () => {
    const result = computeEvaluation({
      language: "PYTHON",
      criteria: [
        {
          id: "fc",
          type: "FUNCTIONAL_CORRECTNESS",
          name: "Functional",
          maxPoints: 100,
          config: null,
        },
      ],
      cases: [
        { caseId: "a", weight: 1, expectedOutput: "1\n", visibility: "VISIBLE" },
        { caseId: "b", weight: 1, expectedOutput: "2\n", visibility: "HIDDEN" },
      ],
      execution: exec([run({ caseId: "a", stdout: "1" }), run({ caseId: "b", stdout: "2" })]),
      semantic: pythonAnalysis(),
    });
    expect(result.scorePercent).toBe(100);
    expect(result.functional.outcomes).toHaveLength(2);
  });

  it("safely coerces persisted config json", () => {
    expect(
      parseCriterionConfig({ forbidden: ["eval", 1], targetTimeMs: -5, mode: "strict" }),
    ).toEqual({
      forbidden: ["eval"],
      mode: "strict",
    });
    expect(parseCriterionConfig("nonsense")).toBeNull();
    expect(parseCriterionConfig(null)).toBeNull();
  });
});
