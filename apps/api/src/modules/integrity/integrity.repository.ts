import type { Prisma, ViolationSeverity, ViolationType } from "@gradevision/database";

import { prisma } from "../../services/database.js";

/** Ownership: the session belongs to this student. */
export function findOwnedSession(sessionId: string, studentId: string) {
  return prisma.examSession.findFirst({
    where: { id: sessionId, studentId },
    select: { id: true, status: true, assessmentId: true },
  });
}

/** Ownership: the session is part of an assessment this instructor owns. */
export function findInstructorSession(
  assessmentId: string,
  sessionId: string,
  instructorId: string,
) {
  return prisma.examSession.findFirst({
    where: {
      id: sessionId,
      assessmentId,
      assessment: {
        OR: [{ section: { instructorId } }, { sectionId: null, createdById: instructorId }],
      },
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      student: { select: { name: true } },
    },
  });
}

export function createViolation(data: {
  examSessionId: string;
  type: ViolationType;
  severity: ViolationSeverity;
  note: string | null;
}) {
  return prisma.violation.create({
    data: {
      examSessionId: data.examSessionId,
      type: data.type,
      severity: data.severity,
      detail: data.note ? ({ note: data.note } satisfies Prisma.InputJsonObject) : undefined,
    },
    select: { id: true, occurredAt: true },
  });
}

export function recordViolationAudit(data: {
  studentId: string;
  sessionId: string;
  type: ViolationType;
  count: number;
}) {
  return prisma.auditEvent.create({
    data: {
      actorId: data.studentId,
      action: "integrity.violation",
      entityType: "ExamSession",
      entityId: data.sessionId,
      summary: `Integrity signal ${data.type} (#${data.count})`,
      metadata: { type: data.type, count: data.count } satisfies Prisma.InputJsonObject,
    },
  });
}

export function violationSummary(sessionId: string) {
  return prisma.violation.aggregate({
    where: { examSessionId: sessionId },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
}

export function listViolations(sessionId: string) {
  return prisma.violation.findMany({
    where: { examSessionId: sessionId },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
}

/** Violation counts for many sessions at once (instructor dashboard). */
export function violationCountsBySession(sessionIds: string[]) {
  if (sessionIds.length === 0) return Promise.resolve([]);
  return prisma.violation.groupBy({
    by: ["examSessionId"],
    where: { examSessionId: { in: sessionIds } },
    _count: { _all: true },
  });
}
