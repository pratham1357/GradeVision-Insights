import { Router } from "express";

/**
 * Users module boundary.
 *
 * Follows the same layering as `modules/health`:
 *   users.routes -> users.controller -> users.service -> users.repository
 * with request payloads validated by a Zod schema (`users.schema.ts`) via
 * `validateBody`. Data access goes through `@gradevision/database`; Prisma is
 * never called from a route handler, and Prisma models are not re-declared here.
 *
 * No routes yet - user CRUD and auth are deferred to later tasks.
 */
export const usersRouter: Router = Router();
