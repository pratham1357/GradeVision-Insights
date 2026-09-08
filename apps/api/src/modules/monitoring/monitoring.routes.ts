import { Router } from "express";

import { requireRole } from "../../middleware/index.js";
import { getStudentMonitorView, getSystemMetricsView } from "./monitoring.controller.js";

/**
 * Instructor monitoring (instructor-only).
 *
 *   GET /monitoring/students  - real student roster + activity, scoped to the
 *                               sections the instructor teaches (no IDOR: no ids
 *                               in the request, everything derives from req.auth).
 *   GET /monitoring/system    - API-process runtime metrics. Operational counters
 *                               only: no env vars, secrets, paths, or stack traces.
 *
 * ADMIN is allowed alongside INSTRUCTOR; students get 403, anonymous 401.
 */
export const monitoringRouter: Router = Router();

monitoringRouter.use(...requireRole("INSTRUCTOR", "ADMIN"));

monitoringRouter.get("/students", getStudentMonitorView);
monitoringRouter.get("/system", getSystemMetricsView);
