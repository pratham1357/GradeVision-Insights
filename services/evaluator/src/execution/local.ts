import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExecutionCaseRun,
  ExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
  ExecutionRunStatus,
  GradingLanguage,
} from "@gradevision/grading";

import { logger } from "../logger.js";

/**
 * Local, in-process execution: the student's program is compiled/interpreted
 * with toolchains installed on the evaluator host (`node:child_process.spawn`,
 * never a shell). This is REAL execution - the program's actual stdout is what
 * the functional grading layer compares - but it is demo-grade isolation only:
 *
 *  - hard wall-clock timeout per case (SIGKILL), capped output, a scrubbed
 *    environment (the child never sees DATABASE_URL / API keys), and a fresh
 *    temporary directory per submission (one working directory per case),
 *    removed when the run finishes;
 *  - NO memory/CPU cgroups, NO network restriction, NO filesystem jail, and the
 *    child runs as the evaluator's own OS user.
 *
 * Judge0 (or another containerised sandbox) remains the intended production
 * engine. This provider is opt-in only (`LOCAL_EXECUTION_ENABLED`) and must never
 * be pointed at a shared or production host.
 */

/** Host toolchains the provider can drive. `null` disables every language needing it. */
export type Toolchain = "python" | "node" | "gcc" | "gxx" | "javac" | "java";
export type ToolchainBins = Record<Toolchain, string | null>;

export interface LocalExecutionConfig {
  /** Toolchain binaries (names on PATH or absolute paths). */
  bins: ToolchainBins;
  /** Wall-clock ceiling per case when the question sets no time limit. */
  defaultWallTimeMs: number;
  /** Wall-clock ceiling for the compile step (compiled languages only). */
  compileTimeoutMs: number;
}

interface Command {
  bin: string;
  args: string[];
}

type Bins = Record<Toolchain, string>;

/** How to build and run one language inside a working directory. */
interface LanguageSpec {
  /** Toolchains this language needs; all must be configured. */
  requires: readonly Toolchain[];
  /** File the source is written to (relative to the build dir). */
  sourceFile: string;
  /** Optional compile/syntax step; a non-zero exit is a COMPILE_ERROR. */
  compile?: (bins: Bins, buildDir: string) => Command;
  /** Runs one case; cwd is the case directory, stdin carries the test input. */
  run: (bins: Bins, buildDir: string) => Command;
}

const EXE = process.platform === "win32" ? "main.exe" : "main";

/**
 * Per-language commands. Conventions match Judge0 CE so a submission graded
 * locally is graded identically later in the real sandbox:
 *  - PYTHON: `-I` isolates from the host's user site/env (and so ignores
 *    PYTHON* variables, hence `-X utf8` on the command line); `-u` keeps stdout
 *    unbuffered so a SIGKILL never loses printed output; `py_compile` turns a
 *    syntax error into a clean COMPILE_ERROR up front.
 *  - JAVASCRIPT: plain `node`, no syntax pre-check (a SyntaxError exits 1 and
 *    is reported as a RUNTIME_ERROR with the message on stderr, as in Judge0).
 *  - C / CPP: gcc/g++ with -O2, C17 / C++17, libm linked.
 *  - JAVA: the source must declare `public class Main` (the Judge0 convention).
 */
