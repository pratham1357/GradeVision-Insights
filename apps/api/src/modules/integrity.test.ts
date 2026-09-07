/**
 * Assessment integrity + instructor monitoring: integration tests against the
 * real database in `DATABASE_URL`. Fixtures use fixed ids under the `bbbbbbbb-…`
 * range and self-clean.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructorA: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  instructorB: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
  studentA: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
  studentB: "bbbbbbbb-bbbb-4bbb-8bbb-000000000004",
  course: "bbbbbbbb-bbbb-4bbb-8bbb-000000000010",
  section: "bbbbbbbb-bbbb-4bbb-8bbb-000000000020",
  question: "bbbbbbbb-bbbb-4bbb-8bbb-000000000030",
  assessment: "bbbbbbbb-bbbb-4bbb-8bbb-000000000040",
  tcVisible: "bbbbbbbb-bbbb-4bbb-8bbb-000000000051",
  tcHidden: "bbbbbbbb-bbbb-4bbb-8bbb-000000000052",
  crit: "bbbbbbbb-bbbb-4bbb-8bbb-000000000060",
  sessionA: "bbbbbbbb-bbbb-4bbb-8bbb-000000000071",
  sessionSubmitted: "bbbbbbbb-bbbb-4bbb-8bbb-000000000072",
} as const;

const HIDDEN_INPUT = "BBBB-HIDDEN-INPUT-3c";
const HIDDEN_EXPECTED = "BBBB-HIDDEN-EXPECTED-3c";

async function cleanup(): Promise<void> {
  const users = [ID.instructorA, ID.instructorB, ID.studentA, ID.studentB];
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [ID.sessionA, ID.sessionSubmitted] } },
  });
  await prisma.violation.deleteMany({ where: { examSession: { assessmentId: ID.assessment } } });
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
      { id: ID.instructorA, email: "bb-ia@t.local", name: "Instr A", role: "INSTRUCTOR" },
      { id: ID.instructorB, email: "bb-ib@t.local", name: "Instr B", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "bb-sa@t.local", name: "Aaron Student", role: "STUDENT" },
      { id: ID.studentB, email: "bb-sb@t.local", name: "Bella Student", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "BB-TEST", name: "Integrity Test" } });
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
      statement: "add",
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
            name: "hidden",
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
                name: "Functional",
                type: "FUNCTIONAL_CORRECTNESS",
                maxPoints: 100,
                position: 0,
              },
            ],
          },
        },
      },
    },
  });
  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Integrity Assessment",
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
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [ID.sessionA, ID.sessionSubmitted] } },
  });
  await prisma.violation.deleteMany({ where: { examSession: { assessmentId: ID.assessment } } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.criterionScore.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.evaluationRun.deleteMany({ where: { submission: { questionId: ID.question } } });
  await prisma.submission.deleteMany({ where: { questionId: ID.question } });
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.assessment } });

  await prisma.examSession.create({
    data: {
      id: ID.sessionA,
      assessmentId: ID.assessment,
      studentId: ID.studentA,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
});

const violationUrl = `/api/v1/student/sessions/${ID.sessionA}/violations`;
const instructorViolationsUrl = `/api/v1/assessments/${ID.assessment}/sessions/${ID.sessionA}/violations`;

describe("recording violations", () => {
  it("records a violation, increments the count, and escalates the warning", async () => {
    const first = await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "WINDOW_BLUR", note: "switched away" });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ recorded: true, violationCount: 1 });
    expect(first.body.data.warning).toMatch(/recorded/i);

    await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "TAB_SWITCH" });
    const third = await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "FULLSCREEN_EXIT" });
    expect(third.body.data.violationCount).toBe(3);
    expect(third.body.data.warning).toMatch(/stay in the exam/i);

    const rows = await prisma.violation.findMany({ where: { examSessionId: ID.sessionA } });
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.type === "FULLSCREEN_EXIT" && r.severity === "MEDIUM")).toBe(true);

    const audit = await prisma.auditEvent.findMany({
      where: { action: "integrity.violation", entityId: ID.sessionA },
    });
    expect(audit.length).toBe(3);
  });

  it("surfaces the count on the student exam view", async () => {
    await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "WINDOW_BLUR" });
    const view = await request(app)
      .get(`/api/v1/student/sessions/${ID.sessionA}`)
      .set("Authorization", studentA);
    expect(view.status).toBe(200);
    expect(view.body.data.integrity.violationCount).toBe(1);
    expect(view.body.data.integrity.warning).toBeTruthy();
  });

  it("rejects another student (404) and a bad type (400)", async () => {
    expect(
      (
        await request(app)
          .post(violationUrl)
          .set("Authorization", studentB)
          .send({ type: "WINDOW_BLUR" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(violationUrl)
          .set("Authorization", studentA)
          .send({ type: "NONSENSE" })
      ).status,
    ).toBe(400);
  });

  it("rejects recording on a session that is no longer in progress (409)", async () => {
    await prisma.examSession.create({
      data: {
        id: ID.sessionSubmitted,
        assessmentId: ID.assessment,
        studentId: ID.studentB,
        status: "SUBMITTED",
        startedAt: new Date(Date.now() - 10_000),
        submittedAt: new Date(),
      },
    });
    const res = await request(app)
      .post(`/api/v1/student/sessions/${ID.sessionSubmitted}/violations`)
      .set("Authorization", studentB)
      .send({ type: "WINDOW_BLUR" });
    expect(res.status).toBe(409);
    await prisma.examSession.deleteMany({ where: { id: ID.sessionSubmitted } });
  });
});

describe("instructor monitoring", () => {
  it("lists a session's violations for the owning instructor only", async () => {
    await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "TAB_SWITCH", note: "n" });

    const owned = await request(app).get(instructorViolationsUrl).set("Authorization", instructorA);
    expect(owned.status).toBe(200);
    expect(owned.body.data.violationCount).toBe(1);
    expect(owned.body.data.violations[0]).toMatchObject({ type: "TAB_SWITCH", note: "n" });

    expect(
      (await request(app).get(instructorViolationsUrl).set("Authorization", instructorB)).status,
    ).toBe(404);
    expect(
      (await request(app).get(instructorViolationsUrl).set("Authorization", studentA)).status,
    ).toBe(403);
  });

  it("includes stats and per-student violation counts in the results view", async () => {
    await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "WINDOW_BLUR" });
    await request(app)
      .post(violationUrl)
      .set("Authorization", studentA)
      .send({ type: "WINDOW_BLUR" });

    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/results`)
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toMatchObject({ totalStudents: 2, totalViolations: 2 });
    const aaron = res.body.data.students.find((s: { studentName: string }) =>
      s.studentName.startsWith("Aaron"),
    );
    expect(aaron.violationCount).toBe(2);
  });

  it("returns a per-session breakdown with hidden test data redacted", async () => {
    const submission = await prisma.submission.create({
      data: {
        examSessionId: ID.sessionA,
        questionId: ID.question,
        language: "PYTHON",
        sourceCode: "print(sum(map(int, input().split())))",
        attemptNumber: 1,
        status: "COMPLETED",
      },
    });
    const run = await prisma.evaluationRun.create({
      data: {
        submissionId: submission.id,
        runNumber: 1,
        status: "COMPLETED",
        totalScore: 50,
        maxScore: 100,
        completedAt: new Date(),
      },
    });
    await prisma.testCaseResult.createMany({
      data: [
        {
          evaluationRunId: run.id,
          testCaseId: ID.tcVisible,
          status: "PASSED",
          pointsAwarded: 1,
          pointsPossible: 1,
          stdout: "5",
        },
        {
          evaluationRunId: run.id,
          testCaseId: ID.tcHidden,
          status: "FAILED",
          pointsAwarded: 0,
          pointsPossible: 1,
          stdout: "SECRET-OUT",
        },
      ],
    });
    await prisma.criterionScore.create({
      data: {
        evaluationRunId: run.id,
        rubricCriterionId: ID.crit,
        pointsAwarded: 50,
        maxPoints: 100,
      },
    });

    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/sessions/${ID.sessionA}/result`)
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);
    const q = res.body.data.questions[0];
    expect(q.evaluation.testsPassed).toBe(1);
    const hidden = q.evaluation.testResults.find((t: { hidden: boolean }) => t.hidden);
    expect(hidden).toMatchObject({
      status: "FAILED",
      input: null,
      expectedOutput: null,
      actualOutput: null,
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(HIDDEN_INPUT);
    expect(serialized).not.toContain(HIDDEN_EXPECTED);
    expect(serialized).not.toContain("SECRET-OUT");

    expect(
      (
        await request(app)
          .get(`/api/v1/assessments/${ID.assessment}/sessions/${ID.sessionA}/result`)
          .set("Authorization", instructorB)
      ).status,
    ).toBe(404);
  });
});
