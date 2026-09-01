import type { User } from "@gradevision/database";

import { prisma } from "../../services/database.js";

/**
 * Data access for authentication. The only place auth touches Prisma.
 * `email` is expected to be already normalised (see `loginSchema`).
 */
export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
