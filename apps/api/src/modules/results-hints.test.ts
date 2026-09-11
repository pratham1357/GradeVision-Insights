/**
 * Automated-evaluation results + progressive hints: integration tests against
 * the real database in `DATABASE_URL`. Fixtures use fixed ids under the
 * `cccccccc-…` range and self-clean. The hint-engine HTTP client is mocked so
 * "AI unavailable" can be exercised without a running provider.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/hint-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/hint-engine.js")>();
  return { ...actual, requestInteractiveHint: vi.fn() };
});

import { createApp } from "../app.js";
import { HintProviderUnavailableError, requestInteractiveHint } from "../services/hint-engine.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();
const mockHint = vi.mocked(requestInteractiveHint);

const ID = {
  instructorA: "cccccccc-cccc-4ccc-8ccc-000000000001",
  instructorB: "cccccccc-cccc-4ccc-8ccc-000000000002",
  studentA: "cccccccc-cccc-4ccc-8ccc-000000000003",
  studentB: "cccccccc-cccc-4ccc-8ccc-000000000004",
  course: "cccccccc-cccc-4ccc-8ccc-000000000010",
  section: "cccccccc-cccc-4ccc-8ccc-000000000020",
  question: "cccccccc-cccc-4ccc-8ccc-000000000030",
  assessment: "cccccccc-cccc-4ccc-8ccc-000000000040",
  tcVisible: "cccccccc-cccc-4ccc-8ccc-000000000051",
  tcHidden: "cccccccc-cccc-4ccc-8ccc-000000000052",
  crit: "cccccccc-cccc-4ccc-8ccc-000000000060",
  stage1: "cccccccc-cccc-4ccc-8ccc-000000000071",
  stage2: "cccccccc-cccc-4ccc-8ccc-000000000072",
  stage3: "cccccccc-cccc-4ccc-8ccc-000000000073",
  stage4: "cccccccc-cccc-4ccc-8ccc-000000000074",
} as const;

const HIDDEN_INPUT = "CCCC-HIDDEN-INPUT-7a";
const HIDDEN_EXPECTED = "CCCC-HIDDEN-EXPECTED-7a";
const HIDDEN_STDOUT = "CCCC-HIDDEN-STDOUT-7a";

async function cleanup(): Promise<void> {
  const users = [ID.instructorA, ID.instructorB, ID.studentA, ID.studentB];
  await prisma.hintUsage.deleteMany({ where: { questionId: ID.question } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.criterionScore.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.evaluationRun.deleteMany({ where: { submission: { questionId: ID.question } } });
  await prisma.submission.deleteMany({ where: { questionId: ID.question } });
  await prisma.submissionDraft.deleteMany({ where: { questionId: ID.question } });
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.assessment } });
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.question.deleteMany({ where: { id: ID.question } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

let studentA = "";
let studentB = "";
let instructorA = "";
let instructorB = "";

beforeAll(async () => {
  await cleanup();

  await prisma.user.createMany({
    data: [
      { id: ID.instructorA, email: "cc-ia@t.local", name: "Instr A", role: "INSTRUCTOR" },
      { id: ID.instructorB, email: "cc-ib@t.local", name: "Instr B", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "cc-sa@t.local", name: "Aaron Student", role: "STUDENT" },
      { id: ID.studentB, email: "cc-sb@t.local", name: "Bella Student", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "CC-TEST", name: "Results Test" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructorA },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentA, sectionId: ID.section, status: "ACTIVE" },
      { studentId: ID.studentB, sectionId: ID.section, status: "ACTIVE" },
    ],
  });

  await prisma.question.create({
    data: {
      id: ID.question,
      title: "Sum Two",
      statement: "Read two ints, print their sum.",
      difficulty: "EASY",
      createdById: ID.instructorA,
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
            name: "hidden-edge",
            input: HIDDEN_INPUT,
            expectedOutput: HIDDEN_EXPECTED,
            visibility: "HIDDEN",
            weight: 1,
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
                id: ID.crit,
                name: "Functional correctness",
                type: "FUNCTIONAL_CORRECTNESS",
                maxPoints: 100,
                position: 0,
              },
            ],
          },
        },
      },
      hintStages: {
        create: [
          {
            id: ID.stage1,
            stageNumber: 1,
            title: "Concept",
            deliveryType: "STATIC",
            content: "Think about what operation the problem is really asking for.",
            unlockDelaySeconds: 0,
          },
          {
            id: ID.stage2,
            stageNumber: 2,
            title: "Direction",
            deliveryType: "STATIC",
            content: "You only need to parse the line and add the numbers.",
            unlockDelaySeconds: 0,
          },
          {
            id: ID.stage3,
            stageNumber: 3,
            title: "Interactive",
            deliveryType: "INTERACTIVE",
            content: null,
            unlockDelaySeconds: 0,
          },
          {
            id: ID.stage4,
            stageNumber: 4,
            title: "Later",
            deliveryType: "STATIC",
            content: "Double-check your input parsing.",
            unlockDelaySeconds: 3_600,
          },
        ],
      },
    },
  });

  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Results Assessment",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructorA,
      durationMinutes: 120,
      questions: { create: [{ questionId: ID.question, position: 0, points: 50 }] },
    },
  });

  studentA = await bearer(ID.studentA, "STUDENT");
  studentB = await bearer(ID.studentB, "STUDENT");
  instructorA = await bearer(ID.instructorA, "INSTRUCTOR");
  instructorB = await bearer(ID.instructorB, "INSTRUCTOR");
});

afterAll(cleanup);

beforeEach(async () => {
  mockHint.mockReset();
  await prisma.hintUsage.deleteMany({ where: { questionId: ID.question } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.criterionScore.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.evaluationRun.deleteMany({ where: { submission: { questionId: ID.question } } });
  await prisma.submission.deleteMany({ where: { questionId: ID.question } });
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.assessment } });
});

async function startSession(studentId: string): Promise<string> {
  const session = await prisma.examSession.create({
    data: {
      assessmentId: ID.assessment,
      studentId,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return session.id;
}

/** Persists a completed EvaluationRun the way the evaluator would. */
async function seedCompletedRun(
  sessionId: string,
  opts: { visiblePassed: boolean; hiddenPassed: boolean; score: number; attemptNumber?: number },
): Promise<string> {
  const submission = await prisma.submission.create({
    data: {
      examSessionId: sessionId,
      questionId: ID.question,
      language: "PYTHON",
      sourceCode: "a,b=map(int,input().split())\nprint(a+b)",
      attemptNumber: opts.attemptNumber ?? 1,
      status: "COMPLETED",
    },
  });
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId: submission.id,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: opts.score,
      maxScore: 100,
      executionTimeMs: 30,
      memoryKb: 4096,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.testCaseResult.createMany({
    data: [
      {
        evaluationRunId: run.id,
        testCaseId: ID.tcVisible,
        status: opts.visiblePassed ? "PASSED" : "FAILED",
        pointsAwarded: opts.visiblePassed ? 1 : 0,
        pointsPossible: 1,
        executionTimeMs: 12,
        stdout: opts.visiblePassed ? "5" : "4",
      },
      {
        evaluationRunId: run.id,
        testCaseId: ID.tcHidden,
        status: opts.hiddenPassed ? "PASSED" : "FAILED",
        pointsAwarded: opts.hiddenPassed ? 1 : 0,
        pointsPossible: 1,
        executionTimeMs: 15,
        stdout: HIDDEN_STDOUT,
      },
    ],
  });
  await prisma.criterionScore.create({
    data: {
      evaluationRunId: run.id,
      rubricCriterionId: ID.crit,
      pointsAwarded: opts.score,
      maxPoints: 100,
      notes: opts.score === 100 ? "All test cases passed." : "Some test cases failed.",
      detail: { type: "FUNCTIONAL_CORRECTNESS", reasons: ["weighted ratio applied"] },
    },
  });
  return submission.id;
}

