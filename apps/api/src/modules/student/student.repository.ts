import type { ExamSessionStatus, Prisma, ProgrammingLanguage } from "@gradevision/database";

import { prisma } from "../../services/database.js";
import { runWithResultsArgs } from "../results/mapper.js";

/**
 * An assessment is available to a student when it is ACTIVE, the student has an
 * ACTIVE enrollment in its section, and (if set) `now` is within its window.
 */
function eligibleWhere(studentId: string, now: Date): Prisma.AssessmentWhereInput {
  return {
    status: "ACTIVE",
    section: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

const sessionQuestionInclude = {
  questions: {
    orderBy: { position: "asc" },
    include: {
      question: {
        include: {
          languages: {
            where: { isEnabled: true },
            orderBy: { language: "asc" },
            select: { language: true, starterCode: true },
          },
          testCases: {
            where: { visibility: "VISIBLE", isActive: true },
            orderBy: { position: "asc" },
            // HIDDEN test cases never leave the database on a student query.
            select: { name: true, input: true, expectedOutput: true },
          },
        },
      },
    },
  },
} satisfies Prisma.AssessmentInclude;

export function listEligibleAssessments(studentId: string, now: Date) {
  return prisma.assessment.findMany({
    where: eligibleWhere(studentId, now),
    orderBy: [{ endsAt: "asc" }, { createdAt: "asc" }],
    include: {
      section: { select: { name: true, course: { select: { code: true } } } },
      _count: { select: { questions: true } },
      examSessions: {
        where: { studentId },
        select: { id: true, status: true, startedAt: true, expiresAt: true },
      },
    },
  });
}

export function findEligibleAssessment(assessmentId: string, studentId: string, now: Date) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, ...eligibleWhere(studentId, now) },
    select: { id: true, durationMinutes: true, endsAt: true },
  });
}

/** Ownership + status + assessment id, for the guards and the session view. */
export function findSessionMeta(sessionId: string, studentId: string) {
  return prisma.examSession.findFirst({
    where: { id: sessionId, studentId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      expiresAt: true,
      submittedAt: true,
      assessmentId: true,
    },
  });
}

export function findExistingSession(assessmentId: string, studentId: string) {
  return prisma.examSession.findUnique({
    where: {
      assessmentId_studentId_attemptNumber: { assessmentId, studentId, attemptNumber: 1 },
    },
    include: { assessment: { select: { id: true, title: true, description: true } } },
  });
}

export function createSession(data: {
  assessmentId: string;
  studentId: string;
  expiresAt: Date | null;
}) {
  return prisma.examSession.create({
    data: {
      assessmentId: data.assessmentId,
      studentId: data.studentId,
      attemptNumber: 1,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      expiresAt: data.expiresAt,
    },
    include: { assessment: { select: { id: true, title: true, description: true } } },
  });
}

export function updateSessionStatus(
  sessionId: string,
  status: ExamSessionStatus,
  extra: { submittedAt?: Date } = {},
) {
  return prisma.examSession.update({
    where: { id: sessionId },
    data: { status, ...extra },
  });
}

export function loadSessionView(sessionId: string) {
  return prisma.examSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      assessment: { include: sessionQuestionInclude },
      drafts: {
        select: { questionId: true, language: true, sourceCode: true, updatedAt: true },
      },
      submissions: {
        orderBy: { attemptNumber: "desc" },
        select: {
          id: true,
          questionId: true,
          language: true,
          status: true,
          attemptNumber: true,
          createdAt: true,
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
  });
}

/** Full evaluation detail for one submission, scoped to its owning student (else null). */
export function findSubmissionResultForStudent(submissionId: string, studentId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, examSession: { studentId } },
    include: {
      question: { select: { title: true } },
      evaluationRuns: { where: { runNumber: 1 }, ...runWithResultsArgs },
    },
  });
}

// --- Hints ------------------------------------------------------------------

/** Active hint stages for a question, ascending, plus this session's usage rows. */
export function loadQuestionHints(questionId: string, examSessionId: string) {
  return prisma.hintStage.findMany({
    where: { questionId, isActive: true },
    orderBy: { stageNumber: "asc" },
    include: {
      usages: {
        where: { examSessionId },
        select: {
          status: true,
          requestedAt: true,
          consumedAt: true,
          detail: true,
        },
      },
    },
  });
}

