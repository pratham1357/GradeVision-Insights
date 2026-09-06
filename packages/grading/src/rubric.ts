import type { RubricCriterionType } from "@gradevision/shared";

import type { FunctionalResult, FunctionalTiming } from "./functional.js";
import { clamp, round2 } from "./normalize.js";
import type { SemanticAnalysis } from "./semantic.js";

/**
 * Instructor-authored, machine-readable grading rules for one criterion
 * (`RubricCriterion.config` in the schema). Every field is optional; sensible
 * defaults keep a criterion useful with no config at all.
 */
export interface CriterionConfig {
  /** Analyzer finding ids that count against the student if present. */
  forbidden?: string[];
  /** Analyzer finding ids expected to be present. Advisory unless `mode: "strict"`. */
  required?: string[];
  mode?: "lenient" | "strict";
  /** Penalty per forbidden construct, as a fraction of `maxPoints` (default 0.5). */
  penaltyPerViolation?: number;
  /** PERFORMANCE: slowest case at or below this (ms) earns full marks. */
  targetTimeMs?: number;
  /** CODE_QUALITY: function-length / nesting limits before a small penalty. */
  maxFunctionLength?: number;
  maxNestingDepth?: number;
}

export interface RubricCriterionInput {
  id: string;
  type: RubricCriterionType;
  name: string;
  maxPoints: number;
  config: CriterionConfig | null;
}

export interface CriterionScoreResult {
  criterionId: string;
  type: RubricCriterionType;
  name: string;
  pointsAwarded: number;
  maxPoints: number;
  summary: string;
  /** Auditable, human-readable reasons for the score. */
  reasons: string[];
}

export interface RubricGradeResult {
  criterionScores: CriterionScoreResult[];
  totalScore: number;
  maxScore: number;
  /** `true` when the question has no rubric and a single implicit criterion was used. */
  isImplicit: boolean;
}

const DEFAULT_PENALTY = 0.5;
const IMPLICIT_MAX = 100;

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function scoreFunctional(
  criterion: RubricCriterionInput,
  functional: FunctionalResult,
): CriterionScoreResult {
  const reasons: string[] = [];
  if (functional.compileFailed) reasons.push("Submission failed to compile.");
  reasons.push(
    `${functional.passedCount}/${functional.totalCount} test cases passed (${pct(functional.ratio)} weighted).`,
  );
  const failing = functional.outcomes.filter((o) => !o.passed);
  if (failing.length > 0) {
    const byStatus = new Map<string, number>();
    for (const f of failing) byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
    reasons.push(
      "Not passed: " +
        [...byStatus.entries()]
          .map(([status, count]) => `${count} ${status.toLowerCase()}`)
          .join(", "),
    );
  }
  return {
    criterionId: criterion.id,
    type: criterion.type,
    name: criterion.name,
    pointsAwarded: round2(criterion.maxPoints * functional.ratio),
    maxPoints: criterion.maxPoints,
    summary: `Functional correctness ${pct(functional.ratio)}`,
    reasons,
  };
}

function scorePerformance(
  criterion: RubricCriterionInput,
  functional: FunctionalResult,
  timing: FunctionalTiming,
): CriterionScoreResult {
  const reasons: string[] = [];
  if (functional.ratio === 0) {
    reasons.push("Performance not assessed: the solution is not functionally correct.");
    return {
      criterionId: criterion.id,
      type: criterion.type,
      name: criterion.name,
      pointsAwarded: 0,
      maxPoints: criterion.maxPoints,
      summary: "Not assessed (0% functional)",
      reasons,
    };
  }
  const target = criterion.config?.targetTimeMs ?? 1000;
  const slowest = timing.slowestCaseMs;
  let perfFactor = 1;
  if (slowest === null) {
    reasons.push("No timing data from the sandbox; assumed within target.");
  } else if (slowest <= target) {
    reasons.push(`Slowest case ${slowest} ms is within the ${target} ms target.`);
  } else if (slowest >= target * 3) {
    perfFactor = 0;
    reasons.push(`Slowest case ${slowest} ms is 3x over the ${target} ms target.`);
  } else {
    perfFactor = clamp(1 - (slowest - target) / (target * 2), 0, 1);
    reasons.push(
      `Slowest case ${slowest} ms vs ${target} ms target (${pct(perfFactor)} of marks).`,
    );
  }
  const awarded = round2(criterion.maxPoints * perfFactor * functional.ratio);
  return {
    criterionId: criterion.id,
    type: criterion.type,
    name: criterion.name,
    pointsAwarded: awarded,
    maxPoints: criterion.maxPoints,
    summary: `Performance ${pct(perfFactor)} (scaled by ${pct(functional.ratio)} correctness)`,
    reasons,
  };
}

/**
 * SEMANTIC_CORRECTNESS / ALGORITHMIC_APPROACH / CODE_QUALITY / OTHER.
 *
 * A functionally-correct submission starts at full marks for the criterion
 * (`base = maxPoints * functionalRatio`) and only LOSES points for concrete,
 * named problems - a forbidden construct, or a code-quality limit exceeded.
 * A different-but-correct approach is therefore never penalised just for being
 * different, and an un-analysable language falls back to the functional base.
 */
