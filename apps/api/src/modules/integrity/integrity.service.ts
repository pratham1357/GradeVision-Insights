import type { ViolationSeverity, ViolationType } from "@gradevision/database";
import type {
  RecordViolationResult,
  SessionIntegritySummary,
  SessionViolationsView,
  ViolationRecord,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { logger } from "../../utils/logger.js";
import { emitAssessmentChanged, emitSessionViolation } from "../../realtime/index.js";
import {
  createViolation,
  findInstructorSession,
  findOwnedSession,
  listViolations,
  recordViolationAudit,
  violationSummary,
} from "./integrity.repository.js";
import type { RecordViolationInput } from "./integrity.schema.js";

/** Focus/visibility signals are advisory (LOW); a fullscreen exit is a firmer signal. */
const SEVERITY_BY_TYPE: Record<ViolationType, ViolationSeverity> = {
  FULLSCREEN_EXIT: "MEDIUM",
  VISIBILITY_CHANGE: "LOW",
  TAB_SWITCH: "MEDIUM",
  WINDOW_BLUR: "LOW",
  OTHER: "LOW",
};

/** Student-facing banner text. Never mentions rule ids, thresholds, or storage. */
export function integrityWarning(count: number, lastAt: Date | null): string | null {
  if (count <= 0) return null;
  const events = `${count} event${count === 1 ? "" : "s"}`;
  void lastAt;
  if (count >= 5) {
    return `Leaving the exam has been recorded ${events}. Repeated exits are flagged for your instructor to review.`;
  }
  if (count >= 3) {
    return `Please stay in the exam window. ${events} where the exam lost focus have been recorded.`;
  }
  return `Heads up: leaving the exam window is recorded (${events} so far).`;
}

export function summariseIntegrity(count: number, lastAt: Date | null): SessionIntegritySummary {
  return {
    violationCount: count,
    lastViolationAt: lastAt?.toISOString() ?? null,
    warning: integrityWarning(count, lastAt),
  };
}

/** Reads the integrity summary for one session (used by the exam view). */
export async function getSessionIntegrity(sessionId: string): Promise<SessionIntegritySummary> {
  const summary = await violationSummary(sessionId);
  return summariseIntegrity(summary._count._all, summary._max.occurredAt);
}

export async function recordViolation(
  sessionId: string,
  studentId: string,
  input: RecordViolationInput,
): Promise<RecordViolationResult> {
  const session = await findOwnedSession(sessionId, studentId);
  if (!session) {
    // 404 (not 403) so another student's session id is not confirmed to exist.
    throw ApiError.notFound("Exam session not found");
  }
  // Only meaningful while the attempt is live; a finished session is immutable.
  if (session.status !== "IN_PROGRESS") {
    throw new ApiError(409, "SESSION_NOT_ACTIVE", "This exam session is not in progress");
  }

  await createViolation({
    examSessionId: sessionId,
    type: input.type,
    severity: SEVERITY_BY_TYPE[input.type],
    note: input.note ?? null,
  });

  const summary = await violationSummary(sessionId);
  const count = summary._count._all;

  // Audit + realtime are best-effort; never fail the student's request on them.
  await recordViolationAudit({ studentId, sessionId, type: input.type, count }).catch((error) => {
    logger.warn("failed to write integrity audit event", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  emitSessionViolation(sessionId, count);
  emitAssessmentChanged(session.assessmentId);

  return {
    recorded: true,
    violationCount: count,
    warning: integrityWarning(count, summary._max.occurredAt),
  };
}

function toViolationRecord(row: {
  id: string;
  type: ViolationType;
  severity: ViolationSeverity;
  occurredAt: Date;
  detail: unknown;
}): ViolationRecord {
  let note: string | null = null;
  if (row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)) {
    const value = (row.detail as Record<string, unknown>).note;
    if (typeof value === "string") note = value;
  }
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    occurredAt: row.occurredAt.toISOString(),
    note,
  };
}

export async function getSessionViolations(
  assessmentId: string,
  sessionId: string,
  instructorId: string,
): Promise<SessionViolationsView> {
  const session = await findInstructorSession(assessmentId, sessionId, instructorId);
  if (!session) {
    throw ApiError.notFound("Exam session not found");
  }
  const rows = await listViolations(sessionId);
  return {
    sessionId,
    studentId: session.studentId,
    studentName: session.student.name,
    violationCount: rows.length,
    violations: rows.map(toViolationRecord),
  };
}
