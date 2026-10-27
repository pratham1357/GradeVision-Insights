import type { NextFunction, Request, Response } from "express";

/**
 * Baseline response headers for a JSON-only API (a minimal, dependency-free
 * subset of what Helmet sets). Responses are never rendered as HTML, never
 * framed, never cached by shared caches, and leak no referrer.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");
  next();
}
