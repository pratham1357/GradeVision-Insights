/**
 * Security, role-matrix and fuzz tests against the real database in
 * `DATABASE_URL` (use a dedicated test database). Fixtures use fixed ids under
 * the `dededede-…` range and are removed before and after the run.
 *
 * Fuzzing is deterministic (seeded PRNG) so any failure is reproducible, and
 * it only ever touches this file's own fixture rows.
 */
import { prisma } from "@gradevision/database";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/hint-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/hint-engine.js")>();
  return { ...actual, requestInteractiveHint: vi.fn() };
});

import { createApp } from "../app.js";
import { HintProviderUnavailableError, requestInteractiveHint } from "../services/hint-engine.js";
import { issueSessionToken } from "./auth/sessions.js";

const app = createApp();
const mockHint = vi.mocked(requestInteractiveHint);

const ID = {
  instructor: "dededede-dede-4ede-8ede-000000000001",
  otherInstructor: "dededede-dede-4ede-8ede-000000000002",
  student: "dededede-dede-4ede-8ede-000000000003",
  otherStudent: "dededede-dede-4ede-8ede-000000000004",
  admin: "dededede-dede-4ede-8ede-000000000005",
  course: "dededede-dede-4ede-8ede-000000000010",
  section: "dededede-dede-4ede-8ede-000000000020",
  question: "dededede-dede-4ede-8ede-000000000030",
  assessment: "dededede-dede-4ede-8ede-000000000040",
  tcVisible: "dededede-dede-4ede-8ede-000000000051",
  tcHidden: "dededede-dede-4ede-8ede-000000000052",
} as const;

const HIDDEN_INPUT = "DEDE-HIDDEN-INPUT-91";
const HIDDEN_EXPECTED = "DEDE-HIDDEN-EXPECTED-91";
const USERS = [ID.instructor, ID.otherInstructor, ID.student, ID.otherStudent, ID.admin];

async function clearAttempts(): Promise<void> {
  await prisma.hintUsage.deleteMany({ where: { questionId: ID.question } });
  await prisma.testCaseResult.deleteMany({
    where: { evaluationRun: { submission: { questionId: ID.question } } },
  });
  await prisma.evaluationRun.deleteMany({ where: { submission: { questionId: ID.question } } });
  await prisma.submission.deleteMany({ where: { questionId: ID.question } });
  await prisma.submissionDraft.deleteMany({ where: { questionId: ID.question } });
  await prisma.violation.deleteMany({ where: { examSession: { assessmentId: ID.assessment } } });
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.assessment } });
}

async function cleanup(): Promise<void> {
  await clearAttempts();
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.question.deleteMany({ where: { id: ID.question } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: USERS } } });
}

const tokenFor = async (sub: string, role: "INSTRUCTOR" | "STUDENT" | "ADMIN") =>
  `Bearer ${await issueSessionToken(sub, role)}`;

