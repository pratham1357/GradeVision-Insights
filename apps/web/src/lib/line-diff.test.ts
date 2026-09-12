import { describe, expect, it } from "vitest";

import { lineDiff } from "./line-diff";

describe("lineDiff", () => {
  it("reports identical code as unchanged", () => {
    const d = lineDiff("a\nb\n", "a\nb\n")!;
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.ops.map((o) => o.kind)).toEqual(["same", "same"]);
  });

  it("marks changed lines as a removal plus an addition, keeping context", () => {
    const d = lineDiff("x = input()\nprint(x - 1)\n", "x = input()\nprint(x + 1)\n")!;
    expect(d.ops).toEqual([
      { kind: "same", text: "x = input()" },
      { kind: "del", text: "print(x - 1)" },
      { kind: "add", text: "print(x + 1)" },
    ]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it("handles pure additions, pure removals and CRLF input", () => {
    expect(lineDiff("", "a\nb")!.ops.map((o) => o.kind)).toEqual(["add", "add"]);
    expect(lineDiff("a\r\nb\r\n", "a\n")!.ops).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
    ]);
  });

  it("gives up on very large inputs instead of freezing the page", () => {
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    expect(lineDiff(big, `${big}\nmore`)).toBeNull();
  });
});
