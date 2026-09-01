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
  question: "00000000-0000-4000-8000-000000000040",
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
} as const;

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
      languages: {
        create: [
          {
            language: ProgrammingLanguage.PYTHON,
            starterCode: "a, b = map(int, input().split())\nprint(a + b)\n",
          },
          {
            language: ProgrammingLanguage.JAVASCRIPT,
            starterCode:
              "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n",
          },
        ],
      },
    },
  });

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

  const criteria: {
    id: string;
    name: string;
    description: string;
    type: RubricCriterionType;
    maxPoints: number;
    position: number;
  }[] = [
    {
      id: ids.criterionFunctional,
      name: "Functional correctness",
      description: "Passes the functional and hidden test cases.",
      type: RubricCriterionType.FUNCTIONAL_CORRECTNESS,
      maxPoints: 70,
      position: 0,
    },
    {
      id: ids.criterionApproach,
      name: "Algorithmic approach",
      description: "Uses a correct, appropriately efficient approach.",
      type: RubricCriterionType.ALGORITHMIC_APPROACH,
      maxPoints: 20,
      position: 1,
    },
    {
      id: ids.criterionQuality,
      name: "Code quality",
      description: "Readable structure, naming, and basic style.",
      type: RubricCriterionType.CODE_QUALITY,
      maxPoints: 10,
      position: 2,
    },
  ];

  for (const criterion of criteria) {
    await prisma.rubricCriterion.upsert({
      where: { id: criterion.id },
      update: {
        name: criterion.name,
        description: criterion.description,
        type: criterion.type,
        maxPoints: criterion.maxPoints,
        position: criterion.position,
      },
      create: { rubricId: rubric.id, ...criterion },
    });
  }

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

  await prisma.assessmentQuestion.upsert({
    where: {
      assessmentId_questionId: { assessmentId: assessment.id, questionId: question.id },
    },
    update: { position: 0, points: 100 },
    create: {
      assessmentId: assessment.id,
      questionId: question.id,
      position: 0,
      points: 100,
    },
  });

  await prisma.hintStage.upsert({
    where: { questionId_stageNumber: { questionId: question.id, stageNumber: 1 } },
    update: {},
    create: {
      id: ids.hintStage1,
      questionId: question.id,
      stageNumber: 1,
      title: "Getting started",
      description: "Nudge toward reading input correctly.",
      deliveryType: HintDeliveryType.STATIC,
      unlockDelaySeconds: 0,
      content: "Both integers are on one line - split the line before converting.",
    },
  });

  await prisma.hintStage.upsert({
    where: { questionId_stageNumber: { questionId: question.id, stageNumber: 2 } },
    update: {},
    create: {
      id: ids.hintStage2,
      questionId: question.id,
      stageNumber: 2,
      title: "Interactive mentor",
      description: "Opens the AI mentor chat after a waiting period.",
      deliveryType: HintDeliveryType.INTERACTIVE,
      unlockDelaySeconds: 600,
    },
  });

  console.log("Seed complete:", {
    users: [instructor.email, student1.email, student2.email],
    course: course.code,
    section: section.name,
    assessment: assessment.title,
    question: question.title,
  });
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
