/**
 * Instructor monitoring: real-student roster + system metrics. Integration
 * tests against the database in `DATABASE_URL`. Fixtures under the
 * `2a...` id range; removed before and after so seed data is never touched.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructorA: "2a000000-0000-4000-8000-000000000001",
  instructorB: "2a000000-0000-4000-8000-000000000002",
  studentX: "2a000000-0000-4000-8000-000000000003",
  studentY: "2a000000-0000-4000-8000-000000000004",
  studentZ: "2a000000-0000-4000-8000-000000000005",
  course: "2a000000-0000-4000-8000-000000000010",
  sectionA: "2a000000-0000-4000-8000-000000000020",
  sectionB: "2a000000-0000-4000-8000-000000000021",
  question: "2a000000-0000-4000-8000-000000000030",
  assessmentA: "2a000000-0000-4000-8000-000000000040",
  assessmentB: "2a000000-0000-4000-8000-000000000041",
  tc: "2a000000-0000-4000-8000-000000000050",
} as const;

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT" | "ADMIN"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

async function cleanup(): Promise<void> {
  const questionIds = [ID.question];
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: { in: questionIds } } } },
  });
  await prisma.evaluationRun.deleteMany({
    where: { submission: { questionId: { in: questionIds } } },
  });
  await prisma.submission.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.submissionDraft.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.violation.deleteMany({
    where: { examSession: { assessmentId: { in: [ID.assessmentA, ID.assessmentB] } } },
  });
  await prisma.examSession.deleteMany({
    where: { assessmentId: { in: [ID.assessmentA, ID.assessmentB] } },
  });
  await prisma.assessment.deleteMany({ where: { id: { in: [ID.assessmentA, ID.assessmentB] } } });
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
  await prisma.enrollment.deleteMany({ where: { sectionId: { in: [ID.sectionA, ID.sectionB] } } });
  await prisma.section.deleteMany({ where: { id: { in: [ID.sectionA, ID.sectionB] } } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({
    where: { id: { in: [ID.instructorA, ID.instructorB, ID.studentX, ID.studentY, ID.studentZ] } },
  });
}

let instructorA = "";
let instructorB = "";
let studentToken = "";
let sessionXId = "";
let submissionXId = "";

beforeAll(async () => {
  await cleanup();

  await prisma.user.createMany({
    data: [
      { id: ID.instructorA, email: "2a-a@instr.local", name: "Prof A", role: "INSTRUCTOR" },
      { id: ID.instructorB, email: "2a-b@instr.local", name: "Prof B", role: "INSTRUCTOR" },
      { id: ID.studentX, email: "2a-x@stud.local", name: "Xena Xu", role: "STUDENT" },
      { id: ID.studentY, email: "2a-y@stud.local", name: "Yves Yang", role: "STUDENT" },
      { id: ID.studentZ, email: "2a-z@stud.local", name: "Zoe Zimm", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "MON-2A", name: "Monitoring" } });
  await prisma.section.createMany({
    data: [
      { id: ID.sectionA, courseId: ID.course, name: "Sec A", instructorId: ID.instructorA },
      { id: ID.sectionB, courseId: ID.course, name: "Sec B", instructorId: ID.instructorB },
    ],
  });
  // Xena + Zoe in A's section; Yves in B's section.
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.studentX, sectionId: ID.sectionA, status: "ACTIVE" },
      { studentId: ID.studentZ, sectionId: ID.sectionA, status: "ACTIVE" },
      { studentId: ID.studentY, sectionId: ID.sectionB, status: "ACTIVE" },
    ],
  });
  await prisma.question.create({
    data: {
      id: ID.question,
      title: "Echo",
      statement: "print input",
      difficulty: "EASY",
      createdById: ID.instructorA,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            id: ID.tc,
            name: "sample",
            input: "hi",
            expectedOutput: "hi",
            visibility: "VISIBLE",
            weight: 1,
            position: 0,
          },
        ],
      },
    },
  });
  await prisma.assessment.createMany({
    data: [
      {
        id: ID.assessmentA,
        title: "A Exam",
        status: "ACTIVE",
        sectionId: ID.sectionA,
        courseId: ID.course,
        createdById: ID.instructorA,
        durationMinutes: 60,
      },
      {
        id: ID.assessmentB,
        title: "B Exam",
        status: "ACTIVE",
        sectionId: ID.sectionB,
        courseId: ID.course,
        createdById: ID.instructorB,
        durationMinutes: 60,
      },
    ],
  });
  await prisma.assessmentQuestion.create({
    data: { assessmentId: ID.assessmentA, questionId: ID.question, position: 0, points: 100 },
  });

  // Xena starts A's exam, submits once, gets a COMPLETED run (80/100) + 1 violation.
  const session = await prisma.examSession.create({
    data: {
      assessmentId: ID.assessmentA,
      studentId: ID.studentX,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });
  sessionXId = session.id;
  const submission = await prisma.submission.create({
    data: {
      examSessionId: session.id,
      questionId: ID.question,
      language: "PYTHON",
      sourceCode: "print(input())",
      attemptNumber: 1,
      status: "COMPLETED",
    },
  });
  submissionXId = submission.id;
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId: submission.id,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: 80,
      maxScore: 100,
      completedAt: new Date(),
    },
  });
  await prisma.testCaseResult.create({
    data: {
      evaluationRunId: run.id,
      testCaseId: ID.tc,
      status: "PASSED",
      pointsAwarded: 1,
      pointsPossible: 1,
      stdout: "hi",
    },
  });
  await prisma.violation.create({
    data: { examSessionId: session.id, type: "FULLSCREEN_EXIT", severity: "MEDIUM" },
  });

  instructorA = await bearer(ID.instructorA, "INSTRUCTOR");
  instructorB = await bearer(ID.instructorB, "INSTRUCTOR");
  studentToken = await bearer(ID.studentX, "STUDENT");
});

afterAll(cleanup);

describe("GET /api/v1/monitoring/students", () => {
  it("returns the instructor's real, database-derived student roster", async () => {
    const res = await request(app)
      .get("/api/v1/monitoring/students")
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);

    const students: Record<string, unknown>[] = res.body.data.students;
    const names = students.map((s) => s.name).sort();
    // Only A's students; never B's student Yves.
    expect(names).toEqual(["Xena Xu", "Zoe Zimm"]);

    const xena = students.find((s) => s.name === "Xena Xu") as Record<string, unknown>;
    expect(xena.email).toBe("2a-x@stud.local");
    expect(xena.submissionCount).toBe(1);
    expect(xena.assessmentsStarted).toBe(1);
    expect(xena.assessmentsAssigned).toBe(1);
    expect(xena.inProgress).toBe(true);
    expect(xena.violationCount).toBe(1);
    expect((xena.latestSubmission as Record<string, unknown>).scorePercent).toBe(80);
    expect((xena.sections as { name: string }[])[0]!.name).toBe("Sec A");

    // A student with no activity still appears, with zeroed activity.
    const zoe = students.find((s) => s.name === "Zoe Zimm") as Record<string, unknown>;
    expect(zoe.submissionCount).toBe(0);
    expect(zoe.assessmentsStarted).toBe(0);
    expect(zoe.latestSubmission).toBeNull();

    expect(res.body.data.summary).toMatchObject({
      totalStudents: 2,
      sectionsCount: 1,
      inProgressCount: 1,
      submittedCount: 0,
      totalViolations: 1,
    });
  });

  it("reflects live database changes rather than fixed values", async () => {
    const before = await request(app)
      .get("/api/v1/monitoring/students")
      .set("Authorization", instructorA);
    const xenaBefore = (before.body.data.students as Record<string, unknown>[]).find(
      (s) => s.name === "Xena Xu",
    ) as Record<string, unknown>;
    expect(xenaBefore.violationCount).toBe(1);

    await prisma.violation.create({
      data: { examSessionId: sessionXId, type: "TAB_SWITCH", severity: "LOW" },
    });
    await prisma.violation.create({
      data: { examSessionId: sessionXId, type: "WINDOW_BLUR", severity: "LOW" },
    });

    const after = await request(app)
      .get("/api/v1/monitoring/students")
      .set("Authorization", instructorA);
    const xenaAfter = (after.body.data.students as Record<string, unknown>[]).find(
      (s) => s.name === "Xena Xu",
    ) as Record<string, unknown>;
    expect(xenaAfter.violationCount).toBe(3);
    expect(xenaAfter.flagged).toBe(true);
    expect(after.body.data.summary.totalViolations).toBe(3);
    expect(after.body.data.summary.flaggedStudents).toBe(1);

    // cleanup the extra violations so other assertions stay stable
    await prisma.violation.deleteMany({
      where: { examSessionId: sessionXId, type: { in: ["TAB_SWITCH", "WINDOW_BLUR"] } },
    });
  });

  it("never exposes another instructor's students or data", async () => {
    const res = await request(app)
      .get("/api/v1/monitoring/students")
      .set("Authorization", instructorB);
    expect(res.status).toBe(200);
    const names = (res.body.data.students as { name: string }[]).map((s) => s.name);
    expect(names).toEqual(["Yves Yang"]);
    expect(JSON.stringify(res.body)).not.toContain("Xena Xu");
    expect(JSON.stringify(res.body)).not.toContain(submissionXId);
  });

  it("rejects a student with 403 and an anonymous caller with 401", async () => {
    const forbidden = await request(app)
      .get("/api/v1/monitoring/students")
      .set("Authorization", studentToken);
    expect(forbidden.status).toBe(403);

    const anon = await request(app).get("/api/v1/monitoring/students");
    expect(anon.status).toBe(401);
  });
});

describe("GET /api/v1/monitoring/system", () => {
  it("requires an instructor/admin and returns real runtime measurements", async () => {
    expect(
      (await request(app).get("/api/v1/monitoring/system").set("Authorization", studentToken))
        .status,
    ).toBe(403);
    expect((await request(app).get("/api/v1/monitoring/system")).status).toBe(401);

    const res = await request(app)
      .get("/api/v1/monitoring/system")
      .set("Authorization", instructorA);
    expect(res.status).toBe(200);

    const m = res.body.data;
    expect(typeof m.process.startedAt).toBe("string");
    expect(m.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(m.memory.rssBytes).toBeGreaterThan(0);
    expect(m.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(typeof m.cpu.userMs).toBe("number");
    expect(typeof m.cpu.systemMs).toBe("number");
    expect(m.cpu.sampleMs).toBeGreaterThan(0);
    // This very request is counted while in flight.
    expect(m.requests.inFlight).toBeGreaterThanOrEqual(1);
    expect(m.requests.total).toBeGreaterThanOrEqual(1);
    expect(m.database.status).toBe("up");
    expect(m.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not leak secrets, env vars, connection strings, paths, or stack traces", async () => {
    const res = await request(app)
      .get("/api/v1/monitoring/system")
      .set("Authorization", instructorA);
    const body = JSON.stringify(res.body).toLowerCase();
    for (const needle of [
      "postgresql://",
      "gradevision_dev_pw",
      "jwt_secret",
      "test-jwt-secret",
      "database_url",
      "password",
      "node_modules",
      "c:\\\\",
      "/users/",
      "\\n    at ",
      "process.env",
    ]) {
      expect(body).not.toContain(needle);
    }
    // Only the documented metric groups are present.
    expect(Object.keys(res.body.data).sort()).toEqual(
      ["cpu", "database", "generatedAt", "memory", "process", "requests"].sort(),
    );
  });
});
