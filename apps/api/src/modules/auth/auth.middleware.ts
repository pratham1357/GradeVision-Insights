import type { UserRole } from "@gradevision/database";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { ApiError } from "../../utils/api-error.js";
import type { AuthContext } from "./auth.types.js";
import { verifyAccessToken } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation
  namespace Express {
    interface Request {
      /** Present only after `authenticate` has run successfully. */
      auth?: AuthContext;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authentication: verifies `Authorization: Bearer <jwt>` and attaches the
 * verified identity to `req.auth`. Rejects missing/malformed/invalid/expired
 * tokens with 401. Never trusts identity or role from the request body.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    }
    const claims = await verifyAccessToken(token);
    req.auth = { userId: claims.sub, role: claims.role };
    next();
  } catch (error) {
    next(
      error instanceof ApiError
        ? error
        : new ApiError(401, "UNAUTHORIZED", "Authentication required"),
    );
  }
}

/** Guard: request must be authenticated. */
export function requireAuth(): RequestHandler[] {
  return [authenticate];
}

/**
 * Authorization: request must be authenticated AND hold one of `roles`.
 * Authentication (401) and authorization (403) stay distinct.
 */
export function requireRole(...roles: UserRole[]): RequestHandler[] {
  const authorize: RequestHandler = (req, _res, next) => {
    if (!req.auth) {
      next(new ApiError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ApiError(403, "FORBIDDEN", "You do not have permission to access this resource"));
      return;
    }
    next();
  };
  return [authenticate, authorize];
}

/** Reads the verified identity in a controller; throws if `authenticate` was skipped. */
export function getAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.auth;
}
