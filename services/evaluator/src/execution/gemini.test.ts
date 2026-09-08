/**
 * Unit tests for the temporary Gemini execution-analysis fallback. `fetch` is
 * fully mocked - no network, no real model calls.
 */
import type { ExecutionRequest } from "@gradevision/grading";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logger.js";
import { GeminiExecutionProvider, type GeminiExecutionConfig } from "./gemini.js";

const CONFIG: GeminiExecutionConfig = {
  apiKey: "test-key",
  model: "gemini-2.0-flash",
  baseUrl: "https://example.test/v1beta",
  timeoutMs: 5_000,
};

const HIDDEN_INPUT = "HIDDEN_STDIN_9f3a";
const HIDDEN_EXPECTED = "HIDDEN_EXPECTED_9f3a";

const REQUEST: ExecutionRequest = {
  language: "PYTHON",
  sourceCode: "a,b=map(int,input().split())\nprint(a+b)",
  limits: { cpuTimeMs: 2_000, memoryMb: 256 },
  problem: { title: "Add Two", statement: "Print the sum of two integers." },
  cases: [
    { id: "case-visible", stdin: "2 3", expectedOutput: "5" },
    { id: "case-hidden", stdin: HIDDEN_INPUT, expectedOutput: HIDDEN_EXPECTED },
  ],
};

function geminiReply(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text }] } }] }),
    text: () => Promise.resolve("body"),
  } as unknown as Response;
}

