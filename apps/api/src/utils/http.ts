import type { Response } from "express";
import type { ApiSuccess } from "@gradevision/shared";

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
