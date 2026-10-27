import type {
  ConceptDto,
  ExternalProblemReference,
  InstructorHintStage,
  QuestionDetail,
  QuestionLanguageDto,
  QuestionSummary,
  RubricDto,
  TestCaseDto,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { findExistingConceptIds } from "../concepts/concepts.repository.js";
import {
  appendHintStage,
  createQuestion,
  createTestCase,
  deleteHintStage,
  deleteTestCase,
  findHintStageForQuestion,
  findInstructorQuestion,
  findOwnedQuestionMeta,
  findRubricWithCriteria,
  findTestCase,
  listHintStages,
  listInstructorQuestions,
  nextTestCasePosition,
  syncRubricCriteria,
  updateHintStage,
  updateQuestion,
  updateTestCase,
} from "./questions.repository.js";
import {
  MAX_HINT_STAGES,
  type CreateHintStageInput,
  type CreateQuestionInput,
  type CreateTestCaseInput,
  type SaveRubricInput,
  type UpdateHintStageInput,
  type UpdateTestCaseInput,
} from "./questions.schema.js";

type SummaryRow = Awaited<ReturnType<typeof listInstructorQuestions>>[number];
type DetailRow = NonNullable<Awaited<ReturnType<typeof findInstructorQuestion>>>;
type TestCaseRow = DetailRow["testCases"][number];
type RubricRow = Awaited<ReturnType<typeof findRubricWithCriteria>>;

/**
 * Parses the question's informational `externalReference` JSON blob into its
 * typed shape. Tolerant of missing/malformed data (older rows, manual edits) -
 * falls back to `null` rather than throwing.
 */
function toExternalReference(value: unknown): ExternalProblemReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string" || v.source.length === 0) return null;
  return {
    source: v.source,
    number: typeof v.number === "number" ? v.number : null,
    title: typeof v.title === "string" ? v.title : null,
    difficulty: typeof v.difficulty === "string" ? v.difficulty : null,
    url: typeof v.url === "string" ? v.url : null,
  };
}

function toTestCase(row: TestCaseRow): TestCaseDto {
  return {
    id: row.id,
    name: row.name,
    input: row.input,
    expectedOutput: row.expectedOutput,
    visibility: row.visibility,
    category: row.category,
    weight: Number(row.weight),
    position: row.position,
    isActive: row.isActive,
  };
}

function toLanguage(row: DetailRow["languages"][number]): QuestionLanguageDto {
  return { language: row.language, starterCode: row.starterCode, isEnabled: row.isEnabled };
}

function toConcept(row: DetailRow["concepts"][number]): ConceptDto {
  return { id: row.concept.id, name: row.concept.name, description: row.concept.description };
}

function toRubric(row: RubricRow): RubricDto {
  if (!row) {
    return { id: null, name: null, description: null, criteria: [] };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: row.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      maxPoints: Number(c.maxPoints),
      position: c.position,
    })),
  };
}

function toDetail(row: DetailRow): QuestionDetail {
  return {
    id: row.id,
    title: row.title,
    statement: row.statement,
    constraints: row.constraints,
    inputFormat: row.inputFormat,
    outputFormat: row.outputFormat,
    difficulty: row.difficulty,
    timeLimitMs: row.timeLimitMs,
    memoryLimitMb: row.memoryLimitMb,
    isArchived: row.isArchived,
    languages: row.languages.map(toLanguage),
    testCases: row.testCases.map(toTestCase),
    rubric: toRubric(row.rubric),
    concepts: row.concepts.map(toConcept),
    transferQuestion: row.transferQuestion
      ? { id: row.transferQuestion.id, title: row.transferQuestion.title }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    externalReference: toExternalReference(row.externalReference),
  };
}

function toSummary(row: SummaryRow): QuestionSummary {
  return {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    languageCount: row._count.languages,
    testCaseCount: row._count.testCases,
    isArchived: row.isArchived,
    updatedAt: row.updatedAt.toISOString(),
    externalReference: toExternalReference(row.externalReference),
  };
}

async function loadOwnedQuestion(questionId: string, instructorId: string): Promise<DetailRow> {
  const question = await findInstructorQuestion(questionId, instructorId);
  if (!question) {
    throw ApiError.notFound("Question not found");
  }
  return question;
}

async function assertQuestionOwner(questionId: string, instructorId: string): Promise<void> {
  if (!(await findOwnedQuestionMeta(questionId, instructorId))) {
    throw ApiError.notFound("Question not found");
  }
}

