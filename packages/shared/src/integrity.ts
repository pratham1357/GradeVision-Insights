/**
 * API contract for lightweight assessment integrity.
 *
 * Client-reported focus/fullscreen signals only - no camera, microphone, screen
 * capture, or keystroke logging. The API records these as `Violation` rows and
 * never exposes internal security details (rule ids, thresholds) to students.
 */
export const VIOLATION_TYPES = [
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "VISIBILITY_CHANGE",
  "OTHER",
] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const VIOLATION_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ViolationSeverity = (typeof VIOLATION_SEVERITIES)[number];

/** `POST /api/v1/student/sessions/:sessionId/violations` request body. */
export interface RecordViolationBody {
  type: ViolationType;
  /** Optional small client note (page title, elapsed seconds, ...). Untrusted. */
  note?: string;
}

/** Compact integrity summary attached to the student exam view. */
export interface SessionIntegritySummary {
  violationCount: number;
  lastViolationAt: string | null;
  /** Escalating banner text for the student. `null` when there are no violations. */
  warning: string | null;
}

/** `POST .../violations` response. */
export interface RecordViolationResult {
  recorded: boolean;
  violationCount: number;
  warning: string | null;
}

/** One violation as shown to an instructor (session-scoped). */
export interface ViolationRecord {
  id: string;
  type: ViolationType;
  severity: ViolationSeverity;
  occurredAt: string;
  note: string | null;
}

/** `GET /api/v1/assessments/:assessmentId/sessions/:sessionId/violations`. */
export interface SessionViolationsView {
  sessionId: string;
  studentId: string;
  studentName: string;
  violationCount: number;
  violations: ViolationRecord[];
}
