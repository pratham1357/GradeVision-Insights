import type { Prisma } from "@gradevision/database";

import { prisma } from "../../services/database.js";
import { runWithResultsArgs } from "../results/mapper.js";

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

/**
 * Questions in the assessment whose Transfer Check target is also in it (or
 * would be, if `candidateQuestionId` were attached). A question and its
 * transfer check must never share an assessment: the transfer task would then
 * be an ordinary, hint-enabled, marked question.
 */
export async function findTransferConflicts(
  assessmentId: string,
  candidateQuestionId?: string,
): Promise<{ questionId: string; transferQuestionId: string }[]> {
  const links = await prisma.assessmentQuestion.findMany({
    where: { assessmentId },
    select: { questionId: true, question: { select: { transferQuestionId: true } } },
  });
  const ids = new Set(links.map((l) => l.questionId));
  const pairs = links.map((l) => ({
    questionId: l.questionId,
    transferQuestionId: l.question.transferQuestionId,
  }));
  if (candidateQuestionId) {
    const candidate = await prisma.question.findUnique({
      where: { id: candidateQuestionId },
      select: { transferQuestionId: true },
    });
    ids.add(candidateQuestionId);
    pairs.push({
      questionId: candidateQuestionId,
      transferQuestionId: candidate?.transferQuestionId ?? null,
    });
  }
  return pairs.filter(
    (p): p is { questionId: string; transferQuestionId: string } =>
      p.transferQuestionId !== null && ids.has(p.transferQuestionId),
  );
}

export function listAssessmentQuestionIds(assessmentId: string) {
  return prisma.assessmentQuestion.findMany({
    where: { assessmentId },
    select: { questionId: true },
  });
}

/**
 * Everything the results view needs, in one ownership-scoped query: the ordered
 * questions, the section's ACTIVE students, and each student's session with its
 * submissions + evaluation runs.
 */
export function loadAssessmentResults(assessmentId: string, instructorId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, ...ownedBy(instructorId) },
    include: {
      questions: {
        orderBy: { position: "asc" },
        include: { question: { select: { id: true, title: true } } },
      },
      section: {
        include: {
          enrollments: {
            where: { status: "ACTIVE" },
            include: { student: { select: { id: true, name: true, email: true } } },
          },
        },
      },
      examSessions: {
        include: {
          submissions: {
            orderBy: { attemptNumber: "desc" },
            include: {
              evaluationRuns: {
                where: { runNumber: 1 },
                select: {
                  status: true,
                  totalScore: true,
                  maxScore: true,
                  testCaseResults: { select: { status: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

/** One session's full per-question breakdown, ownership-scoped to the instructor. */
export function loadAssessmentSessionResult(
  assessmentId: string,
  sessionId: string,
  instructorId: string,
) {
  return prisma.examSession.findFirst({
    where: {
      id: sessionId,
      assessmentId,
      assessment: { ...ownedBy(instructorId) },
    },
    include: {
      student: { select: { id: true, name: true, email: true } },
      assessment: {
        select: {
          id: true,
          questions: {
            orderBy: { position: "asc" },
            include: {
              question: {
                select: {
                  id: true,
                  title: true,
                  transferQuestion: { select: { id: true, title: true } },
                },
              },
            },
          },
        },
      },
      submissions: {
        orderBy: { attemptNumber: "desc" },
        include: { evaluationRuns: { where: { runNumber: 1 }, ...runWithResultsArgs } },
      },
      _count: { select: { violations: true } },
    },
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
