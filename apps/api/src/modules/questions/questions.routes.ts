import { Router } from "express";

import { requireRole, validateBody, validateParams } from "../../middleware/index.js";
import {
  createQuestion,
  createTestCase,
  deleteTestCase,
  getQuestion,
  getRubric,
  listQuestions,
  patchTestCase,
  putRubric,
  updateQuestion,
} from "./questions.controller.js";
import {
  createQuestionSchema,
  createTestCaseSchema,
  questionParamsSchema,
  saveRubricSchema,
  testCaseParamsSchema,
  updateQuestionSchema,
  updateTestCaseSchema,
} from "./questions.schema.js";

/**
 * Questions, test cases, and rubric criteria (instructor-facing).
 *
 * Instructor-only; ownership is `question.createdById === req.auth.userId`,
 * enforced in the service. Test cases (VISIBLE and HIDDEN) and rubric criteria
 * are sub-resources of a question. There are no student-facing endpoints yet -
 * when they arrive, hidden test cases and expected outputs must be filtered out.
 */
export const questionsRouter: Router = Router();

questionsRouter.use(...requireRole("INSTRUCTOR"));

questionsRouter.get("/", listQuestions);
questionsRouter.post("/", validateBody(createQuestionSchema), createQuestion);

questionsRouter.get("/:questionId", validateParams(questionParamsSchema), getQuestion);
questionsRouter.put(
  "/:questionId",
  validateParams(questionParamsSchema),
  validateBody(updateQuestionSchema),
  updateQuestion,
);

questionsRouter.post(
  "/:questionId/test-cases",
  validateParams(questionParamsSchema),
  validateBody(createTestCaseSchema),
  createTestCase,
);
questionsRouter.patch(
  "/:questionId/test-cases/:testCaseId",
  validateParams(testCaseParamsSchema),
  validateBody(updateTestCaseSchema),
  patchTestCase,
);
questionsRouter.delete(
  "/:questionId/test-cases/:testCaseId",
  validateParams(testCaseParamsSchema),
  deleteTestCase,
);

questionsRouter.get("/:questionId/rubric", validateParams(questionParamsSchema), getRubric);
questionsRouter.put(
  "/:questionId/rubric/criteria",
  validateParams(questionParamsSchema),
  validateBody(saveRubricSchema),
  putRubric,
);
