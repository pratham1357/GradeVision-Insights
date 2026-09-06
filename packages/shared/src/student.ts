/**
 * API contract for the student assessment-taking workflow.
 *
 * Response shapes exchanged between the API and the web client. Enum tuples
 * mirror the Prisma enums (the API asserts they stay in sync). Hidden test-case
 * data is never part of any student-facing type.
 */
import type { SubmissionEvaluationSummary } from "./evaluation.js";
import type { ProgrammingLanguage, QuestionDifficulty } from "./instructor.js";

export const EXAM_SESSION_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "EXPIRED",
  "TERMINATED",
] as const;
export type ExamSessionStatus = (typeof EXAM_SESSION_STATUSES)[number];

export const SUBMISSION_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** An ACTIVE assessment the student is enrolled for, plus their session if any. */
export interface StudentAssessmentSummary {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number | null;
  questionCount: number;
  courseCode: string | null;
  sectionName: string | null;
  endsAt: string | null;
  session: {
    id: string;
    status: ExamSessionStatus;
    startedAt: string | null;
    expiresAt: string | null;
  } | null;
}

/** Server-authoritative timing, echoed on every session read and mutation. */
export interface SessionTiming {
  status: ExamSessionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  /** The API's "now" - the frontend timer is derived from this, never the device clock. */
  serverTime: string;
  /** Whole seconds left, clamped to >= 0. `null` means the assessment has no time limit. */
  remainingSeconds: number | null;
}

/** A single visible ("sample") test case - shown to students. */
export interface SampleTestCase {
  name: string | null;
  input: string;
  expectedOutput: string;
}

export interface ExamSubmissionSummary {
  id: string;
  language: ProgrammingLanguage;
  status: SubmissionStatus;
  attemptNumber: number;
  createdAt: string;
  /** Automated-evaluation status for this submission; `null` until a run exists. */
  evaluation: SubmissionEvaluationSummary | null;
}

export interface ExamQuestion {
  id: string;
  position: number;
  points: number;
  title: string;
  statement: string;
  constraints: string | null;
  inputFormat: string | null;
  outputFormat: string | null;
  difficulty: QuestionDifficulty;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  /** Languages the student may write in, with optional starter code. */
  languages: { language: ProgrammingLanguage; starterCode: string | null }[];
  /** VISIBLE test cases only. HIDDEN cases are never included. */
  sampleTestCases: SampleTestCase[];
  /** The student's last saved code for this question in this session. */
  draft: { language: ProgrammingLanguage; sourceCode: string; updatedAt: string } | null;
  /** Every submission the student has made for this question in this session (newest first). */
  submissions: ExamSubmissionSummary[];
}

export interface ExamSessionView {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentDescription: string | null;
  timing: SessionTiming;
  questions: ExamQuestion[];
}

export interface SaveDraftResult {
  questionId: string;
  language: ProgrammingLanguage;
  sourceCode: string;
  updatedAt: string;
  timing: SessionTiming;
}

export interface SubmitResult {
  submission: ExamSubmissionSummary & { questionId: string };
  timing: SessionTiming;
}
