import { z } from "zod";

/**
 * LLM provider abstraction. The HTTP contract (`POST /hints`) never changes when
 * the provider is swapped - only this file and a sibling implementation do.
 */
export const hintRequestSchema = z.object({
  stageNumber: z.number().int().positive().max(20),
  language: z.string().min(1).max(40),
  questionTitle: z.string().min(1).max(300),
  questionStatement: z.string().max(6_000).default(""),
  studentCode: z.string().max(20_000).nullable().default(null),
  previousHints: z.array(z.string().max(2_000)).max(10).default([]),
});

export type HintRequest = z.infer<typeof hintRequestSchema>;

export interface LLMProvider {
  readonly name: string;
  /** True when the provider has everything it needs (API key, etc.). */
  isConfigured(): boolean;
  /** Returns guidance text. Must never return a full solution. */
  generateHint(request: HintRequest): Promise<string>;
}

const STAGE_GOAL: Record<number, string> = {
  1: "Give a single high-level conceptual nudge about which idea or category of approach applies. Do not mention specific functions or syntax.",
  2: "Give a more specific direction: name the data structure or technique that fits, and one property to exploit. Still no code.",
  3: "Give concrete approach and debugging guidance: outline the steps in prose, and if student code is provided, point at the kind of mistake to look for. No code blocks.",
  4: "Act as an interactive tutor responding to the student's current code: ask a pointed question and suggest what to check or trace next. Never write the corrected code for them.",
};

export const HINT_SYSTEM_PROMPT = [
  "You are a patient programming tutor helping a student during a timed exam.",
  "Your job is to help them think, not to solve the problem for them.",
  "Hard rules:",
  "- Never provide a complete or near-complete solution.",
  "- Never write more than 2 lines of illustrative pseudocode, and only if unavoidable.",
  "- Keep the response under 90 words.",
  "- Be encouraging and specific to what the student is asking about.",
].join("\n");

/** Builds the user-turn prompt. Only the minimum necessary context is included. */
export function buildHintPrompt(request: HintRequest): string {
  const goal = STAGE_GOAL[Math.min(request.stageNumber, 4)] ?? STAGE_GOAL[4]!;
  const parts = [
    `Hint stage: ${request.stageNumber}. ${goal}`,
    `Programming language: ${request.language}.`,
    `Problem title: ${request.questionTitle}`,
  ];
  if (request.questionStatement.trim()) {
    parts.push(`Problem statement:\n${request.questionStatement.trim().slice(0, 2_000)}`);
  }
  if (request.previousHints.length > 0) {
    parts.push(
      `Hints already given (do not repeat, escalate from here):\n${request.previousHints
        .map((h, i) => `${i + 1}. ${h}`)
        .join("\n")}`,
    );
  }
  if (request.studentCode && request.studentCode.trim()) {
    parts.push(`The student's current code:\n${request.studentCode.trim().slice(0, 4_000)}`);
  } else {
    parts.push("The student has not written any code yet.");
  }
  parts.push("Respond with the hint only.");
  return parts.join("\n\n");
}

/** Provider used when no LLM is configured. Always reports unconfigured. */
export class UnconfiguredProvider implements LLMProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  generateHint(): Promise<string> {
    return Promise.reject(new Error("No LLM provider is configured"));
  }
}
