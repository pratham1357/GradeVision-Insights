import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { MAX_REQUEST_ID_LENGTH } from "../config/index.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation
  namespace Express {
    interface Request {
      /** Correlation id for this request; echoed in the `X-Request-Id` header. */
      id: string;
    }
  }
}

const HEADER = "x-request-id";

/** Assigns a correlation id, honouring a sane inbound `X-Request-Id` if present. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADER);
  req.id =
    inbound && inbound.length > 0 && inbound.length <= MAX_REQUEST_ID_LENGTH
      ? inbound
      : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}