export function findQuestionForHintContext(questionId: string) {
  return prisma.question.findUnique({
    where: { id: questionId },
    select: { title: true, statement: true },
  });
}

export function findHintStage(questionId: string, stageNumber: number) {
  return prisma.hintStage.findFirst({
    where: { questionId, stageNumber, isActive: true },
  });
}

export function findHintUsage(examSessionId: string, hintStageId: string) {
  return prisma.hintUsage.findUnique({
    where: { examSessionId_hintStageId: { examSessionId, hintStageId } },
  });
}

export function createHintUsage(data: {
  hintStageId: string;
  examSessionId: string;
  studentId: string;
  questionId: string;
  status: "REQUESTED" | "UNLOCKED" | "CONSUMED";
  detail?: Prisma.InputJsonValue;
}) {
  return prisma.hintUsage.create({
    data: {
      hintStageId: data.hintStageId,
      examSessionId: data.examSessionId,
      studentId: data.studentId,
      questionId: data.questionId,
      status: data.status,
      unlockedAt: data.status === "REQUESTED" ? null : new Date(),
      consumedAt: data.status === "CONSUMED" ? new Date() : null,
      ...(data.detail !== undefined ? { detail: data.detail } : {}),
    },
  });
}

export function markHintUsageConsumed(id: string, detail?: Prisma.InputJsonValue) {
  return prisma.hintUsage.update({
    where: { id },
    data: {
      status: "CONSUMED",
      consumedAt: new Date(),
      ...(detail !== undefined ? { detail } : {}),
    },
  });
}

/**
 * Every attempt on a question in this session with its evaluation outcome -
 * the persisted execution evidence the hint policy escalates on and the hint
 * context is built from. Test-case identity/visibility is loaded so the
 * context builder can apply the same VISIBLE/HIDDEN redaction as the student
 * result view (`results/mapper.ts`); nothing here leaves the API unredacted.
 */
export function listHintEvidence(examSessionId: string, questionId: string) {
  return prisma.submission.findMany({
    where: { examSessionId, questionId },
    orderBy: { attemptNumber: "asc" },
    select: {
      attemptNumber: true,
      status: true,
      evaluationRuns: {
        where: { runNumber: 1 },
        select: {
          status: true,
          testCaseResults: {
            select: {
              status: true,
              stdout: true,
              stderr: true,
              testCase: {
                select: {
                  name: true,
                  visibility: true,
                  input: true,
                  expectedOutput: true,
                  position: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export function latestSubmissionCode(examSessionId: string, questionId: string) {
  return prisma.submission.findFirst({
    where: { examSessionId, questionId },
    orderBy: { attemptNumber: "desc" },
    select: { sourceCode: true, language: true },
  });
}

export function findAssessmentQuestionLink(assessmentId: string, questionId: string) {
  return prisma.assessmentQuestion.findUnique({
    where: { assessmentId_questionId: { assessmentId, questionId } },
    select: { questionId: true },
  });
}

export function questionSupportsLanguage(questionId: string, language: ProgrammingLanguage) {
  return prisma.questionLanguage.findFirst({
    where: { questionId, language, isEnabled: true },
    select: { id: true },
  });
}

export function upsertDraft(data: {
  examSessionId: string;
  questionId: string;
  language: ProgrammingLanguage;
  sourceCode: string;
}) {
  return prisma.submissionDraft.upsert({
    where: {
      examSessionId_questionId: {
        examSessionId: data.examSessionId,
        questionId: data.questionId,
      },
    },
    create: data,
    update: { language: data.language, sourceCode: data.sourceCode },
  });
}

export function createSubmissionInSession(data: {
  examSessionId: string;
  questionId: string;
  language: ProgrammingLanguage;
  sourceCode: string;
}) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.submission.aggregate({
      where: { examSessionId: data.examSessionId, questionId: data.questionId },
      _max: { attemptNumber: true },
    });
    return tx.submission.create({
      data: {
        examSessionId: data.examSessionId,
        questionId: data.questionId,
        language: data.language,
        sourceCode: data.sourceCode,
        attemptNumber: (last._max.attemptNumber ?? 0) + 1,
        status: "QUEUED",
      },
      select: {
        id: true,
        questionId: true,
        language: true,
        status: true,
        attemptNumber: true,
        createdAt: true,
      },
    });
  });
}
