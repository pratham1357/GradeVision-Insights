/**
 * API contract for the student assessment-taking workflow.
 *
 * Response shapes exchanged between the API and the web client. Enum tuples
 * mirror the Prisma enums (the API asserts they stay in sync). Hidden test-case
 * data is never part of any student-facing type.
 */
import type { SubmissionEvaluationSummary } from "./evaluation.js";
import type {
  AssessmentStatus,
  ExternalProblemReference,
  ProgrammingLanguage,
  QuestionDifficulty,
} from "./instructor.js";
import type { SessionIntegritySummary } from "./integrity.js";

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

/**
 * Factual outcome of a Transfer Check attempt, read from its persisted
 * evaluation: no score, no mastery. `NOT_EVALUATED` = the grader failed, which
 * is not the student's doing and does not consume the attempt.
 */
export type TransferCheckResult = "PASSED" | "FAILED" | "PENDING" | "NOT_EVALUATED";

/**
 * The Transfer Check attached to an assessment question: a related question
 * the student may attempt - with hints off - once this question is solved.
 * Reported separately from the assessment score.
 */
export interface ExamTransferCheck {
  /** The transfer question (a normal question; never part of this assessment). */
  questionId: string;
  title: string;
  /** Concept labels of the transfer question, for display. */
  concepts: string[];
  /** The source question is solved (latest evaluated attempt passed every test). */
  available: boolean;
  lockedReason: string | null;
  /** A counted attempt exists (pending or graded). One attempt only. */
  attempted: boolean;
  submission: ExamSubmissionSummary | null;
  result: TransferCheckResult | null;
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
  /** Informational-only pointer to a recognizable public problem, if any. */
  externalReference: ExternalProblemReference | null;
  /** The student's last saved code for this question in this session. */
  draft: { language: ProgrammingLanguage; sourceCode: string; updatedAt: string } | null;
  /** Every submission the student has made for this question in this session (newest first). */
  submissions: ExamSubmissionSummary[];
  /** Present when the instructor attached a Transfer Check to this question. */
  transferCheck: ExamTransferCheck | null;
}

/** `GET /api/v1/student/sessions/:sessionId/questions/:questionId/transfer`. */
export interface TransferCheckView {
  sourceQuestionId: string;
  sourceTitle: string;
  /** The transfer question's content, draft and transfer submissions (position/points are 0). */
  question: ExamQuestion;
  transfer: ExamTransferCheck;
  timing: SessionTiming;
}

export interface ExamSessionView {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentDescription: string | null;
  /** Live assessment status - lets the exam page warn if the instructor closed it. */
  assessmentStatus: AssessmentStatus;
  timing: SessionTiming;
  /** Client-reported focus/fullscreen integrity signals for this session. */
  integrity: SessionIntegritySummary;
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
