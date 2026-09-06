import type { GradingLanguage } from "./execution.js";

export interface SemanticMetrics {
  lineCount: number;
  functionCount: number;
  /** Longest function body, in source lines. 0 when no functions are defined. */
  maxFunctionLength: number;
  /** Rough branch count (if / for / while / try / boolean operators). */
  branchCount: number;
  loopCount: number;
  /** Deepest nesting of compound statements. */
  maxNestingDepth: number;
  hasRecursion: boolean;
}

/**
 * A single structural fact about the submission.
 *  - `forbidden`: a construct a rubric may penalise (e.g. `eval`, bare `except`)
 *  - `required` / `info`: a construct present in the code (a loop, recursion…)
 *  - `quality`: a code-quality signal (long function, deep nesting…)
 */
export interface SemanticFinding {
  id: string;
  kind: "forbidden" | "required" | "info" | "quality";
  label: string;
  detail: string;
}

export interface SemanticAnalysis {
  language: GradingLanguage;
  /** `false` when no analyzer supports this language, or parsing failed. */
  available: boolean;
  error: string | null;
  metrics: SemanticMetrics | null;
  findings: SemanticFinding[];
  /** Which analyzer produced this (for the audit trail). */
  analyzer: string;
}

export interface SemanticAnalyzer {
  readonly name: string;
  supports(language: GradingLanguage): boolean;
  analyze(language: GradingLanguage, sourceCode: string): Promise<SemanticAnalysis>;
}

export function unavailableAnalysis(
  language: GradingLanguage,
  reason: string,
  analyzer = "none",
): SemanticAnalysis {
  return { language, available: false, error: reason, metrics: null, findings: [], analyzer };
}

/** An analyzer that supports nothing - the safe default when none is configured. */
export const NOOP_ANALYZER: SemanticAnalyzer = {
  name: "noop",
  supports: () => false,
  analyze: (language) =>
    Promise.resolve(
      unavailableAnalysis(language, "no semantic analyzer for this language", "noop"),
    ),
};
