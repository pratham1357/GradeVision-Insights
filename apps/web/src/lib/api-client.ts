import { API_V1_PREFIX, type ApiErrorBody } from "@gradevision/shared";

import { tokenStorage } from "./auth-storage";

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

/**
 * Minimal API client: prefixes `/api/v1`, attaches the bearer token, unwraps the
 * `{ data }` / `{ error }` envelope. A failed `fetch` (offline / DNS / CORS) is
 * normalised to a friendly `ApiClientError` with `status === 0`, never a raw
 * `TypeError`. Server error bodies are shown as-is (the API never leaks internals).
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiClientError(0, "NETWORK", NETWORK_MESSAGE);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
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

  return (payload as { data: T }).data;
}
