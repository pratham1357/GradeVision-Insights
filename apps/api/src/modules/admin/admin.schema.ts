import { z } from "zod";

const ROLES = ["STUDENT", "INSTRUCTOR", "ADMIN"] as const;

export const userParamsSchema = z.object({ userId: z.uuid() });

const email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email({ error: "A valid email is required" }).max(320),
);
const name = z.string().trim().min(1, "Name is required").max(120);
// Long passphrases; the hash is Argon2id. No composition rules (NIST 800-63B).
const password = z.string().min(12, "Password must be at least 12 characters").max(200);

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const createUserSchema = z.object({
  email,
  name,
  role: z.enum(ROLES),
  password,
  /** Optional: enrol a new STUDENT in this section so they see its assessments. */
  sectionId: z.uuid().optional(),
});

export const updateUserSchema = z
  .object({ name, role: z.enum(ROLES), isActive: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const setPasswordSchema = z.object({ password });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