const LANGUAGES: Record<GradingLanguage, LanguageSpec> = {
  PYTHON: {
    requires: ["python"],
    sourceFile: "main.py",
    compile: (bins, buildDir) => ({
      bin: bins.python,
      args: ["-I", "-X", "utf8", "-m", "py_compile", path.join(buildDir, "main.py")],
    }),
    run: (bins, buildDir) => ({
      bin: bins.python,
      args: ["-I", "-X", "utf8", "-B", "-u", path.join(buildDir, "main.py")],
    }),
  },
  JAVASCRIPT: {
    requires: ["node"],
    sourceFile: "main.js",
    run: (bins, buildDir) => ({ bin: bins.node, args: [path.join(buildDir, "main.js")] }),
  },
  C: {
    requires: ["gcc"],
    sourceFile: "main.c",
    compile: (bins, buildDir) => ({
      bin: bins.gcc,
      args: [
        "-O2",
        "-std=c17",
        "-o",
        path.join(buildDir, EXE),
        path.join(buildDir, "main.c"),
        "-lm",
      ],
    }),
    run: (_bins, buildDir) => ({ bin: path.join(buildDir, EXE), args: [] }),
  },
  CPP: {
    requires: ["gxx"],
    sourceFile: "main.cpp",
    compile: (bins, buildDir) => ({
      bin: bins.gxx,
      args: ["-O2", "-std=c++17", "-o", path.join(buildDir, EXE), path.join(buildDir, "main.cpp")],
    }),
    run: (_bins, buildDir) => ({ bin: path.join(buildDir, EXE), args: [] }),
  },
  JAVA: {
    requires: ["javac", "java"],
    sourceFile: "Main.java",
    compile: (bins, buildDir) => ({
      bin: bins.javac,
      args: ["-d", buildDir, "-encoding", "UTF-8", path.join(buildDir, "Main.java")],
    }),
    run: (bins, buildDir) => ({
      bin: bins.java,
      args: ["-Xss64m", "-Dfile.encoding=UTF-8", "-cp", buildDir, "Main"],
    }),
  },
};

/** Bytes of stdout/stderr kept per stream; beyond this the process is killed. */
const MAX_OUTPUT_BYTES = 1_048_576;
/** Characters of each stream persisted into the run result. */
const MAX_OUTPUT_CHARS = 20_000;

/**
 * Environment variables the child may inherit. Everything else (DATABASE_URL,
 * GEMINI_API_KEY, JUDGE0_TOKEN, REDIS_URL, ...) is withheld so student code
 * cannot read evaluator secrets out of `os.environ`.
 */
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  // Windows: process creation and the Python launcher/App Execution Alias need these.
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "ComSpec",
  "PATHEXT",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMDATA",
  "ProgramData",
  "SYSTEMDRIVE",
  "SystemDrive",
  "WINDIR",
  "windir",
]);

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_ALLOWLIST.has(key) && value !== undefined) env[key] = value;
  }
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}

interface ProcessOutcome {
  /** `null` when the process was killed (timeout / output limit). */
  exitCode: number | null;
  timedOut: boolean;
  outputLimitHit: boolean;
  stdout: string;
  stderr: string;
  timeMs: number;
}

/**
 * Runs one command to completion with a hard wall-clock limit. Resolves for any
 * outcome of the *program* (exit code, timeout, oversized output); rejects only
 * when the process cannot be started at all (missing toolchain) - that is the
 * provider's own failure, surfaced by the evaluator as EVALUATOR_ERROR.
 */
function runProcess(
  command: Command,
  options: { cwd: string; stdin: string; timeoutMs: number },
): Promise<ProcessOutcome> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(command.bin, command.args, {
      cwd: options.cwd,
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let outputLimitHit = false;
    let settled = false;

    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);

    const collect = (chunks: Buffer[], counter: "out" | "err") => (chunk: Buffer) => {
      const total = counter === "out" ? (outBytes += chunk.length) : (errBytes += chunk.length);
      if (total > MAX_OUTPUT_BYTES) {
        if (!outputLimitHit) {
          outputLimitHit = true;
          kill();
        }
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(out, "out"));
    child.stderr.on("data", collect(err, "err"));

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code,
        timedOut,
        outputLimitHit,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timeMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });

    // The child may exit (or be killed) before stdin is fully written.
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin);
  });
}

function cap(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) : value;
}

function mapOutcome(outcome: ProcessOutcome): ExecutionRunStatus {
  if (outcome.timedOut) return "TIMEOUT";
  if (outcome.outputLimitHit || outcome.exitCode === null) return "RUNTIME_ERROR";
  return outcome.exitCode === 0 ? "COMPLETED" : "RUNTIME_ERROR";
}

