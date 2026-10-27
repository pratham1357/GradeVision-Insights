/**
 * Demo reset: target guard (pure), and the reset itself against the dedicated
 * TEST database in `DATABASE_URL` (never the demo database). The CLI is only
 * ever pointed at the test database here, where its guard must refuse.
 *
 * Fixtures: demo-namespace activity for the seeded accounts, plus a non-demo
 * fixture (ids `9a9a9a9a-…`) that must survive every reset.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkDemoTarget,
  DEMO_SCOPE,
  inspectDemoData,
  prisma,
  resetDemoData,
  serverDatabaseName,
  tsxScriptCommand,
} from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { issueSessionToken } from "./auth/sessions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp();

const SEEDED_INSTRUCTOR = DEMO_SCOPE.instructors[0];
const SEEDED_STUDENT = DEMO_SCOPE.students[0];
const LIVE_ASSESSMENT = "00000000-0000-4000-8000-000000000031";

const OTHER = {
  instructor: "9a9a9a9a-9a9a-4a9a-8a9a-000000000001",
  student: "9a9a9a9a-9a9a-4a9a-8a9a-000000000002",
  assessment: "9a9a9a9a-9a9a-4a9a-8a9a-000000000010",
  question: "9a9a9a9a-9a9a-4a9a-8a9a-000000000020",
  session: "9a9a9a9a-9a9a-4a9a-8a9a-000000000030",
} as const;
const REHEARSAL = {
  assessment: "9b9b9b9b-9b9b-4b9b-8b9b-000000000010",
  question: "9b9b9b9b-9b9b-4b9b-8b9b-000000000020",
} as const;

const base = {
  databaseUrl: "postgresql://u:p@127.0.0.1:5432/gradevision?schema=public",
  demoMode: "true",
  expectedName: "gradevision",
  confirmName: "gradevision",
  nodeEnv: "development",
};

describe("checkDemoTarget (guard)", () => {
  it("accepts an explicitly confirmed local demo database", () => {
    expect(checkDemoTarget({ ...base, serverDatabase: "gradevision" })).toMatchObject({ ok: true });
    expect(
      checkDemoTarget({ ...base, databaseUrl: base.databaseUrl.replace("127.0.0.1", "localhost") })
        .ok,
    ).toBe(true);
  });

  it("refuses without the demo-mode flag, the expected name, or the confirmation", () => {
    expect(checkDemoTarget({ ...base, demoMode: undefined }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, demoMode: "1" }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, expectedName: undefined }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, confirmName: undefined }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, confirmName: "gradevision_test" }).ok).toBe(false);
  });

  it("refuses test, system and mismatched databases", () => {
    const testUrl = base.databaseUrl.replace("/gradevision?", "/gradevision_test?");
    const test = checkDemoTarget({
      ...base,
      databaseUrl: testUrl,
      expectedName: "gradevision_test",
      confirmName: "gradevision_test",
    });
    expect(test.ok).toBe(false);
    expect(test.reasons.join(" ")).toMatch(/test database/);
    expect(checkDemoTarget({ ...base, databaseUrl: testUrl }).ok).toBe(false);
    for (const name of ["postgres", "template1"]) {
      const url = base.databaseUrl.replace("/gradevision?", `/${name}?`);
      expect(
        checkDemoTarget({ ...base, databaseUrl: url, expectedName: name, confirmName: name }).ok,
      ).toBe(false);
    }
    // The server reports a different database than the URL names (ambiguous target).
    expect(checkDemoTarget({ ...base, serverDatabase: "other" }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, serverDatabase: null }).ok).toBe(false);
  });

  it("refuses remote / production-like targets and production mode", () => {
    for (const host of [
      "db.example.com",
      "10.0.0.5",
      "mydb.abc123.us-east-1.rds.amazonaws.com",
      "0.0.0.0",
    ]) {
      expect(
        checkDemoTarget({ ...base, databaseUrl: base.databaseUrl.replace("127.0.0.1", host) }).ok,
      ).toBe(false);
    }
    expect(checkDemoTarget({ ...base, nodeEnv: "production" }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, databaseUrl: "mysql://u:p@127.0.0.1/gradevision" }).ok).toBe(
      false,
    );
    expect(checkDemoTarget({ ...base, databaseUrl: "postgresql://u:p@127.0.0.1:5432/" }).ok).toBe(
      false,
    );
    expect(checkDemoTarget({ ...base, databaseUrl: "not a url" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

async function cleanupOther(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: "rehearsal-user@t.local" } });
  await prisma.examSession.deleteMany({ where: { id: OTHER.session } });
  await prisma.assessment.deleteMany({
    where: { id: { in: [OTHER.assessment, REHEARSAL.assessment] } },
  });
  await prisma.question.deleteMany({ where: { id: { in: [OTHER.question, REHEARSAL.question] } } });
  await prisma.user.deleteMany({ where: { id: { in: [OTHER.instructor, OTHER.student] } } });
}

async function seedDemoActivity(): Promise<void> {
  // A seeded student's session with evidence on the seeded live assessment.
  const session = await prisma.examSession.create({
    data: {
      assessmentId: LIVE_ASSESSMENT,
      studentId: SEEDED_STUDENT,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });
  const link = await prisma.assessmentQuestion.findFirstOrThrow({
    where: { assessmentId: LIVE_ASSESSMENT },
  });
  const submission = await prisma.submission.create({
    data: {
      examSessionId: session.id,
      questionId: link.questionId,
      language: "PYTHON",
      sourceCode: "print(0)",
      attemptNumber: 1,
      status: "COMPLETED",
    },
  });
  await prisma.evaluationRun.create({
    data: {
      submissionId: submission.id,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 100,
    },
  });
  await prisma.submissionDraft.create({
    data: {
      examSessionId: session.id,
      questionId: link.questionId,
      language: "PYTHON",
      sourceCode: "x",
    },
  });
  // Rehearsal-authored content by the seeded instructor, plus an added hint stage.
  await prisma.question.create({
    data: {
      id: REHEARSAL.question,
      title: "Rehearsal Q",
      statement: "s",
      createdById: SEEDED_INSTRUCTOR,
    },
  });
  await prisma.assessment.create({
    data: { id: REHEARSAL.assessment, title: "Rehearsal A", createdById: SEEDED_INSTRUCTOR },
  });
  const maxStage = await prisma.hintStage.aggregate({
    where: { questionId: link.questionId },
    _max: { stageNumber: true },
  });
  const stage = await prisma.hintStage.create({
    data: {
      questionId: link.questionId,
      stageNumber: (maxStage._max.stageNumber ?? 0) + 1,
      deliveryType: "INTERACTIVE",
    },
  });
  await prisma.hintUsage.create({
    data: {
      hintStageId: stage.id,
      examSessionId: session.id,
      studentId: SEEDED_STUDENT,
      questionId: link.questionId,
      status: "CONSUMED",
      detail: { hint: "h", source: "ai" },
    },
  });
  await prisma.auditEvent.create({
    data: { actorId: SEEDED_INSTRUCTOR, action: "demo.rehearsal" },
  });
  // An account the demo admin created during the rehearsal (recorded in the audit trail).
  const user = await prisma.user.create({
    data: { email: "rehearsal-user@t.local", name: "Rehearsal User", role: "STUDENT" },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: DEMO_SCOPE.admins[0],
      action: "user.created",
      entityType: "User",
      entityId: user.id,
    },
  });
}

async function seedOther(): Promise<void> {
  await prisma.user.createMany({
    data: [
      { id: OTHER.instructor, email: "dr-other-i@t.local", name: "Other I", role: "INSTRUCTOR" },
      { id: OTHER.student, email: "dr-other-s@t.local", name: "Other S", role: "STUDENT" },
    ],
  });
  await prisma.question.create({
    data: { id: OTHER.question, title: "Other Q", statement: "s", createdById: OTHER.instructor },
  });
  await prisma.assessment.create({
    data: { id: OTHER.assessment, title: "Other A", createdById: OTHER.instructor },
  });
  await prisma.examSession.create({
    data: { id: OTHER.session, assessmentId: OTHER.assessment, studentId: OTHER.student },
  });
}

const testDatabase = new URL(process.env.DATABASE_URL!).pathname.slice(1);
const verifyTestTarget = async (tx: Parameters<Parameters<typeof resetDemoData>[1]>[0]) => {
  // The tests' own guard: the transaction must be on the test database.
  if ((await serverDatabaseName(tx)) !== testDatabase) throw new Error("wrong database");
};

describe("resetDemoData (on the test database)", () => {
  beforeAll(async () => {
    expect(testDatabase).toMatch(/test/);
    await cleanupOther();
    await resetDemoData(prisma, verifyTestTarget);
    await seedOther();
  });
  afterAll(cleanupOther);

  it("rolls back completely when the in-transaction target check fails", async () => {
    await seedDemoActivity();
    const before = await inspectDemoData(prisma);
    await expect(
      resetDemoData(prisma, async () => {
        throw new Error("target changed");
      }),
    ).rejects.toThrow("target changed");
    expect(await inspectDemoData(prisma)).toEqual(before);
  });

  it("removes only the demo namespace and preserves schema, migrations and seed rows", async () => {
    const migrationsBefore = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM _prisma_migrations`;
    const seededUsersBefore = await prisma.user.count({
      where: { id: { in: [...DEMO_SCOPE.students, SEEDED_INSTRUCTOR] } },
    });
    const seededQuestionsBefore = await prisma.question.count({
      where: {
        id: {
          gte: "00000000-0000-4000-8000-000000000000",
          lte: "00000000-0000-4000-8000-ffffffffffff",
        },
      },
    });

    const removed = await resetDemoData(prisma, verifyTestTarget);
    expect(removed.examSessions).toBeGreaterThanOrEqual(1);
    expect(removed.submissions).toBeGreaterThanOrEqual(1);
    expect(removed.hintUsages).toBeGreaterThanOrEqual(1);
    expect(removed.rehearsalAssessments).toBe(1);
    expect(removed.rehearsalQuestions).toBe(1);
    expect(removed.rehearsalHintStages).toBe(1);
    expect(removed.auditEvents).toBeGreaterThanOrEqual(1);
    expect(removed.rehearsalUsers).toBe(1);
    expect(await prisma.user.count({ where: { email: "rehearsal-user@t.local" } })).toBe(0);

    // Non-demo data is untouched.
    expect(await prisma.examSession.count({ where: { id: OTHER.session } })).toBe(1);
    expect(await prisma.assessment.count({ where: { id: OTHER.assessment } })).toBe(1);
    expect(await prisma.question.count({ where: { id: OTHER.question } })).toBe(1);
    expect(
      await prisma.user.count({ where: { id: { in: [OTHER.instructor, OTHER.student] } } }),
    ).toBe(2);
    // Seed rows, migration history and schema are untouched.
    expect(
      await prisma.user.count({
        where: { id: { in: [...DEMO_SCOPE.students, SEEDED_INSTRUCTOR] } },
      }),
    ).toBe(seededUsersBefore);
    expect(
      await prisma.question.count({
        where: {
          id: {
            gte: "00000000-0000-4000-8000-000000000000",
            lte: "00000000-0000-4000-8000-ffffffffffff",
          },
        },
      }),
    ).toBe(seededQuestionsBefore);
    const migrationsAfter = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM _prisma_migrations`;
    expect(migrationsAfter[0]!.n).toBe(migrationsBefore[0]!.n);
  });

  it("is idempotent", async () => {
    const again = await resetDemoData(prisma, verifyTestTarget);
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });

  it("leaves the seeded journey startable: a demo student starts the live assessment", async () => {
    try {
      const token = await issueSessionToken(SEEDED_STUDENT, "STUDENT");
      const res = await request(app)
        .post(`/api/v1/student/assessments/${LIVE_ASSESSMENT}/session`)
        .set("Authorization", `Bearer ${token}`)
        .send({ acknowledgeEvidenceNotice: true });
      expect(res.status).toBe(201);
      expect(res.body.data.assessmentId).toBe(LIVE_ASSESSMENT);
      expect(typeof res.body.data.id).toBe("string");
    } finally {
      await resetDemoData(prisma, verifyTestTarget);
    }
  });
});

describe("demo-reset CLI guard", () => {
  it("refuses the test database even with every flag set, and changes nothing", async () => {
    await resetDemoData(prisma, verifyTestTarget);
    await seedDemoActivity();
    const before = await inspectDemoData(prisma);
    const databaseDir = path.resolve(here, "../../../../database");
    // Node + the tsx loader directly (no shell: the repository path contains spaces).
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "prisma/demo-reset.ts",
        "--confirm",
        testDatabase,
        "--no-backup",
        "--no-seed",
      ],
      {
        cwd: databaseDir,
        env: {
          ...process.env,
          GRADEVISION_DEMO_MODE: "true",
          DEMO_DATABASE_NAME: testDatabase,
          NODE_ENV: "development",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/REFUSED/);
    expect(result.stderr).toMatch(/test database/);
    expect(result.stderr + result.stdout).not.toMatch(/postgresql:\/\//);
    try {
      expect(await inspectDemoData(prisma)).toEqual(before);
    } finally {
      await resetDemoData(prisma, verifyTestTarget);
    }
  });
});

describe("demo-reset re-seed launcher (paths with spaces)", () => {
  const databaseDir = path.resolve(here, "../../../../database");

  it("runs a TypeScript script from a directory whose path contains spaces, without a shell", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gv reseed path with spaces "));
    try {
      const script = path.join(dir, "probe script.ts");
      writeFileSync(script, 'const marker: string = "tsx-ok";\nconsole.log(marker);\n');
      const { command, args, cwd } = tsxScriptCommand(databaseDir, script);
      expect(script).toContain(" ");
      const result = spawnSync(command, args, { cwd, encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.stderr).not.toMatch(/not recognized/);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("tsx-ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-seeds the test database through the same launcher the CLI uses", async () => {
    expect(testDatabase).toMatch(/test/);
    // A rehearsal's admin changes to seeded accounts must be undone by the re-seed.
    await prisma.user.update({
      where: { id: DEMO_SCOPE.students[1] },
      data: { isActive: false, role: "INSTRUCTOR" },
    });
    const { command, args, cwd } = tsxScriptCommand(
      databaseDir,
      path.join(databaseDir, "prisma", "seed.ts"),
    );
    const result = spawnSync(command, args, {
      cwd,
      // DATABASE_URL here is the test database (vitest.config.ts refuses anything else).
      env: process.env,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const seeded = await prisma.user.count({
      where: {
        id: { in: [...DEMO_SCOPE.students, ...DEMO_SCOPE.instructors, ...DEMO_SCOPE.admins] },
      },
    });
    expect(seeded).toBe(4);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: DEMO_SCOPE.students[1] },
        select: { isActive: true, role: true },
      }),
    ).toEqual({ isActive: true, role: "STUDENT" });
  });
});