let student = "";
let otherStudent = "";
let instructor = "";
let otherInstructor = "";
let admin = "";

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "dd-i@t.local", name: "DD Instr", role: "INSTRUCTOR" },
      { id: ID.otherInstructor, email: "dd-i2@t.local", name: "DD Instr 2", role: "INSTRUCTOR" },
      { id: ID.student, email: "dd-s@t.local", name: "DD Student", role: "STUDENT" },
      { id: ID.otherStudent, email: "dd-s2@t.local", name: "DD Student 2", role: "STUDENT" },
      { id: ID.admin, email: "dd-a@t.local", name: "DD Admin", role: "ADMIN" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "DD-SEC", name: "Security" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S", instructorId: ID.instructor },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: ID.student, sectionId: ID.section, status: "ACTIVE" },
      { studentId: ID.otherStudent, sectionId: ID.section, status: "ACTIVE" },
    ],
  });
  await prisma.question.create({
    data: {
      id: ID.question,
      title: "Sum",
      statement: "Print a+b.",
      createdById: ID.instructor,
      languages: { create: [{ language: "PYTHON", starterCode: null }] },
      testCases: {
        create: [
          {
            id: ID.tcVisible,
            name: "sample",
            input: "1 2",
            expectedOutput: "3",
            visibility: "VISIBLE",
            position: 0,
          },
          {
            id: ID.tcHidden,
            name: "hidden",
            input: HIDDEN_INPUT,
            expectedOutput: HIDDEN_EXPECTED,
            visibility: "HIDDEN",
            position: 1,
          },
        ],
      },
      hintStages: {
        create: [
          { stageNumber: 1, deliveryType: "STATIC", content: "Think about addition." },
          { stageNumber: 2, deliveryType: "STATIC", content: "Parse both numbers." },
          { stageNumber: 3, deliveryType: "INTERACTIVE", content: null },
        ],
      },
    },
  });
  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "Security Assessment",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
      durationMinutes: 60,
      questions: { create: [{ questionId: ID.question, position: 0, points: 10 }] },
    },
  });
  student = await tokenFor(ID.student, "STUDENT");
  otherStudent = await tokenFor(ID.otherStudent, "STUDENT");
  instructor = await tokenFor(ID.instructor, "INSTRUCTOR");
  otherInstructor = await tokenFor(ID.otherInstructor, "INSTRUCTOR");
  admin = await tokenFor(ID.admin, "ADMIN");
});

afterAll(cleanup);

