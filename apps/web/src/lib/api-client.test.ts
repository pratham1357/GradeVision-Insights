import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest } from "./api-client";

vi.mock("./auth-storage", () => ({
  tokenStorage: { get: () => "test-token", set: vi.fn(), clear: vi.fn() },
}));

afterEach(() => vi.unstubAllGlobals());

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
});
