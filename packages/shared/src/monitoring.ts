/**
 * API contract for the instructor monitoring dashboard: a real-student roster
 * built from the existing domain model, plus instructor-only runtime metrics.
 *
 * Response shapes only - not a mirror of the Prisma schema. Every value is
 * derived from persisted rows (students, enrolments, sessions, submissions,
 * evaluation runs, violations) or measured by the API process at request time.
 */
import type { EvaluationRunStatus } from "./evaluation.js";
import type { SubmissionStatus } from "./student.js";

// ---------------------------------------------------------------------------
// Student monitoring - `GET /api/v1/monitoring/students`
// ---------------------------------------------------------------------------

/** A section the requesting instructor teaches that the student is enrolled in. */
export interface MonitoredStudentSection {
  id: string;
  name: string;
  courseCode: string;
}

/** The student's most recent code submission across the instructor's assessments. */
export interface MonitoredLatestSubmission {
  submissionId: string;
  assessmentId: string;
  questionTitle: string;
  submissionStatus: SubmissionStatus;
  evaluationStatus: EvaluationRunStatus | null;
  scorePercent: number | null;
  submittedAt: string;
}

/**
 * One row of the instructor's student roster. Aggregates are scoped to the
 * sections the instructor teaches - never another instructor's data.
 */
export interface InstructorStudentActivity {
  studentId: string;
  name: string;
  email: string;
  /** Instructor-taught sections this student is actively enrolled in. */
  sections: MonitoredStudentSection[];
  /** Earliest active enrolment into one of those sections. */
  enrolledAt: string | null;
  /** Non-draft assessments in those sections (assigned to this student). */
  assessmentsAssigned: number;
  assessmentsStarted: number;
  assessmentsSubmitted: number;
  /** In an exam right now (a session in IN_PROGRESS). */
  inProgress: boolean;
  submissionCount: number;
  latestSubmission: MonitoredLatestSubmission | null;
  /** Mean graded score across the student's evaluated submissions, 0-100. */
  averageScorePercent: number | null;
  violationCount: number;
  /** `violationCount >= 3` - same threshold the results view uses. */
  flagged: boolean;
  /** Latest of: session update, submission, or violation. */
  lastActivityAt: string | null;
}

export interface InstructorMonitorSummary {
  totalStudents: number;
  sectionsCount: number;
  inProgressCount: number;
  submittedCount: number;
  averageScorePercent: number | null;
  totalViolations: number;
  flaggedStudents: number;
}

export interface InstructorStudentMonitor {
  students: InstructorStudentActivity[];
  summary: InstructorMonitorSummary;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// System metrics - `GET /api/v1/monitoring/system` (instructor/admin only)
// ---------------------------------------------------------------------------

export interface SystemProcessMetrics {
  /** ISO timestamp the API process started. */
  startedAt: string;
  uptimeSeconds: number;
}

export interface SystemCpuMetrics {
  /** User CPU time over the sample window, milliseconds. */
  userMs: number;
  /** System CPU time over the sample window, milliseconds. */
  systemMs: number;
  /** Percent of a single core used over the sample window; `null` if unmeasured. */
  percent: number | null;
  /** Length of the sample window, milliseconds. */
  sampleMs: number;
}

export interface SystemMemoryMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
}

export interface SystemRequestMetrics {
  /** Requests currently being processed by this process. */
  inFlight: number;
  /** Requests handled since the process started. */
  total: number;
  /** Processing time of the most recent completed request, milliseconds. */
  lastResponseTimeMs: number | null;
  /** Rolling mean processing time over recent requests, milliseconds. */
  averageResponseTimeMs: number | null;
  /** How many recent requests the average is computed from. */
  sampleSize: number;
}

export interface SystemDatabaseMetrics {
  status: "up" | "down";
  latencyMs: number | null;
}

/**
 * A snapshot of API-process health. Contains no secrets, environment variables,
 * connection strings, file paths, or stack traces - only operational counters.
 * "Response time" is server-side request processing duration (request received
 * to response finished), measured by the request middleware.
 */
export interface SystemMetrics {
  process: SystemProcessMetrics;
  cpu: SystemCpuMetrics;
  memory: SystemMemoryMetrics;
  requests: SystemRequestMetrics;
  database: SystemDatabaseMetrics;
  generatedAt: string;
}
