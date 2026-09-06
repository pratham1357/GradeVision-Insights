import { Router } from "express";

import { requireRole, validateBody, validateParams } from "../../middleware/index.js";
import {
  finishExamSession,
  getExamSession,
  getSubmissionResultView,
  listAvailableAssessments,
  listQuestionHints,
  requestQuestionHint,
  saveQuestionDraft,
  startExamSession,
  submitQuestion,
} from "./student.controller.js";
import {
  assessmentParamsSchema,
  requestHintSchema,
  saveDraftSchema,
  sessionParamsSchema,
  sessionQuestionParamsSchema,
  submissionParamsSchema,
  submitSchema,
} from "./student.schema.js";

/**
 * Student assessment-taking (STUDENT only). Every operation derives the student
 * from `req.auth.userId`; sessions/drafts/submissions are scoped to that student
 * in the query, so another student's id in the URL simply doesn't match (404).
 */
export const studentRouter: Router = Router();

studentRouter.use(...requireRole("STUDENT"));

studentRouter.get("/assessments", listAvailableAssessments);
studentRouter.post(
  "/assessments/:assessmentId/session",
  validateParams(assessmentParamsSchema),
  startExamSession,
);

studentRouter.get("/sessions/:sessionId", validateParams(sessionParamsSchema), getExamSession);
studentRouter.post(
  "/sessions/:sessionId/finish",
  validateParams(sessionParamsSchema),
  finishExamSession,
);
studentRouter.put(
  "/sessions/:sessionId/questions/:questionId/draft",
  validateParams(sessionQuestionParamsSchema),
  validateBody(saveDraftSchema),
  saveQuestionDraft,
);
studentRouter.post(
  "/sessions/:sessionId/questions/:questionId/submissions",
  validateParams(sessionQuestionParamsSchema),
  validateBody(submitSchema),
  submitQuestion,
);

studentRouter.get(
  "/sessions/:sessionId/questions/:questionId/hints",
  validateParams(sessionQuestionParamsSchema),
  listQuestionHints,
);
studentRouter.post(
  "/sessions/:sessionId/questions/:questionId/hints",
  validateParams(sessionQuestionParamsSchema),
  validateBody(requestHintSchema),
  requestQuestionHint,
);

studentRouter.get(
  "/submissions/:submissionId",
  validateParams(submissionParamsSchema),
  getSubmissionResultView,
);
