import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHintEngineServer, MAX_BODY_BYTES, type HintEngineOptions } from "./app.js";
import type { HintRequest, LLMProvider } from "./provider.js";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly model = "fake-model:1b";
  constructor(
    private readonly configured: boolean,
    private readonly reply:
      string | Error = "Consider which lookup structure gives O(1) membership checks.",
  ) {}
  isConfigured() {
    return this.configured;
  }
  generateHint(_request: HintRequest): Promise<string> {
    void _request;
    return this.reply instanceof Error ? Promise.reject(this.reply) : Promise.resolve(this.reply);
  }
}

function startServer(provider: LLMProvider, options: HintEngineOptions = { internalToken: null }) {
  const server = createHintEngineServer(provider, options);
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const body: HintRequest = {
  stageNumber: 1,
  language: "PYTHON",
  questionTitle: "Two Sum",
  questionStatement: "add up to target",
  studentCode: null,
  previousHints: [],
  evidence: null,
};

describe("hint-engine HTTP", () => {
  describe("configured provider", () => {
    let srv: Awaited<ReturnType<typeof startServer>>;
    beforeAll(async () => {
      srv = await startServer(new FakeProvider(true));
    });
    afterAll(() => srv.close());

    it("health reports the provider status", async () => {
      const res = await fetch(`${srv.url}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { provider: { configured: boolean } };
      expect(json.provider.configured).toBe(true);
    });

    it("returns a hint for a valid request", async () => {
      const res = await fetch(`${srv.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        data: { hint: string; provider: string; model: string; validator: string };
      };
      expect(json.data.hint).toContain("O(1)");
      // Provenance travels with the hint so the API can persist it.
      expect(json.data).toMatchObject({
        provider: "fake",
        model: "fake-model:1b",
        validator: "hint-output-v1",
      });
    });

    it("rejects an oversized body with 413", async () => {
      const res = await fetch(`${srv.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, studentCode: "x".repeat(MAX_BODY_BYTES + 10) }),
      });
      expect(res.status).toBe(413);
    });

    it("never delivers a reply that fails output validation", async () => {
      const leaky = await startServer(
        new FakeProvider(true, "Here you go:\n```python\ndef two_sum(nums, t):\n    pass\n```"),
      );
      const res = await fetch(`${leaky.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toContain("INVALID_OUTPUT");
      expect(text).not.toContain("two_sum");
      await leaky.close();
    });

    it("rejects an invalid body with 400", async () => {
      const res = await fetch(`${srv.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "PYTHON" }),
      });
      expect(res.status).toBe(400);
    });

    it("maps a provider failure to 502 without leaking details", async () => {
      const failing = await startServer(
        new FakeProvider(true, new Error("gemini 429 quota exceeded")),
      );
      const res = await fetch(`${failing.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("quota");
      await failing.close();
    });
  });

  describe("internal service token", () => {
    const TOKEN = "t".repeat(40);
    let srv: Awaited<ReturnType<typeof startServer>>;
    beforeAll(async () => {
      srv = await startServer(new FakeProvider(true), { internalToken: TOKEN });
    });
    afterAll(() => srv.close());

    const post = (authorization?: string) =>
      fetch(`${srv.url}/hints`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      });

    it("rejects a request without the bearer", async () => {
      expect((await post()).status).toBe(401);
    });

    it("rejects a wrong or truncated bearer", async () => {
      expect((await post(`Bearer ${"u".repeat(40)}`)).status).toBe(401);
      expect((await post(`Bearer ${TOKEN.slice(1)}`)).status).toBe(401);
      expect((await post(TOKEN)).status).toBe(401);
    });

    it("accepts the configured bearer", async () => {
      expect((await post(`Bearer ${TOKEN}`)).status).toBe(200);
    });

    it("keeps /health open (it carries no secrets)", async () => {
      expect((await fetch(`${srv.url}/health`)).status).toBe(200);
    });
  });

  describe("unconfigured provider", () => {
    let srv: Awaited<ReturnType<typeof startServer>>;
    beforeAll(async () => {
      srv = await startServer(new FakeProvider(false));
    });
    afterAll(() => srv.close());

    it("returns a clear 503 configuration error, never a fake hint", async () => {
      const res = await fetch(`${srv.url}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("PROVIDER_NOT_CONFIGURED");
    });
  });
});
