import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

import { ApiError } from "../utils/api-error.js";

/**
 * Validate and coerce `req.body` against a Zod schema at the API boundary.
 * This is the single validation entry point for request payloads.
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

/**
 * Validate URL path parameters (typically UUIDs). Parsed values are written back
 * onto `req.params` in place. Express 5 makes `req.query` read-only, so parsed
 * query values would instead go on `res.locals` when that is first needed.
 */
export function validateParams<T extends Record<string, unknown>>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(ApiError.badRequest("Invalid URL parameters", result.error.issues));
      return;
    }
    Object.assign(req.params, result.data);
    next();
  };
}
