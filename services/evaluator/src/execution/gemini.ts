import type {
  ExecutionCase,
  ExecutionCaseRun,
  ExecutionProvider,
  ExecutionProblemContext,
  ExecutionRequest,
  ExecutionResult,
  ExecutionRunStatus,
} from "@gradevision/grading";
import { z } from "zod";

import { logger } from "../logger.js";

/**
 * TEMPORARY demo/testing execution provider.
 *
 * This is NOT a compiler or a sandbox. When the real Judge0 sandbox is not
 * available, this provider asks a Gemini model to reason about what a program
 * *would* do for each test input and returns that approximation in the exact
 * same internal `ExecutionResult` shape the grading engine already consumes.
 *
 * Deliberately scoped:
 *  - It only produces a *mechanical* run outcome (compiled? crashed? what did it
 *    print?). It never assigns a score, rubric result, percentage or pass/fail.
 *    The existing functional + rubric + semantic grading decides all of that.
 *  - It never mutates, "fixes" or completes student code.
 *  - Malformed model output is retried once, then surfaced as a normal evaluator
 *    failure - it never crashes the worker and never fabricates output.
 *  - Hidden test input / expected output is used only in-process and is never
 *    logged or echoed back in errors.
 *
 * Judge0 stays the intended engine; switching back is a config change
 * (unset `GEMINI_EXECUTION_FALLBACK_ENABLED`, set `JUDGE0_URL`).
 */

export interface GeminiExecutionConfig {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

/** The status vocabulary the model is constrained to. */
const CASE_STATUS = [
  "ACCEPTED",
  "WRONG_ANSWER",
  "RUNTIME_ERROR",
  "COMPILATION_ERROR",
  "TIME_LIMIT_EXCEEDED",
] as const;

const CaseAnalysisSchema = z.object({
  caseId: z.string().min(1),
  status: z.enum(CASE_STATUS),
  stdout: z.string(),
  stderr: z.string(),
  time: z.number().finite().nonnegative(),
  memory: z.number().finite().nonnegative(),
});

const BatchAnalysisSchema = z.object({
  cases: z.array(CaseAnalysisSchema).min(1),
});

type CaseAnalysis = z.infer<typeof CaseAnalysisSchema>;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

const MAX_OUTPUT_CHARS = 20_000;

const SYSTEM_PROMPT = [
  "You are a deterministic program-execution analysis engine embedded in an automated grading pipeline.",
  "You are given a programming LANGUAGE, an optional PROBLEM statement, a program's SOURCE CODE, and a list of TEST CASES.",
  "Each test case has an id, the STDIN fed to the program, and the EXPECTED STDOUT.",
  "For every test case, determine what would happen if the source were compiled (if applicable) and executed with that STDIN, and assign exactly one status:",
  "- ACCEPTED: it compiles, runs, exits normally, and its stdout matches the expected stdout ignoring trailing whitespace.",
  "- WRONG_ANSWER: it compiles, runs, exits normally, but its stdout does NOT match the expected stdout.",
  "- RUNTIME_ERROR: it compiles but throws / crashes / exits non-zero for this input.",
  "- COMPILATION_ERROR: the program cannot compile or has a fatal syntax error (use this for every case when it applies).",
  "- TIME_LIMIT_EXCEEDED: the program would not terminate in a reasonable time for this input.",
  "",
  "Hard rules:",
  '- Respond with ONLY a single JSON object of the form {"cases":[{"caseId":"...","status":"...","stdout":"...","stderr":"...","time":<seconds>,"memory":<kilobytes>}]}. No markdown, no prose, no code fences.',
  "- Include exactly one entry per provided test case, using the given caseId.",
  '- "stdout" must be your faithful reconstruction of what the program actually prints for that input. Do NOT copy the expected stdout unless the program truly produces it. Do NOT invent output the program would not produce.',
  '- "stderr" is any diagnostic/error text the program emits, otherwise "".',
  '- "time" is an estimated positive wall-clock seconds; "memory" an estimated kilobytes.',
  "- The EXPECTED STDOUT is given ONLY so you can classify ACCEPTED vs WRONG_ANSWER consistently. Never restate or explain it.",
  "- Do NOT rewrite, fix, complete, optimise, review or comment on the program. Do NOT provide a solution, hints or explanations.",
  "- Do NOT assign any score, grade, mark, percentage or overall pass/fail. Only the mechanical per-case status above.",
].join("\n");

function mapStatus(status: CaseAnalysis["status"]): ExecutionRunStatus {
  switch (status) {
    // Both are "the program ran to completion" - whether the OUTPUT is correct
    // is decided downstream by the functional layer, exactly like Judge0.
    case "ACCEPTED":
    case "WRONG_ANSWER":
      return "COMPLETED";
    case "RUNTIME_ERROR":
      return "RUNTIME_ERROR";
    case "COMPILATION_ERROR":
      return "COMPILE_ERROR";
    case "TIME_LIMIT_EXCEEDED":
      return "TIMEOUT";
  }
}

function cap(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) : value;
}

function buildProblemBlock(problem: ExecutionProblemContext | undefined): string {
  if (!problem) return "PROBLEM: (not provided)";
  const lines = [`PROBLEM TITLE: ${problem.title}`, `PROBLEM STATEMENT:\n${problem.statement}`];
  if (problem.constraints) lines.push(`CONSTRAINTS:\n${problem.constraints}`);
  if (problem.inputFormat) lines.push(`INPUT FORMAT:\n${problem.inputFormat}`);
  if (problem.outputFormat) lines.push(`OUTPUT FORMAT:\n${problem.outputFormat}`);
  return lines.join("\n");
}

