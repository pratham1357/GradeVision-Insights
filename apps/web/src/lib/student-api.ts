import type {
  ExamSessionView,
  HintRequestResult,
  ProgrammingLanguage,
  QuestionHintsView,
  RecordViolationBody,
  RecordViolationResult,
  SaveDraftResult,
  StudentAssessmentSummary,
  SubmissionResultView,
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

  getSubmissionResult: (submissionId: string) =>
    apiRequest<SubmissionResultView>(`/student/submissions/${submissionId}`),

  listHints: (sessionId: string, questionId: string) =>
    apiRequest<QuestionHintsView>(`/student/sessions/${sessionId}/questions/${questionId}/hints`),

  requestHint: (sessionId: string, questionId: string, stageNumber: number) =>
    apiRequest<HintRequestResult>(`/student/sessions/${sessionId}/questions/${questionId}/hints`, {
      method: "POST",
      ...json({ stageNumber }),
    }),

  recordViolation: (sessionId: string, body: RecordViolationBody) =>
    apiRequest<RecordViolationResult>(`/student/sessions/${sessionId}/violations`, {
      method: "POST",
      ...json(body),
    }),
};