/** Persists a completed evaluation the way the evaluator would (evidence for the hint policy). */
async function seedEvaluated(sessionId: string, attemptNumber: number, passed: boolean) {
  const submission = await prisma.submission.create({
    data: {
      examSessionId: sessionId,
      questionId: ID.question,
      language: "PYTHON",
      sourceCode: "print(sum(map(int,input().split())))",
      attemptNumber,
      status: "COMPLETED",
    },
  });
  const run = await prisma.evaluationRun.create({
    data: {
      submissionId: submission.id,
      runNumber: 1,
      status: "COMPLETED",
      totalScore: passed ? 100 : 0,
      maxScore: 100,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.testCaseResult.createMany({
    data: [ID.tcVisible, ID.tcHidden].map((testCaseId) => ({
      evaluationRunId: run.id,
      testCaseId,
      status: passed ? ("PASSED" as const) : ("FAILED" as const),
      pointsAwarded: passed ? 1 : 0,
      pointsPossible: 1,
      stdout: passed ? "3" : "0",
    })),
  });
}

async function startSession(auth: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/student/assessments/${ID.assessment}/session`)
    .set("Authorization", auth)
    .send({ acknowledgeEvidenceNotice: true });
  expect([200, 201]).toContain(res.status);
  return res.body.data.id as string;
}

// ---------------------------------------------------------------------------

describe("token forgery", () => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it("rejects self-made JWTs of any kind (sessions are opaque and server-side)", async () => {
    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: ID.admin,
      role: "ADMIN",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const signedWithServerSecret = await new SignJWT({ role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ID.admin)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    for (const forged of [unsigned, signedWithServerSecret]) {
      const res = await request(app)
        .get("/api/v1/monitoring/system")
        .set("Authorization", `Bearer ${forged}`);
      expect(res.status).toBe(401);
    }
  });

  it("rejects an edited or truncated session token", async () => {
    const raw = student.slice("Bearer ".length);
    const flipped = (raw[0] === "A" ? "B" : "A") + raw.slice(1);
    for (const bad of [flipped, raw.slice(0, -1), `${raw}x`]) {
      const res = await request(app)
        .get("/api/v1/student/assessments")
        .set("Authorization", `Bearer ${bad}`);
      expect(res.status).toBe(401);
    }
  });

  it("never takes a role from the client: a student session stays a student", async () => {
    const res = await request(app)
      .get("/api/v1/assessments")
      .set("Authorization", student)
      .set("X-Role", "INSTRUCTOR");
    expect(res.status).toBe(403);
  });

  it("treats the client address as irrelevant: a forwarded loopback IP grants nothing", async () => {
    const res = await request(app)
      .get("/api/v1/assessments")
      .set("X-Forwarded-For", "127.0.0.1")
      .set("X-Real-IP", "127.0.0.1");
    expect(res.status).toBe(401);
  });
});

describe("role matrix", () => {
  const instructorOnly = [
    "/api/v1/courses",
    "/api/v1/assessments",
    "/api/v1/questions",
    "/api/v1/concepts",
  ];
  const studentOnly = ["/api/v1/student/assessments"];
  const monitoring = ["/api/v1/monitoring/students", "/api/v1/monitoring/system"];

  it("anonymous callers get 401 everywhere except health", async () => {
    for (const path of [...instructorOnly, ...studentOnly, ...monitoring, "/api/v1/auth/me"]) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
  });

  it("each role reaches exactly its own areas", async () => {
    const expectStatus = async (auth: string, paths: string[], status: number) => {
      for (const path of paths) {
        expect((await request(app).get(path).set("Authorization", auth)).status, path).toBe(status);
      }
    };
    await expectStatus(student, studentOnly, 200);
    await expectStatus(student, [...instructorOnly, ...monitoring], 403);

    await expectStatus(instructor, [...instructorOnly, ...monitoring], 200);
    await expectStatus(instructor, studentOnly, 403);

    // ADMIN today: monitoring only - no authoring, no exam taking.
    await expectStatus(admin, monitoring, 200);
    await expectStatus(admin, [...instructorOnly, ...studentOnly], 403);
  });

  it("an instructor cannot author on another instructor's question", async () => {
    for (const [method, path, body] of [
      ["get", `/api/v1/questions/${ID.question}`, undefined],
      ["get", `/api/v1/questions/${ID.question}/hint-stages`, undefined],
      [
        "post",
        `/api/v1/questions/${ID.question}/test-cases`,
        { input: "1", expectedOutput: "1", visibility: "HIDDEN" },
      ],
      ["put", `/api/v1/questions/${ID.question}/rubric/criteria`, { criteria: [] }],
      ["get", `/api/v1/assessments/${ID.assessment}/results`, undefined],
    ] as const) {
      const req = request(app)[method](path).set("Authorization", otherInstructor);
      const res = body ? await req.send(body) : await req;
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("payload handling", () => {
  it("rejects an oversized JSON body with 413, not a 500", async () => {
    const sessionId = await startSession(student);
    const res = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.question}/draft`)
      .set("Authorization", student)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ language: "PYTHON", sourceCode: "x".repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.c", "password": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("does not let __proto__ keys reach the model or crash the API", async () => {
    const sessionId = await startSession(student);
    const res = await request(app)
      .put(`/api/v1/student/sessions/${sessionId}/questions/${ID.question}/draft`)
      .set("Authorization", student)
      .set("Content-Type", "application/json")
      .send('{"language":"PYTHON","sourceCode":"print(1)","__proto__":{"isAdmin":true}}');
    expect(res.status).toBeLessThan(500);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("duplicate submissions are separate attempts, never a 5xx or a merged row", async () => {
    await clearAttempts();
    const sessionId = await startSession(student);
    const url = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/submissions`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(url)
          .set("Authorization", student)
          .send({ language: "PYTHON", sourceCode: "print(3)" }),
      ),
    );
    for (const res of results) expect(res.status).toBeLessThan(500);
    const rows = await prisma.submission.findMany({ where: { examSessionId: sessionId } });
    const attempts = rows.map((r) => r.attemptNumber).sort();
    expect(new Set(attempts).size).toBe(attempts.length);
  });
});

describe("hidden-test redaction (instructor-side and student-side responses)", () => {
  it("never returns hidden input/expected output to the student", async () => {
    await clearAttempts();
    const sessionId = await startSession(student);
    await seedEvaluated(sessionId, 1, false);
    const session = await request(app)
      .get(`/api/v1/student/sessions/${sessionId}`)
      .set("Authorization", student);
    const submissionId = (session.body.data.questions[0].submissions[0] as { id: string }).id;
    const result = await request(app)
      .get(`/api/v1/student/submissions/${submissionId}`)
      .set("Authorization", student);
    expect(result.status).toBe(200);
    for (const body of [session.text, result.text]) {
      expect(body).not.toContain(HIDDEN_INPUT);
      expect(body).not.toContain(HIDDEN_EXPECTED);
    }
  });
});

// ---------------------------------------------------------------------------
// Fuzzing

/** Mulberry32: small deterministic PRNG so a failing fuzz case can be replayed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NASTY_STRINGS = [
  "",
  " ",
  "null",
  "undefined",
  "0",
  "-1",
  "1e309",
  "NaN",
  "../../etc/passwd",
  "' OR 1=1 --",
  "<script>alert(1)</script>",
  "%00",
  "\u0000",
  "😀".repeat(50),
  "a".repeat(5000),
  "00000000-0000-0000-0000-000000000000",
  "DEDEDEDE-DEDE-4EDE-8EDE-000000000040",
];

function randomValue(rand: () => number, depth = 0): unknown {
  const pick = Math.floor(rand() * 9);
  switch (pick) {
    case 0:
      return NASTY_STRINGS[Math.floor(rand() * NASTY_STRINGS.length)];
    case 1:
      return Math.floor(rand() * 2 ** 33) - 2 ** 32;
    case 2:
      return rand() < 0.5;
    case 3:
      return null;
    case 4:
      return depth > 2 ? [] : [randomValue(rand, depth + 1), randomValue(rand, depth + 1)];
    case 5:
      return depth > 2
        ? {}
        : { stageNumber: randomValue(rand, depth + 1), x: randomValue(rand, depth + 1) };
    case 6:
      return 1.5;
    case 7:
      return ["PYTHON", "JAVA", "COBOL", "python"][Math.floor(rand() * 4)];
    default:
      return Math.floor(rand() * 30) - 5;
  }
}

describe("input fuzzing (seeded)", () => {
  it("route params: random ids are always 4xx, never 5xx", async () => {
    const rand = prng(1337);
    const templates = [
      (x: string) => `/api/v1/student/sessions/${x}`,
      (x: string) => `/api/v1/student/submissions/${x}`,
      (x: string) => `/api/v1/student/sessions/${x}/questions/${x}/hints`,
      (x: string) => `/api/v1/student/sessions/${x}/questions/${ID.question}/transfer`,
    ];
    for (let i = 0; i < 60; i += 1) {
      const raw = String(NASTY_STRINGS[Math.floor(rand() * NASTY_STRINGS.length)] ?? "x");
      const path = templates[i % templates.length]!(encodeURIComponent(raw));
      const res = await request(app).get(path).set("Authorization", student);
      expect(res.status, `GET ${path}`).toBeGreaterThanOrEqual(400);
      expect(res.status, `GET ${path}`).toBeLessThan(500);
    }
  });

  it("bodies: random JSON to student write endpoints is always 4xx or a valid success", async () => {
    await clearAttempts();
    const sessionId = await startSession(student);
    const base = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}`;
    const endpoints: [string, string][] = [
      ["post", `${base}/hints`],
      ["put", `${base}/draft`],
      ["post", `${base}/submissions`],
      ["post", `/api/v1/student/sessions/${sessionId}/violations`],
    ];
    const rand = prng(4242);
    for (let i = 0; i < 80; i += 1) {
      const [method, path] = endpoints[i % endpoints.length]!;
      const body: Record<string, unknown> = {
        language: randomValue(rand),
        sourceCode: randomValue(rand),
        stageNumber: randomValue(rand),
        type: randomValue(rand),
        [String(randomValue(rand))]: randomValue(rand),
      };
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
        method
      ]!(path)
        .set("Authorization", student)
        .send(body);
      expect(res.status, `${method} ${path} ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(
        500,
      );
    }
  });
});

describe("hint state-machine fuzzing (seeded)", () => {
  it("random action sequences never violate the evidence policy or leak hidden data", async () => {
    mockHint.mockImplementation(() =>
      Promise.resolve({
        hint: "Check how you read the input.",
        provider: "ollama",
        model: "m",
        validator: "v",
      }),
    );
    for (const seed of [7, 99, 2026]) {
      await clearAttempts();
      const rand = prng(seed);
      const sessionId = await startSession(student);
      const hintsUrl = `/api/v1/student/sessions/${sessionId}/questions/${ID.question}/hints`;
      let attempts = 0;
      let unsuccessful = 0;
      let latestPassed = false;
      let consumed = 0; // highest consecutive stage delivered
      let finished = false;

      for (let step = 0; step < 25; step += 1) {
        const action = Math.floor(rand() * 10);
        if (action <= 3) {
          // request a random stage (1..4, 4 does not exist)
          const stage = 1 + Math.floor(rand() * 4);
          if (stage === 3 && rand() < 0.3) {
            mockHint.mockRejectedValueOnce(new HintProviderUnavailableError());
          }
          const res = await request(app)
            .post(hintsUrl)
            .set("Authorization", student)
            .send({ stageNumber: stage });
          const label = `seed ${seed} step ${step} stage ${stage}`;
          // 503 is the one acceptable 5xx: the AI stage when the provider is down.
          if (res.status === 503)
            expect(res.body.error.code, label).toBe("HINT_PROVIDER_UNAVAILABLE");
          else expect(res.status, label).toBeLessThan(500);
          if (res.status === 201) {
            // Granted: must satisfy order + evidence (or be an idempotent re-read).
            const isReread = stage <= consumed;
            if (!isReread) {
              expect(finished).toBe(false);
              expect(stage).toBe(consumed + 1);
              if (stage >= 2) {
                expect(unsuccessful).toBeGreaterThanOrEqual(stage - 1);
                expect(latestPassed).toBe(false);
              }
              consumed = stage;
            }
            expect(res.text).not.toContain(HIDDEN_INPUT);
          } else if (res.status === 503) {
            // AI unavailable: nothing recorded for that stage.
            expect(stage).toBe(3);
          }
        } else if (action <= 7) {
          if (finished) continue;
          const passed = rand() < 0.2;
          attempts += 1;
          await seedEvaluated(sessionId, attempts, passed);
          latestPassed = passed;
          if (!passed) unsuccessful += 1;
        } else if (action === 8) {
          const list = await request(app).get(hintsUrl).set("Authorization", student);
          expect(list.status).toBeLessThan(500);
          expect(list.text).not.toContain(HIDDEN_INPUT);
        } else if (!finished && rand() < 0.3) {
          const res = await request(app)
            .post(`/api/v1/student/sessions/${sessionId}/finish`)
            .set("Authorization", student);
          expect(res.status).toBeLessThan(500);
          finished = res.status < 300;
        }
      }

      // Database invariant: delivered stages are exactly 1..consumed, each once.
      const usages = await prisma.hintUsage.findMany({
        where: { examSessionId: sessionId },
        include: { hintStage: true },
      });
      const numbers = usages.map((u) => u.hintStage.stageNumber).sort();
      expect(numbers).toEqual(Array.from({ length: consumed }, (_, i) => i + 1));
      // Every delivered hint has an exact text snapshot.
      for (const usage of usages) {
        expect((usage.detail as { hint?: string } | null)?.hint, `seed ${seed}`).toBeTruthy();
      }
      // The other student never sees this session.
      const peek = await request(app)
        .get(`/api/v1/student/sessions/${sessionId}`)
        .set("Authorization", otherStudent);
      expect(peek.status).toBe(404);
    }
  });
});
