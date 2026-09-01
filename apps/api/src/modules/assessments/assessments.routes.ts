import { Router } from "express";

import { requireRole, validateBody, validateParams } from "../../middleware/index.js";
import {
  attachAssessmentQuestion,
  createAssessment,
  deleteAssessmentQuestion,
  getAssessment,
  listAssessments,
  patchAssessmentQuestion,
  reorderAssessmentQuestions,
  updateAssessment,
} from "./assessments.controller.js";
import {
  assessmentParamsSchema,
  assessmentQuestionParamsSchema,
  attachQuestionSchema,
  createAssessmentSchema,
  reorderQuestionsSchema,
  updateAssessmentQuestionSchema,
  updateAssessmentSchema,
} from "./assessments.schema.js";

/**
 * Assessments (instructor-facing). All endpoints are instructor-only; ownership
 * of the section/assessment is enforced in the service against `req.auth.userId`.
 */
export const assessmentsRouter: Router = Router();

assessmentsRouter.use(...requireRole("INSTRUCTOR"));

assessmentsRouter.get("/", listAssessments);
assessmentsRouter.post("/", validateBody(createAssessmentSchema), createAssessment);

assessmentsRouter.get("/:assessmentId", validateParams(assessmentParamsSchema), getAssessment);
assessmentsRouter.patch(
  "/:assessmentId",
  validateParams(assessmentParamsSchema),
  validateBody(updateAssessmentSchema),
  updateAssessment,
);

assessmentsRouter.post(
  "/:assessmentId/questions",
  validateParams(assessmentParamsSchema),
  validateBody(attachQuestionSchema),
  attachAssessmentQuestion,
);
assessmentsRouter.post(
  "/:assessmentId/questions/reorder",
  validateParams(assessmentParamsSchema),
  validateBody(reorderQuestionsSchema),
  reorderAssessmentQuestions,
);
assessmentsRouter.patch(
  "/:assessmentId/questions/:questionId",
  validateParams(assessmentQuestionParamsSchema),
  validateBody(updateAssessmentQuestionSchema),
  patchAssessmentQuestion,
);
assessmentsRouter.delete(
  "/:assessmentId/questions/:questionId",
  validateParams(assessmentQuestionParamsSchema),
  deleteAssessmentQuestion,
);
