/**
 * Transfer Check: integration tests against the real database in
 * `DATABASE_URL`. Fixtures use fixed ids under the `99999999-…` range and
 * self-clean. Evaluation runs are persisted the way the evaluator would (no
 * sandbox needed) so availability, the single attempt, hint refusal and score
 * separation can be asserted end to end.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructor: "99999999-9999-4999-8999-000000000001",
  otherInstructor: "99999999-9999-4999-8999-000000000002",
  studentA: "99999999-9999-4999-8999-000000000003",
  studentB: "99999999-9999-4999-8999-000000000004",
  course: "99999999-9999-4999-8999-000000000010",
  section: "99999999-9999-4999-8999-000000000020",
  source: "99999999-9999-4999-8999-000000000030",
  transfer: "99999999-9999-4999-8999-000000000031",
  other: "99999999-9999-4999-8999-000000000032",
  srcVisible: "99999999-9999-4999-8999-000000000041",
  srcHidden: "99999999-9999-4999-8999-000000000042",
  trVisible: "99999999-9999-4999-8999-000000000043",
  trHidden: "99999999-9999-4999-8999-000000000044",
  stage1: "99999999-9999-4999-8999-000000000051",
  concept: "99999999-9999-4999-8999-000000000060",
  active: "99999999-9999-4999-8999-000000000070",
} as const;

const TRANSFER_HIDDEN_INPUT = "T9-HIDDEN-INPUT";
const TRANSFER_HIDDEN_EXPECTED = "T9-HIDDEN-EXPECTED";

async function cleanup(): Promise<void> {
  const users = [ID.instructor, ID.otherInstructor, ID.studentA, ID.studentB];
  const questions = [ID.source, ID.transfer, ID.other];
  await prisma.hintUsage.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questions } } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { questionId: { in: questions } } },
  });
  await prisma.submissionDraft.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.submission.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.examSession.deleteMany({ where: { studentId: { in: users } } });
  await prisma.assessment.deleteMany({
    where: { createdById: { in: [ID.instructor, ID.otherInstructor] } },
  });
  await prisma.question.updateMany({
    where: { id: { in: questions } },
    data: { transferQuestionId: null },
  });
  await prisma.question.deleteMany({ where: { id: { in: questions } } });
  await prisma.concept.deleteMany({ where: { id: ID.concept } });
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
let studentA = "";
let studentB = "";

function question(
  id: string,
  title: string,
  visibleId: string,
  hiddenId: string,
  hidden: [string, string],
) {
  return prisma.question.create({
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
            name: "hidden",
            input: hidden[0],
            expectedOutput: hidden[1],
            visibility: "HIDDEN",
            weight: 1,
            position: 1,
          },
        ],
      },
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "t9-i@t.local", name: "Instr T9", role: "INSTRUCTOR" },
      { id: ID.otherInstructor, email: "t9-o@t.local", name: "Other T9", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "t9-a@t.local", name: "Ann Transfer", role: "STUDENT" },
      { id: ID.studentB, email: "t9-b@t.local", name: "Ben Transfer", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "T9-TEST", name: "Transfer Test" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructor },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentA, sectionId: ID.section, status: "ACTIVE" },
      { studentId: ID.studentB, sectionId: ID.section, status: "ACTIVE" },
    ],
  });
  await prisma.concept.create({ data: { id: ID.concept, name: "T9 Hash Maps" } });

  await question(ID.source, "Source Sum", ID.srcVisible, ID.srcHidden, ["S-HIDDEN", "S-EXP"]);
  await question(ID.transfer, "Transfer Sum", ID.trVisible, ID.trHidden, [
    TRANSFER_HIDDEN_INPUT,
    TRANSFER_HIDDEN_EXPECTED,
  ]);
  await question(
    ID.other,
    "Other",
    "99999999-9999-4999-8999-000000000045",
    "99999999-9999-4999-8999-000000000046",
    ["O-H", "O-E"],
  );
  await prisma.questionConcept.create({ data: { questionId: ID.transfer, conceptId: ID.concept } });
  await prisma.hintStage.create({
    data: {
      id: ID.stage1,
      questionId: ID.source,
      stageNumber: 1,
      title: "Nudge",
      deliveryType: "STATIC",
      content: "Add the two numbers.",
    },
  });
  await prisma.question.update({
    where: { id: ID.source },
    data: { transferQuestionId: ID.transfer },
  });

  await prisma.assessment.create({
    data: {
      id: ID.active,
      title: "Transfer Assessment",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 120,
      questions: {
        create: [
          { questionId: ID.source, position: 0, points: 50 },
          { questionId: ID.other, position: 1, points: 50 },
        ],
      },
    },
  });

  instructor = await bearer(ID.instructor, "INSTRUCTOR");
  otherInstructor = await bearer(ID.otherInstructor, "INSTRUCTOR");
  studentA = await bearer(ID.studentA, "STUDENT");
  studentB = await bearer(ID.studentB, "STUDENT");
});

afterAll(cleanup);

beforeEach(async () => {
  const questions = [ID.source, ID.transfer, ID.other];
  await prisma.hintUsage.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questions } } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { questionId: { in: questions } } },
  });
  await prisma.submissionDraft.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.submission.deleteMany({ where: { questionId: { in: questions } } });
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.active } });
  await prisma.assessment.deleteMany({
    where: { createdById: ID.instructor, NOT: { id: ID.active } },
  });
});

async function startSession(studentId: string): Promise<string> {
  const session = await prisma.examSession.create({
    data: {
      assessmentId: ID.active,
      studentId,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return session.id;
}

/** Persists a COMPLETED run for an existing submission, the way the evaluator would. */
async function grade(
  submissionId: string,
  cases: { testCaseId: string; passed: boolean }[],
): Promise<void> {
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
      stdout: c.passed ? "5" : "4",
    })),
  });
  await prisma.submission.update({ where: { id: submissionId }, data: { status: "COMPLETED" } });
}

