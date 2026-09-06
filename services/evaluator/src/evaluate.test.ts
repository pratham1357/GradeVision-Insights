/**
 * Evaluation pipeline: real PostgreSQL, MOCK execution sandbox (no Judge0).
 * Fixtures use fixed ids under the `dddddddd-…` range and self-clean.
 */
import { prisma } from "@gradevision/database";
import type {
  ExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
  ExecutionRunStatus,
  SemanticAnalysis,
} from "@gradevision/grading";
import { unavailableAnalysis } from "@gradevision/grading";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { evaluateSubmission, type EvaluateDeps } from "./evaluate.js";
import type { SemanticAnalysisService } from "./semantic/index.js";

const ID = {
  instructor: "dddddddd-dddd-4ddd-8ddd-000000000001",
  student: "dddddddd-dddd-4ddd-8ddd-000000000002",
  course: "dddddddd-dddd-4ddd-8ddd-000000000010",
  section: "dddddddd-dddd-4ddd-8ddd-000000000020",
  rubricQuestion: "dddddddd-dddd-4ddd-8ddd-000000000030",
  plainQuestion: "dddddddd-dddd-4ddd-8ddd-000000000031",
  assessment: "dddddddd-dddd-4ddd-8ddd-000000000040",
  session: "dddddddd-dddd-4ddd-8ddd-000000000050",
  tcVisible: "dddddddd-dddd-4ddd-8ddd-000000000061",
  tcHidden: "dddddddd-dddd-4ddd-8ddd-000000000062",
  critFunctional: "dddddddd-dddd-4ddd-8ddd-000000000071",
  critApproach: "dddddddd-dddd-4ddd-8ddd-000000000072",
} as const;

const HIDDEN_INPUT = "HIDDEN-INPUT-a1b2";
const HIDDEN_EXPECTED = "HIDDEN-EXPECTED-a1b2";

/** Returns per-case runs driven by a `stdout` map keyed by test-case input. */
class MockProvider implements ExecutionProvider {
  readonly name = "mock";
  constructor(
    private readonly plan: Record<
      string,
      { stdout?: string; status?: ExecutionRunStatus; timeMs?: number }
    >,
    private readonly configured = true,
  ) {}
  isConfigured() {
    return this.configured;
  }
  execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return Promise.resolve({
      provider: this.name,
      runtimeInfo: "mock runtime",
      meta: { mock: true },
      cases: request.cases.map((c) => {
        const p = this.plan[c.stdin] ?? {};
        return {
          caseId: c.id,
          runStatus: p.status ?? "COMPLETED",
          stdout: p.stdout ?? "",
          stderr: "",
          compileOutput: null,
          timeMs: p.timeMs ?? 12,
          memoryKb: 2048,
          exitCode: 0,
        };
      }),
    });
  }
}

class ThrowingProvider implements ExecutionProvider {
  readonly name = "throwing";
  isConfigured() {
    return true;
  }
  execute(): Promise<ExecutionResult> {
    return Promise.reject(new Error("judge0 unreachable"));
  }
}

const analyzerStub = (analysis?: Partial<SemanticAnalysis>): SemanticAnalysisService => ({
  analyze: (language) =>
    Promise.resolve({
      ...unavailableAnalysis(language, "stub"),
      available: true,
      analyzer: "stub",
      error: null,
      metrics: {
        lineCount: 2,
        functionCount: 0,
        maxFunctionLength: 0,
        branchCount: 0,
        loopCount: 0,
        maxNestingDepth: 0,
        hasRecursion: false,
      },
      findings: [],
      ...analysis,
    }),
});

