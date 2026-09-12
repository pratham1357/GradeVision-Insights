/**
 * API contract for automated evaluation results (student- and instructor-facing).
 *
 * Response shapes only - not a mirror of the Prisma schema. Enum tuples mirror
 * the Prisma enums (the API asserts they stay in sync). Hidden test-case data
 * (name, input, expected/actual output) is never part of a student-facing type.
 */
import type { ProgrammingLanguage, RubricCriterionType, TestCaseVisibility } from "./instructor.js";
import type { ExamSessionStatus, SubmissionStatus, TransferCheckResult } from "./student.js";

export const EVALUATION_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type EvaluationRunStatus = (typeof EVALUATION_RUN_STATUSES)[number];

export const TEST_CASE_RESULT_STATUSES = [
  "PASSED",
  "FAILED",
  "ERROR",
  "TIMEOUT",
  "SKIPPED",
] as const;
export type TestCaseResultStatus = (typeof TEST_CASE_RESULT_STATUSES)[number];

/** Compact evaluation status attached to a submission summary in the exam view. */
export interface SubmissionEvaluationSummary {
  status: EvaluationRunStatus;
  score: number | null;
  maxScore: number | null;
  scorePercent: number | null;
  testsPassed: number;
  testsTotal: number;
}

/**
 * One test-case outcome as shown to a student. For HIDDEN cases every
 * identifying field is `null` - only the pass/fail status and timing survive.
 */
export interface StudentTestResult {
  index: number;
  name: string | null;
  visibility: TestCaseVisibility;
  hidden: boolean;
  status: TestCaseResultStatus;
  passed: boolean;
  executionTimeMs: number | null;
  input: string | null;
  expectedOutput: string | null;
  actualOutput: string | null;
}

export interface RubricBreakdownItem {
  name: string;
  type: RubricCriterionType;
  pointsAwarded: number;
  maxPoints: number;
  notes: string | null;
  reasons: string[];
}

export interface SubmissionEvaluationDetail {
  status: EvaluationRunStatus;
  score: number | null;
  maxScore: number | null;
  scorePercent: number | null;
  testsPassed: number;
  testsTotal: number;
  executionTimeMs: number | null;
  memoryKb: number | null;
  error: { type: string; message: string } | null;
  completedAt: string | null;
  testResults: StudentTestResult[];
  rubric: RubricBreakdownItem[];
  feedback: string[];
}

/** `GET /api/v1/student/submissions/:submissionId`. */
export interface SubmissionResultView {
  submissionId: string;
  questionId: string;
  questionTitle: string;
  attemptNumber: number;
  language: ProgrammingLanguage;
  submittedAt: string;
  submissionStatus: SubmissionStatus;
  evaluation: SubmissionEvaluationDetail | null;
}

// ---------------------------------------------------------------------------
// Instructor results
// ---------------------------------------------------------------------------

export interface InstructorResultQuestionScore {
  questionId: string;
  title: string;
  position: number;
  points: number;
  submissionStatus: SubmissionStatus | null;
  evaluationStatus: EvaluationRunStatus | null;
  score: number | null;
  maxScore: number | null;
  scorePercent: number | null;
  testsPassed: number;
  testsTotal: number;
}

export interface InstructorResultRow {
  studentId: string;
  studentName: string;
  studentEmail: string;
  sessionId: string | null;
  sessionStatus: ExamSessionStatus | null;
  startedAt: string | null;
  submittedAt: string | null;
  totalScore: number;
  maxScore: number;
  scorePercent: number | null;
  /** Count of recorded integrity violations for this student's session. */
  violationCount: number;
  questions: InstructorResultQuestionScore[];
}

/** Assessment-level aggregates. Numbers are `null` when there is no data yet. */
export interface InstructorAssessmentStats {
  totalStudents: number;
  startedCount: number;
  submittedCount: number;
  inProgressCount: number;
  gradedCount: number;
  averageScorePercent: number | null;
  highestScorePercent: number | null;
  lowestScorePercent: number | null;
  totalViolations: number;
  studentsWithViolations: number;
}

