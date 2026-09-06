import { describe, expect, it } from "vitest";

import { createEvaluationQueue, createEvaluationWorker, isQueueEnabled } from "./index.js";

describe("@gradevision/queue degradation", () => {
  it("reports disabled and returns null when no Redis URL is configured", () => {
    expect(isQueueEnabled(undefined)).toBe(false);
    expect(isQueueEnabled("")).toBe(false);
    expect(isQueueEnabled("not-a-url")).toBe(false);
    expect(isQueueEnabled("postgres://x")).toBe(false);
    expect(createEvaluationQueue(undefined)).toBeNull();
    expect(createEvaluationWorker(undefined, async () => undefined)).toBeNull();
  });

  it("recognises a redis URL", () => {
    expect(isQueueEnabled("redis://localhost:6379")).toBe(true);
    expect(isQueueEnabled("rediss://user:pass@example.com:6380")).toBe(true);
  });
});
