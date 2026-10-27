import type { UserRole as PrismaUserRole } from "@gradevision/database";
import type { UserRole as SharedUserRole } from "@gradevision/shared";

/** Verified identity for the current request. Sourced ONLY from a valid JWT. */
export interface AuthContext {
  userId: string;
  /** Read from the database on every request - never from a client-held claim. */
  role: PrismaUserRole;
  sessionId: string;
  /** How the session was presented: browser cookie (CSRF-checked) or bearer header. */
  via: "cookie" | "bearer";
}

// Compile-time guarantee that the Prisma role enum and the shared role union
// stay identical. If they drift, this stops compiling.
type Extends<A, B> = [A] extends [B] ? true : never;
type RolesInSync = Extends<PrismaUserRole, SharedUserRole> &
  Extends<SharedUserRole, PrismaUserRole>;
const _rolesInSync: RolesInSync = true;
void _rolesInSync;
