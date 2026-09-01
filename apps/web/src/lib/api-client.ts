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
}

/**
 * Minimal API client: prefixes `/api/v1`, attaches the bearer token, unwraps the
 * `{ data }` / `{ error }` envelope. Kept tiny on purpose - swap the auth header
 * for cookie credentials here when the backend moves to httpOnly cookies.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return (payload as { data: T }).data;
}
