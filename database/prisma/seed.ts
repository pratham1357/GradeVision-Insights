/**
 * Deterministic development seed for GradeVision Insights.
 *
 * Safe to run repeatedly: every record is upserted by a stable id or natural key.
 * All credentials/data are obviously fake and for local development only.
 */
import {
  AssessmentStatus,
  EnrollmentStatus,
  HintDeliveryType,
  Prisma,
  PrismaClient,
  ProgrammingLanguage,
  QuestionDifficulty,
  RubricCriterionType,
  TestCaseCategory,
  TestCaseVisibility,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * DEVELOPMENT-ONLY credentials. Never use these anywhere real.
 *
 *   instructor@example.edu   ->  instructor-dev-password
 *   student1@example.edu     ->  student-dev-password
 *   student2@example.edu     ->  student-dev-password
 *
 * The values below are pre-computed Argon2id hashes (m=19456, t=2, p=1) of those
 * passwords - hard-coded so the seed stays deterministic and needs no crypto
 * dependency. They are verified by the API's `verifyPassword` at login.
 */
const INSTRUCTOR_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$vEnhhhWdFBqheoAydsybqQ$8GQMqr0xkXnoV7OpEYkMlp7SrM0s9M9Vxnaoz/iDzdU";
const STUDENT_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$mpOuUrj4ATdQESCnCUuheA$4d6Pqekb47N/wNQinPoMty2DbUSG0xcRvqL0ogKVg0E";

// Stable ids so reseeding is idempotent.
const ids = {
  instructor: "00000000-0000-4000-8000-000000000001",
  student1: "00000000-0000-4000-8000-000000000002",
  student2: "00000000-0000-4000-8000-000000000003",
  course: "00000000-0000-4000-8000-000000000010",
  section: "00000000-0000-4000-8000-000000000020",
  assessment: "00000000-0000-4000-8000-000000000030",
  activeAssessment: "00000000-0000-4000-8000-000000000031",
  question: "00000000-0000-4000-8000-000000000040",
  question2: "00000000-0000-4000-8000-000000000041",
  rubric: "00000000-0000-4000-8000-000000000050",
  criterionFunctional: "00000000-0000-4000-8000-000000000051",
  criterionApproach: "00000000-0000-4000-8000-000000000052",
  criterionQuality: "00000000-0000-4000-8000-000000000053",
  testSample: "00000000-0000-4000-8000-000000000061",
  testVisible: "00000000-0000-4000-8000-000000000062",
  testHidden1: "00000000-0000-4000-8000-000000000063",
  testHidden2: "00000000-0000-4000-8000-000000000064",
  hintStage1: "00000000-0000-4000-8000-000000000071",
  hintStage2: "00000000-0000-4000-8000-000000000072",
  hintStage3: "00000000-0000-4000-8000-000000000073",
  hintStage4: "00000000-0000-4000-8000-000000000074",
  q2HintStage1: "00000000-0000-4000-8000-000000000075",
  q2HintStage2: "00000000-0000-4000-8000-000000000076",
  q3HintStage1: "00000000-0000-4000-8000-000000000077",
  q3HintStage2: "00000000-0000-4000-8000-000000000078",
  // --- Additional CS101-level questions (question pool for random assignment) ---
  question3: "00000000-0000-4000-8000-000000000080",
  question4: "00000000-0000-4000-8000-000000000081",
  question5: "00000000-0000-4000-8000-000000000082",
  q3TestSample: "00000000-0000-4000-8000-000000000090",
  q3TestVisible: "00000000-0000-4000-8000-000000000091",
  q3TestHidden1: "00000000-0000-4000-8000-000000000092",
  q3TestHidden2: "00000000-0000-4000-8000-000000000093",
  q4TestSample: "00000000-0000-4000-8000-000000000094",
  q4TestVisible: "00000000-0000-4000-8000-000000000095",
  q4TestHidden1: "00000000-0000-4000-8000-000000000096",
  q4TestHidden2: "00000000-0000-4000-8000-000000000097",
  q5TestSample: "00000000-0000-4000-8000-000000000098",
  q5TestVisible: "00000000-0000-4000-8000-000000000099",
  q5TestHidden1: "00000000-0000-4000-8000-000000000100",
  q5TestHidden2: "00000000-0000-4000-8000-000000000101",
  q3Rubric: "00000000-0000-4000-8000-000000000110",
  q3CriterionFunctional: "00000000-0000-4000-8000-000000000111",
  q3CriterionApproach: "00000000-0000-4000-8000-000000000112",
  q3CriterionQuality: "00000000-0000-4000-8000-000000000113",
  q4Rubric: "00000000-0000-4000-8000-000000000120",
  q4CriterionFunctional: "00000000-0000-4000-8000-000000000121",
  q4CriterionApproach: "00000000-0000-4000-8000-000000000122",
  q4CriterionQuality: "00000000-0000-4000-8000-000000000123",
  q5Rubric: "00000000-0000-4000-8000-000000000130",
  q5CriterionFunctional: "00000000-0000-4000-8000-000000000131",
  q5CriterionApproach: "00000000-0000-4000-8000-000000000132",
  q5CriterionQuality: "00000000-0000-4000-8000-000000000133",
  // --- Transfer Check question (never in the pool: offered after Two Sum) ---
  question6: "00000000-0000-4000-8000-000000000083",
  q6TestSample: "00000000-0000-4000-8000-000000000102",
  q6TestVisible: "00000000-0000-4000-8000-000000000103",
  q6TestHidden1: "00000000-0000-4000-8000-000000000104",
  q6TestHidden2: "00000000-0000-4000-8000-000000000105",
  // --- Concepts (instructor-authored labels attached to the questions above) ---
  conceptInputParsing: "00000000-0000-4000-8000-000000000200",
  conceptArithmetic: "00000000-0000-4000-8000-000000000201",
  conceptStrings: "00000000-0000-4000-8000-000000000202",
  conceptArrays: "00000000-0000-4000-8000-000000000203",
  conceptLoops: "00000000-0000-4000-8000-000000000204",
  conceptConditionals: "00000000-0000-4000-8000-000000000205",
  conceptHashMaps: "00000000-0000-4000-8000-000000000206",
  conceptStacks: "00000000-0000-4000-8000-000000000207",
} as const;

// ---------------------------------------------------------------------------
// Deterministic PRNG for question assignment - NOT for anything security-related.
// Reseeding always shuffles identically (same input seed -> same output), so a
// re-run of this script never reshuffles an assessment that already exists.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

/** A fixed-seed Fisher-Yates shuffle, then take the first `count` - deterministic per `seedKey`. */
function pickQuestions<T extends { id: string }>(pool: T[], seedKey: string, count: number): T[] {
  const random = mulberry32(seedFromString(seedKey));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, count);
}

