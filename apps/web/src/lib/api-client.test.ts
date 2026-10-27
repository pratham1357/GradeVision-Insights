import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest, onUnauthorized } from "./api-client";
import { sessionStore } from "./session-store";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStore.clear();
});

const respond = (status: number, body: unknown) => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("apiRequest error handling", () => {
  it("maps a failed fetch (offline) to a friendly network error, not a raw TypeError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(apiRequest("/x")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 0,
      code: "NETWORK",
    });
    await expect(apiRequest("/x")).rejects.toThrow(/connection/i);
  });

  it("marks 5xx service errors as retryable without leaking internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "PROVIDER_ERROR", message: "unavailable" } }),
            {
              status: 503,
            },
          ),
        ),
      ),
    );
    const err = (await apiRequest("/x").catch((e) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(503);
  });

  it("still throws with the status when the error body is missing / not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>oops</html>", { status: 500 }))),
    );
    const err = (await apiRequest("/x").catch((e) => e)) as ApiClientError;
    expect(err.status).toBe(500);
    expect(err.message).not.toContain("html");
  });

  it("unwraps the { data } envelope on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 })),
      ),
    );
    await expect(apiRequest<{ ok: number }>("/x")).resolves.toEqual({ ok: 1 });
  });

  it("always sends the session cookie and never an Authorization header", async () => {
    const fetchMock = respond(200, { data: { ok: 1 } });
    await apiRequest("/student/assessments");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("adds the CSRF token to state-changing requests only", async () => {
    sessionStore.setCsrfToken("csrf-123");
    const fetchMock = respond(200, { data: {} });
    await apiRequest("/x", { method: "POST", body: "{}" });
    await apiRequest("/x");
    const [[, post], [, get]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(new Headers(post!.headers).get("X-CSRF-Token")).toBe("csrf-123");
    expect(new Headers(get!.headers).has("X-CSRF-Token")).toBe(false);
  });

  it("treats a 204 No Content as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("ends the session once on a 401 and forgets the CSRF token", async () => {
    sessionStore.setCsrfToken("csrf-123");
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    respond(401, { error: { code: "UNAUTHORIZED", message: "Your session has ended" } });
    const err = (await apiRequest("/student/assessments").catch((e) => e)) as ApiClientError;
    expect(err.status).toBe(401);
    expect(listener).toHaveBeenCalledOnce();
    expect(sessionStore.getCsrfToken()).toBeNull();
    unsubscribe();
  });

  it("does not end the session on a 403 (wrong role) or a 404", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    respond(403, { error: { code: "FORBIDDEN", message: "nope" } });
    await apiRequest("/assessments").catch(() => undefined);
    respond(404, { error: { code: "NOT_FOUND", message: "nope" } });
    await apiRequest("/assessments/x").catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not treat a failed sign-in or the anonymous session probe as an ended session", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    respond(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });
    await apiRequest("/auth/login", { method: "POST", body: "{}" }).catch(() => undefined);
    respond(401, { error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    await apiRequest("/auth/session").catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
