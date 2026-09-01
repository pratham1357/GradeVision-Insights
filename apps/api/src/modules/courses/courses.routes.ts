import { Router } from "express";

import { requireRole, validateParams } from "../../middleware/index.js";
import { getSection, listCourses } from "./courses.controller.js";
import { sectionParamsSchema } from "./courses.schema.js";

/**
 * Courses / sections (instructor-facing).
 *
 * Every endpoint here is instructor-only for now. When student-facing course
 * endpoints arrive they get their own sub-router rather than relaxing this guard.
 */
export const coursesRouter: Router = Router();

coursesRouter.use(...requireRole("INSTRUCTOR"));

coursesRouter.get("/", listCourses);
coursesRouter.get("/sections/:sectionId", validateParams(sectionParamsSchema), getSection);
