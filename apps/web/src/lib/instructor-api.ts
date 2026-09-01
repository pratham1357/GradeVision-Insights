import type {
  AssessmentDetail,
  AssessmentStatus,
  AssessmentSummary,
  InstructorCourse,
  ProgrammingLanguage,
  QuestionDetail,
  QuestionSummary,
  QuestionDifficulty,
  RubricCriterionType,
  RubricDto,
  TestCaseCategory,
  TestCaseVisibility,
} from "@gradevision/shared";

import { apiRequest } from "./api-client";

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export interface AssessmentInput {
  title: string;
  description?: string | null;
  sectionId: string;
  durationMinutes?: number | null;
}

export interface AssessmentUpdateInput {
  title?: string;
  description?: string | null;
  durationMinutes?: number | null;
  status?: AssessmentStatus;
}

export interface QuestionInput {
  title: string;
  statement: string;
  constraints?: string | null;
  inputFormat?: string | null;
  outputFormat?: string | null;
  difficulty: QuestionDifficulty;
  timeLimitMs?: number | null;
  memoryLimitMb?: number | null;
  languages: { language: ProgrammingLanguage; starterCode?: string | null }[];
}

export interface TestCaseInput {
  name?: string | null;
  input: string;
  expectedOutput: string;
  visibility: TestCaseVisibility;
  category?: TestCaseCategory;
  weight?: number;
  isActive?: boolean;
}

export interface RubricCriterionInput {
  id?: string;
  name: string;
  description?: string | null;
  type: RubricCriterionType;
  maxPoints: number;
}

/**
 * Typed wrappers over the instructor API. Components call these instead of
 * touching `fetch` directly. Mutations return the refreshed resource so callers
 * can replace their local state without a manual merge.
 */
export const instructorApi = {
  listCourses: () => apiRequest<InstructorCourse[]>("/courses"),

  listAssessments: () => apiRequest<AssessmentSummary[]>("/assessments"),
  getAssessment: (id: string) => apiRequest<AssessmentDetail>(`/assessments/${id}`),
  createAssessment: (body: AssessmentInput) =>
    apiRequest<AssessmentDetail>("/assessments", { method: "POST", ...json(body) }),
  updateAssessment: (id: string, body: AssessmentUpdateInput) =>
    apiRequest<AssessmentDetail>(`/assessments/${id}`, { method: "PATCH", ...json(body) }),
  attachQuestion: (id: string, body: { questionId: string; points?: number }) =>
    apiRequest<AssessmentDetail>(`/assessments/${id}/questions`, { method: "POST", ...json(body) }),
  updateAssessmentQuestion: (
    id: string,
    questionId: string,
    body: { points?: number; position?: number },
  ) =>
    apiRequest<AssessmentDetail>(`/assessments/${id}/questions/${questionId}`, {
      method: "PATCH",
      ...json(body),
    }),
  detachQuestion: (id: string, questionId: string) =>
    apiRequest<AssessmentDetail>(`/assessments/${id}/questions/${questionId}`, {
      method: "DELETE",
    }),
  reorderQuestions: (id: string, orderedQuestionIds: string[]) =>
    apiRequest<AssessmentDetail>(`/assessments/${id}/questions/reorder`, {
      method: "POST",
      ...json({ orderedQuestionIds }),
    }),

  listQuestions: () => apiRequest<QuestionSummary[]>("/questions"),
  getQuestion: (id: string) => apiRequest<QuestionDetail>(`/questions/${id}`),
  createQuestion: (body: QuestionInput) =>
    apiRequest<QuestionDetail>("/questions", { method: "POST", ...json(body) }),
  updateQuestion: (id: string, body: QuestionInput) =>
    apiRequest<QuestionDetail>(`/questions/${id}`, { method: "PUT", ...json(body) }),
  createTestCase: (questionId: string, body: TestCaseInput) =>
    apiRequest<QuestionDetail>(`/questions/${questionId}/test-cases`, {
      method: "POST",
      ...json(body),
    }),
  updateTestCase: (questionId: string, testCaseId: string, body: Partial<TestCaseInput>) =>
    apiRequest<QuestionDetail>(`/questions/${questionId}/test-cases/${testCaseId}`, {
      method: "PATCH",
      ...json(body),
    }),
  deleteTestCase: (questionId: string, testCaseId: string) =>
    apiRequest<QuestionDetail>(`/questions/${questionId}/test-cases/${testCaseId}`, {
      method: "DELETE",
    }),
  getRubric: (questionId: string) => apiRequest<RubricDto>(`/questions/${questionId}/rubric`),
  saveRubric: (questionId: string, criteria: RubricCriterionInput[]) =>
    apiRequest<RubricDto>(`/questions/${questionId}/rubric/criteria`, {
      method: "PUT",
      ...json({ criteria }),
    }),
};