function stubFetch(...replies: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const reply of replies) fn.mockResolvedValueOnce(reply);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function batch(cases: Record<string, unknown>[]): string {
  return JSON.stringify({ cases });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeminiExecutionProvider", () => {
  it("reports configured only when an API key is present", () => {
    expect(new GeminiExecutionProvider(CONFIG).isConfigured()).toBe(true);
    expect(new GeminiExecutionProvider({ ...CONFIG, apiKey: null }).isConfigured()).toBe(false);
  });

  it("converts a valid structured analysis into the internal ExecutionResult shape", async () => {
    stubFetch(
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "ACCEPTED",
            stdout: "5",
            stderr: "",
            time: 0.01,
            memory: 4096,
          },
          {
            caseId: "case-hidden",
            status: "WRONG_ANSWER",
            stdout: "oops",
            stderr: "",
            time: 0.02,
            memory: 4096,
          },
        ]),
      ),
    );

    const result = await new GeminiExecutionProvider(CONFIG).execute(REQUEST);

    expect(result.provider).toBe("gemini-execution");
    expect(result.cases).toHaveLength(2);
    // Both "ran to completion"; correctness is the grader's job, not the provider's.
    expect(result.cases[0]).toMatchObject({
      caseId: "case-visible",
      runStatus: "COMPLETED",
      stdout: "5",
      timeMs: 10,
      exitCode: 0,
    });
    expect(result.cases[1]).toMatchObject({
      caseId: "case-hidden",
      runStatus: "COMPLETED",
      stdout: "oops",
    });
  });

  it("maps every model status onto the mechanical run status vocabulary", async () => {
    const cases: Record<string, [string, string]> = {
      RUNTIME_ERROR: ["case-visible", "RUNTIME_ERROR"],
      TIME_LIMIT_EXCEEDED: ["case-visible", "TIMEOUT"],
    };
    for (const [modelStatus, [caseId, expected]] of Object.entries(cases)) {
      stubFetch(
        geminiReply(
          batch([
            { caseId, status: modelStatus, stdout: "", stderr: "boom", time: 0.1, memory: 2048 },
            {
              caseId: "case-hidden",
              status: "ACCEPTED",
              stdout: HIDDEN_EXPECTED,
              stderr: "",
              time: 0.1,
              memory: 2048,
            },
          ]),
        ),
      );
      const result = await new GeminiExecutionProvider(CONFIG).execute(REQUEST);
      expect(result.cases.map((c) => c.runStatus)[0]).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it("propagates a compilation failure to the remaining cases", async () => {
    stubFetch(
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "COMPILATION_ERROR",
            stdout: "",
            stderr: "SyntaxError: bad",
            time: 0,
            memory: 0,
          },
          {
            caseId: "case-hidden",
            status: "COMPILATION_ERROR",
            stdout: "",
            stderr: "SyntaxError: bad",
            time: 0,
            memory: 0,
          },
        ]),
      ),
    );
    const result = await new GeminiExecutionProvider(CONFIG).execute(REQUEST);
    expect(result.cases.map((c) => c.runStatus)).toEqual(["COMPILE_ERROR", "COMPILE_ERROR"]);
    expect(result.cases.map((c) => c.compileOutput)).toEqual([
      expect.stringContaining("SyntaxError"),
      "Skipped after a compilation failure.",
    ]);
  });

  it("strips code fences before parsing the JSON", async () => {
    stubFetch(
      geminiReply(
        "```json\n" +
          batch([
            {
              caseId: "case-visible",
              status: "ACCEPTED",
              stdout: "5",
              stderr: "",
              time: 0.01,
              memory: 1024,
            },
            {
              caseId: "case-hidden",
              status: "ACCEPTED",
              stdout: HIDDEN_EXPECTED,
              stderr: "",
              time: 0.01,
              memory: 1024,
            },
          ]) +
          "\n```",
      ),
    );
    const result = await new GeminiExecutionProvider(CONFIG).execute(REQUEST);
    expect(result.cases.map((c) => c.runStatus)[0]).toBe("COMPLETED");
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const fetchMock = stubFetch(
      geminiReply("not json at all"),
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "ACCEPTED",
            stdout: "5",
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
          {
            caseId: "case-hidden",
            status: "ACCEPTED",
            stdout: HIDDEN_EXPECTED,
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
        ]),
      ),
    );
    const result = await new GeminiExecutionProvider(CONFIG).execute(REQUEST);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.cases).toHaveLength(2);
  });

  it("throws a controlled error when the model stays malformed", async () => {
    stubFetch(geminiReply("garbage"), geminiReply("still garbage"));
    await expect(new GeminiExecutionProvider(CONFIG).execute(REQUEST)).rejects.toThrow(
      /could not complete/i,
    );
  });

  it("throws a controlled error when a case is missing from the analysis", async () => {
    stubFetch(
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "ACCEPTED",
            stdout: "5",
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
        ]),
      ),
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "ACCEPTED",
            stdout: "5",
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
        ]),
      ),
    );
    await expect(new GeminiExecutionProvider(CONFIG).execute(REQUEST)).rejects.toThrow(
      /could not complete/i,
    );
  });

  it("throws a provider-neutral error on an HTTP failure (no retry, no body leak)", async () => {
    const fetchMock = stubFetch(geminiReply("", false, 500));
    await expect(new GeminiExecutionProvider(CONFIG).execute(REQUEST)).rejects.toThrow(
      /temporarily unavailable/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a provider-neutral error when the request times out", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GeminiExecutionProvider(CONFIG).execute(REQUEST)).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });

  it("never writes hidden test input or expected output to the logs", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const infoSpy = vi.spyOn(logger, "info");
    const errorSpy = vi.spyOn(logger, "error");
    stubFetch(geminiReply("garbage"), geminiReply("garbage again"));

    await new GeminiExecutionProvider(CONFIG).execute(REQUEST).catch(() => undefined);

    const logged = [...warnSpy.mock.calls, ...infoSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" | ");
    expect(logged).not.toContain(HIDDEN_INPUT);
    expect(logged).not.toContain(HIDDEN_EXPECTED);
  });

  it("sends the API key as a header, never in the URL", async () => {
    const fetchMock = stubFetch(
      geminiReply(
        batch([
          {
            caseId: "case-visible",
            status: "ACCEPTED",
            stdout: "5",
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
          {
            caseId: "case-hidden",
            status: "ACCEPTED",
            stdout: HIDDEN_EXPECTED,
            stderr: "",
            time: 0.01,
            memory: 1024,
          },
        ]),
      ),
    );
    await new GeminiExecutionProvider(CONFIG).execute(REQUEST);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });
});
