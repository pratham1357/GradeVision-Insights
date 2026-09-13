/**
 * Evidence governance: session binding, ownership, the single active session,
 * and the evidence-notice acknowledgement. Integration tests against the real
 * database; fixtures use the `77777777-…` id range and self-clean.
 *
 * The contamination cases insert rows directly (an attempt for a question that
 * is not in the assessment; the same question solved in another assessment;
 * a hint for a foreign question) and assert that none of it reaches the
 * requested session's replay, report or cohort counts.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructorA: "77777777-7777-4777-8777-000000000001",
  instructorB: "77777777-7777-4777-8777-000000000002",
  studentA: "77777777-7777-4777-8777-000000000003",
  studentB: "77777777-7777-4777-8777-000000000004",
  studentC: "77777777-7777-4777-8777-000000000005", // fresh; used for start/acknowledge cases
  course: "77777777-7777-4777-8777-000000000010",
  sectionA: "77777777-7777-4777-8777-000000000020",
  sectionB: "77777777-7777-4777-8777-000000000021",
  q: "77777777-7777-4777-8777-000000000030", // in assessments A1 and A2 (instructor A)
  qTransfer: "77777777-7777-4777-8777-000000000031",
  qForeign: "77777777-7777-4777-8777-000000000032", // instructor B's question, assessment B1
  qVisible: "77777777-7777-4777-8777-000000000041",
  qHidden: "77777777-7777-4777-8777-000000000042",
  tVisible: "77777777-7777-4777-8777-000000000043",
  tHidden: "77777777-7777-4777-8777-000000000044",
  fVisible: "77777777-7777-4777-8777-000000000045",
  fHidden: "77777777-7777-4777-8777-000000000046",
  stage1: "77777777-7777-4777-8777-000000000051",
  foreignStage: "77777777-7777-4777-8777-000000000052",
  a1: "77777777-7777-4777-8777-000000000070",
  a2: "77777777-7777-4777-8777-000000000071",
  b1: "77777777-7777-4777-8777-000000000072",
  active: "77777777-7777-4777-8777-000000000073", // ACTIVE, for start/acknowledge cases
} as const;

const HIDDEN = "G7-HIDDEN-INPUT";
const GRADER_INTERNALS = "sandbox exploded at /tmp/gradevision-exec-g7";

async function cleanup(): Promise<void> {
  const users = [ID.instructorA, ID.instructorB, ID.studentA, ID.studentB, ID.studentC];
  const questions = [ID.q, ID.qTransfer, ID.qForeign];
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
  await prisma.assessment.deleteMany({ where: { id: { in: [ID.a1, ID.a2, ID.b1, ID.active] } } });
  await prisma.question.updateMany({
    where: { id: { in: questions } },
    data: { transferQuestionId: null },
  });
  await prisma.question.deleteMany({ where: { id: { in: questions } } });
  await prisma.enrollment.deleteMany({ where: { sectionId: { in: [ID.sectionA, ID.sectionB] } } });
  await prisma.section.deleteMany({ where: { id: { in: [ID.sectionA, ID.sectionB] } } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

let instructorA = "";
let instructorB = "";
let studentA = "";
let studentB = "";
let studentC = "";
let sessionA1 = ""; // student A in assessment A1
let sessionA2 = ""; // student A in assessment A2 (same question)
let sessionB1 = ""; // student A in instructor B's assessment
const sub: Record<string, string> = {};

function question(id: string, title: string, createdById: string, visible: string, hidden: string) {
  return prisma.question.create({
    data: {
      id,
      title,
      statement: `${title} statement`,
      difficulty: "EASY",
      createdById,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            id: visible,
            name: "sample",
            input: "2 3",
            expectedOutput: "5",
            visibility: "VISIBLE",
            weight: 1,
            position: 0,
          },
          {
            id: hidden,
            name: "g7-hidden",
            input: HIDDEN,
            expectedOutput: HIDDEN,
            visibility: "HIDDEN",
            weight: 1,
            position: 1,
          },
        ],
      },
    },
  });
}

async function session(assessmentId: string, studentId: string): Promise<string> {
  const row = await prisma.examSession.create({
    data: {
      assessmentId,
      studentId,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return row.id;
}

async function graded(
  key: string,
  sessionId: string,
  questionId: string,
  attemptNumber: number,
  cases: { testCaseId: string; passed: boolean }[],
  transferSourceQuestionId?: string,
): Promise<string> {
  const row = await prisma.submission.create({
    data: {
      examSessionId: sessionId,
      questionId,
      language: "PYTHON",
      sourceCode: `# ${key}`,
      attemptNumber,
      status: "COMPLETED",
      transferSourceQuestionId: transferSourceQuestionId ?? null,
    },
  });
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId: row.id,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: cases.every((c) => c.passed) ? 100 : 0,
      maxScore: 100,
    },
  });
  await prisma.testCaseResult.createMany({
    data: cases.map((c) => ({
      evaluationRunId: run.id,
      testCaseId: c.testCaseId,
      status: c.passed ? "PASSED" : "FAILED",
      pointsAwarded: c.passed ? 1 : 0,
      pointsPossible: 1,
      stdout: c.passed ? "5" : HIDDEN,
    })),
  });
  sub[key] = row.id;
  return row.id;
}

async function hint(sessionId: string, questionId: string, stageId: string, studentId: string) {
  await prisma.hintUsage.create({
    data: {
      hintStageId: stageId,
      examSessionId: sessionId,
      studentId,
      questionId,
      status: "CONSUMED",
      consumedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructorA, email: "g7-ia@t.local", name: "Instr A", role: "INSTRUCTOR" },
      { id: ID.instructorB, email: "g7-ib@t.local", name: "Instr B", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "g7-sa@t.local", name: "Ann", role: "STUDENT" },
      { id: ID.studentB, email: "g7-sb@t.local", name: "Bea", role: "STUDENT" },
      { id: ID.studentC, email: "g7-sc@t.local", name: "Cal", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "G7-TEST", name: "Governance" } });
  await prisma.section.createMany({
    data: [
      { id: ID.sectionA, courseId: ID.course, name: "A", instructorId: ID.instructorA },
      { id: ID.sectionB, courseId: ID.course, name: "B", instructorId: ID.instructorB },
    ],
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentA, sectionId: ID.sectionA, status: "ACTIVE" },
      { studentId: ID.studentB, sectionId: ID.sectionA, status: "ACTIVE" },
      { studentId: ID.studentC, sectionId: ID.sectionA, status: "ACTIVE" },
      { studentId: ID.studentA, sectionId: ID.sectionB, status: "ACTIVE" },
    ],
  });
  await question(ID.q, "Two Sum", ID.instructorA, ID.qVisible, ID.qHidden);
  await question(ID.qTransfer, "Contains Duplicate", ID.instructorA, ID.tVisible, ID.tHidden);
  await question(ID.qForeign, "Foreign", ID.instructorB, ID.fVisible, ID.fHidden);
  await prisma.question.update({ where: { id: ID.q }, data: { transferQuestionId: ID.qTransfer } });
  await prisma.hintStage.createMany({
    data: [
      { id: ID.stage1, questionId: ID.q, stageNumber: 1, deliveryType: "STATIC", content: "nudge" },
      {
        id: ID.foreignStage,
        questionId: ID.qForeign,
        stageNumber: 1,
        deliveryType: "STATIC",
        content: "foreign",
      },
    ],
  });
  const assessment = (
    id: string,
    title: string,
    sectionId: string,
    createdById: string,
    qid: string,
    status: "ACTIVE" | "CLOSED",
  ) =>
    prisma.assessment.create({
      data: {
        id,
        title,
        status,
        sectionId,
        courseId: ID.course,
        createdById,
        durationMinutes: 60,
        questions: { create: [{ questionId: qid, position: 0, points: 100 }] },
      },
    });
  await assessment(ID.a1, "A1", ID.sectionA, ID.instructorA, ID.q, "CLOSED");
  await assessment(ID.a2, "A2", ID.sectionA, ID.instructorA, ID.q, "CLOSED");
  await assessment(ID.b1, "B1", ID.sectionB, ID.instructorB, ID.qForeign, "CLOSED");
  await assessment(ID.active, "Live", ID.sectionA, ID.instructorA, ID.q, "ACTIVE");

  sessionA1 = await session(ID.a1, ID.studentA);
  sessionA2 = await session(ID.a2, ID.studentA);
  sessionB1 = await session(ID.b1, ID.studentA);

  // Session A1: fail, pass, one hint, a passing transfer.
  await graded("a1-1", sessionA1, ID.q, 1, [
    { testCaseId: ID.qVisible, passed: true },
    { testCaseId: ID.qHidden, passed: false },
  ]);
  await hint(sessionA1, ID.q, ID.stage1, ID.studentA);
  await graded("a1-2", sessionA1, ID.q, 2, [
    { testCaseId: ID.qVisible, passed: true },
    { testCaseId: ID.qHidden, passed: true },
  ]);
  await graded(
    "a1-transfer",
    sessionA1,
    ID.qTransfer,
    1,
    [
      { testCaseId: ID.tVisible, passed: true },
      { testCaseId: ID.tHidden, passed: true },
    ],
    ID.q,
  );
  // Session A2: the SAME question, one failing attempt and its own hint.
  await graded("a2-1", sessionA2, ID.q, 1, [
    { testCaseId: ID.qVisible, passed: false },
    { testCaseId: ID.qHidden, passed: false },
  ]);
  await hint(sessionA2, ID.q, ID.stage1, ID.studentA);
  // Session B1: instructor B's assessment, foreign question.
  await graded("b1-1", sessionB1, ID.qForeign, 1, [
    { testCaseId: ID.fVisible, passed: true },
    { testCaseId: ID.fHidden, passed: true },
  ]);
  // Contamination inserted directly into session A1: an attempt and a hint for a
  // question that is NOT in assessment A1, and a grader-failed run with internals.
  await graded("a1-orphan", sessionA1, ID.qForeign, 1, [
    { testCaseId: ID.fVisible, passed: true },
    { testCaseId: ID.fHidden, passed: true },
  ]);
  await hint(sessionA1, ID.qForeign, ID.foreignStage, ID.studentA);
  await prisma.evaluationRun.update({
    where: { submissionId_runNumber: { submissionId: sub["a1-orphan"]!, runNumber: 1 } },
    data: { status: "FAILED", errorType: "EVALUATOR_ERROR", errorMessage: GRADER_INTERNALS },
  });

  instructorA = await bearer(ID.instructorA, "INSTRUCTOR");
  instructorB = await bearer(ID.instructorB, "INSTRUCTOR");
  studentA = await bearer(ID.studentA, "STUDENT");
  studentB = await bearer(ID.studentB, "STUDENT");
  studentC = await bearer(ID.studentC, "STUDENT");
});

afterAll(cleanup);

const resultUrl = (assessmentId: string, sessionId: string) =>
  `/api/v1/assessments/${assessmentId}/sessions/${sessionId}/result`;

describe("session binding", () => {
  it("replays only the evidence of the requested session, even for a question shared across assessments", async () => {
    const res = await request(app)
      .get(resultUrl(ID.a1, sessionA1))
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);
    const [q] = res.body.data.questions;
    expect(res.body.data.questions).toHaveLength(1);
    expect(q.attempts.map((a: { submissionId: string }) => a.submissionId)).toEqual([
      sub["a1-1"],
      sub["a1-2"],
    ]);
    // Session A2's attempt on the same question and the orphan attempt never appear.
    const ids = JSON.stringify(res.body);
    expect(ids).not.toContain(sub["a2-1"]);
    expect(ids).not.toContain(sub["a1-orphan"]);
    expect(ids).not.toContain(GRADER_INTERNALS);
    expect(ids).not.toContain(HIDDEN);
    // Hints: exactly the one consumed in A1 for this question; the foreign hint is ignored.
    const hints = q.attempts.flatMap((a: { hintsBefore: unknown[] }) => a.hintsBefore);
    expect(hints).toHaveLength(1);
    expect(q.hintsAfterFinalAttempt).toEqual([]);
    expect(res.body.data.summary.hints).toEqual({ stagesConsumed: 1, questionsWithHints: 1 });
    expect(res.body.data.summary.questionEvidence[0]).toMatchObject({
      evaluatedAttempts: 2,
      unsuccessfulAttempts: 1,
      finalOutcome: "PASSED",
    });
    expect(res.body.data.totalScore).toBe(100);
  });

  it("keeps the other session's evidence to itself (same question, other assessment)", async () => {
    const res = await request(app)
      .get(resultUrl(ID.a2, sessionA2))
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);
    const [q] = res.body.data.questions;
    expect(q.attempts.map((a: { submissionId: string }) => a.submissionId)).toEqual([sub["a2-1"]]);
    // The hint was consumed after A2's only attempt (fixture order), so it sits after
    // the final attempt - and it is present here, in A2, not in A1's replay above.
    expect(q.attempts[0].hintsBefore).toHaveLength(0);
    expect(q.hintsAfterFinalAttempt).toHaveLength(1);
    expect(res.body.data.summary.hints).toEqual({ stagesConsumed: 1, questionsWithHints: 1 });
    expect(q.transferCheck).toMatchObject({ attempted: false, result: null, attempt: null });
    expect(res.body.data.totalScore).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(sub["a1-transfer"]);
  });

  it("binds the transfer submission to its originating session only", async () => {
    const row = await prisma.submission.findUniqueOrThrow({ where: { id: sub["a1-transfer"]! } });
    expect(row.examSessionId).toBe(sessionA1);
    expect(row.transferSourceQuestionId).toBe(ID.q);
    const a1 = await request(app)
      .get(resultUrl(ID.a1, sessionA1))
      .set("Authorization", instructorA);
    expect(a1.body.data.questions[0].transferCheck).toMatchObject({
      attempted: true,
      result: "PASSED",
      submissionId: sub["a1-transfer"],
    });
  });

  it("refuses a session/assessment pair that does not match, whoever asks", async () => {
    // Session A1 belongs to A1, not A2 - even for its own instructor.
    expect(
      (await request(app).get(resultUrl(ID.a2, sessionA1)).set("Authorization", instructorA))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get(resultUrl(ID.a1, sessionB1)).set("Authorization", instructorA))
        .status,
    ).toBe(404);
  });

  it("excludes another session's attempts from the cohort counts", async () => {
    const res = await request(app)
      .get(`/api/v1/assessments/${ID.a1}/results`)
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);
    // Only session A1 belongs to A1: one student attempted, eventually passed in 2 attempts.
    expect(res.body.data.questions[0].evidence).toEqual({
      studentsAttempted: 1,
      firstEvaluatedAttemptPassed: 0,
      eventuallyPassed: 1,
      meanEvaluatedAttemptsAmongPassed: 2,
    });
  });
});

describe("ownership", () => {
  it("a student cannot read another student's session, submissions or transfer evidence", async () => {
    expect(
      (
        await request(app)
          .get(`/api/v1/student/sessions/${sessionA1}`)
          .set("Authorization", studentB)
      ).status,
    ).toBe(404);
    for (const key of ["a1-1", "a1-transfer"]) {
      expect(
        (
          await request(app)
            .get(`/api/v1/student/submissions/${sub[key]}`)
            .set("Authorization", studentB)
        ).status,
      ).toBe(404);
    }
    const own = await request(app)
      .get(`/api/v1/student/submissions/${sub["a1-1"]}`)
      .set("Authorization", studentA);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain(HIDDEN);
    // Hints / transfer / drafts are scoped the same way.
    expect(
      (
        await request(app)
          .get(`/api/v1/student/sessions/${sessionA1}/questions/${ID.q}/hints`)
          .set("Authorization", studentB)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/student/sessions/${sessionA1}/questions/${ID.q}/transfer`)
          .set("Authorization", studentB)
      ).status,
    ).toBe(404);
  });

  it("an instructor cannot read an assessment or session they do not own", async () => {
    expect(
      (await request(app).get(resultUrl(ID.a1, sessionA1)).set("Authorization", instructorB))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/assessments/${ID.a1}/results`)
          .set("Authorization", instructorB)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/assessments/${ID.a1}/sessions/${sessionA1}/violations`)
          .set("Authorization", instructorB)
      ).status,
    ).toBe(404);
    // ...but does see their own.
    const own = await request(app)
      .get(resultUrl(ID.b1, sessionB1))
      .set("Authorization", instructorB);
    expect(own.status).toBe(200);
    expect(
      own.body.data.questions[0].attempts.map((a: { submissionId: string }) => a.submissionId),
    ).toEqual([sub["b1-1"]]);
    expect(
      (await request(app).get(resultUrl(ID.a1, sessionA1)).set("Authorization", studentA)).status,
    ).toBe(403);
  });
});

describe("active session and evidence notice", () => {
  const start = (token: string, body?: object) =>
    request(app)
      .post(`/api/v1/student/assessments/${ID.active}/session`)
      .set("Authorization", token)
      .send(body as never);

  it("converges concurrent starts on the single session and records no acknowledgement without one", async () => {
    const results = await Promise.all([start(studentC), start(studentC), start(studentC)]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const ids = new Set(results.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    expect(
      await prisma.examSession.count({
        where: { assessmentId: ID.active, studentId: ID.studentC },
      }),
    ).toBe(1);
    expect(results[0]!.body.data.evidenceNoticeAcknowledgedAt).toBeNull();
  });

  it("records the acknowledgement when sent, exposes it to student and instructor, and never clears it", async () => {
    const before = new Date();
    const acked = await start(studentC, { acknowledgeEvidenceNotice: true });
    expect(acked.status).toBe(201);
    const at: string = acked.body.data.evidenceNoticeAcknowledgedAt;
    expect(at).not.toBeNull();
    expect(new Date(at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    // Starting again without the flag keeps the recorded value.
    const again = await start(studentC);
    expect(again.body.data.evidenceNoticeAcknowledgedAt).toBe(at);
    // ...and sending it again does not move it.
    const twice = await start(studentC, { acknowledgeEvidenceNotice: true });
    expect(twice.body.data.evidenceNoticeAcknowledgedAt).toBe(at);

    const list = await request(app)
      .get("/api/v1/student/assessments")
      .set("Authorization", studentC);
    const live = list.body.data.find((a: { id: string }) => a.id === ID.active);
    expect(live.session.evidenceNoticeAcknowledgedAt).toBe(at);

    const sessionId: string = acked.body.data.id;
    const breakdown = await request(app)
      .get(resultUrl(ID.active, sessionId))
      .set("Authorization", instructorA);
    expect(breakdown.status).toBe(200);
    expect(breakdown.body.data.evidenceNoticeAcknowledgedAt).toBe(at);
  });

  it("records the acknowledgement at creation for a fresh start and rejects a malformed body", async () => {
    const created = await start(studentB, { acknowledgeEvidenceNotice: true });
    expect(created.status).toBe(201);
    expect(created.body.data.evidenceNoticeAcknowledgedAt).not.toBeNull();
    const bad = await start(studentB, { acknowledgeEvidenceNotice: "yes" });
    expect(bad.status).toBe(400);
  });
});
