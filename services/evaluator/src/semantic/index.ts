import type { GradingLanguage, SemanticAnalysis, SemanticAnalyzer } from "@gradevision/grading";
import { unavailableAnalysis } from "@gradevision/grading";

import { env } from "../env.js";
import { PythonAstAnalyzer } from "./python-ast.js";

export interface SemanticAnalysisService {
  analyze(language: GradingLanguage, sourceCode: string): Promise<SemanticAnalysis>;
}

/**
 * Picks the analyzer for a language. Only Python has one in v1; every other
 * language returns an `available: false` analysis and grading scales the
 * qualitative criteria from functional correctness instead.
 */
export class SemanticAnalyzerRegistry implements SemanticAnalysisService {
  private readonly analyzers: SemanticAnalyzer[];

  constructor(analyzers: SemanticAnalyzer[]) {
    this.analyzers = analyzers;
  }

  analyze(language: GradingLanguage, sourceCode: string): Promise<SemanticAnalysis> {
    const analyzer = this.analyzers.find((a) => a.supports(language));
    if (!analyzer) {
      return Promise.resolve(unavailableAnalysis(language, `no semantic analyzer for ${language}`));
    }
    return analyzer.analyze(language, sourceCode);
  }
}

export function createAnalyzerRegistry(): SemanticAnalyzerRegistry {
  return new SemanticAnalyzerRegistry([new PythonAstAnalyzer(env.pythonBin)]);
}
