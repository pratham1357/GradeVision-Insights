/**
 * Instructor assessment-authoring: integration tests against the real database
 * in `DATABASE_URL` (seeded dev DB locally, CI service DB in CI).
 *
 * Fixtures use fixed ids under the `ffffffff-…` range and are removed before and
 * after the run, so a crashed run self-heals and seed data is never touched.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signAccessToken } from "./auth/jwt.js";

const app = createApp();

const ID = {
  instructorA: "ffffffff-ffff-4fff-8fff-000000000001",
  instructorB: "ffffffff-ffff-4fff-8fff-000000000002",
  student: "ffffffff-ffff-4fff-8fff-000000000003",
  course: "ffffffff-ffff-4fff-8fff-000000000010",
  sectionA: "ffffffff-ffff-4fff-8fff-000000000020",
  sectionB: "ffffffff-ffff-4fff-8fff-000000000021",
} as const;

async function cleanup(): Promise<void> {
  await prisma.assessment.deleteMany({
    where: { createdById: { in: [ID.instructorA, ID.instructorB] } },
  });
  await prisma.question.deleteMany({
    where: { createdById: { in: [ID.instructorA, ID.instructorB] } },
  });
  await prisma.section.deleteMany({ where: { id: { in: [ID.sectionA, ID.sectionB] } } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({
    where: { id: { in: [ID.instructorA, ID.instructorB, ID.student] } },
  });
}

async function bearer(userId: string, role: "INSTRUCTOR" | "STUDENT" | "ADMIN"): Promise<string> {
  return `Bearer ${await signAccessToken({ sub: userId, role })}`;
}

let instructorA = "";
let instructorB = "";
let student = "";

beforeAll(async () => {
  await cleanup();

  await prisma.user.createMany({
    data: [
      {
        id: ID.instructorA,
        email: "authz-a@instr.local",
        name: "Instructor A",
        role: "INSTRUCTOR",
      },
      {
        id: ID.instructorB,
        email: "authz-b@instr.local",
        name: "Instructor B",
        role: "INSTRUCTOR",
      },
      { id: ID.student, email: "authz-s@student.local", name: "Student Z", role: "STUDENT" },
    ],
  });
  await prisma.course.create({
    data: { id: ID.course, code: "AUTHZ-TEST", name: "Authorization Test Course" },
  });
  await prisma.section.createMany({
    data: [
      { id: ID.sectionA, courseId: ID.course, name: "Section A", instructorId: ID.instructorA },
      { id: ID.sectionB, courseId: ID.course, name: "Section B", instructorId: ID.instructorB },
    ],
  });

  instructorA = await bearer(ID.instructorA, "INSTRUCTOR");
  instructorB = await bearer(ID.instructorB, "INSTRUCTOR");
  student = await bearer(ID.student, "STUDENT");
});

afterAll(cleanup);

describe("authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/v1/courses");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a student on instructor endpoints with 403", async () => {
    for (const path of ["/api/v1/courses", "/api/v1/assessments", "/api/v1/questions"]) {
      const res = await request(app).get(path).set("Authorization", student);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("lists only the instructor's own sections", async () => {
    const res = await request(app).get("/api/v1/courses").set("Authorization", instructorA);
    expect(res.status).toBe(200);
    const sectionIds = res.body.data.flatMap((c: { sections: { id: string }[] }) =>
      c.sections.map((s) => s.id),
    );
    expect(sectionIds).toContain(ID.sectionA);
    expect(sectionIds).not.toContain(ID.sectionB);
  });

  it("returns 404 when reading another instructor's section", async () => {
    const res = await request(app)
      .get(`/api/v1/courses/sections/${ID.sectionB}`)
      .set("Authorization", instructorA);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed section id", async () => {
    const res = await request(app)
      .get("/api/v1/courses/sections/not-a-uuid")
      .set("Authorization", instructorA);
    expect(res.status).toBe(400);
  });
});

describe("assessments", () => {
  it("creates a DRAFT assessment for the instructor's own section", async () => {
    const res = await request(app)
      .post("/api/v1/assessments")
      .set("Authorization", instructorA)
      .send({ title: "Midterm", sectionId: ID.sectionA, durationMinutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("DRAFT");
    expect(res.body.data.sectionId).toBe(ID.sectionA);
  });

  it("refuses to create an assessment for another instructor's section (404)", async () => {
    const res = await request(app)
      .post("/api/v1/assessments")
      .set("Authorization", instructorA)
      .send({ title: "X", sectionId: ID.sectionB });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed create body with 400", async () => {
    const res = await request(app)
      .post("/api/v1/assessments")
      .set("Authorization", instructorA)
      .send({ sectionId: ID.sectionA });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("updates a DRAFT assessment and prevents another instructor from touching it", async () => {
    const created = await request(app)
      .post("/api/v1/assessments")
      .set("Authorization", instructorA)
      .send({ title: "Editable", sectionId: ID.sectionA });
    const id: string = created.body.data.id;

    const ok = await request(app)
      .patch(`/api/v1/assessments/${id}`)
      .set("Authorization", instructorA)
      .send({ title: "Edited" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.title).toBe("Edited");

    const idor = await request(app)
      .patch(`/api/v1/assessments/${id}`)
      .set("Authorization", instructorB)
      .send({ title: "hijacked" });
    expect(idor.status).toBe(404);

    const stillMine = await request(app)
      .get(`/api/v1/assessments/${id}`)
      .set("Authorization", instructorA);
    expect(stillMine.body.data.title).toBe("Edited");
  });
});

describe("questions, test cases, rubric", () => {
  let questionId = "";

  it("creates a question with languages", async () => {
    const res = await request(app)
      .post("/api/v1/questions")
      .set("Authorization", instructorA)
      .send({
        title: "Palindrome",
        statement: "Is the string a palindrome?",
        difficulty: "MEDIUM",
        languages: [
          { language: "PYTHON", starterCode: "s=input()" },
          { language: "JAVASCRIPT", starterCode: null },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.languages).toHaveLength(2);
    questionId = res.body.data.id;
  });

  it("rejects a question with a blank title", async () => {
    const res = await request(app)
      .post("/api/v1/questions")
      .set("Authorization", instructorA)
      .send({ title: "   ", statement: "x", difficulty: "EASY", languages: [] });
    expect(res.status).toBe(400);
  });

  it("persists VISIBLE and HIDDEN test cases with their weights", async () => {
    await request(app)
      .post(`/api/v1/questions/${questionId}/test-cases`)
      .set("Authorization", instructorA)
      .send({ name: "sample", input: "aba", expectedOutput: "true", visibility: "VISIBLE" });

    const withHidden = await request(app)
      .post(`/api/v1/questions/${questionId}/test-cases`)
      .set("Authorization", instructorA)
      .send({ input: "abc", expectedOutput: "false", visibility: "HIDDEN", weight: 3 });

    expect(withHidden.status).toBe(201);
    const cases: Array<{ visibility: string; weight: number; position: number }> =
      withHidden.body.data.testCases;
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.visibility).sort()).toEqual(["HIDDEN", "VISIBLE"]);
    expect(cases.find((c) => c.visibility === "HIDDEN")?.weight).toBe(3);
    expect(cases.map((c) => c.position)).toEqual([0, 1]);

    // Verify straight from the database that the hidden case is really hidden.
    const hidden = await prisma.testCase.findFirst({
      where: { questionId, visibility: "HIDDEN" },
    });
    expect(hidden?.expectedOutput).toBe("false");
  });

  it("stops another instructor adding a test case to the question (404)", async () => {
    const res = await request(app)
      .post(`/api/v1/questions/${questionId}/test-cases`)
      .set("Authorization", instructorB)
      .send({ input: "x", expectedOutput: "y", visibility: "HIDDEN" });
    expect(res.status).toBe(404);
  });

  it("saves multi-criterion rubric with ordering, and reloads it", async () => {
    const save = await request(app)
      .put(`/api/v1/questions/${questionId}/rubric/criteria`)
      .set("Authorization", instructorA)
      .send({
        criteria: [
          { name: "Correctness", type: "FUNCTIONAL_CORRECTNESS", maxPoints: 60 },
          { name: "Efficiency", type: "PERFORMANCE", maxPoints: 25, description: "big-O" },
          { name: "Style", type: "CODE_QUALITY", maxPoints: 15 },
        ],
      });
    expect(save.status).toBe(200);
    expect(save.body.data.criteria.map((c: { name: string }) => c.name)).toEqual([
      "Correctness",
      "Efficiency",
      "Style",
    ]);

    const reload = await request(app)
      .get(`/api/v1/questions/${questionId}/rubric`)
      .set("Authorization", instructorA);
    expect(reload.body.data.criteria).toHaveLength(3);
    expect(reload.body.data.criteria[1]).toMatchObject({ type: "PERFORMANCE", maxPoints: 25 });
  });

  it("rejects a rubric criterion with non-positive points (400)", async () => {
    const res = await request(app)
      .put(`/api/v1/questions/${questionId}/rubric/criteria`)
      .set("Authorization", instructorA)
      .send({ criteria: [{ name: "Bad", type: "OTHER", maxPoints: 0 }] });
    expect(res.status).toBe(400);
  });

  it("attaches the question to an assessment, preserving marks and order", async () => {
    const assessment = await request(app)
      .post("/api/v1/assessments")
      .set("Authorization", instructorA)
      .send({ title: "With questions", sectionId: ID.sectionA });
    const assessmentId: string = assessment.body.data.id;

    const second = await request(app)
      .post("/api/v1/questions")
      .set("Authorization", instructorA)
      .send({ title: "Second", statement: "s", difficulty: "EASY", languages: [] });
    const secondId: string = second.body.data.id;

    await request(app)
      .post(`/api/v1/assessments/${assessmentId}/questions`)
      .set("Authorization", instructorA)
      .send({ questionId, points: 70 });
    const attached = await request(app)
      .post(`/api/v1/assessments/${assessmentId}/questions`)
      .set("Authorization", instructorA)
      .send({ questionId: secondId, points: 30 });

    expect(attached.body.data.totalPoints).toBe(100);
    expect(attached.body.data.questions.map((q: { position: number }) => q.position)).toEqual([
      0, 1,
    ]);

    const reordered = await request(app)
      .post(`/api/v1/assessments/${assessmentId}/questions/reorder`)
      .set("Authorization", instructorA)
      .send({ orderedQuestionIds: [secondId, questionId] });
    expect(reordered.body.data.questions[0].questionId).toBe(secondId);
    expect(reordered.body.data.questions[0].points).toBe(30);
  });
});
