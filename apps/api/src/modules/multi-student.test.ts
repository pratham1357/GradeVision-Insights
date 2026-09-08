/**
 * Multi-student correctness: two students take the same assessment independently,
 * and a FAILED evaluation never leaks the evaluator's raw error to either the
 * student or the instructor. Fixtures under the `71...` id range; self-cleaning.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructor: "71000000-0000-4000-8000-000000000001",
  studentA: "71000000-0000-4000-8000-000000000002",
  studentB: "71000000-0000-4000-8000-000000000003",
  course: "71000000-0000-4000-8000-000000000010",
  section: "71000000-0000-4000-8000-000000000020",
  question: "71000000-0000-4000-8000-000000000030",
  assessment: "71000000-0000-4000-8000-000000000040",
  tcVisible: "71000000-0000-4000-8000-000000000051",
} as const;

const RAW_EVALUATOR_ERROR = "connect ECONNREFUSED 127.0.0.1:2358 (secret internal detail)";

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

async function cleanup(): Promise<void> {
  const users = [ID.instructor, ID.studentA, ID.studentB];
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

let studentA = "";
let studentB = "";
let instructor = "";

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "71-i@t.local", name: "Prof", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "71-a@t.local", name: "Amy A", role: "STUDENT" },
      { id: ID.studentB, email: "71-b@t.local", name: "Ben B", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "MULTI-71", name: "Multi" } });
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
      id: ID.question,
      title: "Echo",
      statement: "print input",
      difficulty: "EASY",
      createdById: ID.instructor,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            id: ID.tcVisible,
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
  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Shared Exam",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 90,
      questions: { create: [{ questionId: ID.question, position: 0, points: 100 }] },
    },
  });

  studentA = await bearer(ID.studentA, "STUDENT");
  studentB = await bearer(ID.studentB, "STUDENT");
  instructor = await bearer(ID.instructor, "INSTRUCTOR");
});

afterAll(cleanup);

beforeEach(async () => {
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
});

async function startAndSubmit(
  token: string,
  code: string,
): Promise<{ sessionId: string; submissionId: string }> {
  const start = await request(app)
    .post(`/api/v1/student/assessments/${ID.assessment}/session`)
    .set("Authorization", token);
  expect(start.status).toBe(201);
  const sessionId: string = start.body.data.id;
  const sub = await request(app)
    .post(`/api/v1/student/sessions/${sessionId}/questions/${ID.question}/submissions`)
    .set("Authorization", token)
    .send({ language: "PYTHON", sourceCode: code });
  expect(sub.status).toBe(201);
  return { sessionId, submissionId: sub.body.data.submission.id };
}

async function seedRun(submissionId: string, kind: "completed" | "failed"): Promise<void> {
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId,
      runNumber: 1,
      status: kind === "completed" ? "COMPLETED" : "FAILED",
      totalScore: kind === "completed" ? 100 : null,
      maxScore: kind === "completed" ? 100 : null,
      errorType: kind === "failed" ? "EVALUATOR_ERROR" : null,
      errorMessage: kind === "failed" ? RAW_EVALUATOR_ERROR : null,
      completedAt: new Date(),
    },
  });
  if (kind === "completed") {
    await prisma.testCaseResult.create({
      data: {
        evaluationRunId: run.id,
        testCaseId: ID.tcVisible,
        status: "PASSED",
        pointsAwarded: 1,
        pointsPossible: 1,
        stdout: "hi",
      },
    });
  }
}

describe("two students, one assessment", () => {
  it("gives each student an independent session and submission", async () => {
    const a = await startAndSubmit(studentA, "print(1)");
    const b = await startAndSubmit(studentB, "print(2)");
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.submissionId).not.toBe(b.submissionId);

    const rows = await prisma.examSession.findMany({ where: { assessmentId: ID.assessment } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.studentId))).toEqual(new Set([ID.studentA, ID.studentB]));

    const cross = await request(app)
      .get(`/api/v1/student/submissions/${b.submissionId}`)
      .set("Authorization", studentA);
    expect(cross.status).toBe(404);
  });

  it("shows A a score and B a curated failure - never the raw evaluator error", async () => {
    const a = await startAndSubmit(studentA, "print(1)");
    const b = await startAndSubmit(studentB, "print(2)");
    await seedRun(a.submissionId, "completed");
    await seedRun(b.submissionId, "failed");

    const aResult = await request(app)
      .get(`/api/v1/student/submissions/${a.submissionId}`)
      .set("Authorization", studentA);
    expect(aResult.body.data.evaluation.status).toBe("COMPLETED");
    expect(aResult.body.data.evaluation.scorePercent).toBe(100);

    const bResult = await request(app)
      .get(`/api/v1/student/submissions/${b.submissionId}`)
      .set("Authorization", studentB);
    expect(bResult.body.data.evaluation.status).toBe("FAILED");
    expect(bResult.body.data.evaluation.error.type).toBe("EVALUATOR_ERROR");
    const serialisedStudent = JSON.stringify(bResult.body);
    expect(serialisedStudent).not.toContain("ECONNREFUSED");
    expect(serialisedStudent).not.toContain("2358");
    expect(serialisedStudent).not.toContain("secret internal detail");

    const bSession = await prisma.examSession.findFirstOrThrow({
      where: { assessmentId: ID.assessment, studentId: ID.studentB },
    });
    const instrDetail = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/sessions/${bSession.id}/result`)
      .set("Authorization", instructor);
    expect(instrDetail.status).toBe(200);
    expect(JSON.stringify(instrDetail.body)).not.toContain("ECONNREFUSED");
  });

  it("aggregates both students in the instructor results with per-student scores", async () => {
    const a = await startAndSubmit(studentA, "print(1)");
    const b = await startAndSubmit(studentB, "print(2)");
    await seedRun(a.submissionId, "completed");
    await seedRun(b.submissionId, "failed");

    const res = await request(app)
      .get(`/api/v1/assessments/${ID.assessment}/results`)
      .set("Authorization", instructor);
    expect(res.status).toBe(200);
    expect(res.body.data.students).toHaveLength(2);

    const amy = res.body.data.students.find(
      (s: { studentName: string }) => s.studentName === "Amy A",
    );
    const ben = res.body.data.students.find(
      (s: { studentName: string }) => s.studentName === "Ben B",
    );
    expect(amy.totalScore).toBe(100);
    expect(ben.totalScore).toBe(0);
    expect(ben.questions[0].evaluationStatus).toBe("FAILED");
    expect(res.body.data.stats.gradedCount).toBe(1);
  });
});
