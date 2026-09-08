/**
 * Headless end-to-end smoke test against the seeded dev database.
 *
 *   pnpm build && node apps/api/scripts/smoke-e2e.mjs
 *
 * Exercises the real API + Socket.IO realtime + the evaluator (with a mock
 * sandbox - no Judge0 needed):
 *   instructor login -> create + activate an assessment -> Student A & B start it
 *   independently -> A autosaves + submits -> evaluator grades -> A sees a result
 *   and the instructor's monitoring view updates (with a realtime nudge) ->
 *   A trips a fullscreen violation -> instructor sees the flag -> a static hint
 *   is delivered (and the AI path degrades cleanly when Gemini is unset).
 *
 * Leaves the database as it found it. Exit code 0 = all checks passed.
 */
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
  "postgresql://gradevision:gradevision_dev_pw@localhost:5432/gradevision?schema=public";
process.env.JWT_SECRET ??= "smoke-jwt-secret-smoke-jwt-secret-smoke-1234";
process.env.API_CORS_ORIGIN = "http://localhost:5173";

const { createApp } = await import("../dist/app.js");
const { initRealtime, shutdownRealtime } = await import("../dist/realtime/index.js");
const { prisma } = await import("../../../database/dist/index.js");
const { evaluateSubmission } = await import("../../../services/evaluator/dist/evaluate.js");
const { GeminiExecutionProvider } =
  await import("../../../services/evaluator/dist/execution/gemini.js");
const { io: ioClient } = await import("socket.io-client");

let pass = 0;
let fail = 0;
const check = (label, ok) => {
  console.log(`${ok ? "  ok  " : " FAIL "}${label}`);
  if (ok) pass += 1;
  else fail += 1;
};

const app = createApp();
const server = createServer(app);
initRealtime(server);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, path, token, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json?.data ?? json };
}
const login = async (email, password) =>
  (await api("POST", "/auth/login", null, { email, password })).body.accessToken;

const mockProvider = {
  name: "smoke-mock",
  isConfigured: () => true,
  execute: (req) =>
    Promise.resolve({
      provider: "smoke-mock",
      runtimeInfo: "mock",
      meta: {},
      cases: req.cases.map((c) => ({
        caseId: c.id,
        runStatus: "COMPLETED",
        stdout: c.expectedOutput,
        stderr: "",
        compileOutput: null,
        timeMs: 5,
        memoryKb: 1000,
        exitCode: 0,
      })),
    }),
};
const mockAnalyzers = {
  analyze: () =>
    Promise.resolve({
      language: "PYTHON",
      available: false,
      error: null,
      analyzer: "none",
      metrics: null,
      findings: [],
    }),
};