function scoreQualitative(
  criterion: RubricCriterionInput,
  functional: FunctionalResult,
  semantic: SemanticAnalysis,
): CriterionScoreResult {
  const config = criterion.config ?? {};
  const base = criterion.maxPoints * functional.ratio;
  const reasons: string[] = [];

  if (!semantic.available) {
    reasons.push(
      `Structural analysis unavailable for ${semantic.language} (${semantic.error ?? "no analyzer"}); ` +
        `scored from functional correctness (${pct(functional.ratio)}).`,
    );
    return {
      criterionId: criterion.id,
      type: criterion.type,
      name: criterion.name,
      pointsAwarded: round2(clamp(base, 0, criterion.maxPoints)),
      maxPoints: criterion.maxPoints,
      summary: `Not analysed; ${pct(functional.ratio)} from correctness`,
      reasons,
    };
  }

  const foundIds = new Set(semantic.findings.map((f) => f.id));
  const labelOf = (id: string) => semantic.findings.find((f) => f.id === id)?.label ?? id;
  const penaltyPer = config.penaltyPerViolation ?? DEFAULT_PENALTY;
  let penalties = 0;

  for (const id of config.forbidden ?? []) {
    if (foundIds.has(id)) {
      penalties += criterion.maxPoints * penaltyPer;
      reasons.push(`Uses a disallowed construct: ${labelOf(id)}.`);
    }
  }

  // Code-quality signals from metrics (safe to penalise - language-neutral concerns).
  if (criterion.type === "CODE_QUALITY" && semantic.metrics) {
    const maxLen = config.maxFunctionLength ?? 60;
    const maxDepth = config.maxNestingDepth ?? 5;
    if (semantic.metrics.maxFunctionLength > maxLen) {
      penalties += criterion.maxPoints * 0.2;
      reasons.push(
        `Longest function is ${semantic.metrics.maxFunctionLength} lines (limit ${maxLen}).`,
      );
    }
    if (semantic.metrics.maxNestingDepth > maxDepth) {
      penalties += criterion.maxPoints * 0.15;
      reasons.push(`Nesting depth ${semantic.metrics.maxNestingDepth} exceeds ${maxDepth}.`);
    }
    for (const quality of semantic.findings.filter((f) => f.kind === "quality")) {
      penalties += criterion.maxPoints * 0.15;
      reasons.push(quality.detail || quality.label);
    }
  }

  // Required constructs: advisory unless strict.
  for (const id of config.required ?? []) {
    if (foundIds.has(id)) continue;
    if (config.mode === "strict") {
      penalties += criterion.maxPoints * 0.25;
      reasons.push(`Expected construct not detected: ${id}.`);
    } else {
      reasons.push(`Note: expected construct "${id}" not detected (not penalised).`);
    }
  }

  const awarded = round2(clamp(base - penalties, 0, criterion.maxPoints));
  if (reasons.length === 0) {
    reasons.push(`No structural concerns; scored from correctness (${pct(functional.ratio)}).`);
  }
  return {
    criterionId: criterion.id,
    type: criterion.type,
    name: criterion.name,
    pointsAwarded: awarded,
    maxPoints: criterion.maxPoints,
    summary:
      penalties > 0
        ? `${round2(criterion.maxPoints - penalties)}/${criterion.maxPoints} after deductions`
        : `${pct(functional.ratio)} from correctness, no deductions`,
    reasons,
  };
}

export interface RubricGradeInput {
  criteria: RubricCriterionInput[];
  functional: FunctionalResult;
  semantic: SemanticAnalysis;
  timing: FunctionalTiming;
}

export function gradeRubric(input: RubricGradeInput): RubricGradeResult {
  if (input.criteria.length === 0) {
    const awarded = round2(IMPLICIT_MAX * input.functional.ratio);
    return {
      isImplicit: true,
      totalScore: awarded,
      maxScore: IMPLICIT_MAX,
      criterionScores: [
        {
          criterionId: "implicit-functional",
          type: "FUNCTIONAL_CORRECTNESS",
          name: "Functional correctness",
          pointsAwarded: awarded,
          maxPoints: IMPLICIT_MAX,
          summary: `Functional correctness ${pct(input.functional.ratio)}`,
          reasons: [
            "No rubric configured; score is functional correctness out of 100.",
            `${input.functional.passedCount}/${input.functional.totalCount} test cases passed.`,
          ],
        },
      ],
    };
  }

  const criterionScores = input.criteria.map((criterion) => {
    switch (criterion.type) {
      case "FUNCTIONAL_CORRECTNESS":
        return scoreFunctional(criterion, input.functional);
      case "PERFORMANCE":
        return scorePerformance(criterion, input.functional, input.timing);
      case "SEMANTIC_CORRECTNESS":
      case "ALGORITHMIC_APPROACH":
      case "CODE_QUALITY":
      case "OTHER":
        return scoreQualitative(criterion, input.functional, input.semantic);
    }
  });

  return {
    isImplicit: false,
    criterionScores,
    totalScore: round2(criterionScores.reduce((sum, c) => sum + c.pointsAwarded, 0)),
    maxScore: round2(criterionScores.reduce((sum, c) => sum + c.maxPoints, 0)),
  };
}
