import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { pathParam, sendData } from "../../utils/http.js";
import type { RecordViolationInput } from "./integrity.schema.js";
import { getSessionViolations, recordViolation } from "./integrity.service.js";

/** `POST /api/v1/student/sessions/:sessionId/violations` (STUDENT). */
export async function recordSessionViolation(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const result = await recordViolation(
    pathParam(req, "sessionId"),
    userId,
    req.body as RecordViolationInput,
  );
  sendData(res, result, 201);
}

/** `GET /api/v1/assessments/:assessmentId/sessions/:sessionId/violations` (INSTRUCTOR). */
export async function getSessionViolationsView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const result = await getSessionViolations(
    pathParam(req, "assessmentId"),
    pathParam(req, "sessionId"),
    userId,
  );
  sendData(res, result);
}
