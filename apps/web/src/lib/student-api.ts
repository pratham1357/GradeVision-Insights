import type {
  ExamSessionView,
  ProgrammingLanguage,
  SaveDraftResult,
  StudentAssessmentSummary,
  SubmitResult,
} from "@gradevision/shared";

import { apiRequest } from "./api-client";

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export interface CodePayload {
  language: ProgrammingLanguage;
  sourceCode: string;
}

/**
 * Typed wrappers over the student API. Components call these rather than `fetch`.
 * Every draft-save / submit response echoes `timing`, so the countdown re-syncs
 * to the server clock on each write.
 */
export const studentApi = {
  listAssessments: () => apiRequest<StudentAssessmentSummary[]>("/student/assessments"),

  startSession: (assessmentId: string) =>
    apiRequest<ExamSessionView>(`/student/assessments/${assessmentId}/session`, { method: "POST" }),

  getSession: (sessionId: string) => apiRequest<ExamSessionView>(`/student/sessions/${sessionId}`),

  finishSession: (sessionId: string) =>
    apiRequest<ExamSessionView>(`/student/sessions/${sessionId}/finish`, { method: "POST" }),

  saveDraft: (sessionId: string, questionId: string, body: CodePayload) =>
    apiRequest<SaveDraftResult>(`/student/sessions/${sessionId}/questions/${questionId}/draft`, {
      method: "PUT",
      ...json(body),
    }),

  submit: (sessionId: string, questionId: string, body: CodePayload) =>
    apiRequest<SubmitResult>(`/student/sessions/${sessionId}/questions/${questionId}/submissions`, {
      method: "POST",
      ...json(body),
    }),
};
