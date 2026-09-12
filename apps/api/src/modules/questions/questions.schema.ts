import { z } from "zod";

import {
  PROGRAMMING_LANGUAGES,
  QUESTION_DIFFICULTIES,
  RUBRIC_CRITERION_TYPES,
  TEST_CASE_CATEGORIES,
  TEST_CASE_VISIBILITIES,
} from "../../utils/enums.js";

export const questionParamsSchema = z.object({
  questionId: z.uuid(),
});

export const testCaseParamsSchema = z.object({
  questionId: z.uuid(),
  testCaseId: z.uuid(),
});

const optionalText = (max: number) => z.string().trim().max(max).nullish();

const languageEntry = z.object({
  language: z.enum(PROGRAMMING_LANGUAGES),
  starterCode: z.string().max(20_000).nullish(),
});

const questionCore = {
  title: z.string().trim().min(1, "Title is required").max(200),
  statement: z.string().trim().min(1, "Problem statement is required").max(20_000),
  constraints: optionalText(5000),
  inputFormat: optionalText(5000),
  outputFormat: optionalText(5000),
  difficulty: z.enum(QUESTION_DIFFICULTIES),
  timeLimitMs: z.number().int().positive().max(60_000).nullish(),
  memoryLimitMb: z.number().int().positive().max(4096).nullish(),
  // At most one entry per language; enforced below.
  languages: z.array(languageEntry).max(PROGRAMMING_LANGUAGES.length),
  // Instructor-authored concept labels (ids from `GET /concepts`). Optional and
  // omitted by older clients: omitted on update = leave associations unchanged,
  // omitted on create = none. The service verifies every id exists.
  conceptIds: z.array(z.uuid()).max(20).optional(),
  // Transfer Check target: another question of this instructor's, offered with
  // hints off once this question is solved. Omitted = unchanged; null = none.
  transferQuestionId: z.uuid().nullable().optional(),
};

function uniqueLanguages(entries: { language: string }[]): boolean {
  return new Set(entries.map((e) => e.language)).size === entries.length;
}

export const createQuestionSchema = z
  .object(questionCore)
  .refine((q) => uniqueLanguages(q.languages), {
    message: "Each language may be configured at most once",
    path: ["languages"],
  });

export const updateQuestionSchema = createQuestionSchema;

export const createTestCaseSchema = z.object({
  name: optionalText(200),
  input: z.string().max(50_000),
  expectedOutput: z.string().max(50_000),
  visibility: z.enum(TEST_CASE_VISIBILITIES),
  category: z.enum(TEST_CASE_CATEGORIES).default("STANDARD"),
  weight: z.number().min(0).max(1000).default(1),
  isActive: z.boolean().default(true),
});

export const updateTestCaseSchema = z
  .object({
    name: optionalText(200),
    input: z.string().max(50_000),
    expectedOutput: z.string().max(50_000),
    visibility: z.enum(TEST_CASE_VISIBILITIES),
    category: z.enum(TEST_CASE_CATEGORIES),
    weight: z.number().min(0).max(1000),
    position: z.number().int().min(0).max(999),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

const rubricCriterion = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Criterion name is required").max(200),
  description: optionalText(2000),
  type: z.enum(RUBRIC_CRITERION_TYPES),
  maxPoints: z.number().positive("Points must be greater than 0").max(1000),
});

export const saveRubricSchema = z.object({
  criteria: z.array(rubricCriterion).max(50),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;
export type SaveRubricInput = z.infer<typeof saveRubricSchema>;
