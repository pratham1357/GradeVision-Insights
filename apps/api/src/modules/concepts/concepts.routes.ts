import { Router } from "express";

import { requireRole } from "../../middleware/index.js";
import { getConcepts } from "./concepts.controller.js";

/**
 * Programming concepts (instructor-facing vocabulary). Concepts are seeded /
 * instructor-authored labels attached to questions via the question endpoints
 * (`conceptIds` on create/update); this router only lists them. No student
 * endpoint: students never read or mutate concept metadata.
 */
export const conceptsRouter: Router = Router();

conceptsRouter.use(...requireRole("INSTRUCTOR"));

conceptsRouter.get("/", getConcepts);
