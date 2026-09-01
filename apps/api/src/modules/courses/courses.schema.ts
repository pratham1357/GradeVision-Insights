import { z } from "zod";

export const sectionParamsSchema = z.object({
  sectionId: z.uuid(),
});
