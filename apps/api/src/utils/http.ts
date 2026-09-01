import type { Request, Response } from "express";
import type { ApiSuccess } from "@gradevision/shared";

import { ApiError } from "./api-error.js";

/**
 * Response conventions for feature endpoints:
 *   success -> `{ "data": ... }`   (see `sendData`)
 *   error   -> `{ "error": { "code", "message" } }`   (see the error handler)
 *
 * The health endpoint is deliberately exempt from the envelope so uptime probes
 * get a flat, conventional body.
 */
export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { data };
  res.status(status).json(body);
}

/**
 * Reads a required path parameter as a string. Routes that use this should also
 * run `validateParams` so a malformed value is a 400 before reaching here.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw ApiError.notFound();
  }
  return value;
}
