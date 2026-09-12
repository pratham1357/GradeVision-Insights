import type {
  Prisma,
  ProgrammingLanguage,
  QuestionDifficulty,
  RubricCriterionType,
} from "@gradevision/database";

import { prisma } from "../../services/database.js";

export interface QuestionScalarInput {
  title: string;
  statement: string;
  constraints: string | null;
  inputFormat: string | null;
  outputFormat: string | null;
  difficulty: QuestionDifficulty;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
}

export interface QuestionLanguageInput {
  language: ProgrammingLanguage;
  starterCode: string | null;
}

export interface RubricCriterionInput {
  id?: string;
  name: string;
  description: string | null;
  type: RubricCriterionType;
  maxPoints: number;
}

const detailInclude = {
  languages: { orderBy: { language: "asc" } },
  testCases: { orderBy: { position: "asc" } },
  rubric: { include: { criteria: { orderBy: { position: "asc" } } } },
  concepts: {
    orderBy: { concept: { name: "asc" } },
    select: { concept: { select: { id: true, name: true, description: true } } },
  },
  transferQuestion: { select: { id: true, title: true } },
} satisfies Prisma.QuestionInclude;

export function listInstructorQuestions(instructorId: string) {
  return prisma.question.findMany({
    where: { createdById: instructorId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { languages: true, testCases: true } } },
  });
}

export function findInstructorQuestion(questionId: string, instructorId: string) {
  return prisma.question.findFirst({
    where: { id: questionId, createdById: instructorId },
    include: detailInclude,
  });
}

/** Ownership-check only. */
export function findOwnedQuestionMeta(questionId: string, instructorId: string) {
  return prisma.question.findFirst({
    where: { id: questionId, createdById: instructorId },
    select: { id: true, title: true, difficulty: true },
  });
}

export function createQuestion(
  scalars: QuestionScalarInput,
  createdById: string,
  languages: QuestionLanguageInput[],
  conceptIds: string[] = [],
  transferQuestionId: string | null = null,
) {
  return prisma.question.create({
    data: {
      ...scalars,
      createdById,
      transferQuestionId,
      languages: { create: languages.map((l) => ({ ...l })) },
      concepts: { create: conceptIds.map((conceptId) => ({ conceptId })) },
    },
    include: detailInclude,
  });
}

/**
 * `conceptIds` undefined = leave the question's concept associations untouched
 * (older clients never send the field); an array replaces the whole set.
 */
export function updateQuestion(
  questionId: string,
  scalars: QuestionScalarInput,
  languages: QuestionLanguageInput[],
  conceptIds?: string[],
  transferQuestionId?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await tx.question.update({
      where: { id: questionId },
      data: { ...scalars, ...(transferQuestionId !== undefined ? { transferQuestionId } : {}) },
    });
    await tx.questionLanguage.deleteMany({ where: { questionId } });
    if (languages.length > 0) {
      await tx.questionLanguage.createMany({
        data: languages.map((l) => ({ questionId, ...l })),
      });
    }
    if (conceptIds !== undefined) {
      await tx.questionConcept.deleteMany({ where: { questionId } });
      if (conceptIds.length > 0) {
        await tx.questionConcept.createMany({
          data: conceptIds.map((conceptId) => ({ questionId, conceptId })),
        });
      }
    }
    return tx.question.findUniqueOrThrow({ where: { id: questionId }, include: detailInclude });
  });
}

// --- Test cases -----------------------------------------------------------

export function findTestCase(testCaseId: string, questionId: string) {
  return prisma.testCase.findFirst({ where: { id: testCaseId, questionId } });
}

export async function nextTestCasePosition(questionId: string): Promise<number> {
  const max = await prisma.testCase.aggregate({
    where: { questionId },
    _max: { position: true },
  });
  return (max._max.position ?? -1) + 1;
}

export function createTestCase(data: Prisma.TestCaseUncheckedCreateInput) {
  return prisma.testCase.create({ data });
}

export function updateTestCase(testCaseId: string, data: Prisma.TestCaseUpdateInput) {
  return prisma.testCase.update({ where: { id: testCaseId }, data });
}

export function deleteTestCase(testCaseId: string) {
  return prisma.testCase.delete({ where: { id: testCaseId } });
}

// --- Rubric --------------------------------------------------------------

export function findRubricWithCriteria(questionId: string) {
  return prisma.rubric.findUnique({
    where: { questionId },
    include: { criteria: { orderBy: { position: "asc" } } },
  });
}

export function syncRubricCriteria(questionId: string, criteria: RubricCriterionInput[]) {
  return prisma.$transaction(async (tx) => {
    const rubric =
      (await tx.rubric.findUnique({ where: { questionId } })) ??
      (await tx.rubric.create({ data: { questionId } }));

    const existing = await tx.rubricCriterion.findMany({
      where: { rubricId: rubric.id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    const keepIds = new Set(criteria.map((c) => c.id).filter((id): id is string => Boolean(id)));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
      await tx.rubricCriterion.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const [position, criterion] of criteria.entries()) {
      const data = {
        name: criterion.name,
        description: criterion.description,
        type: criterion.type,
        maxPoints: criterion.maxPoints,
        position,
      };
      if (criterion.id && existingIds.has(criterion.id)) {
        await tx.rubricCriterion.update({ where: { id: criterion.id }, data });
      } else {
        await tx.rubricCriterion.create({ data: { ...data, rubricId: rubric.id } });
      }
    }

    return tx.rubric.findUniqueOrThrow({
      where: { id: rubric.id },
      include: { criteria: { orderBy: { position: "asc" } } },
    });
  });
}
