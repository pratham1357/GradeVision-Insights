import type { AssessmentDetail, AssessmentStatus, AssessmentSummary } from "@gradevision/shared";

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
