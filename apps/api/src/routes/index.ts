import { Router } from "express";

import { assessmentsRouter } from "../modules/assessments/assessments.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { coursesRouter } from "../modules/courses/courses.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";
import { questionsRouter } from "../modules/questions/questions.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";

/**
 * Central API router, mounted at `API_PREFIX` (`/api/v1`).
 *
 * Domain routers are registered here so the surface is visible in one place.
 * `health`, `auth`, `courses`, `assessments`, and `questions` are implemented
 * (the last three are instructor-facing for the assessment-authoring workflow).
 * `users` is still a boundary. Planned but deferred: /exams, /submissions,
 * /evaluations, /proctoring, /hints, and student-facing course/assessment access.
 */
export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/courses", coursesRouter);
apiRouter.use("/assessments", assessmentsRouter);
apiRouter.use("/questions", questionsRouter);