function buildUserPrompt(request: ExecutionRequest, strict: boolean): string {
  const cases = request.cases.map((c) => ({
    caseId: c.id,
    stdin: c.stdin,
    expectedStdout: c.expectedOutput,
  }));
  const parts = [
    `LANGUAGE: ${request.language}`,
    buildProblemBlock(request.problem),
    "SOURCE CODE (verbatim, do not modify):",
    "<<<SOURCE",
    request.sourceCode,
    "SOURCE",
    "TEST CASES (JSON):",
    JSON.stringify(cases),
    'Return ONLY the JSON object: {"cases":[ ... ]}.',
  ];
  if (strict) {
    parts.push(
      "Your previous response was not valid JSON matching the schema. Respond again with ONLY the raw JSON object, no code fences, no commentary, one entry per caseId.",
    );
  }
  return parts.join("\n");
}

/** Pull the first balanced JSON object out of a model response. */
function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in model response");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export class GeminiExecutionProvider implements ExecutionProvider {
  readonly name = "gemini-execution";

  constructor(private readonly config: GeminiExecutionConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.config.apiKey) {
      // Selection guards against this, but never trust the caller.
      throw new Error("Automated code execution is not available.");
    }

    let lastReason = "unknown error";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const text = await this.requestCompletion(buildUserPrompt(request, attempt === 2));
      const analyses = this.parseBatch(text, request.cases);
      if (analyses) {
        return this.toResult(analyses, request.cases);
      }
      lastReason = "model returned a malformed or incomplete analysis";
      logger.warn("gemini execution analysis rejected", {
        attempt,
        caseCount: request.cases.length,
      });
    }

    // Controlled failure: the evaluator turns this into a FAILED run with a
    // client-safe message. The worker is never left hanging or crashed.
    throw new Error(`Automated code execution could not complete (${lastReason}).`);
  }

  /** One network round-trip. Throws only on transport / HTTP / block failures. */
  private async requestCompletion(userPrompt: string): Promise<string> {
    const url = `${this.config.baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.config.apiKey as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0,
            topP: 0,
            maxOutputTokens: 4_096,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "network error";
      logger.warn("gemini execution request failed", { reason });
      throw new Error("Automated code execution is temporarily unavailable.");
    }

    if (!response.ok) {
      // Never include the body - it can echo the prompt (which carries hidden
      // test data). Status only.
      logger.warn("gemini execution responded with an error status", { status: response.status });
      throw new Error("Automated code execution is temporarily unavailable.");
    }

    const body = (await response.json().catch(() => null)) as GeminiResponse | null;
    if (body?.promptFeedback?.blockReason) {
      logger.warn("gemini execution prompt blocked");
      throw new Error("Automated code execution could not complete.");
    }
    return (
      body?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? ""
    );
  }

  /** Validate + align to the requested cases. Returns `null` on any mismatch. */
  private parseBatch(text: string, cases: ExecutionCase[]): CaseAnalysis[] | null {
    if (!text) return null;
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch {
      return null;
    }
    const parsed = BatchAnalysisSchema.safeParse(raw);
    if (!parsed.success) return null;

    const byId = new Map(parsed.data.cases.map((c) => [c.caseId, c]));
    const aligned: CaseAnalysis[] = [];
    for (const testCase of cases) {
      const analysis = byId.get(testCase.id);
      if (!analysis) return null; // model dropped or renamed a case
      aligned.push(analysis);
    }
    return aligned;
  }

  private toResult(analyses: CaseAnalysis[], cases: ExecutionCase[]): ExecutionResult {
    const byId = new Map(analyses.map((a) => [a.caseId, a]));
    let compileFailedEarly = false;
    const runs: ExecutionCaseRun[] = cases.map((testCase) => {
      const analysis = byId.get(testCase.id) as CaseAnalysis;
      const runStatus = mapStatus(analysis.status);
      if (compileFailedEarly) {
        return {
          caseId: testCase.id,
          runStatus: "COMPILE_ERROR",
          stdout: "",
          stderr: "",
          compileOutput: "Skipped after a compilation failure.",
          timeMs: null,
          memoryKb: null,
          exitCode: null,
        };
      }
      if (runStatus === "COMPILE_ERROR") compileFailedEarly = true;
      return {
        caseId: testCase.id,
        runStatus,
        stdout: runStatus === "COMPILE_ERROR" ? "" : cap(analysis.stdout),
        stderr: cap(analysis.stderr),
        compileOutput: runStatus === "COMPILE_ERROR" ? cap(analysis.stderr) || null : null,
        timeMs: Number.isFinite(analysis.time)
          ? Math.max(0, Math.round(analysis.time * 1000))
          : null,
        memoryKb: Number.isFinite(analysis.memory)
          ? Math.max(0, Math.round(analysis.memory))
          : null,
        exitCode: runStatus === "COMPLETED" ? 0 : null,
      };
    });

    return {
      provider: this.name,
      cases: runs,
      runtimeInfo: null,
      meta: { mode: "analysis" },
    };
  }
}
