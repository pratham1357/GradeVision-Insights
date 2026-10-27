import { prisma } from "../../services/database.js";

const sessionWithUser = {
  user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
} as const;

export function insertSession(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
}) {
  return prisma.authSession.create({ data, select: { id: true, expiresAt: true } });
}

export function findSessionByHash(tokenHash: string) {
  return prisma.authSession.findUnique({ where: { tokenHash }, include: sessionWithUser });
}

export function findSessionById(id: string) {
  return prisma.authSession.findUnique({ where: { id }, include: sessionWithUser });
}

export function touchSession(id: string, at: Date) {
  return prisma.authSession.update({ where: { id }, data: { lastSeenAt: at } });
}

export function revokeSessionRow(id: string, reason: string) {
  return prisma.authSession.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeUserSessionRows(userId: string, reason: string): Promise<string[]> {
  const active = await prisma.authSession.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return active.map((s) => s.id);
}

/** Housekeeping: drop this user's sessions that ended more than a day ago. */
export function pruneUserSessions(userId: string, before: Date) {
  return prisma.authSession.deleteMany({
    where: { userId, OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
  });
}
