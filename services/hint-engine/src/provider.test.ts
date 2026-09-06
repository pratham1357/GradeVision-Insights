import { describe, expect, it } from "vitest";

import { GeminiProvider } from "./gemini.js";
import {
  buildHintPrompt,
  hintRequestSchema,
  UnconfiguredProvider,
  type HintRequest,
} from "./provider.js";

const base: HintRequest = {
  stageNumber: 1,
  language: "PYTHON",
  questionTitle: "Two Sum",
  questionStatement: "Return indices of the two numbers that add up to target.",
  studentCode: null,
  previousHints: [],
};

describe("hintRequestSchema", () => {
  it("applies defaults for optional fields", () => {
    const parsed = hintRequestSchema.parse({
      stageNumber: 2,
      language: "PYTHON",
      questionTitle: "T",
    });
    expect(parsed.previousHints).toEqual([]);
    expect(parsed.studentCode).toBeNull();
  });

  it("rejects a missing title", () => {
    expect(hintRequestSchema.safeParse({ stageNumber: 1, language: "PYTHON" }).success).toBe(false);
  });
});

describe("buildHintPrompt", () => {
  it("includes stage-specific guidance and escalation context", () => {
    const prompt = buildHintPrompt({
      ...base,
      stageNumber: 3,
      previousHints: ["Think about what you can precompute."],
      studentCode: "def two_sum(a, t):\n    pass",
    });
    expect(prompt).toContain("Hint stage: 3");
    expect(prompt).toContain("do not repeat");
    expect(prompt).toContain("two_sum");
    expect(prompt).toContain("Respond with the hint only.");
  });

  it("notes when the student has no code yet", () => {
    expect(buildHintPrompt(base)).toContain("has not written any code yet");
  });
});

describe("UnconfiguredProvider", () => {
  it("reports not configured and rejects generation", async () => {
    const provider = new UnconfiguredProvider();
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.generateHint()).rejects.toThrow();
  });
});

describe("GeminiProvider", () => {
  it("is not configured without an API key", () => {
    const provider = new GeminiProvider({
      apiKey: null,
      model: "gemini-2.0-flash",
      baseUrl: "https://example.test",
      timeoutMs: 1_000,
    });
    expect(provider.isConfigured()).toBe(false);
  });

  it("rejects generateHint when unconfigured rather than faking a hint", async () => {
    const provider = new GeminiProvider({
      apiKey: null,
      model: "gemini-2.0-flash",
      baseUrl: "https://example.test",
      timeoutMs: 1_000,
    });
    await expect(provider.generateHint(base)).rejects.toThrow(/not configured/i);
  });
});
