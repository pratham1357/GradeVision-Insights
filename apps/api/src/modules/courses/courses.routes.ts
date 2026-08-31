import { Router } from "express";

/**
 * Courses module boundary (courses, sections, enrollment).
 *
 * Layering mirrors `modules/health`:
 *   courses.routes -> courses.controller -> courses.service -> courses.repository
 * Validation via a Zod schema + `validateBody`; data access via
 * `@gradevision/database` only.
 *
 * No routes yet - course CRUD is deferred.
 */
export const coursesRouter: Router = Router();
