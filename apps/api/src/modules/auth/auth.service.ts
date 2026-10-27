import type { AuthUser, AuthenticatedAccount } from "@gradevision/shared";
import type { User } from "@gradevision/database";

import { ApiError } from "../../utils/api-error.js";
import { findUserByEmail, findUserById } from "./auth.repository.js";
import { verifyPassword } from "./password.js";
import type { LoginInput } from "./auth.schema.js";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "./login-throttle.js";
import { createSession } from "./sessions.js";

/**
 * A real Argon2id hash (of a throwaway random string). When the email is unknown
 * we still run a full verify against this so response timing does not reveal
 * whether an account exists.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$EaocBn3lKy+TBcXL6LX7yg$Zd83Nx7VQ/azF6gb5/IFQOlE1pd7DEgxyUDLg8fvmbA";

function toAuthUser(user: User): AuthUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function toAccount(user: User): AuthenticatedAccount {
  return { ...toAuthUser(user), isActive: user.isActive };
}

export interface LoginOutput {
  user: AuthUser;
  /** Opaque session token - goes into the HttpOnly cookie (or a token-mode response). */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Verifies credentials and opens a new server-side session.
 *
 * A single generic error is returned whether the email is unknown, the password
 * is wrong, or the account is inactive - no account enumeration.
 */
export async function login(
  input: LoginInput,
  source = "unknown",
  userAgent: string | null = null,
): Promise<LoginOutput> {
  assertLoginAllowed(input.email, source);
  const user = await findUserByEmail(input.email);

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches || !user.isActive) {
    recordLoginFailure(input.email, source);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  clearLoginFailures(input.email, source);

  // A fresh session on every sign-in (the caller revokes any session the
  // request already carried - no session fixation).
  const session = await createSession(user.id, userAgent);
  return {
    user: toAuthUser(user),
    token: session.token,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
}

/**
 * Resolves the current account for an authenticated request. Re-checks the
 * database on every call so a deleted or deactivated user is rejected even while
 * holding an unexpired token.
 */
export async function getCurrentAccount(userId: string): Promise<AuthenticatedAccount> {
  const user = await findUserById(userId);

  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }
  if (!user.isActive) {
    throw new ApiError(401, "ACCOUNT_INACTIVE", "Your account is not active");
  }

  return toAccount(user);
}
