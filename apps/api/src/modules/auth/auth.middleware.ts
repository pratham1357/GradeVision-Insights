import type { UserRole } from "@gradevision/database";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { env } from "../../env.js";
import { ApiError } from "../../utils/api-error.js";
import type { AuthContext } from "./auth.types.js";
import { csrfTokenMatches, resolveSession, SESSION_COOKIE } from "./sessions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation
  namespace Express {
    interface Request {
      /** Present only after `authenticate` has run successfully. */
      auth?: AuthContext;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Minimal cookie-header parser (no dependency); returns the named cookie's value. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * A state-changing request authenticated by the browser cookie must come from
 * an allowed origin. Browsers always send `Origin` on such fetches; absence
 * means a non-browser caller, which must use the bearer form instead.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.header("origin");
  if (origin) return env.CORS_ORIGINS.includes(origin);
  const referer = req.header("referer");
  if (referer && URL.canParse(referer)) return env.CORS_ORIGINS.includes(new URL(referer).origin);
  return false;
}

/**
 * Authentication: resolves the server-side session (cookie or bearer) and the
 * user's CURRENT role and status from the database. Cookie-authenticated
 * state-changing requests also need an allowed Origin and the CSRF token.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookie = readCookie(req, SESSION_COOKIE);
    const bearer = bearerToken(req);
    const token = bearer ?? cookie;
    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    }
    const session = await resolveSession(token);
    if (!session) {
      if (!bearer && cookie) clearSessionCookie(res);
      throw new ApiError(401, "UNAUTHORIZED", "Your session has ended. Please sign in again.");
    }
    const via = bearer ? "bearer" : "cookie";
    if (via === "cookie" && !SAFE_METHODS.has(req.method)) {
      if (!originAllowed(req) || !csrfTokenMatches(session.sessionId, req.header("x-csrf-token"))) {
        throw new ApiError(
          403,
          "CSRF_FAILED",
          "The request could not be verified. Reload the page.",
        );
      }
    }
    req.auth = { userId: session.userId, role: session.role, sessionId: session.sessionId, via };
    next();
  } catch (error) {
    next(
      error instanceof ApiError
        ? error
        : new ApiError(401, "UNAUTHORIZED", "Authentication required"),
    );
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAMESITE,
    path: "/",
  } as const;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

/** Guard: request must be authenticated. */
export function requireAuth(): RequestHandler[] {
  return [authenticate];
}

/**
 * Authorization: request must be authenticated AND hold one of `roles`.
 * Returns the middleware chain so routes can spread it.
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
