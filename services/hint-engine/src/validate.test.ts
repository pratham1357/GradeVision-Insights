import { describe, expect, it } from "vitest";

import { MAX_HINT_WORDS, normalizeHintText, validateHintOutput } from "./validate.js";

describe("validateHintOutput", () => {
  it("accepts a short prose hint", () => {
    const result = validateHintOutput(
      "Your loop compares each number with every other one. Which structure lets you check in one step whether the needed partner was already seen?",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts prose that mentions keywords and a short inline snippet", () => {
    const result = validateHintOutput(
      "for each element, think about what you need to remember. A `seen` set is one option.\nAsk yourself: what should happen when the target is twice a value?",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts up to two lines of pseudocode", () => {
    const result = validateHintOutput(
      "Try tracing the input 2 7 11 15 by hand:\ncomplement = target - x\nthen look it up before storing x.",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects empty or whitespace replies", () => {
    expect(validateHintOutput("   \n ")).toEqual({ ok: false, reason: "empty" });
    expect(validateHintOutput("<think>planning</think>")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects fenced code blocks", () => {
    expect(validateHintOutput("Use this:\n```\nprint(1)\n```")).toEqual({
      ok: false,
      reason: "code_block",
    });
  });

  it("rejects a multi-line code dump without fences", () => {
    const result = validateHintOutput(
      "def two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]",
    );
    expect(result).toEqual({ ok: false, reason: "code_like" });
  });

  it("rejects C-family code lines", () => {
    const result = validateHintOutput(
      'int main() {\n  int n;\n  scanf("%d", &n);\n  printf("%d", n);\n}',
    );
    expect(result).toEqual({ ok: false, reason: "code_like" });
  });

  it("rejects a long inline code span", () => {
    const result = validateHintOutput(
      "Just write `seen = {}; for i, x in enumerate(nums): seen[x] = i; return answer_here` and you are done.",
    );
    expect(result).toEqual({ ok: false, reason: "code_like" });
  });

  it("rejects replies that echo the prompt or its fences", () => {
    expect(validateHintOutput("<<<STUDENT_CODE\nx\nSTUDENT_CODE>>>")).toEqual({
      ok: false,
      reason: "prompt_echo",
    });
    expect(validateHintOutput("Hard rules: never provide a solution.")).toEqual({
      ok: false,
      reason: "prompt_echo",
    });
    expect(validateHintOutput("EXECUTION EVIDENCE says you failed.")).toEqual({
      ok: false,
      reason: "prompt_echo",
    });
  });

  it("rejects claims about hidden test contents", () => {
    expect(validateHintOutput("The hidden test input is an empty list.")).toEqual({
      ok: false,
      reason: "hidden_test_claim",
    });
    // Mentioning that hidden tests exist (as counts) is fine.
    expect(validateHintOutput("One hidden test did not pass; think about edge cases.").ok).toBe(
      true,
    );
  });

  it("rejects overly long replies", () => {
    const long = Array.from({ length: MAX_HINT_WORDS + 5 }, () => "word").join(" ");
    expect(validateHintOutput(long)).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("normalizeHintText", () => {
  it('strips a leading "The hint is:" label', () => {
    expect(normalizeHintText("The hint is: Use a Scanner to read the name.")).toBe(
      "Use a Scanner to read the name.",
    );
  });

  it("strips reasoning blocks, labels and extra blank lines", () => {
    expect(
      normalizeHintText("<think>x</think>\nHint: Check the edge case.\n\n\n\nThen retry."),
    ).toBe("Check the edge case.\n\nThen retry.");
  });
});
