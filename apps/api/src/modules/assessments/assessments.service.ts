import type {
  AssessmentDetail,
  AssessmentStatus,
  AssessmentSummary,
  EvaluationRunStatus,
  InstructorAssessmentResults,
  InstructorResultQuestionScore,
  InstructorResultRow,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { findInstructorSection } from "../courses/courses.repository.js";
import { findOwnedQuestionMeta } from "../questions/questions.repository.js";
import {
  attachQuestion,
  createAssessment,
  detachQuestion,
  findAssessmentQuestion,
  findInstructorAssessment,
  findOwnedAssessmentMeta,
  listAssessmentQuestionIds,
  listInstructorAssessments,
  loadAssessmentResults,
  nextQuestionPosition,
  reorderAssessmentQuestions,
  updateAssessment,
  updateAssessmentQuestion,
} from "./assessments.repository.js";
import type {
  AttachQuestionInput,
  CreateAssessmentInput,
  ReorderQuestionsInput,
  UpdateAssessmentInput,
  UpdateAssessmentQuestionInput,
} from "./assessments.schema.js";

type SummaryRow = Awaited<ReturnType<typeof listInstructorAssessments>>[number];
type DetailRow = NonNullable<Awaited<ReturnType<typeof findInstructorAssessment>>>;

function toSummary(row: SummaryRow): AssessmentSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    durationMinutes: row.durationMinutes,
    sectionId: row.sectionId,
    section: row.section
      ? { id: row.section.id, name: row.section.name, courseCode: row.section.course.code }
      : null,
    questionCount: row.questions.length,
    totalPoints: row.questions.reduce((sum, q) => sum + Number(q.points), 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: DetailRow): AssessmentDetail {
  return {
    ...toSummary(row),
    questions: row.questions.map((link) => ({
      questionId: link.questionId,
      title: link.question.title,
      difficulty: link.question.difficulty,
      position: link.position,
      points: Number(link.points),
    })),
  };
}

// Instructor-editable transitions for this MVP. ACTIVE is exam-lifecycle, deferred.
const ALLOWED_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ["SCHEDULED", "CLOSED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "CLOSED", "ARCHIVED"],
  ACTIVE: [],
  CLOSED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: [],
};

async function loadOwnedAssessment(assessmentId: string, instructorId: string): Promise<DetailRow> {
  const assessment = await findInstructorAssessment(assessmentId, instructorId);
  if (!assessment) {
    throw ApiError.notFound("Assessment not found");
  }
  return assessment;
}

export async function getInstructorAssessments(instructorId: string): Promise<AssessmentSummary[]> {
  const rows = await listInstructorAssessments(instructorId);
  return rows.map(toSummary);
}

export async function getInstructorAssessment(
  assessmentId: string,
  instructorId: string,
): Promise<AssessmentDetail> {
  return toDetail(await loadOwnedAssessment(assessmentId, instructorId));
}

export async function createInstructorAssessment(
  input: CreateAssessmentInput,
  instructorId: string,
): Promise<AssessmentDetail> {
  const section = await findInstructorSection(input.sectionId, instructorId);
  if (!section) {
    throw ApiError.notFound("Section not found");
  }

  const created = await createAssessment({
    title: input.title,
    description: input.description ?? null,
    sectionId: section.id,
    courseId: section.courseId,
    durationMinutes: input.durationMinutes ?? null,
    createdById: instructorId,
  });
  return toDetail(created);
}

export async function updateInstructorAssessment(
  assessmentId: string,
  input: UpdateAssessmentInput,
  instructorId: string,
): Promise<AssessmentDetail> {
  const current = await loadOwnedAssessment(assessmentId, instructorId);

  const editsContent =
    input.title !== undefined ||
    input.description !== undefined ||
    input.durationMinutes !== undefined;

  if (editsContent && current.status !== "DRAFT") {
    throw new ApiError(409, "ASSESSMENT_NOT_EDITABLE", "Only DRAFT assessments can be edited");
  }

  if (input.status && input.status !== current.status) {
    if (!ALLOWED_TRANSITIONS[current.status].includes(input.status)) {
      throw new ApiError(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot change status from ${current.status} to ${input.status}`,
      );
    }
  }

  const updated = await updateAssessment(assessmentId, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.durationMinutes !== undefined
      ? { durationMinutes: input.durationMinutes ?? null }
      : {}),
    ...(input.status ? { status: input.status } : {}),
  });
  return toDetail(updated);
}

async function requireDraftAssessment(assessmentId: string, instructorId: string) {
  const meta = await findOwnedAssessmentMeta(assessmentId, instructorId);
  if (!meta) {
    throw ApiError.notFound("Assessment not found");
  }
  if (meta.status !== "DRAFT") {
    throw new ApiError(
      409,
      "ASSESSMENT_NOT_EDITABLE",
      "Questions can only be changed while the assessment is DRAFT",
    );
  }
  return meta;
}

export async function addAssessmentQuestion(
  assessmentId: string,
  input: AttachQuestionInput,
  instructorId: string,
): Promise<AssessmentDetail> {
  await requireDraftAssessment(assessmentId, instructorId);

  const question = await findOwnedQuestionMeta(input.questionId, instructorId);
  if (!question) {
    throw ApiError.notFound("Question not found");
  }

  if (await findAssessmentQuestion(assessmentId, input.questionId)) {
    throw new ApiError(409, "CONFLICT", "That question is already in this assessment");
  }

  await attachQuestion({
    assessmentId,
    questionId: input.questionId,
    points: input.points,
    position: await nextQuestionPosition(assessmentId),
  });
  return getInstructorAssessment(assessmentId, instructorId);
}

export async function editAssessmentQuestion(
  assessmentId: string,
  questionId: string,
  input: UpdateAssessmentQuestionInput,
  instructorId: string,
): Promise<AssessmentDetail> {
  await requireDraftAssessment(assessmentId, instructorId);
  if (!(await findAssessmentQuestion(assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }
  await updateAssessmentQuestion(assessmentId, questionId, input);
  return getInstructorAssessment(assessmentId, instructorId);
}

export async function removeAssessmentQuestion(
  assessmentId: string,
  questionId: string,
  instructorId: string,
): Promise<AssessmentDetail> {
  await requireDraftAssessment(assessmentId, instructorId);
  if (!(await findAssessmentQuestion(assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }
  await detachQuestion(assessmentId, questionId);
  return getInstructorAssessment(assessmentId, instructorId);
}

// --- Results --------------------------------------------------------------

type ResultsRow = NonNullable<Awaited<ReturnType<typeof loadAssessmentResults>>>;
type SessionRow = ResultsRow["examSessions"][number];
type SubmissionRow = SessionRow["submissions"][number];

function scoreSubmission(
  submission: SubmissionRow | undefined,
  points: number,
): {
  cell: Omit<InstructorResultQuestionScore, "questionId" | "title" | "position" | "points">;
  earned: number;
} {
  const run = submission?.evaluationRuns[0] ?? null;
  const graded = run?.testCaseResults.filter((r) => r.status !== "SKIPPED") ?? [];
  const total = run?.totalScore == null ? null : Number(run.totalScore);
  const max = run?.maxScore == null ? null : Number(run.maxScore);
  const scorePercent =
    total !== null && max !== null && max > 0 ? Math.round((total / max) * 100) : null;
  // Gradebook value: scale the question's points by the rubric percentage.
  const earned = scorePercent === null ? 0 : Math.round((points * scorePercent) / 100);
  return {
    cell: {
      submissionStatus: submission?.status ?? null,
      evaluationStatus: (run?.status as EvaluationRunStatus | undefined) ?? null,
      score: total,
      maxScore: max,
      scorePercent,
      testsPassed: graded.filter((r) => r.status === "PASSED").length,
      testsTotal: graded.length,
    },
    earned,
  };
}

export async function getAssessmentResults(
  assessmentId: string,
  instructorId: string,
): Promise<InstructorAssessmentResults> {
  const assessment = await loadAssessmentResults(assessmentId, instructorId);
  if (!assessment) {
    throw ApiError.notFound("Assessment not found");
  }

  const questions = assessment.questions.map((link) => ({
    questionId: link.questionId,
    title: link.question.title,
    position: link.position,
    points: Number(link.points),
  }));

  const sessionByStudent = new Map<string, SessionRow>();
  for (const session of assessment.examSessions) {
    sessionByStudent.set(session.studentId, session);
  }

  const students: InstructorResultRow[] = assessment.section
    ? assessment.section.enrollments
        .map((enrollment) => {
          const session = sessionByStudent.get(enrollment.studentId) ?? null;
          const latestByQuestion = new Map<string, SubmissionRow>();
          for (const submission of session?.submissions ?? []) {
            if (!latestByQuestion.has(submission.questionId)) {
              latestByQuestion.set(submission.questionId, submission);
            }
          }

          let totalScore = 0;
          let maxScore = 0;
          const questionScores: InstructorResultQuestionScore[] = questions.map((q) => {
            const { cell, earned } = scoreSubmission(latestByQuestion.get(q.questionId), q.points);
            totalScore += earned;
            maxScore += q.points;
            return {
              questionId: q.questionId,
              title: q.title,
              position: q.position,
              points: q.points,
              ...cell,
            };
          });

          return {
            studentId: enrollment.studentId,
            studentName: enrollment.student.name,
            studentEmail: enrollment.student.email,
            sessionId: session?.id ?? null,
            sessionStatus: session?.status ?? null,
            startedAt: session?.startedAt?.toISOString() ?? null,
            submittedAt: session?.submittedAt?.toISOString() ?? null,
            totalScore,
            maxScore,
            scorePercent: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null,
            questions: questionScores,
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName))
    : [];

  return {
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    questions,
    students,
  };
}

export async function reorderInstructorAssessmentQuestions(
  assessmentId: string,
  input: ReorderQuestionsInput,
  instructorId: string,
): Promise<AssessmentDetail> {
  await requireDraftAssessment(assessmentId, instructorId);

  const current = await listAssessmentQuestionIds(assessmentId);
  const currentIds = new Set(current.map((q) => q.questionId));
  const nextIds = new Set(input.orderedQuestionIds);

  if (currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))) {
    throw ApiError.badRequest(
      "orderedQuestionIds must be a permutation of the assessment's questions",
    );
  }

  await reorderAssessmentQuestions(assessmentId, input.orderedQuestionIds);
  return getInstructorAssessment(assessmentId, instructorId);
}