/** One persisted unsuccessful evaluation - the evidence a hint stage escalates on. */
function seedFailedAttempt(sessionId: string, attemptNumber: number): Promise<string> {
  return seedCompletedRun(sessionId, {
    visiblePassed: false,
    hiddenPassed: false,
    score: 0,
    attemptNumber,
  });
}

describe("student submission results", () => {
  it("returns tests + rubric breakdown to the owning student and hides hidden-case data", async () => {
    const sessionId = await startSession(ID.studentA);
    const submissionId = await seedCompletedRun(sessionId, {
      visiblePassed: true,
      hiddenPassed: false,
      score: 50,
    });

    const res = await request(app)
      .get(`/api/v1/student/submissions/${submissionId}`)
      .set("Authorization", studentA);

    expect(res.status).toBe(200);
    expect(res.body.data.evaluation.status).toBe("COMPLETED");
    expect(res.body.data.evaluation.testsPassed).toBe(1);
    expect(res.body.data.evaluation.testsTotal).toBe(2);
    expect(res.body.data.evaluation.rubric[0]).toMatchObject({
      name: "Functional correctness",
      pointsAwarded: 50,
      maxPoints: 100,
    });

    const hiddenResult = res.body.data.evaluation.testResults.find(
      (t: { hidden: boolean }) => t.hidden,
    );
    expect(hiddenResult).toMatchObject({
      status: "FAILED",
      name: null,
      input: null,
      expectedOutput: null,
    });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(HIDDEN_INPUT);
    expect(serialized).not.toContain(HIDDEN_EXPECTED);
    expect(serialized).not.toContain(HIDDEN_STDOUT);
  });

  it("404s for another student and for an unknown id", async () => {
    const sessionId = await startSession(ID.studentA);
    const submissionId = await seedCompletedRun(sessionId, {
      visiblePassed: true,
      hiddenPassed: true,
      score: 100,
    });

    expect(
      (
        await request(app)
          .get(`/api/v1/student/submissions/${submissionId}`)
          .set("Authorization", studentB)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/student/submissions/cccccccc-cccc-4ccc-8ccc-0000000000ff`)
          .set("Authorization", studentA)
      ).status,
    ).toBe(404);
  });

  it("reports a still-queued submission with a null evaluation", async () => {
    const sessionId = await startSession(ID.studentA);
    const submission = await prisma.submission.create({
      data: {
        examSessionId: sessionId,
        questionId: ID.question,
        language: "PYTHON",
        sourceCode: "print(1)",
        attemptNumber: 1,
        status: "QUEUED",
      },
    });
    const res = await request(app)
      .get(`/api/v1/student/submissions/${submission.id}`)
      .set("Authorization", studentA);
    expect(res.status).toBe(200);
    expect(res.body.data.submissionStatus).toBe("QUEUED");
    expect(res.body.data.evaluation).toBeNull();
  });
});

describe("instructor assessment results", () => {
  it("aggregates per-student scores for the owning instructor", async () => {
    const sessionA = await startSession(ID.studentA);
    await seedCompletedRun(sessionA, { visiblePassed: true, hiddenPassed: true, score: 100 });
    const sessionB = await startSession(ID.studentB);
    await seedCompletedRun(sessionB, { visiblePassed: true, hiddenPassed: false, score: 50 });

    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/results`)
      .set("Authorization", instructorA);

    expect(res.status).toBe(200);
    expect(res.body.data.students).toHaveLength(2);
    const aaron = res.body.data.students.find((s: { studentName: string }) =>
      s.studentName.startsWith("Aaron"),
    );
    // question worth 50 points, rubric 100% -> 50
    expect(aaron.totalScore).toBe(50);
    expect(aaron.questions[0]).toMatchObject({ scorePercent: 100, testsPassed: 2, testsTotal: 2 });

    const bella = res.body.data.students.find((s: { studentName: string }) =>
      s.studentName.startsWith("Bella"),
    );
    expect(bella.totalScore).toBe(25);
  });

  it("404s for an instructor who does not own the assessment", async () => {
    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/results`)
      .set("Authorization", instructorB);
    expect(res.status).toBe(404);
  });

  it("403s for a student", async () => {
    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/results`)
      .set("Authorization", studentA);
    expect(res.status).toBe(403);
  });
});

