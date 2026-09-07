import { z } from "zod";

import { VIOLATION_TYPES } from "../../utils/enums.js";

export const sessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const assessmentSessionParamsSchema = z.object({
  assessmentId: z.uuid(),
  sessionId: z.uuid(),
});

export const recordViolationSchema = z.object({
  type: z.enum(VIOLATION_TYPES),
  // Small untrusted client note; capped so a violation row cannot be abused.
  note: z.string().max(500).optional(),
});

export type RecordViolationInput = z.infer<typeof recordViolationSchema>;