/** `GET /api/v1/assessments/:assessmentId/results`. */
export interface InstructorAssessmentResults {
  assessmentId: string;
  assessmentTitle: string;
  questions: { questionId: string; title: string; position: number; points: number }[];
  stats: InstructorAssessmentStats;
  students: InstructorResultRow[];
}

/**
 * One immutable code snapshot for a question, as shown to an instructor in the
 * read-only code viewer. Carries only what the student actually submitted -
 * never a reference solution, never hidden test data.
 */
export interface InstructorSubmissionVersion {
  submissionId: string;
  attemptNumber: number;
  language: ProgrammingLanguage;
  sourceCode: string;
  status: SubmissionStatus;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence Replay (instructor) - reconstructed from persisted rows only
// ---------------------------------------------------------------------------

/**
 * One persisted hint usage, placed in the attempt timeline by its timestamp.
 * `grantedAfter` echoes the evidence the hint policy recorded when it granted
 * the stage (counts only) - a fact about the record, not a causal claim.
 */
export interface ReplayHint {
  stageNumber: number;
  title: string | null;
  source: "static" | "ai";
  /** ISO instant the hint was delivered (consumedAt, else requestedAt). */
  requestedAt: string;
  /** The guidance text actually delivered, when persisted. */
  content: string | null;
  grantedAfter: {
    unsuccessfulAttempts: number;
    latestOutcome: "PASSED" | "FAILED" | null;
  } | null;
}

/**
 * One submission attempt with everything persisted about it: the code, the
 * evaluation (hidden-case data redacted exactly as for students), and the
 * hints delivered after the previous attempt and before this one.
 */
export interface ReplayAttempt {
  attemptNumber: number;
  submissionId: string;
  submittedAt: string;
  language: ProgrammingLanguage;
  sourceCode: string;
  submissionStatus: SubmissionStatus;
  /** `null` while queued/running or when no run exists. */
  evaluation: SubmissionEvaluationDetail | null;
  hintsBefore: ReplayHint[];
}

/** The counted Transfer Check attempt, with the same evidence as a normal attempt. */
export interface ReplayTransferAttempt {
  submissionId: string;
  attemptNumber: number;
  submittedAt: string;
  language: ProgrammingLanguage;
  sourceCode: string;
  submissionStatus: SubmissionStatus;
  evaluation: SubmissionEvaluationDetail | null;
}

/**
 * `GET /api/v1/assessments/:assessmentId/sessions/:sessionId/result` - one
 * student's full per-question breakdown. Hidden test-case input/expected/actual
 * output stay redacted even for the instructor.
 */
export interface InstructorSessionResult {
  sessionId: string;
  assessmentId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  sessionStatus: ExamSessionStatus;
  startedAt: string | null;
  submittedAt: string | null;
  totalScore: number;
  maxScore: number;
  scorePercent: number | null;
  violationCount: number;
  questions: {
    questionId: string;
    title: string;
    position: number;
    points: number;
    submissionId: string | null;
    attemptNumber: number | null;
    submissionStatus: SubmissionStatus | null;
    evaluation: SubmissionEvaluationDetail | null;
    /** Every submission this student made for this question in this session, newest first. */
    versions: InstructorSubmissionVersion[];
    /**
     * Evidence Replay: every attempt oldest first, each with its own evaluation
     * and the hints delivered before it. Reconstructed from persisted rows.
     */
    attempts: ReplayAttempt[];
    /** Hints delivered after the final attempt (or with no attempt at all). */
    hintsAfterFinalAttempt: ReplayHint[];
    /**
     * The question's Transfer Check and this student's counted attempt at it, if
     * any. Reported beside - never inside - the question's marks.
     */
    transferCheck: {
      questionId: string;
      title: string;
      attempted: boolean;
      result: TransferCheckResult | null;
      submissionId: string | null;
      testsPassed: number | null;
      testsTotal: number | null;
      submittedAt: string | null;
      attempt: ReplayTransferAttempt | null;
    } | null;
  }[];
}