function compileErrorCase(caseId: string, compileOutput: string): ExecutionCaseRun {
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

export class LocalExecutionProvider implements ExecutionProvider {
  readonly name = "local";

  constructor(private readonly config: LocalExecutionConfig) {}

  /** Configured when at least one language has every toolchain it needs. */
  isConfigured(): boolean {
    return this.enabledLanguages().length > 0;
  }

  enabledLanguages(): GradingLanguage[] {
    return (Object.keys(LANGUAGES) as GradingLanguage[]).filter(
      (language) => this.binsFor(language) !== null,
    );
  }

  /** The concrete binaries for a language, or `null` if any is unconfigured. */
  private binsFor(language: GradingLanguage): Bins | null {
    const bins: Partial<Bins> = {};
    for (const tool of LANGUAGES[language].requires) {
      const bin = this.config.bins[tool];
      if (!bin) return null;
      bins[tool] = bin;
    }
    return bins as Bins;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const spec = LANGUAGES[request.language];
    const bins = this.binsFor(request.language);
    if (!bins) {
      // Provider misconfiguration, not a student failure - fail the run cleanly.
      throw new Error(`Local execution is not configured for ${request.language}`);
    }

    const wallTimeMs = this.wallTimeMs(request);
    const root = await mkdtemp(path.join(tmpdir(), "gradevision-exec-"));
    try {
      const buildDir = path.join(root, "build");
      await mkdir(buildDir);
      await writeFile(path.join(buildDir, spec.sourceFile), request.sourceCode, "utf8");

      const cases: ExecutionCaseRun[] = [];

      if (spec.compile) {
        const compiled = await runProcess(spec.compile(bins, buildDir), {
          cwd: buildDir,
          stdin: "",
          timeoutMs: this.config.compileTimeoutMs,
        });
        if (compiled.exitCode !== 0) {
          const output = compiled.timedOut
            ? "Compilation timed out."
            : cap(compiled.stderr || compiled.stdout) || "Compilation failed.";
          for (const testCase of request.cases) {
            cases.push(compileErrorCase(testCase.id, output));
          }
          return this.result(request.language, cases);
        }
      }

      for (const [index, testCase] of request.cases.entries()) {
        const caseDir = path.join(root, `case-${index + 1}`);
        await mkdir(caseDir);
        const outcome = await runProcess(spec.run(bins, buildDir), {
          cwd: caseDir,
          stdin: testCase.stdin,
          timeoutMs: wallTimeMs,
        });
        const runStatus = mapOutcome(outcome);
        let stderr = cap(outcome.stderr);
        if (outcome.outputLimitHit) {
          stderr = `${stderr}\n[output limit exceeded; process terminated]`.trim();
        }
        cases.push({
          caseId: testCase.id,
          runStatus,
          stdout: cap(outcome.stdout),
          stderr,
          compileOutput: null,
          timeMs: outcome.timeMs,
          // No per-process resource accounting in this demo-grade provider.
          memoryKb: null,
          exitCode: outcome.exitCode,
        });
      }

      return this.result(request.language, cases);
    } finally {
      // Retries cover Windows EBUSY when a just-killed binary is still unmapping.
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
        (error: unknown) => {
          logger.warn("failed to remove local execution directory", {
            root,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  }

  /**
   * Wall-clock limit per case. Mirrors Judge0Provider: the question's CPU limit
   * (default 2 s) plus a 3 s grace, unless an explicit wall limit is given.
   */
  private wallTimeMs(request: ExecutionRequest): number {
    const { wallTimeMs, cpuTimeMs } = request.limits;
    if (wallTimeMs && wallTimeMs > 0) return wallTimeMs;
    if (cpuTimeMs && cpuTimeMs > 0) return cpuTimeMs + 3_000;
    return this.config.defaultWallTimeMs;
  }

  private result(language: GradingLanguage, cases: ExecutionCaseRun[]): ExecutionResult {
    const tools = LANGUAGES[language].requires
      .map((tool) => path.basename(this.config.bins[tool] ?? tool))
      .join(", ");
    return {
      provider: this.name,
      cases,
      runtimeInfo: `local ${language.toLowerCase()} (${tools})`,
      meta: { mode: "local-process", language, isolation: "none" },
    };
  }
}
