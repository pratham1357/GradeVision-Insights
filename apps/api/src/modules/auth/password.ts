import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing utility layer.
 *
 * Algorithm: Argon2id via `@node-rs/argon2` (prebuilt native bindings - no
 * compiler toolchain required on any platform, unlike the `argon2` package).
 * Parameters follow the OWASP Password Storage Cheat Sheet (2024):
 * 19 MiB memory, 2 iterations, 1 lane.
 */
const HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

/**
 * Verifies a password against an Argon2 hash. Parameters are read from the hash
 * string itself. Returns `false` (never throws) for a wrong password or a
 * malformed/legacy hash.
 */
export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}
