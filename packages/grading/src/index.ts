/**
 * @gradevision/grading
 *
 * Pure, deterministic grading engine. Given the mechanical result of running a
 * submission and (optionally) a structural analysis of the code, it produces an
 * auditable score + rubric breakdown. No I/O, no Prisma, no sandbox.
 */
export * from "./execution.js";
export * from "./normalize.js";
export * from "./functional.js";
export * from "./semantic.js";
export * from "./rubric.js";
export * from "./config.js";

import type { GradingLanguage } from "./execution.js";
import type { ExecutionResult } from "./execution.js";
import {
  evaluateFunctional,
  summariseTiming,
  type FunctionalCase,
  type FunctionalResult,
  type FunctionalTiming,
} from "./functional.js";
import { gradeRubric, type RubricCriterionInput, type RubricGradeResult } from "./rubric.js";
import type { SemanticAnalysis } from "./semantic.js";

export interface EvaluationComputationInput {
  language: GradingLanguage;
  criteria: RubricCriterionInput[];
  cases: FunctionalCase[];
  execution: ExecutionResult;
  semantic: SemanticAnalysis;
}

export interface EvaluationComputation {
  functional: FunctionalResult;
  rubric: RubricGradeResult;
  timing: FunctionalTiming;
  /** Convenience 0-100 percentage of the rubric (or implicit) score. */
  scorePercent: number;
}

/**
 * The one call the evaluator makes after running the code: turns raw run output
 * + structural analysis into `TestCaseResult` rows and `CriterionScore` rows.
 */
export function computeEvaluation(input: EvaluationComputationInput): EvaluationComputation {
  const functional = evaluateFunctional(input.cases, input.execution.cases);
  const timing = summariseTiming(functional.outcomes);
  const rubric = gradeRubric({
    criteria: input.criteria,
    functional,
    semantic: input.semantic,
    timing,
  });
  const scorePercent =
    rubric.maxScore > 0 ? Math.round((rubric.totalScore / rubric.maxScore) * 100) : 0;
  return { functional, rubric, timing, scorePercent };
}
