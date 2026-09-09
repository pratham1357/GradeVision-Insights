/**
 * API contract for the instructor assessment-authoring workflow.
 *
 * These are response/enum shapes exchanged between the API and the web client -
 * NOT a mirror of the Prisma schema. The enum tuples mirror the Prisma enums; the
 * API has a compile-time assertion that they stay in sync.
 */

export const PROGRAMMING_LANGUAGES = ["C", "CPP", "JAVA", "PYTHON", "JAVASCRIPT"] as const;
export type ProgrammingLanguage = (typeof PROGRAMMING_LANGUAGES)[number];

export const QUESTION_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const ASSESSMENT_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "CLOSED", "ARCHIVED"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const TEST_CASE_VISIBILITIES = ["VISIBLE", "HIDDEN"] as const;
export type TestCaseVisibility = (typeof TEST_CASE_VISIBILITIES)[number];

export const TEST_CASE_CATEGORIES = [
  "STANDARD",
  "SAMPLE",
  "EDGE",
  "PERFORMANCE",
  "STRESS",
] as const;
export type TestCaseCategory = (typeof TEST_CASE_CATEGORIES)[number];

export const RUBRIC_CRITERION_TYPES = [
  "FUNCTIONAL_CORRECTNESS",
  "SEMANTIC_CORRECTNESS",
  "ALGORITHMIC_APPROACH",
  "PERFORMANCE",
  "CODE_QUALITY",
  "OTHER",
] as const;
export type RubricCriterionType = (typeof RUBRIC_CRITERION_TYPES)[number];

// ---------------------------------------------------------------------------
// Courses & sections
// ---------------------------------------------------------------------------

export interface InstructorSection {
  id: string;
  name: string;
  term: string | null;
  year: number | null;
  enrollmentCount: number;
  course: { id: string; code: string; name: string };
}

export interface InstructorCourse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sections: InstructorSection[];
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export interface AssessmentQuestionLink {
  questionId: string;
  title: string;
  difficulty: QuestionDifficulty;
  position: number;
  points: number;
}

export interface AssessmentSummary {
  id: string;
  title: string;
  description: string | null;
  status: AssessmentStatus;
  durationMinutes: number | null;
  sectionId: string | null;
  section: { id: string; name: string; courseCode: string } | null;
  questionCount: number;
  totalPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentDetail extends AssessmentSummary {
  questions: AssessmentQuestionLink[];
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * Informational-only pointer to a recognizable public problem (e.g. LeetCode) a
 * question is modelled after. Never fetched at runtime; never carries hidden
 * tests or a solution - display metadata only.
 */
export interface ExternalProblemReference {
  source: string;
  number: number | null;
  title: string | null;
  difficulty: string | null;
  url: string | null;
}

export interface QuestionSummary {
  id: string;
  title: string;
  difficulty: QuestionDifficulty;
  languageCount: number;
  testCaseCount: number;
  isArchived: boolean;
  updatedAt: string;
  externalReference: ExternalProblemReference | null;
}

export interface QuestionLanguageDto {
  language: ProgrammingLanguage;
  starterCode: string | null;
  isEnabled: boolean;
}

/** Instructor-facing test case. Includes `expectedOutput`; student endpoints must not. */
export interface TestCaseDto {
  id: string;
  name: string | null;
  input: string;
  expectedOutput: string;
  visibility: TestCaseVisibility;
  category: TestCaseCategory;
  weight: number;
  position: number;
  isActive: boolean;
}

export interface RubricCriterionDto {
  id: string;
  name: string;
  description: string | null;
  type: RubricCriterionType;
  maxPoints: number;
  position: number;
}

export interface RubricDto {
  id: string | null;
  name: string | null;
  description: string | null;
  criteria: RubricCriterionDto[];
}

export interface QuestionDetail {
  id: string;
  title: string;
  statement: string;
  constraints: string | null;
  inputFormat: string | null;
  outputFormat: string | null;
  difficulty: QuestionDifficulty;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  isArchived: boolean;
  languages: QuestionLanguageDto[];
  testCases: TestCaseDto[];
  rubric: RubricDto;
  createdAt: string;
  updatedAt: string;
  externalReference: ExternalProblemReference | null;
}
