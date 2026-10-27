/**
 * Authentication contract shared by the API and the web client.
 *
 * Backend-for-frontend sessions: the browser holds an opaque session id in an
 * HttpOnly cookie (never readable by page scripts) and sends a session-bound
 * CSRF token on state-changing requests. No access token is ever stored in
 * browser storage.
 */

/**
 * User roles. Mirrors the Prisma `UserRole` enum, kept as a literal union so this
 * package stays dependency-free. The API asserts the two definitions stay in sync.
 */
export type UserRole = "STUDENT" | "INSTRUCTOR" | "ADMIN";

/** Safe, public user shape. Never contains `passwordHash`. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** `AuthUser` plus account status, returned by `GET /auth/me`. */
export interface AuthenticatedAccount extends AuthUser {
  isActive: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** `cookie` (default, browsers) or `token` (non-browser clients, when enabled). */
  mode?: "cookie" | "token";
}

/**
 * `data` payload of a successful `POST /auth/login`. Browsers get the session
 * in an HttpOnly cookie and only the CSRF token here; `accessToken` (the opaque
 * session token) is present only in `token` mode.
 */
export interface LoginResult {
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
  accessToken?: string;
}

/** `GET /auth/session` - the current session's user and its CSRF token. */
export interface SessionInfo {
  user: AuthenticatedAccount;
  csrfToken: string;
}
