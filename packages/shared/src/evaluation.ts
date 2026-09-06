/**
 * API contract for automated evaluation results (student- and instructor-facing).
 *
 * Response shapes only - not a mirror of the Prisma schema. Enum tuples mirror
 * the Prisma enums (the API asserts they stay in sync). Hidden test-case data
 * (name, input, expected/actual output) is never part of a student-facing type.
 */
import type { ProgrammingLanguage, RubricCriterionType, TestCaseVisibility } from "./instructor.js";
import type { ExamSessionStatus, SubmissionStatus } from "./student.js";

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
  questions: InstructorResultQuestionScore[];
}

/** `GET /api/v1/assessments/:assessmentId/results`. */
export interface InstructorAssessmentResults {
  assessmentId: string;
  assessmentTitle: string;
  questions: { questionId: string; title: string; position: number; points: number }[];
  students: InstructorResultRow[];
}
