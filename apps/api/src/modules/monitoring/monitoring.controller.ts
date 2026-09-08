import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { sendData } from "../../utils/http.js";
import { getInstructorStudentMonitor, getSystemMetrics } from "./monitoring.service.js";

/** `GET /api/v1/monitoring/students` - the instructor's real student roster. */
export async function getStudentMonitorView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorStudentMonitor(userId));
}

/** `GET /api/v1/monitoring/system` - API-process runtime metrics (instructor only). */
export async function getSystemMetricsView(_req: Request, res: Response): Promise<void> {
  sendData(res, await getSystemMetrics());
}