describe("progressive hints", () => {
  it("enforces stage progression and persists usage", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;

    // Stage 2 is locked until stage 1 has been used.
    const locked = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 2 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("HINT_LOCKED");

    const s1 = await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    expect(s1.status).toBe(201);
    expect(s1.body.data).toMatchObject({ status: "CONSUMED", source: "static" });
    expect(s1.body.data.content).toContain("operation");

    // Stage 2 needs evidence of difficulty: one persisted unsuccessful evaluation.
    await seedFailedAttempt(sessionId, 1);
    const s2 = await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 2 });
    expect(s2.status).toBe(201);

    const usages = await prisma.hintUsage.findMany({
      where: { examSessionId: sessionId },
      orderBy: { requestedAt: "asc" },
    });
    expect(usages).toHaveLength(2);
    expect(usages.every((u) => u.status === "CONSUMED")).toBe(true);

    // Re-requesting a consumed stage is idempotent.
    const again = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 1 });
    expect(again.status).toBe(201);
    expect(await prisma.hintUsage.count({ where: { examSessionId: sessionId } })).toBe(2);
  });

  it("elapsed time alone never unlocks a stronger hint", async () => {
    // A session that started two hours ago - every legacy unlockDelaySeconds
    // (0 / 0 / 0 / 3600) has elapsed - but with no execution evidence at all.
    const session = await prisma.examSession.create({
      data: {
        assessmentId: ID.assessment,
        studentId: ID.studentA,
        status: "IN_PROGRESS",
        startedAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const url = `/api/v1/student/sessions/${session.id}/questions/${ID.question}/hints`;

    // Initial assistance is always available - asking early is not punished.
    const s1 = await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    expect(s1.status).toBe(201);

    const s2 = await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 2 });
    expect(s2.status).toBe(409);
    expect(s2.body.error.code).toBe("HINT_LOCKED");
    expect(s2.body.error.message).toBe("Submit an attempt first");

    const list = await request(app).get(url).set("Authorization", studentA);
    const [, st2, st3, st4] = list.body.data.stages;
    for (const stage of [st2, st3, st4]) {
      expect(stage).toMatchObject({ available: false, unlockAt: null, status: null });
      expect(stage.lockedReason).toBeTruthy();
    }
  });

  it("escalates one stage per persisted unsuccessful evaluation, regardless of the legacy delay", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    const post = (stageNumber: number) =>
      request(app).post(url).set("Authorization", studentA).send({ stageNumber });

    expect((await post(1)).status).toBe(201);
    expect((await post(2)).status).toBe(409);

    await seedFailedAttempt(sessionId, 1);
    expect((await post(2)).status).toBe(201);
    const locked3 = await post(3);
    expect(locked3.status).toBe(409);
    expect(locked3.body.error.message).toBe("Available after 1 more unsuccessful attempt");

    await seedFailedAttempt(sessionId, 2);
    mockHint.mockResolvedValueOnce("What does your parsing return for a blank line?");
    expect((await post(3)).status).toBe(201);
    expect((await post(4)).status).toBe(409);

    // Stage 4 carries unlockDelaySeconds: 3600 - irrelevant: evidence unlocks it now.
    await seedFailedAttempt(sessionId, 3);
    const s4 = await post(4);
    expect(s4.status).toBe(201);
    expect(s4.body.data.content).toContain("Double-check");
  });

  it("does not offer further hints once the latest attempt passes", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    await seedFailedAttempt(sessionId, 1);
    await seedCompletedRun(sessionId, {
      visiblePassed: true,
      hiddenPassed: true,
      score: 100,
      attemptNumber: 2,
    });

    const list = await request(app).get(url).set("Authorization", studentA);
    const [st1, st2] = list.body.data.stages;
    // Already-delivered guidance stays readable...
    expect(st1).toMatchObject({ status: "CONSUMED" });
    expect(st1.content).toContain("operation");
    // ...but nothing stronger is offered.
    expect(st2).toMatchObject({ available: false, status: null, content: null });
    expect(st2.lockedReason).toContain("passed every test");

    const res = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HINT_LOCKED");
  });

  it("ignores queued and evaluator-failed runs as evidence", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });

    await prisma.submission.create({
      data: {
        examSessionId: sessionId,
        questionId: ID.question,
        language: "PYTHON",
        sourceCode: "print(1)",
        attemptNumber: 1,
        status: "QUEUED",
      },
    });
    const failedSubmission = await prisma.submission.create({
      data: {
        examSessionId: sessionId,
        questionId: ID.question,
        language: "PYTHON",
        sourceCode: "print(2)",
        attemptNumber: 2,
        status: "FAILED",
      },
    });
    await prisma.evaluationRun.create({
      data: {
        submissionId: failedSubmission.id,
        runNumber: 1,
        status: "FAILED",
        errorType: "EXECUTION_UNAVAILABLE",
        errorMessage: "sandbox not configured",
      },
    });

    const res = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      "Submit an attempt first (an attempt is still being graded)",
    );
  });

  it("returns AI guidance for an interactive stage", async () => {
    mockHint.mockResolvedValueOnce("Trace what happens when the two values are equal.");
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    await seedFailedAttempt(sessionId, 1);
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 2 });
    await seedFailedAttempt(sessionId, 2);

    const res = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ source: "ai", status: "CONSUMED" });
    expect(res.body.data.content).toContain("Trace");
    expect(mockHint).toHaveBeenCalledOnce();
    // Only minimal context is forwarded.
    const [ctx] = mockHint.mock.calls[0]!;
    expect(ctx).toMatchObject({ stageNumber: 3, questionTitle: "Sum Two" });
    expect(ctx.previousHints.length).toBe(2);
  });

  it("fails gracefully with 503 when the AI provider is not configured", async () => {
    mockHint.mockRejectedValueOnce(
      new HintProviderUnavailableError("The AI hint provider is not configured"),
    );
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    await seedFailedAttempt(sessionId, 1);
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 2 });
    await seedFailedAttempt(sessionId, 2);

    const res = await request(app)
      .post(url)
      .set("Authorization", studentA)
      .send({ stageNumber: 3 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("HINT_PROVIDER_UNAVAILABLE");

    // Static hints still work; no fake AI usage row was persisted as CONSUMED.
    const interactiveUsage = await prisma.hintUsage.findFirst({
      where: { hintStageId: ID.stage3 },
    });
    expect(interactiveUsage).toBeNull();
  });

  it("lists stages with availability and hides unearned content", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    await request(app).post(url).set("Authorization", studentA).send({ stageNumber: 1 });
    await seedFailedAttempt(sessionId, 1);

    const res = await request(app).get(url).set("Authorization", studentA);
    expect(res.status).toBe(200);
    const [st1, st2, st3, st4] = res.body.data.stages;
    expect(st1).toMatchObject({ status: "CONSUMED" });
    expect(st1.content).toContain("operation");
    expect(st2).toMatchObject({ available: true, status: null, content: null, lockedReason: null });
    expect(st3).toMatchObject({ available: false, lockedReason: "Use the previous hint first" });
    expect(st4).toMatchObject({ available: false, unlockAt: null });
    expect(st4.lockedReason).toBeTruthy();

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("Double-check your input parsing");
  });

  it("a student cannot read hints for another student's session", async () => {
    const sessionId = await startSession(ID.studentA);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
    expect((await request(app).get(url).set("Authorization", studentB)).status).toBe(404);
  });
});
