import type {
  AssessmentDetail,
  AssessmentStatus,
  AssessmentSummary,
  EvaluationRunStatus,
  InstructorAssessmentResults,
  InstructorAssessmentStats,
  InstructorResultQuestionScore,
  InstructorResultRow,
  InstructorSessionResult,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { findInstructorSection } from "../courses/courses.repository.js";
import { violationCountsBySession } from "../integrity/integrity.repository.js";
import { findOwnedQuestionMeta } from "../questions/questions.repository.js";
import { emitAssessmentChanged, emitAssessmentSessionsChanged } from "../../realtime/index.js";
import { toEvaluationDetail } from "../results/mapper.js";
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
  loadAssessmentSessionResult,
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

// Legal instructor-editable status transitions. Content edits stay DRAFT-only
// (see updateInstructorAssessment); status-only changes follow this table.
const ALLOWED_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ["SCHEDULED", "ACTIVE", "CLOSED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"],
  ACTIVE: ["CLOSED"],
  CLOSED: ["DRAFT", "ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

// Statuses in which a student may already be sitting the exam. A status change
// into / out of these is pushed to every in-progress session immediately.
const LIVE_STATUSES = new Set<AssessmentStatus>(["ACTIVE", "CLOSED"]);

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

  // Realtime: the instructor's own dashboard, and any student currently sitting
  // this exam, should reflect the change without a manual reload.
  emitAssessmentChanged(assessmentId);
  const statusChanged = input.status !== undefined && input.status !== current.status;
  const touchesLiveExam =
    statusChanged && (LIVE_STATUSES.has(current.status) || LIVE_STATUSES.has(updated.status));
  if (touchesLiveExam || (statusChanged && updated.status === "ACTIVE")) {
    await emitAssessmentSessionsChanged(assessmentId);
  }

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

  const violationCounts = new Map<string, number>();
  for (const row of await violationCountsBySession(assessment.examSessions.map((s) => s.id))) {
    violationCounts.set(row.examSessionId, row._count._all);
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
            violationCount: session ? (violationCounts.get(session.id) ?? 0) : 0,
            questions: questionScores,
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName))
    : [];

  return {
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    questions,
    stats: computeStats(students),
    students,
  };
}

function computeStats(rows: InstructorResultRow[]): InstructorAssessmentStats {
  const started = rows.filter((r) => r.sessionId !== null);
  const submitted = started.filter(
    (r) => r.sessionStatus === "SUBMITTED" || r.sessionStatus === "EXPIRED",
  );
  const inProgress = started.filter((r) => r.sessionStatus === "IN_PROGRESS");
  // "graded" = at least one question has a COMPLETED evaluation run.
  const graded = started.filter((r) => r.questions.some((q) => q.evaluationStatus === "COMPLETED"));
  const percents = graded.map((r) => r.scorePercent).filter((p): p is number => p !== null);
  const round = (n: number) => Math.round(n);
  return {
    totalStudents: rows.length,
    startedCount: started.length,
    submittedCount: submitted.length,
    inProgressCount: inProgress.length,
    gradedCount: graded.length,
    averageScorePercent: percents.length
      ? round(percents.reduce((a, b) => a + b, 0) / percents.length)
      : null,
    highestScorePercent: percents.length ? Math.max(...percents) : null,
    lowestScorePercent: percents.length ? Math.min(...percents) : null,
    totalViolations: rows.reduce((sum, r) => sum + r.violationCount, 0),
    studentsWithViolations: rows.filter((r) => r.violationCount > 0).length,
  };
}

// --- Per-session breakdown (instructor) ----------------------------------

export async function getAssessmentSessionResult(
  assessmentId: string,
  sessionId: string,
  instructorId: string,
): Promise<InstructorSessionResult> {
  const session = await loadAssessmentSessionResult(assessmentId, sessionId, instructorId);
  if (!session) {
    throw ApiError.notFound("Exam session not found");
  }

  const submissionsByQuestion = new Map<string, typeof session.submissions>();
  for (const submission of session.submissions) {
    const list = submissionsByQuestion.get(submission.questionId) ?? [];
    list.push(submission);
    submissionsByQuestion.set(submission.questionId, list);
  }

  let totalScore = 0;
  let maxScore = 0;
  const questions = session.assessment.questions.map((link) => {
    const points = Number(link.points);
    // Repository orders submissions `attemptNumber: "desc"` - index 0 is latest.
    const versions = submissionsByQuestion.get(link.questionId) ?? [];
    const submission = versions[0];
    const run = submission?.evaluationRuns[0] ?? null;
    const detail = toEvaluationDetail(run);
    const pct = detail?.scorePercent ?? null;
    totalScore += pct === null ? 0 : Math.round((points * pct) / 100);
    maxScore += points;
    return {
      questionId: link.questionId,
      title: link.question.title,
      position: link.position,
      points,
      submissionId: submission?.id ?? null,
      attemptNumber: submission?.attemptNumber ?? null,
      submissionStatus: submission?.status ?? null,
      // `toEvaluationDetail` redacts hidden test-case input/expected/actual output.
      evaluation: detail,
      // The student's own submitted code only - never a reference solution, never
      // hidden test data. Read-only inspection in the instructor code viewer.
      versions: versions.map((s) => ({
        submissionId: s.id,
        attemptNumber: s.attemptNumber,
        language: s.language,
        sourceCode: s.sourceCode,
        status: s.status,
        submittedAt: s.createdAt.toISOString(),
      })),
    };
  });

  return {
    sessionId: session.id,
    assessmentId,
    studentId: session.student.id,
    studentName: session.student.name,
    studentEmail: session.student.email,
    sessionStatus: session.status,
    startedAt: session.startedAt?.toISOString() ?? null,
    submittedAt: session.submittedAt?.toISOString() ?? null,
    totalScore,
    maxScore,
    scorePercent: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null,
    violationCount: session._count.violations,
    questions,
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