export async function getInstructorQuestions(instructorId: string): Promise<QuestionSummary[]> {
  return (await listInstructorQuestions(instructorId)).map(toSummary);
}

export async function getInstructorQuestion(
  questionId: string,
  instructorId: string,
): Promise<QuestionDetail> {
  return toDetail(await loadOwnedQuestion(questionId, instructorId));
}

function splitQuestionInput(input: CreateQuestionInput) {
  return {
    scalars: {
      title: input.title,
      statement: input.statement,
      constraints: input.constraints ?? null,
      inputFormat: input.inputFormat ?? null,
      outputFormat: input.outputFormat ?? null,
      difficulty: input.difficulty,
      timeLimitMs: input.timeLimitMs ?? null,
      memoryLimitMb: input.memoryLimitMb ?? null,
    },
    languages: input.languages.map((l) => ({
      language: l.language,
      starterCode: l.starterCode ?? null,
    })),
    // Deduplicated so a repeated id cannot trip the unique constraint.
    conceptIds: input.conceptIds === undefined ? undefined : [...new Set(input.conceptIds)],
    transferQuestionId: input.transferQuestionId,
  };
}

/**
 * A Transfer Check target must be a different question of the same instructor.
 * (Whether it can share an assessment with its source is enforced when
 * questions are attached / the assessment is activated.)
 */
async function assertTransferTarget(
  transferQuestionId: string | null | undefined,
  questionId: string | null,
  instructorId: string,
): Promise<void> {
  if (!transferQuestionId) return;
  if (questionId !== null && transferQuestionId === questionId) {
    throw ApiError.badRequest("A question cannot be its own transfer check");
  }
  if (!(await findOwnedQuestionMeta(transferQuestionId, instructorId))) {
    throw ApiError.badRequest("Unknown transfer question");
  }
}

/** Client-supplied concept ids are never trusted: every one must exist. */
async function assertConceptsExist(conceptIds: string[] | undefined): Promise<void> {
  if (!conceptIds || conceptIds.length === 0) return;
  const existing = new Set((await findExistingConceptIds(conceptIds)).map((c) => c.id));
  const unknown = conceptIds.filter((id) => !existing.has(id));
  if (unknown.length > 0) {
    throw ApiError.badRequest(`Unknown concept id${unknown.length === 1 ? "" : "s"}`);
  }
}

export async function createInstructorQuestion(
  input: CreateQuestionInput,
  instructorId: string,
): Promise<QuestionDetail> {
  const { scalars, languages, conceptIds, transferQuestionId } = splitQuestionInput(input);
  await assertConceptsExist(conceptIds);
  await assertTransferTarget(transferQuestionId, null, instructorId);
  return toDetail(
    await createQuestion(
      scalars,
      instructorId,
      languages,
      conceptIds ?? [],
      transferQuestionId ?? null,
    ),
  );
}

export async function updateInstructorQuestion(
  questionId: string,
  input: CreateQuestionInput,
  instructorId: string,
): Promise<QuestionDetail> {
  await assertQuestionOwner(questionId, instructorId);
  const { scalars, languages, conceptIds, transferQuestionId } = splitQuestionInput(input);
  await assertConceptsExist(conceptIds);
  await assertTransferTarget(transferQuestionId, questionId, instructorId);
  return toDetail(
    await updateQuestion(questionId, scalars, languages, conceptIds, transferQuestionId),
  );
}

export async function addTestCase(
  questionId: string,
  input: CreateTestCaseInput,
  instructorId: string,
): Promise<QuestionDetail> {
  await assertQuestionOwner(questionId, instructorId);
  await createTestCase({
    questionId,
    name: input.name ?? null,
    input: input.input,
    expectedOutput: input.expectedOutput,
    visibility: input.visibility,
    category: input.category,
    weight: input.weight,
    isActive: input.isActive,
    position: await nextTestCasePosition(questionId),
  });
  return getInstructorQuestion(questionId, instructorId);
}

