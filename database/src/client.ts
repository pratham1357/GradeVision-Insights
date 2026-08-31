import { PrismaClient } from "@prisma/client";

/**
 * Process-wide PrismaClient singleton.
 *
 * Reusing one client avoids exhausting the PostgreSQL connection pool when a
 * module graph is re-evaluated (dev watch mode) or when several packages import
 * the database layer. Safe for future multi-worker deployments: each worker
 * process gets exactly one client.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