async function cleanup(): Promise<void> {
  const questionIds = [ID.rubricQuestion, ID.plainQuestion];
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questionIds } } } },
  });
  await prisma.criterionScore.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questionIds } } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { questionId: { in: questionIds } } },
  });
  await prisma.submission.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.submissionDraft.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.examSession.deleteMany({ where: { id: ID.session } });
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: [ID.instructor, ID.student] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "eval-i@t.local", name: "I", role: "INSTRUCTOR" },
      { id: ID.student, email: "eval-s@t.local", name: "S", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "EVAL-T", name: "Eval Test" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructor },
  });
  await prisma.enrollment.create({
    data: { studentId: ID.student, sectionId: ID.section, status: "ACTIVE" },
  });

  await prisma.question.create({
    data: {
      id: ID.rubricQuestion,
      title: "Rubric Q",
      statement: "add",
      difficulty: "EASY",
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: ID.instructor,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            id: ID.tcVisible,
            name: "sample",
            input: "2 3",
            expectedOutput: "5",
            visibility: "VISIBLE",
            weight: 1,
            position: 0,
          },
          {
            id: ID.tcHidden,
            name: "hidden",
            input: HIDDEN_INPUT,
            expectedOutput: HIDDEN_EXPECTED,
            visibility: "HIDDEN",
            weight: 3,
            position: 1,
          },
        ],
      },
      rubric: {
        create: {
          name: "r",
          criteria: {
            create: [
              {
                id: ID.critFunctional,
                name: "Functional",
                type: "FUNCTIONAL_CORRECTNESS",
                maxPoints: 70,
                position: 0,
              },
              {
                id: ID.critApproach,
                name: "Approach",
                type: "ALGORITHMIC_APPROACH",
                maxPoints: 30,
                position: 1,
                config: { forbidden: ["eval"] },
              },
            ],
          },
        },
      },
    },
  });
  await prisma.question.create({
    data: {
      id: ID.plainQuestion,
      title: "Plain Q",
      statement: "echo",
      difficulty: "EASY",
      createdById: ID.instructor,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            name: "a",
            input: "x",
            expectedOutput: "x",
            visibility: "HIDDEN",
            weight: 1,
            position: 0,
          },
          {
            name: "b",
            input: "y",
            expectedOutput: "y",
            visibility: "HIDDEN",
            weight: 1,
            position: 1,
          },
        ],
      },
    },
  });

  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Eval A",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      questions: {
        create: [
          { questionId: ID.rubricQuestion, position: 0, points: 100 },
          { questionId: ID.plainQuestion, position: 1, points: 100 },
        ],
      },
    },
  });
  await prisma.examSession.create({
    data: {
      id: ID.session,
      assessmentId: ID.assessment,
      studentId: ID.student,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });
});

afterAll(cleanup);

beforeEach(async () => {
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { examSessionId: ID.session } } },
  });
  await prisma.criterionScore.deleteMany({
    where: { evaluationRun: { submission: { examSessionId: ID.session } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { examSessionId: ID.session } },
  });
  await prisma.submission.deleteMany({ where: { examSessionId: ID.session } });
});

async function makeSubmission(questionId: string, sourceCode = "print('x')"): Promise<string> {
  const last = await prisma.submission.aggregate({
    where: { examSessionId: ID.session, questionId },
    _max: { attemptNumber: true },
  });
  const submission = await prisma.submission.create({
    data: {
      examSessionId: ID.session,
      questionId,
      language: "PYTHON",
      sourceCode,
      attemptNumber: (last._max.attemptNumber ?? 0) + 1,
      status: "QUEUED",
    },
  });
  return submission.id;
}

const deps = (provider: ExecutionProvider, analyzers?: SemanticAnalysisService): EvaluateDeps => ({
  executionProvider: provider,
  analyzers: analyzers ?? analyzerStub(),
});

