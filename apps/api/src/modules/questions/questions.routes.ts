import { Router } from "express";

/**
 * Questions module boundary (questions, test cases, rubric criteria).
 *
 * Layering mirrors `modules/health`:
 *   questions.routes -> questions.controller -> questions.service
 *   -> questions.repository
 * Validation via a Zod schema + `validateBody`; data access via
 * `@gradevision/database` only.
 *
 * No routes yet - question CRUD is deferred. Note: hidden test cases and
 * expected outputs must never be exposed to students once endpoints exist.
 */
export const questionsRouter: Router = Router();
