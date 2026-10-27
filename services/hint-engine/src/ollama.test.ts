import { afterEach, describe, expect, it, vi } from "vitest";

import { isCloudModelTag, isLoopbackUrl } from "./env.js";
import { OLLAMA_NUM_PREDICT, OllamaProvider, type OllamaConfig } from "./ollama.js";
import type { HintRequest } from "./provider.js";

const config: OllamaConfig = {
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen2.5:1.5b-instruct",
  timeoutMs: 5_000,
  keepAlive: "30m",
  numCtx: 2_048,
};

const request: HintRequest = {
  stageNumber: 4,
  language: "PYTHON",
  questionTitle: "Two Sum",
  questionStatement: "Print the indices of two numbers that add up to target.",
  studentCode: "print(0, 0)",
  previousHints: ["Think about lookups."],
  evidence: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OllamaProvider", () => {
  it("reports its model for provenance", () => {
    const provider = new OllamaProvider(config);
    expect(provider.name).toBe("ollama");
    expect(provider.model).toBe("qwen2.5:1.5b-instruct");
    expect(provider.isConfigured()).toBe(true);
  });

  it("sends the shared system prompt and the built prompt to /api/chat, non-streaming", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: { content: "  Check your loop bounds.  " }, done: true }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const hint = await new OllamaProvider(config).generateHint(request);
    expect(hint).toBe("Check your loop bounds.");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const sent = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
      options: { num_predict: number; num_ctx: number };
    };
    expect(sent.model).toBe("qwen2.5:1.5b-instruct");
    expect(sent.stream).toBe(false);
    expect(sent.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(sent.messages[0]!.content).toContain(
      "Never provide a complete or near-complete solution",
    );
    expect(sent.messages[1]!.content).toContain("<<<STUDENT_CODE");
    expect(sent.options.num_predict).toBe(OLLAMA_NUM_PREDICT);
    expect(sent.options.num_ctx).toBe(2_048);
  });

  it("rejects on a non-2xx response instead of inventing a hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "model not found" }, 404)),
    );
    await expect(new OllamaProvider(config).generateHint(request)).rejects.toThrow(/404/);
  });

  it("rejects on an empty reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: { content: "" } })));
    await expect(new OllamaProvider(config).generateHint(request)).rejects.toThrow(/empty/);
  });

  it("propagates a timeout / connection failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    );
    await expect(new OllamaProvider(config).generateHint(request)).rejects.toThrow(/timed out/);
  });

  it("probe reports reachability and whether the model is pulled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: "qwen2.5:1.5b-instruct" }] })),
    );
    expect(await new OllamaProvider(config).probe()).toEqual({
      reachable: true,
      modelAvailable: true,
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await new OllamaProvider(config).probe()).toEqual({
      reachable: false,
      modelAvailable: false,
    });
  });
});

describe("isLoopbackUrl", () => {
  it("only accepts this machine", () => {
    expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackUrl("http://localhost:11434")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:11434")).toBe(true);
    expect(isLoopbackUrl("http://192.168.1.20:11434")).toBe(false);
    expect(isLoopbackUrl("http://0.0.0.0:11434")).toBe(false);
    expect(isLoopbackUrl("https://ollama.example.com")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("isCloudModelTag", () => {
  it("flags Ollama cloud-proxied tags and accepts local ones", () => {
    expect(isCloudModelTag("gpt-oss:120b-cloud")).toBe(true);
    expect(isCloudModelTag("qwen3-coder:480b-cloud")).toBe(true);
    expect(isCloudModelTag("some-model:cloud")).toBe(true);
    expect(isCloudModelTag("qwen2.5:1.5b-instruct")).toBe(false);
    expect(isCloudModelTag("llama3.2:1b")).toBe(false);
    expect(isCloudModelTag("cloudy-model:1b")).toBe(false);
  });
});
