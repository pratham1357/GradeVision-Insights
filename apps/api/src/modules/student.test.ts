/**
 * Student assessment-taking: integration tests against the real database in
 * `DATABASE_URL`. Fixtures use fixed ids under the `eeeeeeee-…` range and are
 * removed before and after the run, so a crashed run self-heals and seed data is
 * untouched.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructor: "eeeeeeee-eeee-4eee-8eee-000000000001",
  studentA: "eeeeeeee-eeee-4eee-8eee-000000000002",
  studentB: "eeeeeeee-eeee-4eee-8eee-000000000003",
  studentC: "eeeeeeee-eeee-4eee-8eee-000000000004", // not enrolled
  course: "eeeeeeee-eeee-4eee-8eee-000000000010",
  section: "eeeeeeee-eeee-4eee-8eee-000000000020",
  q1: "eeeeeeee-eeee-4eee-8eee-000000000030",
  q2: "eeeeeeee-eeee-4eee-8eee-000000000031",
  active: "eeeeeeee-eeee-4eee-8eee-000000000040",
  draftAssessment: "eeeeeeee-eeee-4eee-8eee-000000000041",
} as const;

const HIDDEN_INPUT = "SECRET-HIDDEN-INPUT-9f2a";
const HIDDEN_OUTPUT = "SECRET-HIDDEN-OUTPUT-9f2a";

async function cleanup(): Promise<void> {
  const userIds = [ID.instructor, ID.studentA, ID.studentB, ID.studentC];
  await prisma.submissionDraft.deleteMany({
    where: { examSession: { studentId: { in: userIds } } },
  });
  await prisma.submission.deleteMany({ where: { examSession: { studentId: { in: userIds } } } });
  await prisma.examSession.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.assessment.deleteMany({ where: { createdById: ID.instructor } });
  await prisma.question.deleteMany({ where: { createdById: ID.instructor } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function bearer(userId: string, role: "STUDENT" | "INSTRUCTOR"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

let studentA = "";
let studentB = "";
let studentC = "";
let instructor = "";

beforeAll(async () => {
  await cleanup();

  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "stud-i@t.local", name: "Instr", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "stud-a@t.local", name: "Student A", role: "STUDENT" },
      { id: ID.studentB, email: "stud-b@t.local", name: "Student B", role: "STUDENT" },
      { id: ID.studentC, email: "stud-c@t.local", name: "Student C", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "STUD-TEST", name: "Student Test" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructor },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentA, sectionId: ID.section, status: "ACTIVE" },
      { studentId: ID.studentB, sectionId: ID.section, status: "ACTIVE" },
    ],
  });

  await prisma.question.create({
    data: {
      id: ID.q1,
      title: "Q1",
      statement: "do a thing",
      difficulty: "EASY",
      createdById: ID.instructor,
      languages: {
        create: [
          { language: "PYTHON", starterCode: "# start" },
          { language: "JAVASCRIPT", starterCode: null },
        ],
      },
      testCases: {
        create: [
          { name: "sample", input: "1", expectedOutput: "2", visibility: "VISIBLE", position: 0 },
          {
            name: "hidden",
            input: HIDDEN_INPUT,
            expectedOutput: HIDDEN_OUTPUT,
            visibility: "HIDDEN",
            position: 1,
          },
        ],
      },
    },
  });
  await prisma.question.create({
    data: {
      id: ID.q2,
      title: "Q2",
      statement: "do another thing",
      difficulty: "MEDIUM",
      createdById: ID.instructor,
      languages: { create: [{ language: "PYTHON", starterCode: "# q2" }] },
    },
  });

  await prisma.assessment.create({
    data: {
      id: ID.active,
      title: "Active One",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 60,
      questions: {
        create: [
          { questionId: ID.q1, position: 0, points: 60 },
          { questionId: ID.q2, position: 1, points: 40 },
        ],
      },
    },
  });
  await prisma.assessment.create({
    data: {
      id: ID.draftAssessment,
      title: "Draft One",
      status: "DRAFT",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 60,
      questions: { create: [{ questionId: ID.q1, position: 0, points: 100 }] },
    },
  });

  studentA = await bearer(ID.studentA, "STUDENT");
  studentB = await bearer(ID.studentB, "STUDENT");
  studentC = await bearer(ID.studentC, "STUDENT");
  instructor = await bearer(ID.instructor, "INSTRUCTOR");
});

afterAll(cleanup);

// Each test starts from a clean session slate for student A/B/C.
beforeEach(async () => {
  const userIds = [ID.studentA, ID.studentB, ID.studentC];
  await prisma.submissionDraft.deleteMany({
    where: { examSession: { studentId: { in: userIds } } },
  });
  await prisma.submission.deleteMany({ where: { examSession: { studentId: { in: userIds } } } });
  await prisma.examSession.deleteMany({ where: { studentId: { in: userIds } } });
});

async function startSession(token: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/student/assessments/${ID.active}/session`)
    .set("Authorization", token);
  return res.body.data.id as string;
}

describe("discovery & authorization", () => {
  it("401 without a token, 403 for an instructor", async () => {
    expect((await request(app).get("/api/v1/student/assessments")).status).toBe(401);
    const asInstructor = await request(app)
      .get("/api/v1/student/assessments")
      .set("Authorization", instructor);
    expect(asInstructor.status).toBe(403);
  });

  it("an enrolled student sees the ACTIVE assessment but not the DRAFT one", async () => {
    const res = await request(app)
      .get("/api/v1/student/assessments")
      .set("Authorization", studentA);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toContain(ID.active);
    expect(ids).not.toContain(ID.draftAssessment);
  });

  it("a non-enrolled student sees nothing and cannot start", async () => {
    const list = await request(app)
      .get("/api/v1/student/assessments")
      .set("Authorization", studentC);
    expect(list.body.data).toHaveLength(0);

    const start = await request(app)
      .post(`/api/v1/student/assessments/${ID.active}/session`)
      .set("Authorization", studentC);
    expect(start.status).toBe(404);
  });

  it("cannot start a session for a DRAFT assessment", async () => {
    const res = await request(app)
      .post(`/api/v1/student/assessments/${ID.draftAssessment}/session`)
      .set("Authorization", studentA);
    expect(res.status).toBe(404);
  });
});

describe("sessions", () => {
  it("starts a session with server-computed expiry, and resuming is idempotent", async () => {
    const first = await request(app)
      .post(`/api/v1/student/assessments/${ID.active}/session`)
      .set("Authorization", studentA);
    expect(first.status).toBe(201);
    expect(first.body.data.timing.status).toBe("IN_PROGRESS");
    expect(first.body.data.timing.remainingSeconds).toBeGreaterThan(3500);

    const second = await request(app)
      .post(`/api/v1/student/assessments/${ID.active}/session`)
      .set("Authorization", studentA);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await prisma.examSession.count({
      where: { studentId: ID.studentA, assessmentId: ID.active },
    });
    expect(rows).toBe(1);
  });

  it("returns questions in position order and never leaks hidden test-case data", async () => {
    const sessionId = await startSession(studentA);
    const res = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}`)
      .set("Authorization", studentA);

    expect(res.status).toBe(200);
    expect(res.body.data.questions.map((q: { position: number }) => q.position)).toEqual([0, 1]);
    expect(res.body.data.questions[0].sampleTestCases).toHaveLength(1);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(HIDDEN_INPUT);
    expect(serialized).not.toContain(HIDDEN_OUTPUT);
  });

  it("a student cannot read another student's session", async () => {
    const sessionId = await startSession(studentA);
    const res = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}`)
      .set("Authorization", studentB);
    expect(res.status).toBe(404);
  });
});

describe("drafts", () => {
  it("saves and idempotently updates a draft that survives a reload", async () => {
    const sessionId = await startSession(studentA);

    await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "v1" });
    const save2 = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentA)
      .send({ language: "JAVASCRIPT", sourceCode: "v2" });
    expect(save2.status).toBe(200);

    const rows = await prisma.submissionDraft.count({
      where: { examSessionId: sessionId, questionId: ID.q1 },
    });
    expect(rows).toBe(1);

    const view = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}`)
      .set("Authorization", studentA);
    const q1 = view.body.data.questions.find((q: { id: string }) => q.id === ID.q1);
    expect(q1.draft).toMatchObject({ language: "JAVASCRIPT", sourceCode: "v2" });
  });

  it("rejects a draft for an unsupported language (400)", async () => {
    const sessionId = await startSession(studentA);
    const res = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentA)
      .send({ language: "JAVA", sourceCode: "x" });
    expect(res.status).toBe(400);
  });

  it("a student cannot write to another student's draft", async () => {
    const sessionId = await startSession(studentA);
    const res = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentB)
      .send({ language: "PYTHON", sourceCode: "x" });
    expect(res.status).toBe(404);
  });
});

describe("submissions", () => {
  it("persists a submission as QUEUED and increments the attempt number", async () => {
    const sessionId = await startSession(studentA);

    const s1 = await request(app)
      .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(1)" });
    expect(s1.status).toBe(201);
    expect(s1.body.data.submission).toMatchObject({ status: "QUEUED", attemptNumber: 1 });

    const s2 = await request(app)
      .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "print(2)" });
    expect(s2.body.data.submission.attemptNumber).toBe(2);

    const rows = await prisma.submission.findMany({
      where: { examSessionId: sessionId, questionId: ID.q1 },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "QUEUED")).toBe(true);
  });

  it("a student cannot submit to another student's session", async () => {
    const sessionId = await startSession(studentA);
    const res = await request(app)
      .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/submissions`)
      .set("Authorization", studentB)
      .send({ language: "PYTHON", sourceCode: "print(1)" });
    expect(res.status).toBe(404);
  });
});

describe("expiry", () => {
  it("an expired session is persisted EXPIRED, rejects new work, and keeps saved work", async () => {
    const sessionId = await startSession(studentA);
    await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "saved before expiry" });

    await prisma.examSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const view = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}`)
      .set("Authorization", studentA);
    expect(view.body.data.timing.status).toBe("EXPIRED");
    expect(view.body.data.timing.remainingSeconds).toBe(0);
    const q1 = view.body.data.questions.find((q: { id: string }) => q.id === ID.q1);
    expect(q1.draft.sourceCode).toBe("saved before expiry");

    const persisted = await prisma.examSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(persisted.status).toBe("EXPIRED");

    const lateDraft = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/draft`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "too late" });
    expect(lateDraft.status).toBe(409);

    const lateSubmit = await request(app)
      .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.q1}/submissions`)
      .set("Authorization", studentA)
      .send({ language: "PYTHON", sourceCode: "too late" });
    expect(lateSubmit.status).toBe(409);
  });
});