/**
 * Assigns exactly `questions` to `assessmentId` via `AssessmentQuestion` - the
 * persisted, deterministic record of "which questions does this assessment
 * have". Re-running with the same picks is a no-op; a changed pick set (e.g.
 * the pool grew) converges the links to match without touching Submissions.
 */
async function syncAssessmentQuestions(
  assessmentId: string,
  questions: { id: string }[],
): Promise<void> {
  const keepIds = questions.map((q) => q.id);
  await prisma.assessmentQuestion.deleteMany({
    where: { assessmentId, questionId: { notIn: keepIds } },
  });
  for (const [position, question] of questions.entries()) {
    await prisma.assessmentQuestion.upsert({
      where: { assessmentId_questionId: { assessmentId, questionId: question.id } },
      update: { position, points: 100 },
      create: { assessmentId, questionId: question.id, position, points: 100 },
    });
  }
}

const QUESTIONS_PER_ASSESSMENT = 3;

async function main(): Promise<void> {
  const instructor = await prisma.user.upsert({
    where: { email: "instructor@example.edu" },
    update: {
      name: "Dev Instructor",
      role: UserRole.INSTRUCTOR,
      passwordHash: INSTRUCTOR_PASSWORD_HASH,
    },
    create: {
      id: ids.instructor,
      email: "instructor@example.edu",
      name: "Dev Instructor",
      role: UserRole.INSTRUCTOR,
      passwordHash: INSTRUCTOR_PASSWORD_HASH,
    },
  });

  const student1 = await prisma.user.upsert({
    where: { email: "student1@example.edu" },
    update: { name: "Dev Student One", passwordHash: STUDENT_PASSWORD_HASH },
    create: {
      id: ids.student1,
      email: "student1@example.edu",
      name: "Dev Student One",
      role: UserRole.STUDENT,
      passwordHash: STUDENT_PASSWORD_HASH,
    },
  });

  const student2 = await prisma.user.upsert({
    where: { email: "student2@example.edu" },
    update: { name: "Dev Student Two", passwordHash: STUDENT_PASSWORD_HASH },
    create: {
      id: ids.student2,
      email: "student2@example.edu",
      name: "Dev Student Two",
      role: UserRole.STUDENT,
      passwordHash: STUDENT_PASSWORD_HASH,
    },
  });

  const course = await prisma.course.upsert({
    where: { code: "CS101" },
    update: { name: "Introduction to Programming" },
    create: {
      id: ids.course,
      code: "CS101",
      name: "Introduction to Programming",
      description: "Foundational programming course used for local development.",
    },
  });

  const section = await prisma.section.upsert({
    where: { courseId_name: { courseId: course.id, name: "Section A" } },
    update: { instructorId: instructor.id, term: "Fall", year: 2026 },
    create: {
      id: ids.section,
      courseId: course.id,
      name: "Section A",
      term: "Fall",
      year: 2026,
      instructorId: instructor.id,
    },
  });

  for (const student of [student1, student2]) {
    await prisma.enrollment.upsert({
      where: { studentId_sectionId: { studentId: student.id, sectionId: section.id } },
      update: { status: EnrollmentStatus.ACTIVE },
      create: {
        studentId: student.id,
        sectionId: section.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
  }

  // --- Question 1: Sum of Two Integers ---------------------------------------
  // NOTE: the starter code below is a genuine template (input parsing only). It
  // must never contain a working solution - Monaco preloads exactly this text
  // for a student who has no saved draft yet.
  const question = await prisma.question.upsert({
    where: { id: ids.question },
    update: {},
    create: {
      id: ids.question,
      title: "Sum of Two Integers",
      statement: "Read two integers `a` and `b` from standard input and print their sum.",
      constraints: "-10^9 <= a, b <= 10^9",
      inputFormat: "A single line containing two space-separated integers a and b.",
      outputFormat: "A single line containing the integer a + b.",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      // Not mapped to a LeetCode problem: this is an original warm-up exercise,
      // not a recognizable public problem, so `externalReference` stays null
      // rather than attaching a misleading LeetCode number.
    },
  });
  await upsertLanguages(question.id, [
    {
      language: ProgrammingLanguage.PYTHON,
      starterCode: "a, b = map(int, input().split())\n# your code here\n",
    },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode:
        "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// your code here\n",
    },
  ]);

  await prisma.testCase.upsert({
    where: { id: ids.testSample },
    update: {},
    create: {
      id: ids.testSample,
      questionId: question.id,
      name: "Sample",
      input: "2 3\n",
      expectedOutput: "5\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.SAMPLE,
      weight: 0,
      position: 0,
    },
  });

  await prisma.testCase.upsert({
    where: { id: ids.testVisible },
    update: {},
    create: {
      id: ids.testVisible,
      questionId: question.id,
      name: "Visible - negatives",
      input: "-4 10\n",
      expectedOutput: "6\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 1,
    },
  });

  await prisma.testCase.upsert({
    where: { id: ids.testHidden1 },
    update: {},
    create: {
      id: ids.testHidden1,
      questionId: question.id,
      name: "Hidden - zero",
      input: "0 0\n",
      expectedOutput: "0\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 2,
    },
  });

  await prisma.testCase.upsert({
    where: { id: ids.testHidden2 },
    update: {},
    create: {
      id: ids.testHidden2,
      questionId: question.id,
      name: "Hidden - large bounds",
      input: "1000000000 1000000000\n",
      expectedOutput: "2000000000\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.EDGE,
      weight: 2,
      position: 3,
    },
  });

  const rubric = await prisma.rubric.upsert({
    where: { questionId: question.id },
    update: {},
    create: {
      id: ids.rubric,
      questionId: question.id,
      name: "Default rubric",
      description: "Multi-criterion rubric for approach-agnostic grading.",
    },
  });

  await upsertCriteria(rubric.id, [
    {
      id: ids.criterionFunctional,
      name: "Functional correctness",
      description: "Passes the functional and hidden test cases.",
      type: RubricCriterionType.FUNCTIONAL_CORRECTNESS,
      maxPoints: 70,
      position: 0,
      config: {},
    },
    {
      id: ids.criterionApproach,
      name: "Algorithmic approach",
      description: "Uses a correct, appropriately efficient approach.",
      type: RubricCriterionType.ALGORITHMIC_APPROACH,
      maxPoints: 20,
      position: 1,
      config: { forbidden: ["eval", "exec"], mode: "lenient" },
    },
    {
      id: ids.criterionQuality,
      name: "Code quality",
      description: "Readable structure, naming, and basic style.",
      type: RubricCriterionType.CODE_QUALITY,
      maxPoints: 10,
      position: 2,
      config: { maxFunctionLength: 40, maxNestingDepth: 4 },
    },
  ]);

  // --- Question 2: Greet by Name, so the student exam has real navigation ----
  const question2 = await prisma.question.upsert({
    where: { id: ids.question2 },
    update: {},
    create: {
      id: ids.question2,
      title: "Greet by Name",
      statement: "Read a name from standard input and print `Hello, <name>!`.",
      constraints: "The name is a single non-empty line, at most 100 characters.",
      inputFormat: "One line containing the name.",
      outputFormat: "One line: `Hello, <name>!`",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      testCases: {
        create: [
          {
            name: "Sample",
            input: "Ada\n",
            expectedOutput: "Hello, Ada!\n",
            visibility: TestCaseVisibility.VISIBLE,
            category: TestCaseCategory.SAMPLE,
            weight: 0,
            position: 0,
          },
          {
            name: "Hidden",
            input: "Grace\n",
            expectedOutput: "Hello, Grace!\n",
            visibility: TestCaseVisibility.HIDDEN,
            category: TestCaseCategory.STANDARD,
            weight: 1,
            position: 1,
          },
        ],
      },
    },
  });
  await upsertLanguages(question2.id, [
    { language: ProgrammingLanguage.PYTHON, starterCode: "name = input()\n# your code here\n" },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode:
        "const name = require('fs').readFileSync(0, 'utf8').trim();\n// your code here\n",
    },
  ]);

  // --- Question 3: Two Sum (LeetCode #1, Easy) --------------------------------
  const question3 = await prisma.question.upsert({
    where: { id: ids.question3 },
    update: {},
    create: {
      id: ids.question3,
      title: "Two Sum",
      statement:
        "Given an array of integers `nums` and an integer `target`, find the two distinct " +
        "indices such that `nums[i] + nums[j] == target`. Print the two 0-indexed positions, " +
        "in ascending order, separated by a single space. Assume each input has exactly one " +
        "solution, and the same element may not be used twice.",
      constraints:
        "2 <= n <= 1000\n-10^6 <= nums[i], target <= 10^6\nExactly one valid pair of indices exists.",
      inputFormat:
        "Line 1: two integers n and target, space-separated.\n" +
        "Line 2: n space-separated integers - the array nums.",
      outputFormat:
        "One line: the two 0-indexed positions of the numbers that add up to target, ascending, space-separated.",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      externalReference: {
        source: "LeetCode",
        number: 1,
        title: "Two Sum",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/two-sum/",
      } satisfies Prisma.InputJsonValue,
    },
  });
  await upsertLanguages(question3.id, [
    {
      language: ProgrammingLanguage.PYTHON,
      starterCode:
        "n, target = map(int, input().split())\nnums = list(map(int, input().split()))\n# your code here\n",
    },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode:
        "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n" +
        "const [n, target] = lines[0].split(' ').map(Number);\n" +
        "const nums = lines[1].split(' ').map(Number);\n" +
        "// your code here\n",
    },
  ]);

  await prisma.testCase.upsert({
    where: { id: ids.q3TestSample },
    update: {},
    create: {
      id: ids.q3TestSample,
      questionId: question3.id,
      name: "Sample",
      input: "4 9\n2 7 11 15\n",
      expectedOutput: "0 1\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.SAMPLE,
      weight: 0,
      position: 0,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q3TestVisible },
    update: {},
    create: {
      id: ids.q3TestVisible,
      questionId: question3.id,
      name: "Visible - middle pair",
      input: "3 6\n3 2 4\n",
      expectedOutput: "1 2\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 1,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q3TestHidden1 },
    update: {},
    create: {
      id: ids.q3TestHidden1,
      questionId: question3.id,
      name: "Hidden - negative target",
      input: "2 -1\n-3 2\n",
      expectedOutput: "0 1\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 2,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q3TestHidden2 },
    update: {},
    create: {
      id: ids.q3TestHidden2,
      questionId: question3.id,
      name: "Hidden - all negatives",
      input: "5 -8\n-1 -2 -3 -4 -5\n",
      expectedOutput: "2 4\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.EDGE,
      weight: 2,
      position: 3,
    },
  });

  const q3Rubric = await prisma.rubric.upsert({
    where: { questionId: question3.id },
    update: {},
    create: {
      id: ids.q3Rubric,
      questionId: question3.id,
      name: "Default rubric",
      description: "Multi-criterion rubric for approach-agnostic grading.",
    },
  });
  await upsertCriteria(q3Rubric.id, [
    {
      id: ids.q3CriterionFunctional,
      name: "Functional correctness",
      description: "Passes the functional and hidden test cases.",
      type: RubricCriterionType.FUNCTIONAL_CORRECTNESS,
      maxPoints: 70,
      position: 0,
      config: {},
    },
    {
      id: ids.q3CriterionApproach,
      name: "Algorithmic approach",
      description:
        "Uses a correct, appropriately efficient approach (e.g. a single hash-map pass).",
      type: RubricCriterionType.ALGORITHMIC_APPROACH,
      maxPoints: 20,
      position: 1,
      config: { forbidden: ["eval", "exec"], mode: "lenient" },
    },
    {
      id: ids.q3CriterionQuality,
      name: "Code quality",
      description: "Readable structure, naming, and basic style.",
      type: RubricCriterionType.CODE_QUALITY,
      maxPoints: 10,
      position: 2,
      config: { maxFunctionLength: 40, maxNestingDepth: 4 },
    },
  ]);

  // --- Question 4: Valid Parentheses (LeetCode #20, Easy) ---------------------
  const question4 = await prisma.question.upsert({
    where: { id: ids.question4 },
    update: {},
    create: {
      id: ids.question4,
      title: "Valid Parentheses",
      statement:
        "Given a string `s` containing just the characters '(', ')', '{', '}', '[' and ']', " +
        "determine if the input string is valid. A string is valid if every opening bracket is " +
        "closed by the same type of bracket, and brackets are closed in the correct order. " +
        "Print `true` if the string is valid, or `false` otherwise (lowercase, exactly as shown).",
      constraints:
        "1 <= length of s <= 10^4\ns consists only of the characters '(', ')', '{', '}', '[', ']'.",
      inputFormat: "One line containing the string s.",
      outputFormat: "One line: `true` or `false` (lowercase).",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      externalReference: {
        source: "LeetCode",
        number: 20,
        title: "Valid Parentheses",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/valid-parentheses/",
      } satisfies Prisma.InputJsonValue,
    },
  });
  await upsertLanguages(question4.id, [
    { language: ProgrammingLanguage.PYTHON, starterCode: "s = input()\n# your code here\n" },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode: "const s = require('fs').readFileSync(0, 'utf8').trim();\n// your code here\n",
    },
  ]);

  await prisma.testCase.upsert({
    where: { id: ids.q4TestSample },
    update: {},
    create: {
      id: ids.q4TestSample,
      questionId: question4.id,
      name: "Sample",
      input: "()[]{}\n",
      expectedOutput: "true\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.SAMPLE,
      weight: 0,
      position: 0,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q4TestVisible },
    update: {},
    create: {
      id: ids.q4TestVisible,
      questionId: question4.id,
      name: "Visible - mismatched",
      input: "(]\n",
      expectedOutput: "false\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 1,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q4TestHidden1 },
    update: {},
    create: {
      id: ids.q4TestHidden1,
      questionId: question4.id,
      name: "Hidden - nested",
      input: "([{}])\n",
      expectedOutput: "true\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 2,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q4TestHidden2 },
    update: {},
    create: {
      id: ids.q4TestHidden2,
      questionId: question4.id,
      name: "Hidden - unclosed",
      input: "(((\n",
      expectedOutput: "false\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.EDGE,
      weight: 2,
      position: 3,
    },
  });

  const q4Rubric = await prisma.rubric.upsert({
    where: { questionId: question4.id },
    update: {},
    create: {
      id: ids.q4Rubric,
      questionId: question4.id,
      name: "Default rubric",
      description: "Multi-criterion rubric for approach-agnostic grading.",
    },
  });
  await upsertCriteria(q4Rubric.id, [
    {
      id: ids.q4CriterionFunctional,
      name: "Functional correctness",
      description: "Passes the functional and hidden test cases.",
      type: RubricCriterionType.FUNCTIONAL_CORRECTNESS,
      maxPoints: 70,
      position: 0,
      config: {},
    },
    {
      id: ids.q4CriterionApproach,
      name: "Algorithmic approach",
      description: "Uses a correct, appropriately efficient approach (e.g. a stack).",
      type: RubricCriterionType.ALGORITHMIC_APPROACH,
      maxPoints: 20,
      position: 1,
      config: { forbidden: ["eval", "exec"], mode: "lenient" },
    },
    {
      id: ids.q4CriterionQuality,
      name: "Code quality",
      description: "Readable structure, naming, and basic style.",
      type: RubricCriterionType.CODE_QUALITY,
      maxPoints: 10,
      position: 2,
      config: { maxFunctionLength: 40, maxNestingDepth: 4 },
    },
  ]);

  // --- Question 5: Palindrome Number (LeetCode #9, Easy) ----------------------
  const question5 = await prisma.question.upsert({
    where: { id: ids.question5 },
    update: {},
    create: {
      id: ids.question5,
      title: "Palindrome Number",
      statement:
        "Given an integer `x`, print `true` if `x` is a palindrome integer (reads the same " +
        "forwards and backwards), and `false` otherwise. Negative numbers are never palindromes.",
      constraints: "-2^31 <= x <= 2^31 - 1",
      inputFormat: "One line containing the integer x.",
      outputFormat: "One line: `true` or `false` (lowercase).",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      externalReference: {
        source: "LeetCode",
        number: 9,
        title: "Palindrome Number",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/palindrome-number/",
      } satisfies Prisma.InputJsonValue,
    },
  });
  await upsertLanguages(question5.id, [
    { language: ProgrammingLanguage.PYTHON, starterCode: "x = int(input())\n# your code here\n" },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode:
        "const x = parseInt(require('fs').readFileSync(0, 'utf8').trim(), 10);\n// your code here\n",
    },
  ]);

  await prisma.testCase.upsert({
    where: { id: ids.q5TestSample },
    update: {},
    create: {
      id: ids.q5TestSample,
      questionId: question5.id,
      name: "Sample",
      input: "121\n",
      expectedOutput: "true\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.SAMPLE,
      weight: 0,
      position: 0,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q5TestVisible },
    update: {},
    create: {
      id: ids.q5TestVisible,
      questionId: question5.id,
      name: "Visible - negative",
      input: "-121\n",
      expectedOutput: "false\n",
      visibility: TestCaseVisibility.VISIBLE,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 1,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q5TestHidden1 },
    update: {},
    create: {
      id: ids.q5TestHidden1,
      questionId: question5.id,
      name: "Hidden - trailing zero",
      input: "10\n",
      expectedOutput: "false\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.STANDARD,
      weight: 1,
      position: 2,
    },
  });
  await prisma.testCase.upsert({
    where: { id: ids.q5TestHidden2 },
    update: {},
    create: {
      id: ids.q5TestHidden2,
      questionId: question5.id,
      name: "Hidden - single digit",
      input: "0\n",
      expectedOutput: "true\n",
      visibility: TestCaseVisibility.HIDDEN,
      category: TestCaseCategory.EDGE,
      weight: 2,
      position: 3,
    },
  });

  const q5Rubric = await prisma.rubric.upsert({
    where: { questionId: question5.id },
    update: {},
    create: {
      id: ids.q5Rubric,
      questionId: question5.id,
      name: "Default rubric",
      description: "Multi-criterion rubric for approach-agnostic grading.",
    },
  });
  await upsertCriteria(q5Rubric.id, [
    {
      id: ids.q5CriterionFunctional,
      name: "Functional correctness",
      description: "Passes the functional and hidden test cases.",
      type: RubricCriterionType.FUNCTIONAL_CORRECTNESS,
      maxPoints: 70,
      position: 0,
      config: {},
    },
    {
      id: ids.q5CriterionApproach,
      name: "Algorithmic approach",
      description: "Uses a correct, appropriately efficient approach.",
      type: RubricCriterionType.ALGORITHMIC_APPROACH,
      maxPoints: 20,
      position: 1,
      config: { forbidden: ["eval", "exec"], mode: "lenient" },
    },
    {
      id: ids.q5CriterionQuality,
      name: "Code quality",
      description: "Readable structure, naming, and basic style.",
      type: RubricCriterionType.CODE_QUALITY,
      maxPoints: 10,
      position: 2,
      config: { maxFunctionLength: 40, maxNestingDepth: 4 },
    },
  ]);

  // --- Transfer Check for Two Sum: a related hash-map problem, not a copy ---
  // Kept OUT of the assessment pool: a question and its transfer check must
  // never share an assessment (the transfer task is offered, hints off, after
  // Two Sum is solved).
  const question6 = await prisma.question.upsert({
    where: { id: ids.question6 },
    update: {},
    create: {
      id: ids.question6,
      title: "Contains Duplicate",
      statement:
        "Given an array of integers `nums`, print `true` if any value appears at least twice " +
        "in the array, and `false` if every element is distinct (lowercase, exactly as shown).",
      constraints: "1 <= n <= 1000\n-10^6 <= nums[i] <= 10^6",
      inputFormat: "Line 1: an integer n.\nLine 2: n space-separated integers - the array nums.",
      outputFormat: "One line: `true` or `false` (lowercase).",
      difficulty: QuestionDifficulty.EASY,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      createdById: instructor.id,
      externalReference: {
        source: "LeetCode",
        number: 217,
        title: "Contains Duplicate",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/contains-duplicate/",
      } satisfies Prisma.InputJsonValue,
      testCases: {
        create: [
          {
            id: ids.q6TestSample,
            name: "Sample",
            input: "5\n1 2 3 1 5\n",
            expectedOutput: "true\n",
            visibility: TestCaseVisibility.VISIBLE,
            category: TestCaseCategory.SAMPLE,
            weight: 0,
            position: 0,
          },
          {
            id: ids.q6TestVisible,
            name: "Visible - all distinct",
            input: "4\n1 2 3 4\n",
            expectedOutput: "false\n",
            visibility: TestCaseVisibility.VISIBLE,
            category: TestCaseCategory.STANDARD,
            weight: 1,
            position: 1,
          },
          {
            id: ids.q6TestHidden1,
            name: "Hidden - single element",
            input: "1\n7\n",
            expectedOutput: "false\n",
            visibility: TestCaseVisibility.HIDDEN,
            category: TestCaseCategory.EDGE,
            weight: 1,
            position: 2,
          },
          {
            id: ids.q6TestHidden2,
            name: "Hidden - negative duplicate",
            input: "6\n-1 4 0 -1 2 3\n",
            expectedOutput: "true\n",
            visibility: TestCaseVisibility.HIDDEN,
            category: TestCaseCategory.STANDARD,
            weight: 1,
            position: 3,
          },
        ],
      },
    },
  });
  await upsertLanguages(question6.id, [
    {
      language: ProgrammingLanguage.PYTHON,
      starterCode: "n = int(input())\nnums = list(map(int, input().split()))\n# your code here\n",
    },
    {
      language: ProgrammingLanguage.JAVASCRIPT,
      starterCode:
        "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n" +
        "const n = Number(lines[0]);\n" +
        "const nums = lines[1].split(' ').map(Number);\n// your code here\n",
    },
  ]);
  // Two Sum -> Contains Duplicate (idempotent; converges on every run).
  await prisma.question.update({
    where: { id: question3.id },
    data: { transferQuestionId: question6.id },
  });

  // --- Assessments -------------------------------------------------------
  const assessment = await prisma.assessment.upsert({
    where: { id: ids.assessment },
    update: {},
    create: {
      id: ids.assessment,
      title: "CS101 - Practice Assessment 1",
      description: "Draft practice assessment for local development.",
      status: AssessmentStatus.DRAFT,
      courseId: course.id,
      sectionId: section.id,
      createdById: instructor.id,
      durationMinutes: 60,
    },
  });

  const activeAssessment = await prisma.assessment.upsert({
    where: { id: ids.activeAssessment },
    update: { status: AssessmentStatus.ACTIVE },
    create: {
      id: ids.activeAssessment,
      title: "CS101 - Live Coding Assessment",
      description: "An in-progress assessment for the student exam workflow.",
      status: AssessmentStatus.ACTIVE,
      courseId: course.id,
      sectionId: section.id,
      createdById: instructor.id,
      durationMinutes: 60,
    },
  });

  // --- Question assignment: a fixed-size, seeded-random draw from the pool ---
  // Randomization happens here (once, deterministically) - never at request time
  // and never re-rolled by a plain re-seed. `AssessmentQuestion` is the durable
  // record every student in the assessment shares.
  const questionPool = [question, question2, question3, question4, question5];
  const draftPicks = pickQuestions(
    questionPool,
    `assessment:${assessment.id}`,
    QUESTIONS_PER_ASSESSMENT,
  );
  const activePicks = pickQuestions(
    questionPool,
    `assessment:${activeAssessment.id}`,
    QUESTIONS_PER_ASSESSMENT,
  );
  await syncAssessmentQuestions(assessment.id, draftPicks);
  await syncAssessmentQuestions(activeAssessment.id, activePicks);

  // Progressive hints: three static stages that escalate, then an interactive
  // (AI mentor) stage. The interactive stage needs the hint-engine + a provider
  // key; without one the API returns a clear 503 rather than a fake hint.
  const hintStages: {
    id: string;
    questionId: string;
    stageNumber: number;
    title: string;
    description: string;
    deliveryType: HintDeliveryType;
    unlockDelaySeconds: number;
    content: string | null;
  }[] = [
    {
      id: ids.hintStage1,
      questionId: question.id,
      stageNumber: 1,
      title: "Conceptual nudge",
      description: "Points at the shape of the problem.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 0,
      content: "This is just input parsing plus one arithmetic operation - nothing more.",
    },
    {
      id: ids.hintStage2,
      questionId: question.id,
      stageNumber: 2,
      title: "Specific direction",
      description: "Names the technique.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 30,
      content: "Both integers are on one line - split the line, then convert each piece to an int.",
    },
    {
      id: ids.hintStage3,
      questionId: question.id,
      stageNumber: 3,
      title: "Approach & debugging",
      description: "Walks through the steps and common mistakes.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 90,
      content:
        "Steps: read one line, split on whitespace, map to int, sum, print. If you get a type error you probably added strings; if the count is wrong, check your split.",
    },
    {
      id: ids.hintStage4,
      questionId: question.id,
      stageNumber: 4,
      title: "Interactive mentor",
      description: "Opens the AI mentor, which responds to your current code.",
      deliveryType: HintDeliveryType.INTERACTIVE,
      unlockDelaySeconds: 150,
      content: null,
    },
    {
      id: ids.q2HintStage1,
      questionId: question2.id,
      stageNumber: 1,
      title: "Conceptual nudge",
      description: "Points at the shape of the problem.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 0,
      content: "You are building one output string from one input string - watch the exact format.",
    },
    {
      id: ids.q2HintStage2,
      questionId: question2.id,
      stageNumber: 2,
      title: "Specific direction",
      description: "Names the technique.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 30,
      content:
        "Strip the trailing newline from the input, then interpolate it into `Hello, <name>!`.",
    },
    // Two Sum: the source of the seeded Transfer Check, so the assisted -> transfer
    // loop can be demonstrated end to end (assistance here, none on the transfer).
    {
      id: ids.q3HintStage1,
      questionId: question3.id,
      stageNumber: 1,
      title: "Conceptual nudge",
      description: "Points at the shape of the problem.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 0,
      content:
        "For each number, the partner you need is fixed: target minus that number. Think about how to check quickly whether you have already seen it.",
    },
    {
      id: ids.q3HintStage2,
      questionId: question3.id,
      stageNumber: 2,
      title: "Specific direction",
      description: "Names the technique.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 0,
      content:
        "Keep a dictionary from value to index as you scan. Before storing a number, look up target minus it; if it is there, print that stored index and the current one.",
    },
  ];

  for (const stage of hintStages) {
    await prisma.hintStage.upsert({
      where: {
        questionId_stageNumber: { questionId: stage.questionId, stageNumber: stage.stageNumber },
      },
      update: {
        title: stage.title,
        description: stage.description,
        deliveryType: stage.deliveryType,
        unlockDelaySeconds: stage.unlockDelaySeconds,
        content: stage.content,
      },
      create: stage,
    });
  }

  // Concepts: a small canonical vocabulary, each one genuinely exercised by at
  // least one seeded question. Labels are instructor-authored metadata - they
  // say what a question is about, not what a student has mastered.
  const concepts: { id: string; name: string; description: string }[] = [
    {
      id: ids.conceptInputParsing,
      name: "Input Parsing",
      description: "Reading and converting values from standard input.",
    },
    {
      id: ids.conceptArithmetic,
      name: "Arithmetic",
      description: "Integer arithmetic and digit manipulation.",
    },
    {
      id: ids.conceptStrings,
      name: "Strings",
      description: "Building, formatting and scanning strings.",
    },
    {
      id: ids.conceptArrays,
      name: "Arrays",
      description: "Indexed sequences and positional access.",
    },
    { id: ids.conceptLoops, name: "Loops", description: "Iterating over input or a range." },
    {
      id: ids.conceptConditionals,
      name: "Conditionals",
      description: "Branching on a property of the input.",
    },
    {
      id: ids.conceptHashMaps,
      name: "Hash Maps",
      description: "Constant-time lookup by key (dictionary / object / map).",
    },
    {
      id: ids.conceptStacks,
      name: "Stacks",
      description: "Last-in, first-out matching and nesting.",
    },
  ];
  for (const concept of concepts) {
    await prisma.concept.upsert({
      where: { id: concept.id },
      update: { name: concept.name, description: concept.description },
      create: concept,
    });
  }

  // Question <-> Concept associations, from what each seeded statement asks for.
  const questionConcepts: [string, string[]][] = [
    [question.id, [ids.conceptInputParsing, ids.conceptArithmetic]], // Sum of Two Integers
    [question2.id, [ids.conceptInputParsing, ids.conceptStrings]], // Greet by Name
    [question3.id, [ids.conceptArrays, ids.conceptLoops, ids.conceptHashMaps]], // Two Sum
    [question4.id, [ids.conceptStrings, ids.conceptLoops, ids.conceptStacks]], // Valid Parentheses
    [question5.id, [ids.conceptArithmetic, ids.conceptConditionals, ids.conceptStrings]], // Palindrome Number
    [question6.id, [ids.conceptArrays, ids.conceptLoops, ids.conceptHashMaps]], // Contains Duplicate (transfer)
  ];
  for (const [questionId, conceptIds] of questionConcepts) {
    for (const conceptId of conceptIds) {
      await prisma.questionConcept.upsert({
        where: { questionId_conceptId: { questionId, conceptId } },
        update: {},
        create: { questionId, conceptId },
      });
    }
  }

  console.log("Seed complete:", {
    users: [instructor.email, student1.email, student2.email],
    course: course.code,
    section: section.name,
    assessments: [
      `${assessment.title} (DRAFT) - questions: ${draftPicks.map((q) => q.title).join(", ")}`,
      `${activeAssessment.title} (ACTIVE) - questions: ${activePicks.map((q) => q.title).join(", ")}`,
    ],
    questionPool: questionPool.map((q) => q.title),
  });
}

// --- Rubric criteria helper (shared by all five questions) -----------------

interface CriterionSeed {
  id: string;
  name: string;
  description: string;
  type: RubricCriterionType;
  maxPoints: number;
  position: number;
  // Machine-readable grading config the evaluator's rubric engine reads.
  config: Record<string, unknown>;
}

/**
 * Explicitly upserts each (question, language) starter-code row.
 *
 * The nested `languages: { create: [...] } }` inside a `question.upsert(...)`
 * call only runs when the question itself is being *created* - on a re-seed
 * where the question already exists, `update: {}` is a no-op and that nested
 * `create` never executes, so starter-code edits would silently never reach
 * an already-seeded database. This makes starter code idempotently converge
 * on every run, the same way `upsertCriteria` does for rubric criteria.
 */
async function upsertLanguages(
  questionId: string,
  languages: { language: ProgrammingLanguage; starterCode: string | null }[],
): Promise<void> {
  for (const entry of languages) {
    await prisma.questionLanguage.upsert({
      where: { questionId_language: { questionId, language: entry.language } },
      update: { starterCode: entry.starterCode, isEnabled: true },
      create: { questionId, language: entry.language, starterCode: entry.starterCode },
    });
  }
}

async function upsertCriteria(rubricId: string, criteria: CriterionSeed[]): Promise<void> {
  for (const criterion of criteria) {
    await prisma.rubricCriterion.upsert({
      where: { id: criterion.id },
      update: {
        name: criterion.name,
        description: criterion.description,
        type: criterion.type,
        maxPoints: criterion.maxPoints,
        position: criterion.position,
        config: criterion.config,
      },
      create: { rubricId, ...criterion },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
