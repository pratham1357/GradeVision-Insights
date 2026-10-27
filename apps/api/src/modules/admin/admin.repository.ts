import type { Prisma, UserRole } from "@gradevision/database";

import { prisma } from "../../services/database.js";

export const adminUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  enrollments: {
    where: { status: "ACTIVE" },
    select: { section: { select: { id: true, name: true, course: { select: { code: true } } } } },
  },
} satisfies Prisma.UserSelect;

export function listUsers(where: Prisma.UserWhereInput) {
  return prisma.user.findMany({
    where,
    orderBy: [{ role: "asc" }, { email: "asc" }],
    take: 200,
    select: adminUserSelect,
  });
}

export function findUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: adminUserSelect });
}

export function findUserByEmailAny(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

export function activeSessionCounts(userIds: string[], now: Date) {
  return prisma.authSession.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, revokedAt: null, expiresAt: { gt: now } },
    _count: { _all: true },
  });
}

export function findSection(id: string) {
  return prisma.section.findUnique({ where: { id }, select: { id: true } });
}

export function listSections() {
  return prisma.section.findMany({
    orderBy: [{ course: { code: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      course: { select: { code: true, name: true } },
      instructor: { select: { name: true } },
    },
  });
}

export function createUserWithAudit(
  data: { email: string; name: string; role: UserRole; passwordHash: string; sectionId?: string },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        name: data.name,
        role: data.role,
        passwordHash: data.passwordHash,
        ...(data.sectionId
          ? { enrollments: { create: { sectionId: data.sectionId, status: "ACTIVE" } } }
          : {}),
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "user.created",
        entityType: "User",
        entityId: user.id,
        summary: `Created ${data.role.toLowerCase()} account ${data.email}`,
        metadata: { role: data.role, enrolledSectionId: data.sectionId ?? null },
      },
    });
    return user;
  });
}

export class LastAdminError extends Error {}

/**
 * Applies a change and its audit row atomically. When the change could remove
 * the target from the set of active admins, the "another active admin remains"
 * check runs in the same SERIALIZABLE transaction, so two concurrent demotions
 * cannot both succeed.
 */
export function updateUserWithAudit(
  userId: string,
  data: Prisma.UserUpdateInput,
  audit: { actorId: string; action: string; summary: string; metadata: Prisma.InputJsonObject },
  guardLastAdmin: boolean,
) {
  return prisma.$transaction(
    async (tx) => {
      if (guardLastAdmin) {
        const others = await tx.user.count({
          where: { role: "ADMIN", isActive: true, id: { not: userId } },
        });
        if (others === 0) throw new LastAdminError();
      }
      await tx.user.update({ where: { id: userId }, data });
      await tx.auditEvent.create({
        data: {
          actorId: audit.actorId,
          action: audit.action,
          entityType: "User",
          entityId: userId,
          summary: audit.summary,
          metadata: audit.metadata,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export function listAuditEvents(limit: number) {
  return prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
}
