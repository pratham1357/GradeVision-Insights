import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHintEngineServer } from "./app.js";
import type { HintRequest, LLMProvider } from "./provider.js";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
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

function startServer(provider: LLMProvider) {
  const server = createHintEngineServer(provider);
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
      const json = (await res.json()) as { data: { hint: string } };
      expect(json.data.hint).toContain("O(1)");
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
