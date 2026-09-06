import { z } from "zod";

import { PROGRAMMING_LANGUAGES } from "../../utils/enums.js";

export const assessmentParamsSchema = z.object({
  assessmentId: z.uuid(),
});

export const sessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const sessionQuestionParamsSchema = z.object({
  sessionId: z.uuid(),
  questionId: z.uuid(),
});

export const submissionParamsSchema = z.object({
  submissionId: z.uuid(),
});

export const requestHintSchema = z.object({
  stageNumber: z.number().int().positive().max(20),
});

export type RequestHintInput = z.infer<typeof requestHintSchema>;

const codePayload = z.object({
  language: z.enum(PROGRAMMING_LANGUAGES),
  // Generous cap; the editor is for solutions, not file uploads.
  sourceCode: z.string().max(200_000),
});

export const saveDraftSchema = codePayload;
export const submitSchema = codePayload.extend({
  sourceCode: z.string().min(1, "Cannot submit empty code").max(200_000),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type SubmitInput = z.infer<typeof submitSchema>;
