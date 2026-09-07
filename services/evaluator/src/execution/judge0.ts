import type {
  ExecutionCaseRun,
  ExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
  ExecutionRunStatus,
  GradingLanguage,
} from "@gradevision/grading";

import { logger } from "../logger.js";

export interface Judge0Config {
  url: string;
  token: string | null;
  languageIds: Record<GradingLanguage, number>;
}

interface Judge0SubmissionResponse {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
  exit_code: number | null;
  status: { id: number; description: string };
}

const b64 = (value: string): string => Buffer.from(value, "utf8").toString("base64");
const unb64 = (value: string | null): string =>
  value ? Buffer.from(value, "base64").toString("utf8") : "";

/** Judge0 status id -> our mechanical run status. */
function mapStatus(id: number): ExecutionRunStatus {
  if (id === 3 || id === 4) return "COMPLETED";
  if (id === 5) return "TIMEOUT";
  if (id === 6) return "COMPILE_ERROR";
  if (id >= 7 && id <= 12) return "RUNTIME_ERROR";
  return "INTERNAL_ERROR";
}

/**
 * Real sandbox: a self-hosted Judge0 CE instance. Each case is one synchronous
 * `wait=true` submission. Student compile/runtime failures are reported per case;
 * only Judge0 being unreachable throws.
 */
export class Judge0Provider implements ExecutionProvider {
  readonly name = "judge0";

  constructor(private readonly config: Judge0Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.url);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const languageId = this.config.languageIds[request.language];
    if (!languageId || !Number.isFinite(languageId)) {
      // Misconfigured JUDGE0_LANG_* for this language - fail the run cleanly
      // rather than sending Judge0 an undefined language id.
      throw new Error(`No Judge0 language id configured for ${request.language}`);
    }
    const cpuTime = Math.max(1, Math.ceil((request.limits.cpuTimeMs ?? 2000) / 1000));
    const wallTime = cpuTime + 3;
    const memoryKb = Math.max(16_384, (request.limits.memoryMb ?? 256) * 1024);

    const cases: ExecutionCaseRun[] = [];
    let compileFailedEarly = false;

    for (const testCase of request.cases) {
      if (compileFailedEarly) {
        cases.push(this.compileErrorCase(testCase.id, "Skipped after a compilation failure."));
        continue;
      }
      const run = await this.runOne({
        languageId,
        sourceCode: request.sourceCode,
        stdin: testCase.stdin,
        caseId: testCase.id,
        cpuTime,
        wallTime,
        memoryKb,
      });
      if (run.runStatus === "COMPILE_ERROR") compileFailedEarly = true;
      cases.push(run);
    }

    return {
      provider: this.name,
      cases,
      runtimeInfo: `Judge0 language id ${languageId}`,
      meta: { languageId, judge0Url: this.config.url },
    };
  }

  private compileErrorCase(caseId: string, compileOutput: string): ExecutionCaseRun {
    return {
      caseId,
      runStatus: "COMPILE_ERROR",
      stdout: "",
      stderr: "",
      compileOutput,
      timeMs: null,
      memoryKb: null,
      exitCode: null,
    };
  }

  private async runOne(input: {
    languageId: number;
    sourceCode: string;
    stdin: string;
    caseId: string;
    cpuTime: number;
    wallTime: number;
    memoryKb: number;
  }): Promise<ExecutionCaseRun> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.token) headers["X-Auth-Token"] = this.config.token;

    const response = await fetch(`${this.config.url}/submissions?base64_encoded=true&wait=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        language_id: input.languageId,
        source_code: b64(input.sourceCode),
        stdin: b64(input.stdin),
        cpu_time_limit: input.cpuTime,
        wall_time_limit: input.wallTime,
        memory_limit: input.memoryKb,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Judge0 responded ${response.status} for case ${input.caseId}`);
    }

    const body = (await response.json()) as Judge0SubmissionResponse;
    const runStatus = mapStatus(body.status.id);
    return {
      caseId: input.caseId,
      runStatus,
      stdout: unb64(body.stdout),
      stderr: unb64(body.stderr) || (body.message ?? ""),
      compileOutput: body.compile_output ? unb64(body.compile_output) : null,
      timeMs: body.time ? Math.round(parseFloat(body.time) * 1000) : null,
      memoryKb: body.memory ?? null,
      exitCode: body.exit_code ?? null,
    };
  }
}

/** Provider used when Judge0 is not configured: reports `isConfigured() === false`. */
export class UnconfiguredExecutionProvider implements ExecutionProvider {
  readonly name = "unconfigured";
  isConfigured(): boolean {
    return false;
  }
  execute(): Promise<ExecutionResult> {
    logger.warn("Execution requested but no sandbox is configured");
    return Promise.reject(new Error("No execution sandbox is configured (set JUDGE0_URL)"));
  }
}
