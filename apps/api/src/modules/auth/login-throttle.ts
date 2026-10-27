import { ApiError } from "../../utils/api-error.js";

/**
 * Failed-login throttle: at most `MAX_FAILURES` wrong passwords per
 * (email, client address) in a fixed window. Keyed on both so one source cannot
 * keep guessing an account, while a different source cannot lock a student out
 * of their exam. A successful login clears the counter. In-memory (single API
 * process), which matches the current deployment shape.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES = 10;
const MAX_TRACKED_KEYS = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

const failures = new Map<string, Entry>();

const keyOf = (email: string, source: string) => `${email.trim().toLowerCase()}|${source}`;

function prune(now: number): void {
  if (failures.size < MAX_TRACKED_KEYS) return;
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
}

export function assertLoginAllowed(email: string, source: string, now = Date.now()): void {
  const entry = failures.get(keyOf(email, source));
  if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    throw new ApiError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
}

export function recordLoginFailure(email: string, source: string, now = Date.now()): void {
  prune(now);
  const key = keyOf(email, source);
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(email: string, source: string): void {
  failures.delete(keyOf(email, source));
}

/** Test helper. */
export function resetLoginThrottle(): void {
  failures.clear();
}
