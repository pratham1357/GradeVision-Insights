import type {
  AssessmentStatus as PrismaAssessmentStatus,
  ProgrammingLanguage as PrismaProgrammingLanguage,
  QuestionDifficulty as PrismaQuestionDifficulty,
  RubricCriterionType as PrismaRubricCriterionType,
  TestCaseCategory as PrismaTestCaseCategory,
  TestCaseVisibility as PrismaTestCaseVisibility,
} from "@gradevision/database";
import type {
  AssessmentStatus,
  ProgrammingLanguage,
  QuestionDifficulty,
  RubricCriterionType,
  TestCaseCategory,
  TestCaseVisibility,
} from "@gradevision/shared";

export {
  ASSESSMENT_STATUSES,
  PROGRAMMING_LANGUAGES,
  QUESTION_DIFFICULTIES,
  RUBRIC_CRITERION_TYPES,
  TEST_CASE_CATEGORIES,
  TEST_CASE_VISIBILITIES,
} from "@gradevision/shared";

// Compile-time guarantee that each shared enum union is identical to its Prisma
// enum. If the schema changes and the shared mirror is not updated, this breaks.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _enumsInSync: [
  Same<AssessmentStatus, PrismaAssessmentStatus>,
  Same<ProgrammingLanguage, PrismaProgrammingLanguage>,
  Same<QuestionDifficulty, PrismaQuestionDifficulty>,
  Same<RubricCriterionType, PrismaRubricCriterionType>,
  Same<TestCaseCategory, PrismaTestCaseCategory>,
  Same<TestCaseVisibility, PrismaTestCaseVisibility>,
] = [true, true, true, true, true, true];
void _enumsInSync;
