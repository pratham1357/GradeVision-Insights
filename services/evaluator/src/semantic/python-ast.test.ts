/**
 * Real `python3` AST analyzer. Student code is only PARSED, never executed.
 * The whole suite is skipped when no Python interpreter is on PATH.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import type { SemanticAnalysis, SemanticMetrics } from "@gradevision/grading";

import { PythonAstAnalyzer } from "./python-ast.js";

function metricsOf(result: SemanticAnalysis): SemanticMetrics {
  if (!result.metrics) throw new Error("expected metrics to be present");
  return result.metrics;
}

function resolvePythonBin(): string | null {
  for (const bin of ["python3", "python"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const pythonBin = resolvePythonBin();
const describeMaybe = pythonBin ? describe : describe.skip;

describeMaybe("PythonAstAnalyzer (real python3)", () => {
  const analyzer = new PythonAstAnalyzer(pythonBin);

  it("does not support non-Python languages", () => {
    expect(analyzer.supports("JAVASCRIPT")).toBe(false);
    expect(analyzer.supports("PYTHON")).toBe(true);
  });

  it("analyses a straightforward solution and reports structure", async () => {
    const result = await analyzer.analyze(
      "PYTHON",
      "a, b = map(int, input().split())\nprint(a + b)",
    );
    expect(result.available).toBe(true);
    expect(result.error).toBeNull();
    expect(result.analyzer).toBe("python-ast");
    expect(metricsOf(result).functionCount).toBe(0);
    expect(metricsOf(result).loopCount).toBe(0);
  });

  it("flags a forbidden eval() call", async () => {
    const result = await analyzer.analyze("PYTHON", "print(eval(input()))");
    expect(result.available).toBe(true);
    const forbidden = result.findings.filter((f) => f.kind === "forbidden");
    expect(forbidden.map((f) => f.id)).toContain("eval");
  });

  it("detects recursion", async () => {
    const code = [
      "def fib(n):",
      "    if n < 2:",
      "        return n",
      "    return fib(n - 1) + fib(n - 2)",
    ].join("\n");
    const result = await analyzer.analyze("PYTHON", code);
    expect(metricsOf(result).hasRecursion).toBe(true);
    expect(metricsOf(result).functionCount).toBe(1);
  });

  it("counts loops and nesting depth", async () => {
    const code = ["for i in range(3):", "    for j in range(3):", "        print(i * j)"].join(
      "\n",
    );
    const result = await analyzer.analyze("PYTHON", code);
    expect(metricsOf(result).loopCount).toBe(2);
    expect(metricsOf(result).maxNestingDepth).toBeGreaterThanOrEqual(2);
    expect(result.findings.some((f) => f.id === "uses_for")).toBe(true);
  });

  it("marks a syntax error as unavailable rather than throwing", async () => {
    const result = await analyzer.analyze("PYTHON", "def broken(:\n    pass");
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/SyntaxError/i);
  });

  it("returns unavailable when the interpreter is disabled", async () => {
    const disabled = new PythonAstAnalyzer(null);
    const result = await disabled.analyze("PYTHON", "print(1)");
    expect(result.available).toBe(false);
  });
});
