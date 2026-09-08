import { z } from "zod";

export const assessmentParamsSchema = z.object({
  assessmentId: z.uuid(),
});

export const assessmentQuestionParamsSchema = z.object({
  assessmentId: z.uuid(),
  questionId: z.uuid(),
});

const title = z.string().trim().min(1, "Title is required").max(200);
const description = z.string().trim().max(5000).nullish();
const durationMinutes = z
  .number()
  .int()
  .positive()
  .max(24 * 60)
  .nullish();
const points = z.number().min(0).max(1000);

export const createAssessmentSchema = z.object({
  title,
  description,
  sectionId: z.uuid(),
  durationMinutes,
});

// Instructors may edit these fields only while the assessment is DRAFT.
export const updateAssessmentSchema = z
  .object({
    title,
    description,
    durationMinutes,
    // Instructor-editable status transitions. Legal transitions are enforced
    // in the service (see ALLOWED_TRANSITIONS).
    status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "CLOSED", "ARCHIVED"]),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const attachQuestionSchema = z.object({
  questionId: z.uuid(),
  points: points.default(100),
});

export const updateAssessmentQuestionSchema = z
  .object({
    points,
    position: z.number().int().min(0).max(999),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const reorderQuestionsSchema = z.object({
  orderedQuestionIds: z.array(z.uuid()).min(1).max(200),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
export type AttachQuestionInput = z.infer<typeof attachQuestionSchema>;
export type UpdateAssessmentQuestionInput = z.infer<typeof updateAssessmentQuestionSchema>;
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;
