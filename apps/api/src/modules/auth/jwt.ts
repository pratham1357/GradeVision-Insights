import { UserRole } from "@gradevision/database";
import { SignJWT, jwtVerify } from "jose";

import { env } from "../../env.js";
import { ApiError } from "../../utils/api-error.js";

/**
 * First-stage access-token implementation: symmetric HS256 JWTs.
 *
 * The payload carries only identity needed for authorization - `sub` (user id)
 * and `role`. No PII, no secrets, no mutable application state. Refresh tokens,
 * asymmetric keys, and SSO can be layered on later without changing callers.
 */
const ALG = "HS256";
const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenClaims {
  /** user id */
  sub: string;
  role: UserRole;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (Object.values(UserRole) as string[]).includes(value);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

/**
 * Verifies signature + expiry and extracts claims. Any failure (missing/expired/
 * tampered/malformed) throws a generic 401 `ApiError` - never a jose error.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (typeof payload.sub === "string" && isUserRole(payload.role)) {
      return { sub: payload.sub, role: payload.role };
    }
  } catch {
    // fall through to the generic error below
  }
  throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
}
