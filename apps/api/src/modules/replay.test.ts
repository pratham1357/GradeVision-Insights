/**
 * Evidence Replay: the instructor per-session breakdown reconstructs a
 * student's attempt trajectory - code, evaluation, hints, transfer check - from
 * persisted rows. Integration tests against the real database; fixtures use the
 * `88888888-…` id range and self-clean. Runs are persisted the way the evaluator
 * would, with explicit timestamps so ordering can be asserted.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructor: "88888888-8888-4888-8888-000000000001",
  otherInstructor: "88888888-8888-4888-8888-000000000002",
  studentA: "88888888-8888-4888-8888-000000000003",
  studentB: "88888888-8888-4888-8888-000000000004",
  course: "88888888-8888-4888-8888-000000000010",
  section: "88888888-8888-4888-8888-000000000020",
  source: "88888888-8888-4888-8888-000000000030",
  transfer: "88888888-8888-4888-8888-000000000031",
  srcVisible: "88888888-8888-4888-8888-000000000041",
  srcHidden: "88888888-8888-4888-8888-000000000042",
  trVisible: "88888888-8888-4888-8888-000000000043",
  trHidden: "88888888-8888-4888-8888-000000000044",
  stage1: "88888888-8888-4888-8888-000000000051",
  stage2: "88888888-8888-4888-8888-000000000052",
  assessment: "88888888-8888-4888-8888-000000000070",
} as const;

const HIDDEN_INPUT = "R8-HIDDEN-INPUT";
const HIDDEN_EXPECTED = "R8-HIDDEN-EXPECTED";
const HIDDEN_STDOUT = "R8-HIDDEN-STDOUT";
const HIDDEN_NAME = "r8-hidden-edge-case";
const GRADER_INTERNALS = "sandbox exploded at /tmp/gradevision-exec-abc";

const T0 = Date.parse("2026-09-12T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

async function cleanup(): Promise<void> {
  const users = [ID.instructor, ID.otherInstructor, ID.studentA, ID.studentB];
  const questions = [ID.source, ID.transfer];
  await prisma.hintUsage.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questions } } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { questionId: { in: questions } } },
  });
  await prisma.submission.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.examSession.deleteMany({ where: { studentId: { in: users } } });
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.question.updateMany({
    where: { id: { in: questions } },
    data: { transferQuestionId: null },
  });
  await prisma.question.deleteMany({ where: { id: { in: questions } } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

let instructor = "";
let otherInstructor = "";
let student = "";
let sessionA = "";
let sessionB = "";
const submissionIds: Record<string, string> = {};

async function submission(input: {
  key: string;
  sessionId: string;
  questionId: string;
  attemptNumber: number;
  minute: number;
  code: string;
  status: "QUEUED" | "COMPLETED" | "FAILED";
  transferSourceQuestionId?: string;
}) {
  const row = await prisma.submission.create({
    data: {
      examSessionId: input.sessionId,
      questionId: input.questionId,
      language: "PYTHON",
      sourceCode: input.code,
      attemptNumber: input.attemptNumber,
      status: input.status,
      createdAt: at(input.minute),
      transferSourceQuestionId: input.transferSourceQuestionId ?? null,
    },
  });
  submissionIds[input.key] = row.id;
  return row.id;
}

async function completedRun(
  submissionId: string,
  cases: { testCaseId: string; passed: boolean; stdout: string }[],
) {
  const passed = cases.filter((c) => c.passed).length;
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: Math.round((passed / cases.length) * 100),
      maxScore: 100,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.testCaseResult.createMany({
    data: cases.map((c) => ({
      evaluationRunId: run.id,
      testCaseId: c.testCaseId,
      status: c.passed ? "PASSED" : "FAILED",
      pointsAwarded: c.passed ? 1 : 0,
      pointsPossible: 1,
      stdout: c.stdout,
    })),
  });
}

async function hint(sessionId: string, stageId: string, minute: number, detail?: object) {
  await prisma.hintUsage.create({
    data: {
      hintStageId: stageId,
      examSessionId: sessionId,
      studentId: ID.studentA,
      questionId: ID.source,
      status: "CONSUMED",
      requestedAt: at(minute),
      unlockedAt: at(minute),
      consumedAt: at(minute),
      ...(detail ? { detail } : {}),
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "r8-i@t.local", name: "Instr R8", role: "INSTRUCTOR" },
      { id: ID.otherInstructor, email: "r8-o@t.local", name: "Other R8", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "r8-a@t.local", name: "Ada Replay", role: "STUDENT" },
      { id: ID.studentB, email: "r8-b@t.local", name: "Bob Replay", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "R8-TEST", name: "Replay Test" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructor },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentA, sectionId: ID.section, status: "ACTIVE" },
      { studentId: ID.studentB, sectionId: ID.section, status: "ACTIVE" },
    ],
  });
  const question = (id: string, title: string, visibleId: string, hiddenId: string) =>
    prisma.question.create({
      data: {
        id,
        title,
        statement: `${title} statement`,
        difficulty: "EASY",
        createdById: ID.instructor,
        languages: { create: [{ language: "PYTHON", starterCode: null }] },
        testCases: {
          create: [
            {
              id: visibleId,
              name: "sample",
              input: "2 3",
              expectedOutput: "5",
              visibility: "VISIBLE",
              weight: 1,
              position: 0,
            },
            {
              id: hiddenId,
              name: HIDDEN_NAME,
              input: HIDDEN_INPUT,
              expectedOutput: HIDDEN_EXPECTED,
              visibility: "HIDDEN",
              weight: 1,
              position: 1,
            },
          ],
        },
      },
    });
  await question(ID.source, "Two Sum", ID.srcVisible, ID.srcHidden);
  await question(ID.transfer, "Contains Duplicate", ID.trVisible, ID.trHidden);
  await prisma.question.update({
    where: { id: ID.source },
    data: { transferQuestionId: ID.transfer },
  });
  await prisma.hintStage.createMany({
    data: [
      {
        id: ID.stage1,
        questionId: ID.source,
        stageNumber: 1,
        title: "Conceptual nudge",
        deliveryType: "STATIC",
        content: "Think about the complement.",
      },
      {
        id: ID.stage2,
        questionId: ID.source,
        stageNumber: 2,
        title: "Interactive mentor",
        deliveryType: "INTERACTIVE",
        content: null,
      },
    ],
  });
  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Replay Assessment",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 120,
      questions: { create: [{ questionId: ID.source, position: 0, points: 40 }] },
    },
  });

  // --- Student A: the demo trajectory -------------------------------------
  sessionA = (
    await prisma.examSession.create({
      data: {
        assessmentId: ID.assessment,
        studentId: ID.studentA,
        status: "SUBMITTED",
        startedAt: at(0),
        submittedAt: at(30),
        expiresAt: at(120),
      },
    })
  ).id;
  await hint(sessionA, ID.stage1, 2); // before attempt 1
  await completedRun(
    await submission({
      key: "a1",
      sessionId: sessionA,
      questionId: ID.source,
      attemptNumber: 1,
      minute: 5,
      code: "print(0, 0)",
      status: "COMPLETED",
    }),
    [
      { testCaseId: ID.srcVisible, passed: false, stdout: "0 0" },
      { testCaseId: ID.srcHidden, passed: false, stdout: HIDDEN_STDOUT },
    ],
  );
  await hint(sessionA, ID.stage2, 8, {
    hint: "Look at what you print for the sample.",
    evidence: { evaluatedAttempts: 1, unsuccessfulAttempts: 1, latestOutcome: "FAILED" },
  }); // between attempt 1 and 2
  await completedRun(
    await submission({
      key: "a2",
      sessionId: sessionA,
      questionId: ID.source,
      attemptNumber: 2,
      minute: 10,
      code: "a,b=map(int,input().split())\nprint(a+b)",
      status: "COMPLETED",
    }),
    [
      { testCaseId: ID.srcVisible, passed: true, stdout: "5" },
      { testCaseId: ID.srcHidden, passed: true, stdout: HIDDEN_STDOUT },
    ],
  );
  await completedRun(
    await submission({
      key: "t1",
      sessionId: sessionA,
      questionId: ID.transfer,
      attemptNumber: 1,
      minute: 20,
      code: "n=int(input())\nprint('true')",
      status: "COMPLETED",
      transferSourceQuestionId: ID.source,
    }),
    [
      { testCaseId: ID.trVisible, passed: true, stdout: "true" },
      { testCaseId: ID.trHidden, passed: false, stdout: HIDDEN_STDOUT },
    ],
  );

  // --- Student B: pending and grader-failed attempts ------------------------
  sessionB = (
    await prisma.examSession.create({
      data: {
        assessmentId: ID.assessment,
        studentId: ID.studentB,
        status: "IN_PROGRESS",
        startedAt: at(0),
        expiresAt: at(120),
      },
    })
  ).id;
  const broken = await submission({
    key: "b1",
    sessionId: sessionB,
    questionId: ID.source,
    attemptNumber: 1,
    minute: 3,
    code: "print(1)",
    status: "FAILED",
  });
  await prisma.evaluationRun.create({
    data: {
      submissionId: broken,
      runNumber: 1,
      status: "FAILED",
      errorType: "EVALUATOR_ERROR",
      errorMessage: GRADER_INTERNALS,
    },
  });
  await submission({
    key: "b2",
    sessionId: sessionB,
    questionId: ID.source,
    attemptNumber: 2,
    minute: 6,
    code: "print(2)",
    status: "QUEUED",
  });

  instructor = await bearer(ID.instructor, "INSTRUCTOR");
  otherInstructor = await bearer(ID.otherInstructor, "INSTRUCTOR");
  student = await bearer(ID.studentA, "STUDENT");
});

afterAll(cleanup);

const url = (sessionId: string) =>
  `/api/v1/assessments/${ID.assessment}/sessions/${sessionId}/result`;

describe("evidence replay", () => {
  it("is available to the owning instructor only", async () => {
    expect((await request(app).get(url(sessionA)).set("Authorization", instructor)).status).toBe(
      200,
    );
    expect(
      (await request(app).get(url(sessionA)).set("Authorization", otherInstructor)).status,
    ).toBe(404);
    expect((await request(app).get(url(sessionA)).set("Authorization", student)).status).toBe(403);
    expect((await request(app).get(url(sessionA))).status).toBe(401);
  });

  it("reconstructs every attempt in order with its own code and evaluation", async () => {
    const res = await request(app).get(url(sessionA)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    expect(q.attempts).toHaveLength(2);
    expect(q.attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([1, 2]);
    expect(q.attempts.map((a: { submittedAt: string }) => a.submittedAt)).toEqual([
      at(5).toISOString(),
      at(10).toISOString(),
    ]);

    const [a1, a2] = q.attempts;
    expect(a1).toMatchObject({
      submissionId: submissionIds.a1,
      sourceCode: "print(0, 0)",
      language: "PYTHON",
      submissionStatus: "COMPLETED",
    });
    expect(a1.evaluation).toMatchObject({ status: "COMPLETED", testsPassed: 0, testsTotal: 2 });
    expect(a2).toMatchObject({
      submissionId: submissionIds.a2,
      sourceCode: "a,b=map(int,input().split())\nprint(a+b)",
    });
    expect(a2.evaluation).toMatchObject({ status: "COMPLETED", testsPassed: 2, testsTotal: 2 });

    // Existing contract untouched: latest evaluation + versions (newest first).
    expect(q.evaluation.testsPassed).toBe(2);
    expect(q.versions.map((v: { attemptNumber: number }) => v.attemptNumber)).toEqual([2, 1]);
    expect(q.attemptNumber).toBe(2);
  });

  it("places hints before the attempt that followed them, with the recorded evidence counts", async () => {
    const res = await request(app).get(url(sessionA)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    const [a1, a2] = q.attempts;

    expect(a1.hintsBefore).toEqual([
      {
        stageNumber: 1,
        title: "Conceptual nudge",
        source: "static",
        requestedAt: at(2).toISOString(),
        content: "Think about the complement.",
        grantedAfter: null,
      },
    ]);
    expect(a2.hintsBefore).toEqual([
      {
        stageNumber: 2,
        title: "Interactive mentor",
        source: "ai",
        requestedAt: at(8).toISOString(),
        content: "Look at what you print for the sample.",
        grantedAfter: { unsuccessfulAttempts: 1, latestOutcome: "FAILED" },
      },
    ]);
    expect(q.hintsAfterFinalAttempt).toEqual([]);
  });

  it("keeps hidden-test identity, inputs and outputs out of the replay while counting them", async () => {
    const res = await request(app).get(url(sessionA)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    const [a1] = q.attempts;
    const hidden = a1.evaluation.testResults.find((t: { hidden: boolean }) => t.hidden);
    expect(hidden).toMatchObject({
      hidden: true,
      status: "FAILED",
      name: null,
      input: null,
      expectedOutput: null,
      actualOutput: null,
    });
    const visible = a1.evaluation.testResults.find((t: { hidden: boolean }) => !t.hidden);
    // Visible failure evidence follows the student-facing rule: shown in full.
    expect(visible).toMatchObject({
      name: "sample",
      input: "2 3",
      expectedOutput: "5",
      actualOutput: "0 0",
      status: "FAILED",
    });
    const serialized = JSON.stringify(res.body);
    for (const secret of [HIDDEN_INPUT, HIDDEN_EXPECTED, HIDDEN_STDOUT, HIDDEN_NAME]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("shows the transfer check separately, with its evidence, and leaves the score unchanged", async () => {
    const res = await request(app).get(url(sessionA)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    expect(q.transferCheck).toMatchObject({
      questionId: ID.transfer,
      title: "Contains Duplicate",
      attempted: true,
      result: "FAILED",
      testsPassed: 1,
      testsTotal: 2,
      submissionId: submissionIds.t1,
    });
    expect(q.transferCheck.attempt).toMatchObject({
      submissionId: submissionIds.t1,
      attemptNumber: 1,
      sourceCode: "n=int(input())\nprint('true')",
      submittedAt: at(20).toISOString(),
    });
    expect(q.transferCheck.attempt.evaluation).toMatchObject({ testsPassed: 1, testsTotal: 2 });
    // The transfer attempt is not one of the question's attempts...
    expect(q.attempts.map((a: { submissionId: string }) => a.submissionId)).not.toContain(
      submissionIds.t1,
    );
    // ...and the score is the source question's alone: 100% of 40 points.
    expect(res.body.data.totalScore).toBe(40);
    expect(res.body.data.maxScore).toBe(40);
    expect(res.body.data.scorePercent).toBe(100);
  });

  it("represents grader failures and pending attempts factually, without grader internals", async () => {
    const res = await request(app).get(url(sessionB)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    expect(q.attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([1, 2]);
    const [b1, b2] = q.attempts;
    expect(b1.submissionStatus).toBe("FAILED");
    expect(b1.evaluation).toMatchObject({ status: "FAILED", error: { type: "EVALUATOR_ERROR" } });
    expect(b2).toMatchObject({ submissionStatus: "QUEUED", evaluation: null });
    expect(q.transferCheck).toMatchObject({ attempted: false, result: null, attempt: null });
    expect(JSON.stringify(res.body)).not.toContain(GRADER_INTERNALS);
    expect(JSON.stringify(res.body)).not.toContain("gradevision-exec");
  });

  it("exposes evidence fields only - no narrative, mastery or risk fields", async () => {
    const res = await request(app).get(url(sessionA)).set("Authorization", instructor);
    const [q] = res.body.data.questions;
    expect(Object.keys(q).sort()).toEqual(
      [
        "attemptNumber",
        "attempts",
        "evaluation",
        "hintsAfterFinalAttempt",
        "points",
        "position",
        "questionId",
        "submissionId",
        "submissionStatus",
        "title",
        "transferCheck",
        "versions",
      ].sort(),
    );
    expect(Object.keys(q.attempts[0]).sort()).toEqual(
      [
        "attemptNumber",
        "evaluation",
        "hintsBefore",
        "language",
        "sourceCode",
        "submissionId",
        "submissionStatus",
        "submittedAt",
      ].sort(),
    );
    const text = JSON.stringify(res.body).toLowerCase();
    for (const banned of ["mastery", "competence", "cheat", "risk", "probability", "profile"]) {
      expect(text).not.toContain(banned);
    }
  });
});