describe("evaluateSubmission", () => {
  it("evaluates a QUEUED submission, running BOTH visible and hidden test cases", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const provider = new MockProvider({
      "2 3": { stdout: "5" },
      [HIDDEN_INPUT]: { stdout: HIDDEN_EXPECTED },
    });

    const outcome = await evaluateSubmission(id, deps(provider));
    expect(outcome.status).toBe("completed");

    const submission = await prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(submission.status).toBe("COMPLETED");

    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    expect(run.status).toBe("COMPLETED");
    expect(Number(run.totalScore)).toBe(100);
    expect(Number(run.maxScore)).toBe(100);

    const results = await prisma.testCaseResult.findMany({ where: { evaluationRunId: run.id } });
    expect(results).toHaveLength(2); // visible + hidden both evaluated
    expect(results.every((r) => r.status === "PASSED")).toBe(true);

    const scores = await prisma.criterionScore.findMany({ where: { evaluationRunId: run.id } });
    expect(scores).toHaveLength(2);
  });

  it("computes weighted partial rubric credit when a hidden case fails", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const provider = new MockProvider({
      "2 3": { stdout: "5" },
      [HIDDEN_INPUT]: { stdout: "WRONG" },
    });
    await evaluateSubmission(id, deps(provider));

    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    // weighted ratio = 1 / 4 -> functional 17.5 / 70; approach scaled to 7.5 / 30
    expect(Number(run.totalScore)).toBeCloseTo(25);
    const fn = await prisma.criterionScore.findFirstOrThrow({
      where: { evaluationRunId: run.id, rubricCriterionId: ID.critFunctional },
    });
    expect(Number(fn.pointsAwarded)).toBeCloseTo(17.5);
  });

  it("marks timeout and runtime errors on the right cases", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const provider = new MockProvider({
      "2 3": { status: "TIMEOUT" },
      [HIDDEN_INPUT]: { status: "RUNTIME_ERROR" },
    });
    await evaluateSubmission(id, deps(provider));

    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    const results = await prisma.testCaseResult.findMany({
      where: { evaluationRunId: run.id },
      orderBy: { testCase: { position: "asc" } },
    });
    expect(results.map((r) => r.status)).toEqual(["TIMEOUT", "ERROR"]);
    expect(Number(run.totalScore)).toBe(0);
  });

  it("handles a compilation failure as a zero-score COMPLETED run", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const provider = new MockProvider({
      "2 3": { status: "COMPILE_ERROR" },
      [HIDDEN_INPUT]: { status: "COMPILE_ERROR" },
    });
    const outcome = await evaluateSubmission(id, deps(provider));
    expect(outcome).toMatchObject({ status: "completed", totalScore: 0 });
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(submission.status).toBe("COMPLETED");
  });

  it("prevents a second evaluation of the same submission", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const provider = new MockProvider({
      "2 3": { stdout: "5" },
      [HIDDEN_INPUT]: { stdout: HIDDEN_EXPECTED },
    });

    const first = await evaluateSubmission(id, deps(provider));
    const second = await evaluateSubmission(id, deps(provider));

    expect(first.status).toBe("completed");
    expect(second.status).toBe("skipped");
    expect(await prisma.evaluationRun.count({ where: { submissionId: id } })).toBe(1);
    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    expect(await prisma.testCaseResult.count({ where: { evaluationRunId: run.id } })).toBe(2);
  });

  it("scores a question with no rubric out of 100 functional points", async () => {
    const id = await makeSubmission(ID.plainQuestion);
    const provider = new MockProvider({ x: { stdout: "x" }, y: { stdout: "NOPE" } });
    const outcome = await evaluateSubmission(id, deps(provider));
    expect(outcome).toMatchObject({ status: "completed", totalScore: 50, maxScore: 100 });
    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    expect(await prisma.criterionScore.count({ where: { evaluationRunId: run.id } })).toBe(0);
  });

  it("gives an alternative correct solution full approach marks", async () => {
    const id = await makeSubmission(ID.rubricQuestion, "a,b=map(int,input().split())\nprint(a+b)");
    const provider = new MockProvider({
      "2 3": { stdout: "5" },
      [HIDDEN_INPUT]: { stdout: HIDDEN_EXPECTED },
    });
    await evaluateSubmission(
      id,
      deps(
        provider,
        analyzerStub({ findings: [{ id: "uses_loop", kind: "info", label: "loop", detail: "" }] }),
      ),
    );
    const approach = await prisma.criterionScore.findFirstOrThrow({
      where: { rubricCriterionId: ID.critApproach },
    });
    expect(Number(approach.pointsAwarded)).toBe(30);
  });

  it("penalises a forbidden construct reported by the analyzer", async () => {
    const id = await makeSubmission(ID.rubricQuestion, "print(eval(input()))");
    const provider = new MockProvider({
      "2 3": { stdout: "5" },
      [HIDDEN_INPUT]: { stdout: HIDDEN_EXPECTED },
    });
    await evaluateSubmission(
      id,
      deps(
        provider,
        analyzerStub({
          findings: [{ id: "eval", kind: "forbidden", label: "eval()", detail: "" }],
        }),
      ),
    );
    const approach = await prisma.criterionScore.findFirstOrThrow({
      where: { rubricCriterionId: ID.critApproach },
    });
    expect(Number(approach.pointsAwarded)).toBe(15); // 30 - 30 * 0.5
  });

  it("fails cleanly when no execution sandbox is configured", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const outcome = await evaluateSubmission(id, deps(new MockProvider({}, false)));
    expect(outcome).toMatchObject({ status: "failed", errorType: "EXECUTION_UNAVAILABLE" });
    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    expect(run.status).toBe("FAILED");
    expect((await prisma.submission.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("fails cleanly when the sandbox throws", async () => {
    const id = await makeSubmission(ID.rubricQuestion);
    const outcome = await evaluateSubmission(id, deps(new ThrowingProvider()));
    expect(outcome).toMatchObject({ status: "failed", errorType: "EVALUATOR_ERROR" });
    const run = await prisma.evaluationRun.findFirstOrThrow({ where: { submissionId: id } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("judge0 unreachable");
  });
});
