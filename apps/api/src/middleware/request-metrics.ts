import type { NextFunction, Request, Response } from "express";

import { requestMetrics } from "../services/request-metrics.js";

/**
 * Feeds the in-memory request counters used by the instructor system-metrics
 * endpoint. Mirrors `requestLogger`'s timing (a `performance.now()` delta closed
 * on `res` finish/close) and adds the in-flight / total counters. Registered
 * once, early in the middleware chain, so it covers every route.
 */
export function requestMetricsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  requestMetrics.onRequestStart();

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    requestMetrics.onRequestEnd(performance.now() - start);
  };

  res.on("finish", settle);
  res.on("close", settle);

  next();
}
