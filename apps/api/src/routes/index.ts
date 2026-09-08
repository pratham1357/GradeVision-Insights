import { Router } from "express";

import { assessmentsRouter } from "../modules/assessments/assessments.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { coursesRouter } from "../modules/courses/courses.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";
import { monitoringRouter } from "../modules/monitoring/monitoring.routes.js";
import { questionsRouter } from "../modules/questions/questions.routes.js";
import { studentRouter } from "../modules/student/student.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";

/**
 * Central API router, mounted at `API_PREFIX` (`/api/v1`).
 *
 * Domain routers are registered here so the surface is visible in one place.
 * `courses` / `assessments` / `questions` are instructor-facing authoring;
 * `student` is the student assessment-taking workflow. `users` is still a
 * boundary. Deferred: /evaluations, /proctoring, /hints.
 */
export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/courses", coursesRouter);
apiRouter.use("/assessments", assessmentsRouter);
apiRouter.use("/questions", questionsRouter);
apiRouter.use("/monitoring", monitoringRouter);
apiRouter.use("/student", studentRouter);
