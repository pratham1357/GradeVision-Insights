import type { Prisma } from "@gradevision/database";

import { prisma } from "../../services/database.js";

/** Matches assessments the instructor owns: their section's, or their own section-less drafts. */
function ownedBy(instructorId: string): Prisma.AssessmentWhereInput {
  return {
    OR: [{ section: { instructorId } }, { sectionId: null, createdById: instructorId }],
  };
}

const summaryInclude = {
  section: { select: { id: true, name: true, course: { select: { code: true } } } },
  questions: { select: { points: true } },
} satisfies Prisma.AssessmentInclude;

const detailInclude = {
  section: { select: { id: true, name: true, course: { select: { code: true } } } },
  questions: {
    orderBy: { position: "asc" },
    include: { question: { select: { id: true, title: true, difficulty: true } } },
  },
} satisfies Prisma.AssessmentInclude;

export function listInstructorAssessments(instructorId: string) {
  return prisma.assessment.findMany({
    where: ownedBy(instructorId),
    orderBy: { updatedAt: "desc" },
    include: summaryInclude,
  });
}

export function findInstructorAssessment(assessmentId: string, instructorId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, ...ownedBy(instructorId) },
    include: detailInclude,
  });
}

/** Ownership-check only: returns the assessment's status/section or null. */
export function findOwnedAssessmentMeta(assessmentId: string, instructorId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, ...ownedBy(instructorId) },
    select: { id: true, status: true, sectionId: true },
  });
}

export function createAssessment(data: {
  title: string;
  description: string | null;
  sectionId: string;
  courseId: string | null;
  durationMinutes: number | null;
  createdById: string;
}) {
  return prisma.assessment.create({
    data: { ...data, status: "DRAFT" },
    include: detailInclude,
  });
}

export function updateAssessment(assessmentId: string, data: Prisma.AssessmentUpdateInput) {
  return prisma.assessment.update({
    where: { id: assessmentId },
    data,
    include: detailInclude,
  });
}

export function findAssessmentQuestion(assessmentId: string, questionId: string) {
  return prisma.assessmentQuestion.findUnique({
    where: { assessmentId_questionId: { assessmentId, questionId } },
  });
}

export async function nextQuestionPosition(assessmentId: string): Promise<number> {
  const max = await prisma.assessmentQuestion.aggregate({
    where: { assessmentId },
    _max: { position: true },
  });
  return (max._max.position ?? -1) + 1;
}

export function attachQuestion(data: {
  assessmentId: string;
  questionId: string;
  points: number;
  position: number;
}) {
  return prisma.assessmentQuestion.create({ data });
}

export function updateAssessmentQuestion(
  assessmentId: string,
  questionId: string,
  data: { points?: number; position?: number },
) {
  return prisma.assessmentQuestion.update({
    where: { assessmentId_questionId: { assessmentId, questionId } },
    data,
  });
}

export function detachQuestion(assessmentId: string, questionId: string) {
  return prisma.assessmentQuestion.delete({
    where: { assessmentId_questionId: { assessmentId, questionId } },
  });
}

export function listAssessmentQuestionIds(assessmentId: string) {
  return prisma.assessmentQuestion.findMany({
    where: { assessmentId },
    select: { questionId: true },
  });
}

export function reorderAssessmentQuestions(assessmentId: string, orderedQuestionIds: string[]) {
  return prisma.$transaction(
    orderedQuestionIds.map((questionId, index) =>
      prisma.assessmentQuestion.update({
        where: { assessmentId_questionId: { assessmentId, questionId } },
        data: { position: index },
      }),
    ),
  );
}
