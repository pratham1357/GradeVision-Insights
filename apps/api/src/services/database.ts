import { prisma } from "@gradevision/database";

/**
 * The API uses the one Prisma client owned by `@gradevision/database`.
 * It never constructs its own client, and route handlers never import this
 * directly - data access goes through a module's repository/service layer.
 */
export { prisma };

export type DatabasePing = { ok: true; latencyMs: number } | { ok: false; error: string };

/** Cheap liveness probe for the health endpoint. Not for hot paths. */
export async function pingDatabase(): Promise<DatabasePing> {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
