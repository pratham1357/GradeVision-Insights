/**
 * E1/E2 runner (paper Section VI). Prompts and evidence come from the
 * repository's own modules, unmodified:
 *   - services/hint-engine/src/provider.ts  HINT_SYSTEM_PROMPT, buildHintPrompt
 *   - apps/api/.../student/hint-context.ts  buildHintExecutionEvidence
 *   - packages/grading/src/normalize.ts     outputsMatch (evaluator comparison)
 * Evidence is real execution output: every attempt (and every attacked attempt
 * in E2) is run with the local Python interpreter, 5 s limit per test.
 *
 * Usage (from the repository root):
 *   node services/hint-engine/node_modules/tsx/dist/cli.mjs experiments/run_llm.ts --dataset
 *   ... --dry            plan + prompt sizes, no model calls
 *   ... --run [--max-calls N]   resumable; appends to results/llm_raw.jsonl
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildHintExecutionEvidence } from "../apps/api/src/modules/student/hint-context.ts";
import { outputsMatch } from "../packages/grading/src/normalize.ts";
import {
  buildHintPrompt,
  CODE_CLOSE,
  CODE_OPEN,
  HINT_SYSTEM_PROMPT,
  hintRequestSchema,
  OUTPUT_CLOSE,
  OUTPUT_OPEN,
} from "../services/hint-engine/src/provider.ts";
import { ATTACKS, PROBLEMS, type DatasetProblem } from "./dataset.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const resultsDir = path.join(here, "results");
const RAW = path.join(resultsDir, "llm_raw.jsonl");
const PROMPTS = path.join(resultsDir, "prompts.jsonl");
mkdirSync(resultsDir, { recursive: true });

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b-instruct";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 75_000);
const PYTHON = process.env.PYTHON_BIN ?? "python";

// Generation options of the shipped OllamaProvider (services/hint-engine/src/ollama.ts).
const OPTIONS = { temperature: 0.3, top_p: 0.9, num_predict: 220, num_ctx: 2048 };
{
  const src = readFileSync(path.join(root, "services/hint-engine/src/ollama.ts"), "utf8");
  const ok =
    /temperature:\s*0\.3\b/u.test(src) &&
    /top_p:\s*0\.9\b/u.test(src) &&
    /OLLAMA_NUM_PREDICT\s*=\s*220\b/u.test(src);
  if (!ok) throw new Error("ollama.ts generation options changed - update OPTIONS before running");
}

const E1_STAGES = [2, 4];
const E1_CONDITIONS = ["C2", "C1", "C0"] as const;
const E2_CONDITIONS = ["C2", "C2-nofence"] as const;
const REPEATS = 3;
// The paper does not name the three E2 attempts or the stage; fixed here before
// any call: the first attempt (b1) of the first three problems, at stage 4.
const E2_CASES = ["sum_even-b1", "palindrome-b1", "second_largest-b1"];
const E2_STAGE = 4;

// --- execution -------------------------------------------------------------

interface CaseRun {
  name: string;
  visibility: "VISIBLE" | "HIDDEN";
  input: string;
  expected: string;
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout: string;
  stderr: string;
}

const workDir = path.join(os.tmpdir(), "gv-experiments");
mkdirSync(workDir, { recursive: true });

function execute(code: string, problem: DatasetProblem): CaseRun[] {
  const file = path.join(workDir, "main.py");
  writeFileSync(file, code);
  return problem.tests.map((test) => {
    const r = spawnSync(PYTHON, ["-I", file], {
      input: test.input + "\n",
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const stdout = (r.stdout ?? "").replace(/\r\n/gu, "\n");
    const stderr = (r.stderr ?? "").replace(/\r\n/gu, "\n");
    // Same mapping as packages/grading statusFromRun: non-zero exit = runtime error.
    const status: CaseRun["status"] =
      r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
        ? "TIMEOUT"
        : r.status !== 0
          ? "ERROR"
          : outputsMatch(stdout, test.expected)
            ? "PASSED"
            : "FAILED";
    return { ...test, status, stdout, stderr };
  });
}

function evidenceFor(runs: CaseRun[]) {
  return buildHintExecutionEvidence([
    {
      attemptNumber: 1,
      status: "COMPLETED",
      evaluationRuns: [
        {
          status: "COMPLETED",
          testCaseResults: runs.map((r, position) => ({
            status: r.status,
            stdout: r.stdout,
            stderr: r.stderr,
            testCase: {
              name: r.name,
              visibility: r.visibility,
              input: r.input,
              expectedOutput: r.expected,
              position,
            },
          })),
        },
      ],
    },
  ] as never);
}

// --- dataset check (Table XIV) ----------------------------------------------

function datasetCheck() {
  const outcomes = [];
  for (const problem of PROBLEMS) {
    const ref = execute(problem.reference, problem);
    const bad = ref.filter((r) => r.status !== "PASSED");
    if (bad.length) throw new Error(`reference for ${problem.id} fails ${bad.map((b) => b.name)}`);
    for (const attempt of problem.attempts) {
      const runs = execute(attempt.code, problem);
      outcomes.push({
        case: attempt.id,
        defect: attempt.defect,
        pass: runs.filter((r) => r.status === "PASSED").length,
        visibleFail: runs.filter((r) => r.visibility === "VISIBLE" && r.status !== "PASSED").length,
        hiddenFail: runs.filter((r) => r.visibility === "HIDDEN" && r.status !== "PASSED").length,
        errors: runs.filter((r) => r.stderr.trim()).length,
        statuses: runs.map((r) => r.status[0]).join(""),
      });
    }
  }
  return outcomes;
}

// --- prompts ------------------------------------------------------------------

const DELIMITERS = new Set([CODE_OPEN, CODE_CLOSE, OUTPUT_OPEN, OUTPUT_CLOSE]);

function platformPrompt(problem: DatasetProblem, code: string, stage: number, runs: CaseRun[]) {
  const request = hintRequestSchema.parse({
    stageNumber: stage,
    language: "PYTHON",
    questionTitle: problem.title,
    questionStatement: problem.statement,
    studentCode: code,
    previousHints: [],
    evidence: evidenceFor(runs),
  });
  return buildHintPrompt(request);
}

function messagesFor(
  condition: string,
  problem: DatasetProblem,
  code: string,
  stage: number,
  runs: CaseRun[],
) {
  const user = platformPrompt(problem, code, stage, runs);
  switch (condition) {
    case "C2":
      return { system: HINT_SYSTEM_PROMPT, user };
    case "C1":
      return { system: "You are a helpful programming assistant.", user };
    case "C0":
      return {
        system: null,
        user: `Here is my Python code for the problem "${problem.title}":\n${problem.statement}\n\n${code}\n\nIt does not work. Help me.`,
      };
    case "C2-nofence":
      // Lines that consist only of a fence delimiter are removed; the system prompt still mentions them.
      return {
        system: HINT_SYSTEM_PROMPT,
        user: user
          .split("\n")
          .filter((line) => !DELIMITERS.has(line.trim()))
          .join("\n"),
      };
  }
  throw new Error(condition);
}

// --- plan ---------------------------------------------------------------------

interface Item {
  key: string;
  experiment: "E1" | "E2";
  case: string;
  problem: string;
  stage: number;
  condition: string;
  attack: string | null;
  repeat: number;
  system: string | null;
  user: string;
}

function plan(): Item[] {
  const byCase = new Map(
    PROBLEMS.flatMap((p) => p.attempts.map((a) => [a.id, { problem: p, attempt: a }] as const)),
  );
  const items: Item[] = [];
  const eligible: string[] = [];
  const runsByCase = new Map<string, CaseRun[]>();
  for (const [id, { problem, attempt }] of byCase) {
    const runs = execute(attempt.code, problem);
    runsByCase.set(id, runs);
    if (runs.some((r) => r.status !== "PASSED")) eligible.push(id); // policy: no hint once passing
  }
  const e2Runs = new Map<string, CaseRun[]>();
  for (const id of E2_CASES) {
    const { problem, attempt } = byCase.get(id)!;
    for (const attack of ATTACKS) {
      e2Runs.set(`${id}|${attack.family}`, execute(`${attempt.code}\n${attack.text}`, problem));
    }
  }
  for (let repeat = 1; repeat <= REPEATS; repeat++) {
    for (const id of eligible) {
      const { problem, attempt } = byCase.get(id)!;
      for (const stage of E1_STAGES) {
        for (const condition of E1_CONDITIONS) {
          const m = messagesFor(condition, problem, attempt.code, stage, runsByCase.get(id)!);
          items.push({
            key: `E1|${id}|${stage}|${condition}|-|${repeat}`,
            experiment: "E1",
            case: id,
            problem: problem.id,
            stage,
            condition,
            attack: null,
            repeat,
            ...m,
          });
        }
      }
    }
    for (const id of E2_CASES) {
      const { problem, attempt } = byCase.get(id)!;
      for (const attack of ATTACKS) {
        const code = `${attempt.code}\n${attack.text}`;
        for (const condition of E2_CONDITIONS) {
          const m = messagesFor(
            condition,
            problem,
            code,
            E2_STAGE,
            e2Runs.get(`${id}|${attack.family}`)!,
          );
          items.push({
            key: `E2|${id}|${E2_STAGE}|${condition}|${attack.family}|${repeat}`,
            experiment: "E2",
            case: id,
            problem: problem.id,
            stage: E2_STAGE,
            condition,
            attack: attack.family,
            repeat,
            ...m,
          });
        }
      }
    }
  }
  return items;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function modelInfo() {
  const version = (await (await fetch(`${OLLAMA}/api/version`)).json()) as { version: string };
  const tags = (await (await fetch(`${OLLAMA}/api/tags`)).json()) as {
    models: { name: string; digest: string; details: Record<string, string> }[];
  };
  const m = tags.models.find((x) => x.name === MODEL);
  if (!m) throw new Error(`model ${MODEL} not pulled`);
  return {
    ollamaVersion: version.version,
    model: MODEL,
    digest: m.digest,
    quantization: m.details.quantization_level,
    parameterSize: m.details.parameter_size,
  };
}

async function call(item: Item) {
  const messages = [
    ...(item.system ? [{ role: "system", content: item.system }] : []),
    { role: "user", content: item.user },
  ];
  const started = performance.now();
  try {
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: "30m",
        messages,
        options: OPTIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) return { latencyMs, error: `HTTP ${response.status}`, output: null };
    const body = (await response.json()) as Record<string, unknown> & {
      message?: { content?: string };
    };
    return {
      latencyMs,
      error: null,
      output: body.message?.content ?? "",
      promptTokens: body.prompt_eval_count ?? null,
      outputTokens: body.eval_count ?? null,
      totalDurationMs: body.total_duration ? Math.round(Number(body.total_duration) / 1e6) : null,
      loadDurationMs: body.load_duration ? Math.round(Number(body.load_duration) / 1e6) : null,
      doneReason: body.done_reason ?? null,
      returnedModel: body.model ?? null,
    };
  } catch (error) {
    return {
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      output: null,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--dataset")) {
    const outcomes = datasetCheck();
    writeFileSync(path.join(resultsDir, "dataset_outcomes.json"), JSON.stringify(outcomes, null, 2));
    console.table(outcomes.map(({ statuses: _s, ...o }) => o));
    return;
  }
  const items = plan();
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.experiment] = (counts[i.experiment] ?? 0) + 1;
  console.log("planned calls:", counts, "total", items.length);
  if (args.includes("--dry")) {
    const chars = items.map((i) => (i.system?.length ?? 0) + i.user.length);
    console.log("prompt chars min/median/max:", Math.min(...chars), chars.sort((a, b) => a - b)[chars.length >> 1], Math.max(...chars));
    return;
  }
  if (!args.includes("--run")) return;

  const info = await modelInfo();
  console.log("model:", info);
  const done = new Set(
    existsSync(RAW)
      ? readFileSync(RAW, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).key as string)
      : [],
  );
  const knownPrompts = new Set(
    existsSync(PROMPTS)
      ? readFileSync(PROMPTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).hash as string)
      : [],
  );
  const maxIdx = args.indexOf("--max-calls");
  const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) : Infinity;

  // Warm-up (not recorded) so the first measured call does not include the model load.
  await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, stream: false, keep_alive: "30m", messages: [{ role: "user", content: "hi" }], options: { num_predict: 1 } }),
  });

  let n = 0;
  for (const item of items) {
    if (done.has(item.key) || n >= max) continue;
    const promptHash = sha256(`${item.system ?? ""}\u0000${item.user}`);
    if (!knownPrompts.has(promptHash)) {
      appendFileSync(PROMPTS, JSON.stringify({ hash: promptHash, system: item.system, user: item.user }) + "\n");
      knownPrompts.add(promptHash);
    }
    const result = await call(item);
    const { system: _s, user: _u, ...meta } = item;
    appendFileSync(
      RAW,
      JSON.stringify({ ...meta, ...info, promptHash, timestamp: new Date().toISOString(), options: OPTIONS, ...result }) + "\n",
    );
    n++;
    if (n % 10 === 0 || result.error) {
      console.log(`${n} calls; last ${item.key} ${result.latencyMs} ms ${result.error ?? ""}`);
    }
  }
  console.log(`done: ${n} new calls`);
}

await main();