function socket(token, sub, event) {
  const s = ioClient(base, {
    path: "/realtime",
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  const seen = [];
  s.on(event, () => seen.push(event));
  const ready = new Promise((res) => {
    s.on("connect", () => s.emit("subscribe", sub));
    s.on("subscribe:ok", res);
  });
  return { s, seen, ready };
}

let assessmentId;
try {
  const instructor = await login("instructor@example.edu", "instructor-dev-password");
  const studentA = await login("student1@example.edu", "student-dev-password");
  const studentB = await login("student2@example.edu", "student-dev-password");
  check("instructor + 2 students logged in", Boolean(instructor && studentA && studentB));

  const courses = await api("GET", "/courses", instructor);
  const sectionId = courses.body[0].sections[0].id;
  const questions = await api("GET", "/questions", instructor);
  const questionId =
    questions.body.find((q) => q.title.includes("Sum of Two"))?.id ?? questions.body[0].id;

  const created = await api("POST", "/assessments", instructor, {
    title: `Smoke ${Date.now().toString(36)}`,
    sectionId,
    durationMinutes: 60,
  });
  assessmentId = created.body.id;
  await api("POST", `/assessments/${assessmentId}/questions`, instructor, {
    questionId,
    points: 100,
  });
  const activated = await api("PATCH", `/assessments/${assessmentId}`, instructor, {
    status: "ACTIVE",
  });
  check("instructor activated the assessment", activated.body.status === "ACTIVE");

  const instr = socket(instructor, { assessmentId }, "assessment:changed");
  await instr.ready;

  const startA = await api("POST", `/student/assessments/${assessmentId}/session`, studentA);
  const startB = await api("POST", `/student/assessments/${assessmentId}/session`, studentB);
  check("Student A and B each got their own session", startA.body.id !== startB.body.id);
  check(
    "exam view carries live assessment status + integrity summary",
    startA.body.assessmentStatus === "ACTIVE" && startA.body.integrity.violationCount === 0,
  );

  const sessionA = startA.body.id;
  const stu = socket(studentA, { sessionId: sessionA }, "session:changed");
  await stu.ready;

  const q = startA.body.questions[0];
  await api("PUT", `/student/sessions/${sessionA}/questions/${q.id}/draft`, studentA, {
    language: "PYTHON",
    sourceCode: "a,b=map(int,input().split())\n# wip",
  });
  const submit = await api(
    "POST",
    `/student/sessions/${sessionA}/questions/${q.id}/submissions`,
    studentA,
    { language: "PYTHON", sourceCode: "a,b=map(int,input().split())\nprint(a+b)" },
  );
  check(
    "autosave + submission accepted (QUEUED)",
    submit.status === 201 && submit.body.submission.status === "QUEUED",
  );

  await sleep(200);
  check("student socket nudged on submit", stu.seen.includes("session:changed"));
  check("instructor socket nudged on submit", instr.seen.includes("assessment:changed"));

  const outcome = await evaluateSubmission(submit.body.submission.id, {
    executionProvider: mockProvider,
    analyzers: mockAnalyzers,
  });
  check(
    "evaluation completed with a score",
    outcome.status === "completed" && outcome.scorePercent === 100,
  );

  const aResult = await api("GET", `/student/submissions/${submit.body.submission.id}`, studentA);
  check("Student A sees a COMPLETED result", aResult.body.evaluation?.status === "COMPLETED");

  const instrResults = await api("GET", `/assessments/${assessmentId}/results`, instructor);
  const rowA = instrResults.body.students.find((s) => s.sessionId === sessionA);
  check("instructor results show A's score", Boolean(rowA) && rowA.totalScore === 100);
  check("instructor stats aggregate both students", instrResults.body.stats.totalStudents === 2);

  // --- Instructor monitoring: real student roster + system metrics ----------
  const monitor = await api("GET", "/monitoring/students", instructor);
  const monitoredA = monitor.body.students?.find((s) => s.email === "student1@example.edu");
  check(
    "student monitor lists real enrolled students with activity",
    monitor.status === 200 &&
      Array.isArray(monitor.body.students) &&
      Boolean(monitoredA) &&
      monitoredA.submissionCount >= 1 &&
      monitor.body.summary.totalStudents >= 2,
  );
  check(
    "students cannot read instructor monitoring",
    (await api("GET", "/monitoring/students", studentA)).status === 403,
  );

  const metrics = await api("GET", "/monitoring/system", instructor);
  check(
    "system metrics report real runtime measurements",
    metrics.status === 200 &&
      metrics.body.memory.rssBytes > 0 &&
      typeof metrics.body.process.uptimeSeconds === "number" &&
      metrics.body.requests.total >= 1 &&
      metrics.body.database.status === "up",
  );
  check(
    "system metrics expose no secrets / connection strings",
    !/postgresql:\/\/|jwt_secret|database_url|password/i.test(JSON.stringify(metrics.body)),
  );
  check(
    "students cannot read system metrics",
    (await api("GET", "/monitoring/system", studentA)).status === 403,
  );

  // --- Temporary Gemini execution fallback: Student B, with `fetch` stubbed so
  // no real model is called. Proves the pipeline still produces a normal result
  // and that nothing about the provider leaks to the student.
  const sessionB = startB.body.id;
  const qB = startB.body.questions[0];
  const submitB = await api(
    "POST",
    `/student/sessions/${sessionB}/questions/${qB.id}/submissions`,
    studentB,
    { language: "PYTHON", sourceCode: "a,b=map(int,input().split())\nprint(a+b)" },
  );
  const bundleB = await prisma.submission.findUnique({
    where: { id: submitB.body.submission.id },
    include: { question: { include: { testCases: true } } },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      cases: bundleB.question.testCases.map((tc) => ({
                        caseId: tc.id,
                        status: "ACCEPTED",
                        stdout: tc.expectedOutput,
                        stderr: "",
                        time: 0.01,
                        memory: 2048,
                      })),
                    }),
                  },
                ],
              },
            },
          ],
        }),
      text: () => Promise.resolve(""),
    });
  let outcomeB;
  try {
    outcomeB = await evaluateSubmission(submitB.body.submission.id, {
      executionProvider: new GeminiExecutionProvider({
        apiKey: "smoke-key",
        model: "gemini-2.0-flash",
        baseUrl: "https://example.invalid/v1beta",
        timeoutMs: 5000,
      }),
      analyzers: mockAnalyzers,
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  check(
    "fallback path graded Student B's submission",
    outcomeB.status === "completed" && outcomeB.scorePercent === 100,
  );
  const bResult = await api("GET", `/student/submissions/${submitB.body.submission.id}`, studentB);
  check(
    "Student B sees a normal COMPLETED result",
    bResult.body.evaluation?.status === "COMPLETED",
  );
  const bPayload = JSON.stringify(bResult.body).toLowerCase();
  check(
    "student result never names the execution provider / AI / Judge0",
    !/judge0|gemini|\bai\b|fallback|simulated|mock execution|fake execution/.test(bPayload),
  );

  instr.seen.length = 0;
  const violation = await api("POST", `/student/sessions/${sessionA}/violations`, studentA, {
    type: "FULLSCREEN_EXIT",
    note: "smoke test",
  });
  check(
    "fullscreen violation recorded, count = 1",
    violation.body.violationCount === 1 && Boolean(violation.body.warning),
  );
  await sleep(200);
  check("instructor nudged on the violation", instr.seen.includes("assessment:changed"));

  const withFlags = await api("GET", `/assessments/${assessmentId}/results`, instructor);
  check(
    "instructor dashboard shows the integrity flag",
    withFlags.body.students.find((s) => s.sessionId === sessionA).violationCount === 1,
  );
  const sessViolations = await api(
    "GET",
    `/assessments/${assessmentId}/sessions/${sessionA}/violations`,
    instructor,
  );
  check(
    "instructor can inspect the violation",
    sessViolations.body.violations[0].type === "FULLSCREEN_EXIT",
  );

  const hints = await api("GET", `/student/sessions/${sessionA}/questions/${q.id}/hints`, studentA);
  const staticStage = hints.body.stages.find((s) => s.deliveryType === "STATIC" && s.available);
  if (staticStage) {
    const got = await api(
      "POST",
      `/student/sessions/${sessionA}/questions/${q.id}/hints`,
      studentA,
      { stageNumber: staticStage.stageNumber },
    );
    check(
      "static hint delivered (no AI provider needed)",
      got.status === 201 && got.body.source === "static" && Boolean(got.body.content),
    );
  } else {
    check(
      "static hint stages configured",
      hints.body.stages.some((s) => s.deliveryType === "STATIC"),
    );
  }

  instr.s.close();
  stu.s.close();
} finally {
  if (assessmentId) {
    const sessions = await prisma.examSession.findMany({
      where: { assessmentId },
      select: { id: true },
    });
    const ids = sessions.map((s) => s.id);
    await prisma.testCaseResult.deleteMany({
      where: { evaluationRun: { submission: { examSessionId: { in: ids } } } },
    });
    await prisma.criterionScore.deleteMany({
      where: { evaluationRun: { submission: { examSessionId: { in: ids } } } },
    });
    await prisma.evaluationRun.deleteMany({
      where: { submission: { examSessionId: { in: ids } } },
    });
    await prisma.submission.deleteMany({ where: { examSessionId: { in: ids } } });
    await prisma.submissionDraft.deleteMany({ where: { examSessionId: { in: ids } } });
    await prisma.hintUsage.deleteMany({ where: { examSessionId: { in: ids } } });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "ExamSession", entityId: { in: ids } },
    });
    await prisma.violation.deleteMany({ where: { examSessionId: { in: ids } } });
    await prisma.examSession.deleteMany({ where: { assessmentId } });
    await prisma.assessmentQuestion.deleteMany({ where: { assessmentId } });
    await prisma.assessment.deleteMany({ where: { id: assessmentId } });
  }
  await shutdownRealtime();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
