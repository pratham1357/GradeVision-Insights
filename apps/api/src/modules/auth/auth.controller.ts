import type { LoginResult, SessionInfo } from "@gradevision/shared";
import type { Request, Response } from "express";

import { env } from "../../env.js";
import { ApiError } from "../../utils/api-error.js";
import { sendData } from "../../utils/http.js";
import {
  clearSessionCookie,
  getAuthContext,
  originAllowed,
  readCookie,
  sessionCookieOptions,
} from "./auth.middleware.js";
import type { LoginInput } from "./auth.schema.js";
import { getCurrentAccount, login } from "./auth.service.js";
import { csrfTokenFor, resolveSession, revokeSession, SESSION_COOKIE } from "./sessions.js";

/** `POST /api/v1/auth/login` - body already validated by `loginSchema`. */
export async function postLogin(req: Request, res: Response): Promise<void> {
  if (!env.PASSWORD_LOGIN_ENABLED) {
    throw new ApiError(404, "NOT_FOUND", "Password sign-in is not available");
  }
  const input = req.body as LoginInput;
  // Login CSRF: a browser request from a foreign origin may not sign anyone in.
  if (req.header("origin") && !originAllowed(req)) {
    throw new ApiError(403, "CSRF_FAILED", "The request could not be verified.");
  }
  if (input.mode === "token" && !env.AUTH_TOKEN_LOGIN) {
    throw new ApiError(400, "TOKEN_LOGIN_DISABLED", "Token sign-in is not enabled");
  }

  // The socket address (no proxy headers are trusted) - a throttle key, never an authorization input.
  const result = await login(
    input,
    req.socket.remoteAddress ?? "unknown",
    req.header("user-agent") ?? null,
  );

  // Rotation: whatever session this browser carried before is ended.
  const previous = readCookie(req, SESSION_COOKIE);
  if (previous) {
    const old = await resolveSession(previous);
    if (old) await revokeSession(old.sessionId, "replaced_by_login");
  }

  const body: LoginResult = {
    user: result.user,
    csrfToken: result.csrfToken,
    expiresAt: result.expiresAt.toISOString(),
  };
  if (input.mode === "token") {
    body.accessToken = result.token;
  } else {
    res.cookie(SESSION_COOKIE, result.token, {
      ...sessionCookieOptions(),
      maxAge: result.expiresAt.getTime() - Date.now(),
    });
  }
  sendData(res, body);
}

/** `GET /api/v1/auth/me` - the current account (re-read from the database). */
export async function getMe(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const account = await getCurrentAccount(userId);
  sendData(res, account);
}

/** `GET /api/v1/auth/session` - current account plus the session's CSRF token (after a reload). */
export async function getSession(req: Request, res: Response): Promise<void> {
  const { userId, sessionId } = getAuthContext(req);
  const body: SessionInfo = {
    user: await getCurrentAccount(userId),
    csrfToken: csrfTokenFor(sessionId),
  };
  sendData(res, body);
}

/** `POST /api/v1/auth/logout` - ends this session server-side and clears the cookie. */
export async function postLogout(req: Request, res: Response): Promise<void> {
  const { sessionId } = getAuthContext(req);
  await revokeSession(sessionId, "logout");
  clearSessionCookie(res);
  res.status(204).end();
}
