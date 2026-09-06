import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { pathParam, sendData } from "../../utils/http.js";
import type {
  AttachQuestionInput,
  CreateAssessmentInput,
  ReorderQuestionsInput,
  UpdateAssessmentInput,
  UpdateAssessmentQuestionInput,
} from "./assessments.schema.js";
import {
  addAssessmentQuestion,
  createInstructorAssessment,
  editAssessmentQuestion,
  getAssessmentResults,
  getInstructorAssessment,
  getInstructorAssessments,
  removeAssessmentQuestion,
  reorderInstructorAssessmentQuestions,
  updateInstructorAssessment,
} from "./assessments.service.js";

export async function listAssessments(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorAssessments(userId));
}

export async function getAssessment(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorAssessment(pathParam(req, "assessmentId"), userId));
}

export async function createAssessment(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const created = await createInstructorAssessment(req.body as CreateAssessmentInput, userId);
  sendData(res, created, 201);
}

export async function updateAssessment(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await updateInstructorAssessment(
    pathParam(req, "assessmentId"),
    req.body as UpdateAssessmentInput,
    userId,
  );
  sendData(res, updated);
}

export async function getAssessmentResultsView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getAssessmentResults(pathParam(req, "assessmentId"), userId));
}

export async function attachAssessmentQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await addAssessmentQuestion(
    pathParam(req, "assessmentId"),
    req.body as AttachQuestionInput,
    userId,
  );
  sendData(res, updated, 201);
}

export async function patchAssessmentQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await editAssessmentQuestion(
    pathParam(req, "assessmentId"),
    pathParam(req, "questionId"),
    req.body as UpdateAssessmentQuestionInput,
    userId,
  );
  sendData(res, updated);
}

export async function deleteAssessmentQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await removeAssessmentQuestion(
    pathParam(req, "assessmentId"),
    pathParam(req, "questionId"),
    userId,
  );
  sendData(res, updated);
}

export async function reorderAssessmentQuestions(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await reorderInstructorAssessmentQuestions(
    pathParam(req, "assessmentId"),
    req.body as ReorderQuestionsInput,
    userId,
  );
  sendData(res, updated);
}
