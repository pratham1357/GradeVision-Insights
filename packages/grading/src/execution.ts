import type { ProgrammingLanguage } from "@gradevision/shared";

/** Languages the grading engine understands (mirror of the Prisma enum). */
export type GradingLanguage = ProgrammingLanguage;

/** One test case handed to an execution provider. */
export interface ExecutionCase {
  id: string;
  stdin: string;
  expectedOutput: string;
}

export interface ExecutionLimits {
  /** CPU time per case, milliseconds. */
  cpuTimeMs?: number | null;
  /** Wall time per case, milliseconds. */
  wallTimeMs?: number | null;
  /** Memory ceiling, megabytes. */
  memoryMb?: number | null;
}

/**
 * How a single case's run terminated. The provider reports the *mechanical*
 * outcome only - whether the program's OUTPUT is correct is decided later by the
 * functional layer (so alternative implementations are graded on behaviour).
 */
export type ExecutionRunStatus =
  "COMPLETED" | "TIMEOUT" | "RUNTIME_ERROR" | "COMPILE_ERROR" | "INTERNAL_ERROR";

export interface ExecutionCaseRun {
  caseId: string;
  runStatus: ExecutionRunStatus;
  stdout: string;
  stderr: string;
  compileOutput: string | null;
  timeMs: number | null;
  memoryKb: number | null;
  exitCode: number | null;
}

export interface ExecutionResult {
  provider: string;
  cases: ExecutionCaseRun[];
  /** Free-form runtime summary, e.g. "Python 3.11 (Judge0 id 92)". */
  runtimeInfo: string | null;
  /** Provider-specific payload (Judge0 tokens, ...). Never contains secrets. */
  meta: Record<string, unknown>;
}

export interface ExecutionRequest {
  language: GradingLanguage;
  sourceCode: string;
  cases: ExecutionCase[];
  limits: ExecutionLimits;
}

/**
 * Replaceable sandbox. `Judge0Provider` is the real one; tests use a mock. A
 * provider must never let compilation/runtime failure of student code throw -
 * those are reported per case. It may throw only for its own outages (network,
 * misconfiguration), which the evaluator turns into a FAILED evaluation run.
 */
export interface ExecutionProvider {
  readonly name: string;
  isConfigured(): boolean;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