export async function editTestCase(
  questionId: string,
  testCaseId: string,
  input: UpdateTestCaseInput,
  instructorId: string,
): Promise<QuestionDetail> {
  await assertQuestionOwner(questionId, instructorId);
  if (!(await findTestCase(testCaseId, questionId))) {
    throw ApiError.notFound("Test case not found");
  }
  await updateTestCase(testCaseId, {
    ...(input.name !== undefined ? { name: input.name ?? null } : {}),
    ...(input.input !== undefined ? { input: input.input } : {}),
    ...(input.expectedOutput !== undefined ? { expectedOutput: input.expectedOutput } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });
  return getInstructorQuestion(questionId, instructorId);
}

export async function removeTestCase(
  questionId: string,
  testCaseId: string,
  instructorId: string,
): Promise<QuestionDetail> {
  await assertQuestionOwner(questionId, instructorId);
  if (!(await findTestCase(testCaseId, questionId))) {
    throw ApiError.notFound("Test case not found");
  }
  await deleteTestCase(testCaseId);
  return getInstructorQuestion(questionId, instructorId);
}

export async function getInstructorRubric(
  questionId: string,
  instructorId: string,
): Promise<RubricDto> {
  await assertQuestionOwner(questionId, instructorId);
  return toRubric(await findRubricWithCriteria(questionId));
}

export async function saveInstructorRubric(
  questionId: string,
  input: SaveRubricInput,
  instructorId: string,
): Promise<RubricDto> {
  await assertQuestionOwner(questionId, instructorId);
  const rubric = await syncRubricCriteria(
    questionId,
    input.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      type: c.type,
      maxPoints: c.maxPoints,
    })),
  );
  return toRubric(rubric);
}

// --- Hint stages (authoring) ------------------------------------------------
//
// Stages stay numbered 1..n without gaps: new stages are appended and only the
// last, never-delivered stage can be removed. That keeps the student policy
// ("stage N needs stage N-1 used") satisfiable for every stage. Editing a stage
// that was already delivered is allowed - every delivery stores a snapshot of
// the text shown, so the evidence record is unaffected.

type HintStageRow = Awaited<ReturnType<typeof listHintStages>>[number];

function toHintStage(row: HintStageRow): InstructorHintStage {
  return {
    id: row.id,
    stageNumber: row.stageNumber,
    title: row.title,
    deliveryType: row.deliveryType,
    content: row.content,
    usageCount: row._count.usages,
  };
}

export async function getInstructorHintStages(
  questionId: string,
  instructorId: string,
): Promise<InstructorHintStage[]> {
  await assertQuestionOwner(questionId, instructorId);
  return (await listHintStages(questionId)).map(toHintStage);
}

export async function addHintStage(
  questionId: string,
  input: CreateHintStageInput,
  instructorId: string,
): Promise<InstructorHintStage[]> {
  await assertQuestionOwner(questionId, instructorId);
  if ((await listHintStages(questionId)).length >= MAX_HINT_STAGES) {
    throw new ApiError(
      409,
      "HINT_STAGE_LIMIT",
      `A question can have at most ${MAX_HINT_STAGES} hint stages`,
    );
  }
  await appendHintStage(questionId, {
    title: input.title ?? null,
    deliveryType: input.deliveryType,
    content: input.deliveryType === "STATIC" ? (input.content ?? null) : null,
  });
  return getInstructorHintStages(questionId, instructorId);
}

export async function editHintStage(
  questionId: string,
  stageId: string,
  input: UpdateHintStageInput,
  instructorId: string,
): Promise<InstructorHintStage[]> {
  await assertQuestionOwner(questionId, instructorId);
  const stage = await findHintStageForQuestion(stageId, questionId);
  if (!stage) {
    throw ApiError.notFound("Hint stage not found");
  }
  const deliveryType = input.deliveryType ?? stage.deliveryType;
  const content =
    deliveryType === "INTERACTIVE"
      ? null
      : input.content !== undefined
        ? (input.content ?? null)
        : stage.content;
  if (deliveryType === "STATIC" && !content?.trim()) {
    throw ApiError.badRequest("A written hint needs its text");
  }
  await updateHintStage(stageId, {
    ...(input.title !== undefined ? { title: input.title ?? null } : {}),
    deliveryType,
    content,
  });
  return getInstructorHintStages(questionId, instructorId);
}

export async function removeHintStage(
  questionId: string,
  stageId: string,
  instructorId: string,
): Promise<InstructorHintStage[]> {
  await assertQuestionOwner(questionId, instructorId);
  const stages = await listHintStages(questionId);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) {
    throw ApiError.notFound("Hint stage not found");
  }
  if (stage.id !== stages.at(-1)?.id) {
    throw new ApiError(409, "HINT_STAGE_NOT_LAST", "Only the last hint stage can be removed");
  }
  if (stage._count.usages > 0) {
    throw new ApiError(
      409,
      "HINT_STAGE_IN_USE",
      "This hint has already been delivered to a student and is part of their evidence record",
    );
  }
  await deleteHintStage(stageId);
  return getInstructorHintStages(questionId, instructorId);
}
