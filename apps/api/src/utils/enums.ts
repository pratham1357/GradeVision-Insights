import type {
  AssessmentStatus as PrismaAssessmentStatus,
  EvaluationRunStatus as PrismaEvaluationRunStatus,
  ExamSessionStatus as PrismaExamSessionStatus,
  HintDeliveryType as PrismaHintDeliveryType,
  HintUsageStatus as PrismaHintUsageStatus,
  ProgrammingLanguage as PrismaProgrammingLanguage,
  QuestionDifficulty as PrismaQuestionDifficulty,
  RubricCriterionType as PrismaRubricCriterionType,
  SubmissionStatus as PrismaSubmissionStatus,
  TestCaseCategory as PrismaTestCaseCategory,
  TestCaseResultStatus as PrismaTestCaseResultStatus,
  TestCaseVisibility as PrismaTestCaseVisibility,
} from "@gradevision/database";
import type {
  AssessmentStatus,
  EvaluationRunStatus,
  ExamSessionStatus,
  HintDeliveryType,
  HintUsageStatus,
  ProgrammingLanguage,
  QuestionDifficulty,
  RubricCriterionType,
  SubmissionStatus,
  TestCaseCategory,
  TestCaseResultStatus,
  TestCaseVisibility,
} from "@gradevision/shared";

export {
  ASSESSMENT_STATUSES,
  EVALUATION_RUN_STATUSES,
  EXAM_SESSION_STATUSES,
  HINT_DELIVERY_TYPES,
  HINT_USAGE_STATUSES,
  PROGRAMMING_LANGUAGES,
  QUESTION_DIFFICULTIES,
  RUBRIC_CRITERION_TYPES,
  SUBMISSION_STATUSES,
  TEST_CASE_CATEGORIES,
  TEST_CASE_RESULT_STATUSES,
  TEST_CASE_VISIBILITIES,
} from "@gradevision/shared";

// Compile-time guarantee that each shared enum union is identical to its Prisma
// enum. If the schema changes and the shared mirror is not updated, this breaks.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _enumsInSync: [
  Same<AssessmentStatus, PrismaAssessmentStatus>,
  Same<EvaluationRunStatus, PrismaEvaluationRunStatus>,
  Same<ExamSessionStatus, PrismaExamSessionStatus>,
  Same<HintDeliveryType, PrismaHintDeliveryType>,
  Same<HintUsageStatus, PrismaHintUsageStatus>,
  Same<ProgrammingLanguage, PrismaProgrammingLanguage>,
  Same<QuestionDifficulty, PrismaQuestionDifficulty>,
  Same<RubricCriterionType, PrismaRubricCriterionType>,
  Same<SubmissionStatus, PrismaSubmissionStatus>,
  Same<TestCaseCategory, PrismaTestCaseCategory>,
  Same<TestCaseResultStatus, PrismaTestCaseResultStatus>,
  Same<TestCaseVisibility, PrismaTestCaseVisibility>,
] = [true, true, true, true, true, true, true, true, true, true, true, true];
void _enumsInSync;
