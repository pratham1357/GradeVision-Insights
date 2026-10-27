import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { pathParam, sendData } from "../../utils/http.js";
import type {
  CreateHintStageInput,
  CreateQuestionInput,
  CreateTestCaseInput,
  SaveRubricInput,
  UpdateHintStageInput,
  UpdateTestCaseInput,
} from "./questions.schema.js";
import {
  addHintStage,
  addTestCase,
  createInstructorQuestion,
  editHintStage,
  editTestCase,
  getInstructorHintStages,
  getInstructorQuestion,
  getInstructorQuestions,
  getInstructorRubric,
  removeHintStage,
  removeTestCase,
  saveInstructorRubric,
  updateInstructorQuestion,
} from "./questions.service.js";

export async function listQuestions(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorQuestions(userId));
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorQuestion(pathParam(req, "questionId"), userId));
}

export async function createQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const created = await createInstructorQuestion(req.body as CreateQuestionInput, userId);
  sendData(res, created, 201);
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await updateInstructorQuestion(
    pathParam(req, "questionId"),
    req.body as CreateQuestionInput,
    userId,
  );
  sendData(res, updated);
}

export async function createTestCase(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await addTestCase(
    pathParam(req, "questionId"),
    req.body as CreateTestCaseInput,
    userId,
  );
  sendData(res, updated, 201);
}

export async function patchTestCase(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await editTestCase(
    pathParam(req, "questionId"),
    pathParam(req, "testCaseId"),
    req.body as UpdateTestCaseInput,
    userId,
  );
  sendData(res, updated);
}

export async function deleteTestCase(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const updated = await removeTestCase(
    pathParam(req, "questionId"),
    pathParam(req, "testCaseId"),
    userId,
  );
  sendData(res, updated);
}

export async function getRubric(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorRubric(pathParam(req, "questionId"), userId));
}

export async function putRubric(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const rubric = await saveInstructorRubric(
    pathParam(req, "questionId"),
    req.body as SaveRubricInput,
    userId,
  );
  sendData(res, rubric);
}

export async function getHintStages(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorHintStages(pathParam(req, "questionId"), userId));
}

export async function createHintStage(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const stages = await addHintStage(
    pathParam(req, "questionId"),
    req.body as CreateHintStageInput,
    userId,
  );
  sendData(res, stages, 201);
}

export async function patchHintStage(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const stages = await editHintStage(
    pathParam(req, "questionId"),
    pathParam(req, "stageId"),
    req.body as UpdateHintStageInput,
    userId,
  );
  sendData(res, stages);
}

export async function deleteHintStage(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const stages = await removeHintStage(
    pathParam(req, "questionId"),
    pathParam(req, "stageId"),
    userId,
  );
  sendData(res, stages);
}
