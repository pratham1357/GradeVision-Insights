import { CODE_CLOSE, CODE_OPEN, OUTPUT_CLOSE, OUTPUT_OPEN } from "./provider.js";

/**
 * Deterministic checks on generated hint text before it is delivered. A model
 * reply that fails any rule is never shown to the student and never recorded
 * as a consumed hint - the student can simply ask again. The rules are
 * deliberately conservative: they catch the failure modes small local models
 * actually show (code dumps, prompt echo, rambling), not "quality".
 */
export const HINT_VALIDATOR_VERSION = "hint-output-v1";

export const MAX_HINT_WORDS = 160;
export const MAX_HINT_CHARS = 1_200;
/** More lines that look like source code than this reads as a solution, not a hint. */
export const MAX_CODE_LIKE_LINES = 2;

export type HintRejectionReason =
  "empty" | "too_long" | "code_block" | "code_like" | "prompt_echo" | "hidden_test_claim";

export type HintValidation =
  { ok: true; text: string } | { ok: false; reason: HintRejectionReason };

const CODE_LINE_PATTERNS: RegExp[] = [
  /^\s*(def|class)\s+\w+.*:\s*$/u,
  /^\s*(for|while|if|elif)\b.*:\s*$/u,
  /^\s*(else|try|finally)\s*:\s*$/u,
  /^\s*except\b.*:\s*$/u,
  /^\s*return\b[^.?!]*$/u,
  /^\s*import\s+[\w.]+\s*$/u,
  /^\s*from\s+\S+\s+import\b/u,
  /^\s*#include\b/u,
  /^\s*(public|private|static|int|long|double|char|bool|void|let|const|var|function)\s+\w/u,
  /^\s*(if|for|while)\s*\(.*\)\s*\{?\s*$/u,
  /^\s*(print|console\.log|System\.out\.print\w*|printf|cout)\s*[(<]/u,
  /^\s*[A-Za-z_][\w.[\]]*\s*(\+|-|\*)?=\s*[^=\s].*$/u,
  /[;{}]\s*$/u,
];

const PROMPT_ECHO_MARKERS = [
  CODE_OPEN,
  CODE_CLOSE,
  OUTPUT_OPEN,
  OUTPUT_CLOSE,
  "STUDENT_CODE",
  "PROGRAM_OUTPUT",
  "EXECUTION EVIDENCE",
  "Hard rules:",
];

const HIDDEN_TEST_CLAIM =
  /hidden\s+(test|case)s?\s*(\d+\s*)?(input|inputs|expects?|expected|output|uses|is|are|contains?)\b/iu;

function isCodeLike(line: string): boolean {
  const trimmed = line.trim();
  // Prose sentences ending in ":" ("Ask yourself:") are fine; bullets are prose.
  if (trimmed.length === 0 || /^[-*•]\s/u.test(trimmed)) return false;
  return CODE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Removes reasoning blocks some local models emit, and normalizes whitespace. */
export function normalizeHintText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/giu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/^\s*(the\s+)?(hint|answer|response)(\s+is)?\s*:\s*/iu, "")
    .trim();
}

export function validateHintOutput(raw: string): HintValidation {
  const text = normalizeHintText(raw);
  if (text.length === 0) return { ok: false, reason: "empty" };

  if (text.includes("```") || /<\/?think>/iu.test(text)) {
    return { ok: false, reason: text.includes("```") ? "code_block" : "prompt_echo" };
  }
  if (PROMPT_ECHO_MARKERS.some((marker) => text.includes(marker))) {
    return { ok: false, reason: "prompt_echo" };
  }

  const words = text.split(/\s+/u).filter(Boolean).length;
  if (words > MAX_HINT_WORDS || text.length > MAX_HINT_CHARS) {
    return { ok: false, reason: "too_long" };
  }

  const codeLines = text.split("\n").filter(isCodeLike).length;
  const longInlineCode = (text.match(/`[^`\n]{60,}`/gu) ?? []).length > 0;
  if (codeLines > MAX_CODE_LIKE_LINES || longInlineCode) {
    return { ok: false, reason: "code_like" };
  }

  if (HIDDEN_TEST_CLAIM.test(text)) {
    return { ok: false, reason: "hidden_test_claim" };
  }

  return { ok: true, text };
}
