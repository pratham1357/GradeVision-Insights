import { Prisma } from "@gradevision/database";
import type { AdminSection, AdminUser, AuditEntry } from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { hashPassword } from "../auth/password.js";
import { revokeUserSessions } from "../auth/sessions.js";
import {
  activeSessionCounts,
  createUserWithAudit,
  findSection,
  findUser,
  findUserByEmailAny,
  LastAdminError,
  listAuditEvents,
  listSections,
  listUsers,
  updateUserWithAudit,
} from "./admin.repository.js";
import type {
  CreateUserInput,
  ListUsersQuery,
  SetPasswordInput,
  UpdateUserInput,
} from "./admin.schema.js";

type UserRow = NonNullable<Awaited<ReturnType<typeof findUser>>>;

function toAdminUser(row: UserRow, sessions: Map<string, number>): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    sections: row.enrollments.map((e) => ({
      id: e.section.id,
      name: e.section.name,
      courseCode: e.section.course.code,
    })),
    activeSessions: sessions.get(row.id) ?? 0,
  };
}

async function withSessions(rows: UserRow[]): Promise<AdminUser[]> {
  const counts = await activeSessionCounts(
    rows.map((r) => r.id),
    new Date(),
  );
  const map = new Map(counts.map((c) => [c.userId, c._count._all]));
  return rows.map((row) => toAdminUser(row, map));
}

async function loadUser(userId: string): Promise<AdminUser> {
  const row = await findUser(userId);
  if (!row) throw ApiError.notFound("User not found");
  return (await withSessions([row]))[0]!;
}

export async function getUsers(query: ListUsersQuery): Promise<AdminUser[]> {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { isActive: query.status === "active" } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  return withSessions(await listUsers(where));
}

export async function createUser(input: CreateUserInput, actorId: string): Promise<AdminUser> {
  if (await findUserByEmailAny(input.email)) {
    throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists");
  }
  if (input.sectionId) {
    if (input.role !== "STUDENT") {
      throw ApiError.badRequest("Only students are enrolled in a section");
    }
    if (!(await findSection(input.sectionId))) throw ApiError.notFound("Section not found");
  }
  try {
    const user = await createUserWithAudit(
      {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        sectionId: input.sectionId,
      },
      actorId,
    );
    return loadUser(user.id);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists");
    }
    throw error;
  }
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<AdminUser> {
  const current = await findUser(userId);
  if (!current) throw ApiError.notFound("User not found");

  const roleChanges = input.role !== undefined && input.role !== current.role;
  const statusChanges = input.isActive !== undefined && input.isActive !== current.isActive;
  if (userId === actorId && (roleChanges || input.isActive === false)) {
    throw new ApiError(
      409,
      "SELF_CHANGE",
      "You cannot change your own role or deactivate yourself",
    );
  }
  const leavesAdmins =
    current.role === "ADMIN" &&
    current.isActive &&
    ((roleChanges && input.role !== "ADMIN") || input.isActive === false);

  const changes: string[] = [];
  if (input.name !== undefined && input.name !== current.name) changes.push("name");
  if (roleChanges) changes.push(`role ${current.role} -> ${input.role}`);
  if (statusChanges) changes.push(input.isActive ? "reactivated" : "deactivated");
  if (changes.length === 0) return loadUser(userId);

  try {
    await updateUserWithAudit(
      userId,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(roleChanges ? { role: input.role } : {}),
        ...(statusChanges ? { isActive: input.isActive } : {}),
      },
      {
        actorId,
        action: statusChanges && input.isActive === false ? "user.deactivated" : "user.updated",
        summary: `${current.email}: ${changes.join(", ")}`,
        metadata: {
          ...(roleChanges ? { fromRole: current.role, toRole: input.role! } : {}),
          ...(statusChanges ? { isActive: input.isActive! } : {}),
        },
      },
      leavesAdmins,
    );
  } catch (error) {
    if (error instanceof LastAdminError) {
      throw new ApiError(409, "LAST_ADMIN", "At least one active administrator must remain");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApiError(409, "CONFLICT", "Another change happened at the same time - try again");
    }
    throw error;
  }

  // Privilege or status change: end every session so nothing runs on old rights.
  if (roleChanges || (statusChanges && input.isActive === false)) {
    await revokeUserSessions(userId, roleChanges ? "role_changed" : "deactivated");
  }
  return loadUser(userId);
}

export async function setPassword(
  userId: string,
  input: SetPasswordInput,
  actorId: string,
): Promise<AdminUser> {
  const current = await findUser(userId);
  if (!current) throw ApiError.notFound("User not found");
  await updateUserWithAudit(
    userId,
    { passwordHash: await hashPassword(input.password) },
    {
      actorId,
      action: "user.password_set",
      summary: `Password set for ${current.email}`,
      metadata: {},
    },
    false,
  );
  await revokeUserSessions(userId, "password_set");
  return loadUser(userId);
}

export async function getSections(): Promise<AdminSection[]> {
  return (await listSections()).map((s) => ({
    id: s.id,
    name: s.name,
    courseCode: s.course.code,
    courseName: s.course.name,
    instructorName: s.instructor?.name ?? null,
  }));
}

export async function getAudit(limit = 50): Promise<AuditEntry[]> {
  return (await listAuditEvents(limit)).map((e) => ({
    id: e.id,
    action: e.action,
    actorName: e.actor?.name ?? null,
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    createdAt: e.createdAt.toISOString(),
  }));
}
