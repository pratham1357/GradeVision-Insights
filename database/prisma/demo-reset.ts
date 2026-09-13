/**
 * Demo reset for the final-review walkthrough.
 *
 * Deletes the seeded demo students' exam sessions on the seeded assessments -
 * and only those - together with the evidence those sessions produced
 * (submissions, evaluation runs, test-case results, drafts, hint usages,
 * integrity events). Everything the seed authored (users, course, questions,
 * tests, rubrics, hint stages, concepts, transfer links, assessments) is left
 * untouched, so `pnpm db:seed && pnpm db:demo-reset` always yields the same
 * starting state: two students who can start the live assessment afresh.
 *
 * Nothing outside the fixed seed ids is touched. Safe to run repeatedly.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEEDED_STUDENTS = [
  "00000000-0000-4000-8000-000000000002", // student1@example.edu
  "00000000-0000-4000-8000-000000000003", // student2@example.edu
];
const SEEDED_ASSESSMENTS = [
  "00000000-0000-4000-8000-000000000030", // CS101 - Practice Assessment 1 (DRAFT)
  "00000000-0000-4000-8000-000000000031", // CS101 - Live Coding Assessment (ACTIVE)
];

async function main(): Promise<void> {
  const sessions = await prisma.examSession.findMany({
    where: { studentId: { in: SEEDED_STUDENTS }, assessmentId: { in: SEEDED_ASSESSMENTS } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) {
    console.log("Demo reset: nothing to reset - the seeded students have no sessions.");
    return;
  }

  const submissionIds = (
    await prisma.submission.findMany({
      where: { examSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((s) => s.id);

  const [results, runs, submissions, deletedSessions] = await prisma.$transaction([
    prisma.testCaseResult.deleteMany({
      where: { evaluationRun: { submissionId: { in: submissionIds } } },
    }),
    prisma.evaluationRun.deleteMany({ where: { submissionId: { in: submissionIds } } }),
    prisma.submission.deleteMany({ where: { id: { in: submissionIds } } }),
    // Drafts, hint usages and violations cascade from the session.
    prisma.examSession.deleteMany({ where: { id: { in: sessionIds } } }),
  ]);

  console.log("Demo reset complete:", {
    sessions: deletedSessions.count,
    submissions: submissions.count,
    evaluationRuns: runs.count,
    testCaseResults: results.count,
  });
}

main()
  .catch((error) => {
    console.error("Demo reset failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
