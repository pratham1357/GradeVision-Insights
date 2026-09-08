import { describe, expect, it } from "vitest";

import { COOLDOWN_MS, createIntegrityDebouncer } from "./use-integrity-monitor";

describe("integrity debounce", () => {
  it("collapses the blur + visibility burst of one tab-switch into a single event", () => {
    let now = 1_000;
    const d = createIntegrityDebouncer(COOLDOWN_MS, () => now);

    expect(d.shouldRecord()).toBe(true); // blur
    now += 30;
    expect(d.shouldRecord()).toBe(false); // visibilitychange, same action
    now += 40;
    expect(d.shouldRecord()).toBe(false); // fullscreenchange, same action
  });

  it("records a genuinely separate event once the cooldown elapses", () => {
    let now = 0;
    const d = createIntegrityDebouncer(1_000, () => now);

    expect(d.shouldRecord()).toBe(true);
    now = 999;
    expect(d.shouldRecord()).toBe(false);
    now = 1_000;
    expect(d.shouldRecord()).toBe(true);
    now = 5_000;
    expect(d.shouldRecord()).toBe(true);
  });
});
