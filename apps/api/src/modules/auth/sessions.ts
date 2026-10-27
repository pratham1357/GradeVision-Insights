/**
 * Server-side sessions (backend-for-frontend).
 *
 * - The client receives an opaque 256-bit random token: in an HttpOnly cookie
 *   for browsers, or (non-browser clients, when enabled) in the login response.
 *   Only its SHA-256 hash is stored, so a database leak yields no usable session.
 * - Every request re-reads the session and the user: revocation, deactivation
 *   and role changes take effect on the next request (no stale role claims).
 * - Idle timeout from `lastSeenAt`, absolute lifetime from `expiresAt`.
 * - CSRF tokens are HMAC(secret, session id): bound to the session, never
 *   stored, recomputable for `GET /auth/session` after a page reload.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";

import type { UserRole } from "@gradevision/database";

import { env } from "../../env.js";
import {
  findSessionByHash,
  findSessionById,
  insertSession,
  pruneUserSessions,
  revokeSessionRow,
  revokeUserSessionRows,
  touchSession,
} from "./sessions.repository.js";

export const SESSION_COOKIE = env.SESSION_COOKIE_SECURE ? "__Host-gv_session" : "gv_session";
/** Write `lastSeenAt` at most this often per session (an exam autosaves often). */
const TOUCH_INTERVAL_MS = 60_000;

/** Emitted after sessions are revoked, so live sockets can be disconnected. */
export const sessionEvents = new EventEmitter();
export interface SessionsRevokedEvent {
  sessionIds: string[];
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  user: { id: string; email: string; name: string; role: UserRole };
}

export async function createSession(
  userId: string,
  userAgent: string | null = null,
): Promise<{ token: string; sessionId: string; expiresAt: Date; csrfToken: string }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const row = await insertSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + env.SESSION_ABSOLUTE_MS),
    userAgent: userAgent ? userAgent.slice(0, 200) : null,
  });
  await pruneUserSessions(userId, new Date(now - 86_400_000));
  return { token, sessionId: row.id, expiresAt: row.expiresAt, csrfToken: csrfTokenFor(row.id) };
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSessionByHash>>>;

function toActive(row: SessionRow | null, now: number): ActiveSession | null {
  if (!row || row.revokedAt) return null;
  if (row.expiresAt.getTime() <= now) return null;
  if (row.lastSeenAt.getTime() + env.SESSION_IDLE_MS <= now) return null;
  if (!row.user.isActive) return null;
  return {
    sessionId: row.id,
    userId: row.user.id,
    role: row.user.role,
    user: { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role },
  };
}

/** Resolves a presented token to a live session for an active user, or null. */
export async function resolveSession(token: string): Promise<ActiveSession | null> {
  if (token.length < 20 || token.length > 200) return null;
  const now = Date.now();
  const row = await findSessionByHash(hashToken(token));
  const active = toActive(row, now);
  if (active && row && now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await touchSession(row.id, new Date(now));
  }
  return active;
}

/** Re-checks an already-resolved session (used by long-lived sockets). */
export async function recheckSession(sessionId: string): Promise<ActiveSession | null> {
  return toActive(await findSessionById(sessionId), Date.now());
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await revokeSessionRow(sessionId, reason);
  sessionEvents.emit("revoked", { sessionIds: [sessionId] } satisfies SessionsRevokedEvent);
}

/** Ends every session of a user (deactivation, role change, password change). */
export async function revokeUserSessions(userId: string, reason: string): Promise<number> {
  const ids = await revokeUserSessionRows(userId, reason);
  if (ids.length > 0) {
    sessionEvents.emit("revoked", { sessionIds: ids } satisfies SessionsRevokedEvent);
  }
  return ids.length;
}

export function csrfTokenFor(sessionId: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`csrf:${sessionId}`).digest("base64url");
}

export function csrfTokenMatches(sessionId: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * For tests and local scripts: a real session (same validation path as a
 * browser login). `expectRole` guards a test against assuming a role the user
 * does not have - the role always comes from the database.
 */
export async function issueSessionToken(userId: string, expectRole?: UserRole): Promise<string> {
  const { token } = await createSession(userId, "test");
  if (expectRole) {
    const session = await resolveSession(token);
    if (session?.role !== expectRole) {
      throw new Error(
        `issueSessionToken: user ${userId} is ${session?.role ?? "unknown"}, not ${expectRole}`,
      );
    }
  }
  return token;
}
