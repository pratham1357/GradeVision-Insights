import { Router } from "express";

/**
 * Assessments module boundary.
 *
 * Layering mirrors `modules/health`:
 *   assessments.routes -> assessments.controller -> assessments.service
 *   -> assessments.repository
 * Validation via a Zod schema + `validateBody`; data access via
 * `@gradevision/database` only.
 *
 * No routes yet - assessment CRUD and exam-session logic are deferred.
 */
export const assessmentsRouter: Router = Router();
