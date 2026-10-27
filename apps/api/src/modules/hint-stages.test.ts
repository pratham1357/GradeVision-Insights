/**
 * Instructor hint-stage authoring: integration tests against the real database
 * in `DATABASE_URL`. Fixtures use fixed ids under the `abababab-…` range and are
 * removed before and after the run; seed data is never touched.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { issueSessionToken } from "./auth/sessions.js";

const app = createApp();

const ID = {
  instructorA: "abababab-abab-4bab-8bab-000000000001",
  instructorB: "abababab-abab-4bab-8bab-000000000002",
  student: "abababab-abab-4bab-8bab-000000000003",
  admin: "abababab-abab-4bab-8bab-000000000004",
  question: "abababab-abab-4bab-8bab-000000000010",
  assessment: "abababab-abab-4bab-8bab-000000000020",
  session: "abababab-abab-4bab-8bab-000000000030",
} as const;

async function cleanup(): Promise<void> {
  await prisma.hintUsage.deleteMany({ where: { studentId: ID.student } });
  await prisma.examSession.deleteMany({ where: { id: ID.session } });
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.question.deleteMany({ where: { id: ID.question } });
  await prisma.user.deleteMany({
    where: { id: { in: [ID.instructorA, ID.instructorB, ID.student, ID.admin] } },
  });
}

const bearer = async (sub: string, role: "INSTRUCTOR" | "STUDENT" | "ADMIN") =>
  `Bearer ${await issueSessionToken(sub, role)}`;

let instructorA = "";
let instructorB = "";
let student = "";
let admin = "";
const base = `/api/v1/questions/${ID.question}/hint-stages`;

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructorA, email: "hs-a@instr.local", name: "HS A", role: "INSTRUCTOR" },
      { id: ID.instructorB, email: "hs-b@instr.local", name: "HS B", role: "INSTRUCTOR" },
      { id: ID.student, email: "hs-s@student.local", name: "HS S", role: "STUDENT" },
      { id: ID.admin, email: "hs-admin@t.local", name: "HS Admin", role: "ADMIN" },
    ],
  });
  await prisma.question.create({
    data: {
      id: ID.question,
      title: "Hint stage fixture",
      statement: "Add two numbers.",
      createdById: ID.instructorA,
    },
  });
  await prisma.assessment.create({
    data: { id: ID.assessment, title: "HS fixture", createdById: ID.instructorA },
  });
  await prisma.examSession.create({
    data: { id: ID.session, assessmentId: ID.assessment, studentId: ID.student },
  });
  instructorA = await bearer(ID.instructorA, "INSTRUCTOR");
  instructorB = await bearer(ID.instructorB, "INSTRUCTOR");
  student = await bearer(ID.student, "STUDENT");
  admin = await bearer(ID.admin, "ADMIN");
});

afterAll(cleanup);

interface StageBody {
  id: string;
  stageNumber: number;
  deliveryType: string;
  content: string | null;
  usageCount: number;
}

describe("hint-stage authoring", () => {
  it("is instructor-only and owner-only", async () => {
    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set("Authorization", student)).status).toBe(403);
    expect((await request(app).get(base).set("Authorization", admin)).status).toBe(403);
    // Another instructor cannot see that the question exists.
    expect((await request(app).get(base).set("Authorization", instructorB)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(base)
          .set("Authorization", instructorB)
          .send({ deliveryType: "STATIC", content: "x" })
      ).status,
    ).toBe(404);
  });

  it("appends stages in order and validates input", async () => {
    const empty = await request(app).get(base).set("Authorization", instructorA);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);

    // A written hint needs text; unknown delivery types and oversized text are rejected.
    for (const bad of [
      { deliveryType: "STATIC" },
      { deliveryType: "STATIC", content: "   " },
      { deliveryType: "VIDEO", content: "x" },
      { deliveryType: "STATIC", content: "x".repeat(2_001) },
    ]) {
      const res = await request(app).post(base).set("Authorization", instructorA).send(bad);
      expect(res.status).toBe(400);
    }

    const s1 = await request(app)
      .post(base)
      .set("Authorization", instructorA)
      .send({ title: "Nudge", deliveryType: "STATIC", content: "Think about addition." });
    expect(s1.status).toBe(201);
    const s2 = await request(app)
      .post(base)
      .set("Authorization", instructorA)
      .send({ deliveryType: "INTERACTIVE", content: "ignored for AI stages" });
    expect(s2.status).toBe(201);
    const stages = s2.body.data as StageBody[];
    expect(stages.map((s) => [s.stageNumber, s.deliveryType])).toEqual([
      [1, "STATIC"],
      [2, "INTERACTIVE"],
    ]);
    expect(stages[1]!.content).toBeNull();
  });

  it("edits a stage, keeping static text required", async () => {
    const list = (await request(app).get(base).set("Authorization", instructorA)).body
      .data as StageBody[];
    const [s1, s2] = list;

    const edited = await request(app)
      .patch(`${base}/${s1!.id}`)
      .set("Authorization", instructorA)
      .send({ content: "Which operation combines two numbers?" });
    expect(edited.status).toBe(200);
    expect((edited.body.data as StageBody[])[0]!.content).toBe(
      "Which operation combines two numbers?",
    );

    // Switching the AI stage to STATIC without text is refused.
    const bad = await request(app)
      .patch(`${base}/${s2!.id}`)
      .set("Authorization", instructorA)
      .send({ deliveryType: "STATIC" });
    expect(bad.status).toBe(400);

    // Another instructor cannot edit it.
    const foreign = await request(app)
      .patch(`${base}/${s1!.id}`)
      .set("Authorization", instructorB)
      .send({ content: "hijack" });
    expect(foreign.status).toBe(404);
  });

  it("removes only the last stage, and never one already delivered", async () => {
    const list = (await request(app).get(base).set("Authorization", instructorA)).body
      .data as StageBody[];
    const [s1, s2] = list;

    const notLast = await request(app)
      .delete(`${base}/${s1!.id}`)
      .set("Authorization", instructorA);
    expect(notLast.status).toBe(409);
    expect(notLast.body.error.code).toBe("HINT_STAGE_NOT_LAST");

    // Stage 2 was delivered to a student: it is evidence and stays.
    await prisma.hintUsage.create({
      data: {
        hintStageId: s2!.id,
        examSessionId: ID.session,
        studentId: ID.student,
        questionId: ID.question,
        status: "CONSUMED",
        detail: { hint: "AI text", source: "ai" },
      },
    });
    const inUse = await request(app).delete(`${base}/${s2!.id}`).set("Authorization", instructorA);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("HINT_STAGE_IN_USE");

    await prisma.hintUsage.deleteMany({ where: { hintStageId: s2!.id } });
    const removed = await request(app)
      .delete(`${base}/${s2!.id}`)
      .set("Authorization", instructorA);
    expect(removed.status).toBe(200);
    expect((removed.body.data as StageBody[]).map((s) => s.stageNumber)).toEqual([1]);
  });

  it("caps the number of stages", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(base)
        .set("Authorization", instructorA)
        .send({ deliveryType: "STATIC", content: `hint ${i}` });
    }
    const over = await request(app)
      .post(base)
      .set("Authorization", instructorA)
      .send({ deliveryType: "STATIC", content: "one too many" });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("HINT_STAGE_LIMIT");
  });

  it("rejects malformed ids", async () => {
    const res = await request(app)
      .patch("/api/v1/questions/not-a-uuid/hint-stages/also-bad")
      .set("Authorization", instructorA)
      .send({ content: "x" });
    expect(res.status).toBe(400);
  });
});
