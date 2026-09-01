import { Prisma } from "@gradevision/database";
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

  // Safety net for Prisma errors a service did not translate itself.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return new ApiError(404, "NOT_FOUND", "Resource not found");
    if (err.code === "P2002") return new ApiError(409, "CONFLICT", "That resource already exists");
    if (err.code === "P2003") {
      return new ApiError(409, "CONFLICT", "Operation violates a data constraint");
    }
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
