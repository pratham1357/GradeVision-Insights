/**
 * Authentication contract shared by the API and the web client.
 *
 * First-stage design: short-lived JWT access tokens only. Refresh tokens, SSO,
 * and registration are deliberately not modelled here yet.
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
}

/** `data` payload of a successful `POST /auth/login`. */
export interface LoginResult {
  accessToken: string;
  user: AuthUser;
}
