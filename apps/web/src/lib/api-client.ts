import { API_V1_PREFIX, type ApiErrorBody } from "@gradevision/shared";

import { sessionStore } from "./session-store";

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"}${API_V1_PREFIX}`;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }

  /** The request never reached the server (offline, DNS, CORS, timeout). */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const NETWORK_MESSAGE =
  "Can't reach the server right now. Check your connection - your work is kept locally and you can retry.";

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Called when a request comes back 401 because the session ended (expired,
 * revoked, signed out elsewhere, account deactivated). Returns an unsubscribe.
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Requests whose 401 means "not signed in", not "your session ended". */
const AUTH_PROBES = new Set(["/auth/login", "/auth/session"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Minimal API client: prefixes `/api/v1`, sends the HttpOnly session cookie
 * (`credentials: "include"`), adds the CSRF token to state-changing requests,
 * and unwraps the `{ data }` / `{ error }` envelope. A failed `fetch` (offline /
 * DNS / CORS) is normalised to a friendly `ApiClientError` with `status === 0`,
 * never a raw `TypeError`. Server error bodies are shown as-is.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  const csrf = sessionStore.getCsrfToken();
  if (!SAFE_METHODS.has(method) && csrf) headers.set("X-CSRF-Token", csrf);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiClientError(0, "NETWORK", NETWORK_MESSAGE);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    if (response.status === 401 && !AUTH_PROBES.has(path)) {
      // The session ended server-side: forget the CSRF token and tell the app once.
      sessionStore.clear();
      for (const listener of unauthorizedListeners) listener();
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new ApiClientError(
        response.status,
        error?.code ?? "SERVICE_UNAVAILABLE",
        error?.message ?? "That service is temporarily unavailable. Please try again shortly.",
      );
    }
    throw new ApiClientError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed (${response.status}).`,
    );
  }

  // 204 No Content (e.g. logout) has no envelope.
  return (payload as { data: T } | null)?.data as T;
}
