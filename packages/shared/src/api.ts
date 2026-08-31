/**
 * Cross-application HTTP/API contract shared by the web client and the API.
 * Keep this minimal - it is not a place to mirror the database schema.
 */

/** Canonical, versioned API base path. There is intentionally only one version. */
export const API_V1_PREFIX = "/api/v1";

/** Envelope for a successful response that carries a body. */
export interface ApiSuccess<T> {
  data: T;
}

/** Envelope for every non-2xx response. */
export interface ApiErrorBody {
  error: {
    /** Stable, machine-readable identifier, e.g. `VALIDATION_ERROR`. */
    code: string;
    /** Human-readable, safe to display. Never contains secrets or stack traces. */
    message: string;
    /** Optional structured context (e.g. field-level validation issues). */
    details?: unknown;
  };
}
