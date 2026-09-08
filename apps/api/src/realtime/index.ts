import type { Server as HttpServer } from "node:http";

import { prisma } from "../services/database.js";
import { logger } from "../utils/logger.js";
import { attachRealtime, assessmentRoom, sessionRoom } from "./io.js";

/**
 * Process-wide realtime handle. `null` until `initRealtime` runs (it is wired in
 * `server.ts` only). Every exported emit is a safe no-op when realtime is not
 * attached - so tests and REST-only deployments are unaffected.
 */
let handle: ReturnType<typeof attachRealtime> | null = null;

export function initRealtime(httpServer: HttpServer): void {
  if (handle) return;
  handle = attachRealtime(httpServer);
}

export async function shutdownRealtime(): Promise<void> {
  if (!handle) return;
  await handle.close();
  handle = null;
}

export function isRealtimeEnabled(): boolean {
  return handle !== null;
}

/** A submission/evaluation for this session changed - tell the student to re-fetch. */
export function emitSessionChanged(sessionId: string): void {
  handle?.io.to(sessionRoom(sessionId)).emit("session:changed", { sessionId });
}

/** Results/violations for this assessment changed - tell the instructor to re-fetch. */
export function emitAssessmentChanged(assessmentId: string): void {
  handle?.io.to(assessmentRoom(assessmentId)).emit("assessment:changed", { assessmentId });
}

/** A new integrity violation was recorded. */
export function emitSessionViolation(sessionId: string, violationCount: number): void {
  handle?.io.to(sessionRoom(sessionId)).emit("session:violation", { sessionId, violationCount });
}

/**
 * Fan a `session:changed` signal out to every student currently sitting an exam
 * for this assessment - used when the instructor changes the assessment (status,
 * duration, ...) so open exam pages re-fetch. Best-effort: never throws, and is a
 * no-op when realtime is not attached.
 */
export async function emitAssessmentSessionsChanged(assessmentId: string): Promise<void> {
  if (!handle) return;
  try {
    const sessions = await prisma.examSession.findMany({
      where: { assessmentId, status: "IN_PROGRESS" },
      select: { id: true },
    });
    for (const { id } of sessions) {
      handle.io.to(sessionRoom(id)).emit("session:changed", { sessionId: id });
    }
  } catch (error) {
    logger.warn("failed to fan out assessment session change", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
