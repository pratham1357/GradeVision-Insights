import { spawn } from "node:child_process";

import type { GradingLanguage, SemanticAnalysis, SemanticAnalyzer } from "@gradevision/grading";
import { unavailableAnalysis } from "@gradevision/grading";

import { logger } from "../logger.js";
import { PYTHON_ANALYZER_SCRIPT } from "./python-script.js";

interface PythonReport {
  ok: boolean;
  error?: string;
  metrics?: {
    lineCount: number;
    functionCount: number;
    maxFunctionLength: number;
    branchCount: number;
    loopCount: number;
    maxNestingDepth: number;
    hasRecursion: boolean;
  };
  findings?: { id: string; kind: string; label: string; detail: string }[];
}

function runPython(bin: string, source: string): Promise<PythonReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-c", PYTHON_ANALYZER_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(`python exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as PythonReport);
      } catch {
        reject(new Error(`unparseable analyzer output: ${stdout.slice(0, 200)}`));
      }
    });

    child.stdin.on("error", () => {
      /* the child may exit before we finish writing - handled by close */
    });
    child.stdin.end(source);
  });
}

const ALLOWED_KINDS = new Set(["forbidden", "required", "info", "quality"]);

/**
 * v1 semantic analyzer: Python's own `ast` module via a short helper script.
 * Student code is parsed, never run. When `python3` is missing or the code has a
 * syntax error the analysis is marked `available: false` and grading falls back
 * to functional correctness (so a valid alternative is never penalised).
 */
export class PythonAstAnalyzer implements SemanticAnalyzer {
  readonly name = "python-ast";

  constructor(private readonly pythonBin: string | null) {}

  supports(language: GradingLanguage): boolean {
    return language === "PYTHON" && this.pythonBin !== null;
  }

  async analyze(language: GradingLanguage, sourceCode: string): Promise<SemanticAnalysis> {
    if (!this.supports(language)) {
      return unavailableAnalysis(language, "python analyzer disabled", this.name);
    }
    let report: PythonReport;
    try {
      report = await runPython(this.pythonBin as string, sourceCode);
    } catch (error) {
      logger.warn("python analyzer failed", { error: (error as Error).message });
      return unavailableAnalysis(
        language,
        `analyzer error: ${(error as Error).message}`,
        this.name,
      );
    }

    if (!report.ok || !report.metrics) {
      return unavailableAnalysis(language, report.error ?? "analysis failed", this.name);
    }

    return {
      language,
      available: true,
      error: null,
      analyzer: this.name,
      metrics: report.metrics,
      findings: (report.findings ?? [])
        .filter((f) => ALLOWED_KINDS.has(f.kind))
        .map((f) => ({
          id: f.id,
          kind: f.kind as SemanticAnalysis["findings"][number]["kind"],
          label: f.label,
          detail: f.detail,
        })),
    };
  }
}
