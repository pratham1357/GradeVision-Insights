import type { NextFunction, Request, Response } from "express";
import type { ApiErrorBody } from "@gradevision/shared";
import { z, ZodError } from "zod";

import { ApiError } from "../utils/api-error.js";
import { logger } from "../utils/logger.js";

/** Terminal 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: "NOT_FOUND",
      message: `Cannot ${req.method} ${req.path}`,
    },
  };
  res.status(404).json(body);
}

function normalize(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ApiError(400, "VALIDATION_ERROR", "Request validation failed", z.flattenError(err));
  }

  // express.json() rejects malformed bodies with a SyntaxError carrying `status`.
  if (err instanceof SyntaxError && "status" in err) {
    return new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  return ApiError.internal();
}

/** Centralised error handler. Never leaks stack traces or internals to clients. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const apiError = normalize(err);

  if (apiError.status >= 500) {
    logger.error(apiError.message, {
      requestId: req.id,
      code: apiError.code,
      stack: err instanceof Error ? err.stack : String(err),
    });
  } else {
    logger.warn(`${apiError.code}: ${apiError.message}`, { requestId: req.id });
  }

  const body: ApiErrorBody = {
    error: { code: apiError.code, message: apiError.message },
  };

  // Structured context is only ever attached to client (4xx) errors.
  if (apiError.status < 500 && apiError.details !== undefined) {
    body.error.details = apiError.details;
  }

  res.status(apiError.status).json(body);
}