/** A source-question attempt with a persisted outcome. */
async function sourceAttempt(sessionId: string, attemptNumber: number, passed: boolean) {
  const submission = await prisma.submission.create({
    data: {
      examSessionId: sessionId,
      questionId: ID.source,
      language: "PYTHON",
      sourceCode: "a,b=map(int,input().split())\nprint(a+b)",
      attemptNumber,
      status: "COMPLETED",
    },
  });
  await grade(submission.id, [
    { testCaseId: ID.srcVisible, passed: true },
    { testCaseId: ID.srcHidden, passed },
  ]);
  return submission.id;
}

const transferUrl = (sessionId: string) =>
  `/api/v1/student/sessions/${sessionId}/questions/${ID.source}/transfer`;
const sessionView = async (sessionId: string, token: string) =>
  (await request(app).get(`/api/v1/student/sessions/${sessionId}`).set("Authorization", token)).body
    .data;

describe("transfer check", () => {
  it("stays locked until the source question's latest evaluated attempt passes", async () => {
    const sessionId = await startSession(ID.studentA);

    let view = await sessionView(sessionId, studentA);
    expect(view.questions[0].transferCheck).toMatchObject({
      questionId: ID.transfer,
      title: "Transfer Sum",
      concepts: ["T9 Hash Maps"],
      available: false,
      lockedReason: "Solve the original question first",
      attempted: false,
      result: null,
    });
    expect(view.questions[1].transferCheck).toBeNull(); // "Other" has no transfer check

    const locked = await request(app).get(transferUrl(sessionId)).set("Authorization", studentA);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("TRANSFER_LOCKED");
    const lockedSubmit = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    expect(lockedSubmit.status).toBe(409);

    await sourceAttempt(sessionId, 1, false); // hint-worthy failure, still locked
    expect(
      (await request(app).get(transferUrl(sessionId)).set("Authorization", studentA)).status,
    ).toBe(409);

    await sourceAttempt(sessionId, 2, true); // solved
    const res = await request(app).get(transferUrl(sessionId)).set("Authorization", studentA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      sourceQuestionId: ID.source,
      sourceTitle: "Source Sum",
      transfer: { questionId: ID.transfer, available: true, attempted: false, result: null },
    });
    expect(res.body.data.question).toMatchObject({ id: ID.transfer, title: "Transfer Sum" });
    expect(res.body.data.question.sampleTestCases).toHaveLength(1);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(TRANSFER_HIDDEN_INPUT);
    expect(serialized).not.toContain(TRANSFER_HIDDEN_EXPECTED);

    view = await sessionView(sessionId, studentA);
    expect(view.questions[0].transferCheck).toMatchObject({ available: true, lockedReason: null });
  });

  it("refuses hints for the transfer question server-side while the source keeps its hints", async () => {
    const sessionId = await startSession(ID.studentA);
    const hintsFor = (questionId: string) =>
      `/api/v1/student/sessions/${sessionId}/questions/${questionId}/hints`;

    // Assistance on the source works as before (initial stage, no evidence needed)...
    const sourceHint = await request(app)
      .post(hintsFor(ID.source))
      .set("Authorization", studentA)
      .send({ stageNumber: 1 });
    expect(sourceHint.status).toBe(201);

    await sourceAttempt(sessionId, 1, true);

    const list = await request(app).get(hintsFor(ID.transfer)).set("Authorization", studentA);
    expect(list.status).toBe(409);
    expect(list.body.error.code).toBe("HINTS_UNAVAILABLE_FOR_TRANSFER");
    const ask = await request(app)
      .post(hintsFor(ID.transfer))
      .set("Authorization", studentA)
      .send({ stageNumber: 1 });
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe("HINTS_UNAVAILABLE_FOR_TRANSFER");
    // ...and the only hint usage on record is the source's.
    const usages = await prisma.hintUsage.findMany({ where: { examSessionId: sessionId } });
    expect(usages.map((u) => u.questionId)).toEqual([ID.source]);
  });

  it("records the single transfer attempt separately from the source's history", async () => {
    const sessionId = await startSession(ID.studentA);
    await sourceAttempt(sessionId, 1, false);
    await sourceAttempt(sessionId, 2, true);
    const sourceCountBefore = await prisma.submission.count({
      where: { examSessionId: sessionId, questionId: ID.source },
    });

    const submitted = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "a,b=map(int,input().split())\nprint(a+b)" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.submission).toMatchObject({
      questionId: ID.transfer,
      attemptNumber: 1,
      status: "QUEUED",
    });
    const row = await prisma.submission.findUniqueOrThrow({
      where: { id: submitted.body.data.submission.id },
    });
    expect(row.transferSourceQuestionId).toBe(ID.source);
    expect(row.questionId).toBe(ID.transfer);

    // Source history untouched; the transfer attempt is visible only under transferCheck.
    expect(
      await prisma.submission.count({ where: { examSessionId: sessionId, questionId: ID.source } }),
    ).toBe(sourceCountBefore);
    const view = await sessionView(sessionId, studentA);
    expect(view.questions[0].submissions).toHaveLength(sourceCountBefore);
    expect(view.questions[0].transferCheck).toMatchObject({
      attempted: true,
      result: "PENDING",
      submission: { attemptNumber: 1, status: "QUEUED" },
    });

    // One attempt only.
    const again = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("TRANSFER_ALREADY_ATTEMPTED");

    // The transfer question is not an assessment question: the normal path refuses it.
    const normal = await request(app)
      .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.transfer}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    expect(normal.status).toBe(404);
  });

  it("reports the graded result to student and instructor without touching the score", async () => {
    const sessionId = await startSession(ID.studentA);
    await sourceAttempt(sessionId, 1, true);
    const submitted = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    const transferSubmissionId: string = submitted.body.data.submission.id;
    await grade(transferSubmissionId, [
      { testCaseId: ID.trVisible, passed: true },
      { testCaseId: ID.trHidden, passed: false },
    ]);

    const view = await sessionView(sessionId, studentA);
    expect(view.questions[0].transferCheck).toMatchObject({ attempted: true, result: "FAILED" });
    const own = await request(app)
      .get(`/api/v1/student/submissions/${transferSubmissionId}`)
      .set("Authorization", studentA);
    expect(own.status).toBe(200);
    expect(own.body.data.evaluation.testsPassed).toBe(1);

    const breakdown = await request(app)
      .get(`/api/v1/assessments/${ID.active}/sessions/${sessionId}/result`)
      .set("Authorization", instructor);
    expect(breakdown.status).toBe(200);
    const [q1, q2] = breakdown.body.data.questions;
    expect(q1.transferCheck).toMatchObject({
      questionId: ID.transfer,
      title: "Transfer Sum",
      attempted: true,
      result: "FAILED",
      submissionId: transferSubmissionId,
      testsPassed: 1,
      testsTotal: 2,
    });
    expect(q2.transferCheck).toBeNull();
    // Source passed 100% of 50 points; the failed transfer changes nothing.
    expect(q1.evaluation.scorePercent).toBe(100);
    expect(breakdown.body.data.totalScore).toBe(50);
    expect(breakdown.body.data.maxScore).toBe(100);
    expect(q1.versions.map((v: { submissionId: string }) => v.submissionId)).not.toContain(
      transferSubmissionId,
    );

    const results = await request(app)
      .get(`/api/v1/assessments/${ID.active}/results`)
      .set("Authorization", instructor);
    const ann = results.body.data.students.find(
      (s: { studentId: string }) => s.studentId === ID.studentA,
    );
    expect(ann.totalScore).toBe(50);
  });

  it("does not let a grader failure consume the single attempt", async () => {
    const sessionId = await startSession(ID.studentB);
    await sourceAttempt(sessionId, 1, true);
    const first = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentB)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    const firstId: string = first.body.data.submission.id;
    await prisma.evaluationRun.create({
      data: {
        submissionId: firstId,
        runNumber: 1,
        status: "FAILED",
        errorType: "EXECUTION_UNAVAILABLE",
        errorMessage: "sandbox not configured",
      },
    });
    await prisma.submission.update({ where: { id: firstId }, data: { status: "FAILED" } });

    const view = await sessionView(sessionId, studentB);
    expect(view.questions[0].transferCheck).toMatchObject({ attempted: false, result: null });

    const second = await request(app)
      .post(`${transferUrl(sessionId)}/submissions`)
      .set("Authorization", studentB)
      .send({ language: "PYTHON", sourceCode: "print(5)" });
    expect(second.status).toBe(201);
    expect(second.body.data.submission.attemptNumber).toBe(2);
  });

  it("is scoped to the owning student and to questions that have a transfer check", async () => {
    const sessionId = await startSession(ID.studentA);
    await sourceAttempt(sessionId, 1, true);
    expect(
      (await request(app).get(transferUrl(sessionId)).set("Authorization", studentB)).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${transferUrl(sessionId)}/submissions`)
          .set("Authorization", studentB)
          .send({ language: "PYTHON", sourceCode: "print(5)" })
      ).status,
    ).toBe(404);
    const none = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}/questions/${ID.other}/transfer`)
      .set("Authorization", studentA);
    expect(none.status).toBe(404);
    // The transfer question id itself is not a source question of this assessment.
    const viaTransferId = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}/questions/${ID.transfer}/transfer`)
      .set("Authorization", studentA);
    expect(viaTransferId.status).toBe(404);
  });

  it("keeps a question and its transfer check out of the same assessment", async () => {
    const create = () =>
      request(app)
        .post("/api/v1/assessments")
        .set("Authorization", instructor)
        .send({ title: "Draft", sectionId: ID.section, durationMinutes: 30 });
    const attach = (assessmentId: string, questionId: string) =>
      request(app)
        .post(`/api/v1/assessments/${assessmentId}/questions`)
        .set("Authorization", instructor)
        .send({ questionId, points: 10 });

    const a = (await create()).body.data.id;
    expect((await attach(a, ID.source)).status).toBe(201);
    const conflict = await attach(a, ID.transfer);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("TRANSFER_CONFLICT");

    const b = (await create()).body.data.id;
    expect((await attach(b, ID.transfer)).status).toBe(201);
    expect((await attach(b, ID.source)).body.error.code).toBe("TRANSFER_CONFLICT");

    // Linked after attaching: activation refuses it.
    const c = (await create()).body.data.id;
    expect((await attach(c, ID.other)).status).toBe(201);
    expect((await attach(c, ID.transfer)).status).toBe(201);
    await prisma.question.update({
      where: { id: ID.other },
      data: { transferQuestionId: ID.transfer },
    });
    try {
      const activate = await request(app)
        .patch(`/api/v1/assessments/${c}`)
        .set("Authorization", instructor)
        .send({ status: "ACTIVE" });
      expect(activate.status).toBe(409);
      expect(activate.body.error.code).toBe("TRANSFER_CONFLICT");
    } finally {
      await prisma.question.update({
        where: { id: ID.other },
        data: { transferQuestionId: null },
      });
    }
  });

  it("instructor authoring validates the transfer target", async () => {
    const body = {
      title: "Source Sum",
      statement: "Source Sum statement",
      difficulty: "EASY",
      languages: [{ language: "PYTHON", starterCode: null }],
    };
    const put = (payload: Record<string, unknown>, token = instructor) =>
      request(app).put(`/api/v1/questions/${ID.source}`).set("Authorization", token).send(payload);

    expect((await put({ ...body, transferQuestionId: ID.source })).status).toBe(400);
    expect(
      (await put({ ...body, transferQuestionId: "99999999-9999-4999-8999-0000000000ee" })).status,
    ).toBe(400);
    expect((await put({ ...body, transferQuestionId: ID.transfer }, otherInstructor)).status).toBe(
      404,
    );

    const untouched = await put(body);
    expect(untouched.body.data.transferQuestion).toEqual({
      id: ID.transfer,
      title: "Transfer Sum",
    });

    const cleared = await put({ ...body, transferQuestionId: null });
    expect(cleared.body.data.transferQuestion).toBeNull();

    const relinked = await put({ ...body, transferQuestionId: ID.transfer });
    expect(relinked.body.data.transferQuestion).toEqual({ id: ID.transfer, title: "Transfer Sum" });
    const detail = await request(app)
      .get(`/api/v1/questions/${ID.source}`)
      .set("Authorization", instructor);
    expect(detail.body.data.transferQuestion?.id).toBe(ID.transfer);
  });
});
