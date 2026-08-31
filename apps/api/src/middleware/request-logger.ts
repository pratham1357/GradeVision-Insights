import type { NextFunction, Request, Response } from "express";

import { logger } from "../utils/logger.js";

/** Logs one line per completed request. Dev-friendly; structured in production. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();

  res.on("finish", () => {
    const durationMs = Math.round(performance.now() - start);
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`, {
      requestId: req.id,
    });
  });

  next();
}
