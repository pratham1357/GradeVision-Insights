import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { pathParam, sendData } from "../../utils/http.js";
import type { SaveDraftInput, SubmitInput } from "./student.schema.js";
import {
  finishSession,
  getEligibleAssessments,
  getSession,
  saveDraft,
  startSession,
  submitCode,
} from "./student.service.js";

/** `GET /api/v1/student/assessments` - ACTIVE assessments the student may take. */
export async function listAvailableAssessments(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getEligibleAssessments(userId));
}

/** `POST /api/v1/student/assessments/:assessmentId/session` - start or resume. */
export async function startExamSession(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const view = await startSession(pathParam(req, "assessmentId"), userId);
  sendData(res, view, 201);
}

/** `GET /api/v1/student/sessions/:sessionId` - full exam view (server-authoritative timing). */
export async function getExamSession(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getSession(pathParam(req, "sessionId"), userId));
}

/** `POST /api/v1/student/sessions/:sessionId/finish` - end the whole attempt. */
export async function finishExamSession(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await finishSession(pathParam(req, "sessionId"), userId));
}

/** `PUT /api/v1/student/sessions/:sessionId/questions/:questionId/draft` - save/autosave. */
export async function saveQuestionDraft(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const result = await saveDraft(
    pathParam(req, "sessionId"),
    pathParam(req, "questionId"),
    req.body as SaveDraftInput,
    userId,
  );
  sendData(res, result);
}

/** `POST /api/v1/student/sessions/:sessionId/questions/:questionId/submissions` - submit code. */
export async function submitQuestion(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const result = await submitCode(
    pathParam(req, "sessionId"),
    pathParam(req, "questionId"),
    req.body as SubmitInput,
    userId,
  );
  sendData(res, result, 201);
}
