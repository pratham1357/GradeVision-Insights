import type { CriterionConfig } from "./rubric.js";

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string");
  return items.length > 0 ? items : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Safely coerces `RubricCriterion.config` (arbitrary persisted JSON) into a
 * `CriterionConfig`. Unknown fields are dropped; nothing throws.
 */
export function parseCriterionConfig(value: unknown): CriterionConfig | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const config: CriterionConfig = {};

  const forbidden = stringArray(raw.forbidden);
  if (forbidden) config.forbidden = forbidden;
  const required = stringArray(raw.required);
  if (required) config.required = required;
  if (raw.mode === "strict" || raw.mode === "lenient") config.mode = raw.mode;

  const penalty = raw.penaltyPerViolation;
  if (typeof penalty === "number" && penalty >= 0 && penalty <= 1) {
    config.penaltyPerViolation = penalty;
  }

  const target = positiveNumber(raw.targetTimeMs);
  if (target) config.targetTimeMs = target;
  const maxLen = positiveNumber(raw.maxFunctionLength);
  if (maxLen) config.maxFunctionLength = maxLen;
  const maxDepth = positiveNumber(raw.maxNestingDepth);
  if (maxDepth) config.maxNestingDepth = maxDepth;

  return Object.keys(config).length > 0 ? config : {};
}
