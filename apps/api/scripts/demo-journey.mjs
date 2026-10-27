#!/usr/bin/env node
/**
 * Full core journey against the RUNNING local stack (API :4000, evaluator with
 * local execution, hint-engine + Ollama). No mocks: code is really executed and
 * the AI-mentor hint really comes from the local model.
 *
 *   node apps/api/scripts/demo-journey.mjs     (then: pnpm db:demo-reset)
 *
 * instructor ensures Two Sum has an AI-mentor stage 3 -> student1 starts the
 * live assessment -> 3 wrong attempts (really executed) with hints 1, 2 and the
 * AI stage between them -> correct attempt -> Transfer Check (hints refused,
 * solved) -> instructor Evidence Replay shows every attempt, the exact hint
 * texts, the AI hint's provider/model, and the transfer outcome; nothing hidden
 * leaks to the student. Exit code 0 = every check passed.
 */
const API = process.env.JOURNEY_API_URL ?? "http://127.0.0.1:4000";
const INSTRUCTOR = [
  "instructor@example.edu",
  process.env.JOURNEY_INSTRUCTOR_PASSWORD ?? "instructor-dev-password",
];
const STUDENT = [
  "student1@example.edu",
  process.env.JOURNEY_STUDENT_PASSWORD ?? "student-dev-password",
];

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : " FAIL "}${label}${detail ? ` - ${detail}` : ""}`);
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, token, body) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, error: json.error, raw: JSON.stringify(json) };
}

async function login([email, password]) {
  const res = await api("POST", "/auth/login", null, { email, password, mode: "token" });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.data.accessToken;
}

const WRONG = [
  "print(0, 0)",
  "n, t = map(int, input().split())\nnums = list(map(int, input().split()))\nprint(0, n - 1)",
  "n, t = map(int, input().split())\nnums = list(map(int, input().split()))\nfor i in range(n):\n    for j in range(n):\n        if i != j and nums[i] + nums[j] == t:\n            print(j, i)\n            raise SystemExit",
];
const CORRECT =
  "n, target = map(int, input().split())\nnums = list(map(int, input().split()))\nseen = {}\nfor i, x in enumerate(nums):\n    if target - x in seen:\n        print(seen[target - x], i)\n        break\n    seen[x] = i";
const TRANSFER_CORRECT =
  "input()\nnums = input().split()\nprint('true' if len(set(nums)) < len(nums) else 'false')";

async function waitForEvaluation(student, sessionId, questionId, attemptNumber, path = null) {
  for (let i = 0; i < 120; i += 1) {
    const view = path
      ? (await api("GET", path, student)).data?.question
      : (await api("GET", `/student/sessions/${sessionId}`, student)).data?.questions?.find(
          (q) => q.id === questionId,
        );
    const sub = view?.submissions?.find((s) => s.attemptNumber === attemptNumber);
    const ev = sub?.evaluation;
    if (ev && ev.status !== "PENDING" && ev.status !== "RUNNING") return { sub, ev };
    await sleep(500);
  }
  return { sub: null, ev: null };
}

const instructor = await login(INSTRUCTOR);
const student = await login(STUDENT);
check("instructor and student signed in", Boolean(instructor && student));

const assessments = (await api("GET", "/assessments", instructor)).data ?? [];
const live = assessments.find((a) => a.status === "ACTIVE" && /Live Coding/i.test(a.title));
if (!check("live assessment is ACTIVE", Boolean(live))) process.exit(1);
const detail = (await api("GET", `/assessments/${live.id}`, instructor)).data;
const twoSum = detail.questions.find((q) => /^Two Sum$/i.test(q.title ?? q.question?.title ?? ""));
const twoSumId = twoSum?.questionId ?? twoSum?.id ?? twoSum?.question?.id;
if (!check("Two Sum is in the assessment", Boolean(twoSumId))) process.exit(1);

// Instructor: ensure an AI-mentor stage 3 exists (idempotent across runs).
let stages = (await api("GET", `/questions/${twoSumId}/hint-stages`, instructor)).data ?? [];
if (!stages.some((s) => s.deliveryType === "INTERACTIVE")) {
  const created = await api("POST", `/questions/${twoSumId}/hint-stages`, instructor, {
    title: "AI mentor",
    deliveryType: "INTERACTIVE",
    content: null,
  });
  check("instructor added an AI-mentor stage", created.status === 201, `HTTP ${created.status}`);
  stages = created.data ?? stages;
}
const aiStage = stages.find((s) => s.deliveryType === "INTERACTIVE");
check(
  "Two Sum hint stages",
  stages.length >= 3,
  stages.map((s) => `${s.stageNumber}:${s.deliveryType}`).join(" "),
);

// Student: start with the evidence notice acknowledged.
const started = await api("POST", `/student/assessments/${live.id}/session`, student, {
  acknowledgeEvidenceNotice: true,
});
const sessionId = started.data?.id;
if (
  !check(
    "student started a session",
    Boolean(sessionId),
    `HTTP ${started.status}${started.error ? ` ${started.error.message}` : ""}`,
  )
) {
  console.log("Hint: run `pnpm db:demo-reset` first.");
  process.exit(1);
}
const hintsUrl = `/student/sessions/${sessionId}/questions/${twoSumId}/hints`;
const submitUrl = `/student/sessions/${sessionId}/questions/${twoSumId}/submissions`;
const delivered = [];

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const sub = await api("POST", submitUrl, student, {
    language: "PYTHON",
    sourceCode: WRONG[attempt - 1],
  });
  check(`wrong attempt ${attempt} submitted`, sub.status === 201, `HTTP ${sub.status}`);
  const { ev } = await waitForEvaluation(student, sessionId, twoSumId, attempt);
  check(
    `attempt ${attempt} really executed and failed`,
    ev?.status === "COMPLETED" && ev.testsPassed < ev.testsTotal,
    ev ? `${ev.testsPassed}/${ev.testsTotal}` : "no evaluation (is the evaluator running?)",
  );
  const stageNumber = attempt;
  const started = Date.now();
  const hint = await api("POST", hintsUrl, student, { stageNumber });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const isAi = aiStage && stageNumber === aiStage.stageNumber;
  check(
    `hint stage ${stageNumber} delivered${isAi ? " by the local model" : ""}`,
    hint.status === 201,
    `HTTP ${hint.status}, ${seconds}s${hint.error ? `, ${hint.error.code}` : ""}`,
  );
  if (hint.status === 201) {
    delivered.push({ stageNumber, content: hint.data.content });
    if (isAi) {
      console.log(`        AI hint: "${hint.data.content.replace(/\s+/g, " ")}"`);
      check(
        "student response does not name the provider or model",
        !/ollama|qwen|llama|gemma/i.test(hint.raw),
      );
    }
  }
}

const final = await api("POST", submitUrl, student, { language: "PYTHON", sourceCode: CORRECT });
check("correct attempt submitted", final.status === 201);
const { ev: finalEv } = await waitForEvaluation(student, sessionId, twoSumId, 4);
check(
  "correct attempt passes every test",
  finalEv?.testsPassed === finalEv?.testsTotal && finalEv?.testsTotal > 0,
  finalEv ? `${finalEv.testsPassed}/${finalEv.testsTotal}` : "none",
);

// Transfer Check: unlocked by solving, hints refused, solved.
const transferPath = `/student/sessions/${sessionId}/questions/${twoSumId}/transfer`;
const transfer = await api("GET", transferPath, student);
check(
  "Transfer Check available after solving",
  transfer.status === 200 && transfer.data?.transfer?.available !== false,
  transfer.data?.transfer?.lockedReason ?? "",
);
if (transfer.status === 200) {
  const tq = transfer.data.question.id;
  const refused = await api(
    "POST",
    `/student/sessions/${sessionId}/questions/${tq}/hints`,
    student,
    { stageNumber: 1 },
  );
  check(
    "hints are refused during the Transfer Check",
    refused.status >= 400 && refused.status < 500,
    `HTTP ${refused.status}`,
  );
  const tsub = await api("POST", `${transferPath}/submissions`, student, {
    language: "PYTHON",
    sourceCode: TRANSFER_CORRECT,
  });
  check("transfer attempt submitted", tsub.status === 201, `HTTP ${tsub.status}`);
  let result = null;
  for (let i = 0; i < 120 && (!result || result === "PENDING"); i += 1) {
    await sleep(500);
    result = (await api("GET", transferPath, student)).data?.transfer?.result ?? null;
  }
  check("Transfer Check passed", result === "PASSED", String(result));
}

// Hidden data never reaches the student.
const sessionView = await api("GET", `/student/sessions/${sessionId}`, student);
check(
  "student session view carries no hidden-test fields",
  !/"visibility":"HIDDEN"[^}]*"input":"[^"]/.test(sessionView.raw),
);

// Instructor: evidence record.
const result = await api("GET", `/assessments/${live.id}/sessions/${sessionId}/result`, instructor);
check("instructor opens the session evidence", result.status === 200, `HTTP ${result.status}`);
const q = result.data?.questions?.find((x) => x.questionId === twoSumId);
const replayHints = [
  ...(q?.attempts ?? []).flatMap((a) => a.hintsBefore),
  ...(q?.hintsAfterFinalAttempt ?? []),
];
check("replay shows 4 attempts", q?.attempts?.length === 4, String(q?.attempts?.length));
check(
  "replay hint texts equal what the student was shown",
  delivered.every((d) =>
    replayHints.some((h) => h.stageNumber === d.stageNumber && h.content === d.content),
  ),
);
const aiReplay = replayHints.find((h) => h.source === "ai");
if (aiStage) {
  check(
    "AI hint carries provider + model provenance",
    aiReplay?.generatedBy?.provider === "ollama" && Boolean(aiReplay?.generatedBy?.model),
    aiReplay?.generatedBy
      ? `${aiReplay.generatedBy.provider} / ${aiReplay.generatedBy.model}`
      : "none",
  );
}
check(
  "transfer outcome reported beside the score",
  Boolean(q?.transferCheck),
  q?.transferCheck?.result ?? "none",
);
check("no mastery/competence wording in the evidence", !/mastery|competen|cheat/i.test(result.raw));

console.log(
  `\n${failed === 0 ? "JOURNEY PASSED" : `JOURNEY FAILED (${failed})`} - session ${sessionId}. Run \`pnpm db:demo-reset\` to clear it.`,
);
process.exit(failed === 0 ? 0 : 1);
