import { z } from "zod";

/**
 * `POST /api/v1/auth/login` body.
 * Email is trimmed and lower-cased before validation so lookups are consistent.
 */
export const loginSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.email({ error: "A valid email is required" }).max(320),
  ),
  password: z.string().min(1, "Password is required").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
