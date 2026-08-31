import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

import { ApiError } from "../utils/api-error.js";

/**
 * Validate and coerce `req.body` against a Zod schema at the API boundary.
 *
 * This is the single validation entry point for request payloads. Extend with
 * query/params support when the first endpoint needs it - note that Express 5
 * makes `req.query` read-only, so parsed query values must go on `res.locals`.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(ApiError.badRequest("Request body validation failed", result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}
