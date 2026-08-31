import { Router } from "express";

import { assessmentsRouter } from "../modules/assessments/assessments.routes.js";
import { coursesRouter } from "../modules/courses/courses.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";
import { questionsRouter } from "../modules/questions/questions.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";

/**
 * Central API router, mounted at `API_PREFIX` (`/api/v1`).
 *
 * Domain routers are registered here so the surface is visible in one place.
 * Only `health` is implemented; the rest are empty module boundaries.
 * Planned but deferred: /auth, /exams, /submissions, /evaluations, /proctoring,
 * /hints.
 */
export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/courses", coursesRouter);
apiRouter.use("/assessments", assessmentsRouter);
apiRouter.use("/questions", questionsRouter);
