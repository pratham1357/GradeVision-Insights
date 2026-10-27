/**
 * Demo-data reset: restores a dedicated local DEMO database to its seeded
 * state after a rehearsal, without touching schema, migrations or anyone
 * else's data.
 *
 * Two layers of protection:
 *
 * 1. Target guard (`checkDemoTarget`): the operator must opt in
 *    (`GRADEVISION_DEMO_MODE=true`), name the dedicated database
 *    (`DEMO_DATABASE_NAME`) and confirm it on the command line; the URL must be
 *    loopback-only and name that database; the server must report the same
 *    database; test databases, system databases and production mode are refused.
 *    The server-side check is repeated inside the deleting transaction.
 *
 * 2. Scope (`DEMO_SCOPE`): even on the right database, only the demo namespace
 *    is touched - activity of the seeded demo accounts, and content those
 *    accounts authored during a rehearsal (rows whose id is outside the seed's
 *    fixed-id prefix). Seeded rows themselves are kept and restored by re-seeding.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/** Every row the seed creates has an id with this prefix (database/prisma/seed.ts). */
export const SEED_ID_PREFIX = "00000000-0000-4000-8000-";
/** The same namespace as a UUID range (UUID columns support range filters, not prefixes). */
const SEEDED_IDS = {
  gte: `${SEED_ID_PREFIX}000000000000`,
  lte: `${SEED_ID_PREFIX}ffffffffffff`,
};

export const DEMO_SCOPE = {
  students: [
    "00000000-0000-4000-8000-000000000002", // student1@example.edu
    "00000000-0000-4000-8000-000000000003", // student2@example.edu
  ],
  instructors: ["00000000-0000-4000-8000-000000000001"], // instructor@example.edu
  admins: ["00000000-0000-4000-8000-000000000004"], // admin@example.edu
} as const;

const DEMO_ACCOUNTS = [...DEMO_SCOPE.students, ...DEMO_SCOPE.instructors, ...DEMO_SCOPE.admins];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);

export interface DemoTargetInput {
  databaseUrl: string | undefined;
  demoMode: string | undefined;
  expectedName: string | undefined;
  confirmName: string | undefined;
  nodeEnv: string | undefined;
  /** What the server itself reports (`current_database()`), when already connected. */
  serverDatabase?: string | null;
}

export interface DemoTargetCheck {
  ok: boolean;
  database: string | null;
  host: string | null;
  reasons: string[];
}

function looksLikeTestDatabase(name: string): boolean {
  return /(^|[_\-.])(test|tests|testing|ci)($|[_\-.])/iu.test(name);
}

/** Pure decision: is this connection target an explicitly confirmed, dedicated local demo database? */
export function checkDemoTarget(input: DemoTargetInput): DemoTargetCheck {
  const reasons: string[] = [];
  let database: string | null = null;
  let host: string | null = null;

  if (input.nodeEnv === "production") reasons.push("NODE_ENV is production");
  if (input.demoMode !== "true") reasons.push("GRADEVISION_DEMO_MODE is not 'true'");
  const expected = input.expectedName?.trim() || null;
  if (!expected) reasons.push("DEMO_DATABASE_NAME is not set");

  if (!input.databaseUrl || !URL.canParse(input.databaseUrl)) {
    reasons.push("DATABASE_URL is missing or not a URL");
  } else {
    const url = new URL(input.databaseUrl);
    host = url.hostname;
    database = decodeURIComponent(url.pathname.replace(/^\//u, "")) || null;
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      reasons.push("DATABASE_URL is not a PostgreSQL URL");
    }
    if (!LOOPBACK.has(host)) reasons.push(`database host '${host}' is not loopback`);
    if (!database) reasons.push("DATABASE_URL names no database");
  }

  if (database) {
    if (SYSTEM_DATABASES.has(database)) reasons.push(`'${database}' is a system database`);
    if (looksLikeTestDatabase(database)) reasons.push(`'${database}' looks like a test database`);
    if (expected && database !== expected) {
      reasons.push(`DATABASE_URL names '${database}', DEMO_DATABASE_NAME is '${expected}'`);
    }
  }
  if (expected && input.confirmName !== expected) {
    reasons.push(`--confirm must repeat the database name ('${expected}')`);
  }
  if (input.serverDatabase !== undefined) {
    if (!input.serverDatabase) reasons.push("server did not report a database name");
    else if (expected && input.serverDatabase !== expected) {
      reasons.push(`server reports database '${input.serverDatabase}', expected '${expected}'`);
    }
  }

  return { ok: reasons.length === 0, database, host, reasons };
}

export interface ScriptCommand {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * How to run a TypeScript script (e.g. the re-seed): Node itself with the tsx
 * loader, resolved from `databaseDir`. Never through a shell - on Windows a
 * shell splits unquoted paths at spaces ("...\demo\GradeVision Insights\...").
 */
export function tsxScriptCommand(databaseDir: string, script: string): ScriptCommand {
  return { command: process.execPath, args: ["--import", "tsx", script], cwd: databaseDir };
}

export async function serverDatabaseName(
  client: PrismaClient | Prisma.TransactionClient,
): Promise<string | null> {
  const rows = await client.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  return rows[0]?.db ?? null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Ids of everything the reset would remove, resolved from the demo scope. */
async function resolveScope(db: Db) {
  const authoredAssessments = await db.assessment.findMany({
    where: { createdById: { in: [...DEMO_SCOPE.instructors] }, NOT: { id: SEEDED_IDS } },
    select: { id: true },
  });
  const authoredQuestions = await db.question.findMany({
    where: { createdById: { in: [...DEMO_SCOPE.instructors] }, NOT: { id: SEEDED_IDS } },
    select: { id: true },
  });
  const assessmentIds = authoredAssessments.map((a) => a.id);
  const questionIds = authoredQuestions.map((q) => q.id);
  // Accounts the demo admin created during a rehearsal (from the audit trail).
  const created = await db.auditEvent.findMany({
    where: { action: "user.created", entityType: "User", actorId: { in: [...DEMO_SCOPE.admins] } },
    select: { entityId: true },
  });
  const userIds = (
    await db.user.findMany({
      where: {
        id: { in: created.map((c) => c.entityId).filter((id): id is string => Boolean(id)) },
        NOT: { id: SEEDED_IDS },
      },
      select: { id: true },
    })
  ).map((u) => u.id);

  const sessions = await db.examSession.findMany({
    where: {
      OR: [
        { studentId: { in: [...DEMO_SCOPE.students, ...userIds] } },
        { assessmentId: { in: assessmentIds } },
      ],
    },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const submissions = await db.submission.findMany({
    where: { examSessionId: { in: sessionIds } },
    select: { id: true },
  });
  const submissionIds = submissions.map((s) => s.id);

  // Hint stages added to SEEDED questions during a rehearsal (authored questions
  // cascade) - only when every delivery of the stage is itself in scope.
  const addedStages = await db.hintStage.findMany({
    where: {
      NOT: { id: SEEDED_IDS },
      questionId: SEEDED_IDS,
      usages: { every: { examSessionId: { in: sessionIds } } },
    },
    select: { id: true },
  });

  return {
    userIds,
    assessmentIds,
    questionIds,
    sessionIds,
    submissionIds,
    stageIds: addedStages.map((s) => s.id),
  };
}

export interface DemoResetCounts {
  examSessions: number;
  submissions: number;
  evaluationRuns: number;
  testCaseResults: number;
  criterionScores: number;
  drafts: number;
  hintUsages: number;
  violations: number;
  rehearsalAssessments: number;
  rehearsalQuestions: number;
  rehearsalHintStages: number;
  auditEvents: number;
  authSessions: number;
  rehearsalUsers: number;
}

/** Non-destructive: what a reset would remove right now. */
export async function inspectDemoData(db: Db): Promise<DemoResetCounts> {
  const scope = await resolveScope(db);
  const runFilter = { submissionId: { in: scope.submissionIds } };
  const [
    evaluationRuns,
    testCaseResults,
    criterionScores,
    drafts,
    hintUsages,
    violations,
    auditEvents,
    authSessions,
  ] = await Promise.all([
    db.evaluationRun.count({ where: runFilter }),
    db.testCaseResult.count({ where: { evaluationRun: runFilter } }),
    db.criterionScore.count({ where: { evaluationRun: runFilter } }),
    db.submissionDraft.count({ where: { examSessionId: { in: scope.sessionIds } } }),
    db.hintUsage.count({ where: { examSessionId: { in: scope.sessionIds } } }),
    db.violation.count({ where: { examSessionId: { in: scope.sessionIds } } }),
    db.auditEvent.count({
      where: { OR: [{ actorId: { in: DEMO_ACCOUNTS } }, { entityId: { in: scope.userIds } }] },
    }),
    db.authSession.count({ where: { userId: { in: [...DEMO_ACCOUNTS, ...scope.userIds] } } }),
  ]);
  return {
    examSessions: scope.sessionIds.length,
    submissions: scope.submissionIds.length,
    evaluationRuns,
    testCaseResults,
    criterionScores,
    drafts,
    hintUsages,
    violations,
    rehearsalAssessments: scope.assessmentIds.length,
    rehearsalQuestions: scope.questionIds.length,
    rehearsalHintStages: scope.stageIds.length,
    auditEvents,
    authSessions,
    rehearsalUsers: scope.userIds.length,
  };
}

/**
 * Removes the demo namespace's generated records in one transaction, in
 * dependency order. `verify` runs inside the transaction before the first
 * delete and must throw if the target is wrong.
 */
export async function resetDemoData(
  prisma: PrismaClient,
  verify: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<DemoResetCounts> {
  return prisma.$transaction(
    async (tx) => {
      await verify(tx);
      const scope = await resolveScope(tx);
      const runFilter = { submissionId: { in: scope.submissionIds } };

      const testCaseResults = await tx.testCaseResult.deleteMany({
        where: { evaluationRun: runFilter },
      });
      const criterionScores = await tx.criterionScore.deleteMany({
        where: { evaluationRun: runFilter },
      });
      const evaluationRuns = await tx.evaluationRun.deleteMany({ where: runFilter });
      const hintUsages = await tx.hintUsage.deleteMany({
        where: { examSessionId: { in: scope.sessionIds } },
      });
      const drafts = await tx.submissionDraft.deleteMany({
        where: { examSessionId: { in: scope.sessionIds } },
      });
      const violations = await tx.violation.deleteMany({
        where: { examSessionId: { in: scope.sessionIds } },
      });
      const submissions = await tx.submission.deleteMany({
        where: { id: { in: scope.submissionIds } },
      });
      const examSessions = await tx.examSession.deleteMany({
        where: { id: { in: scope.sessionIds } },
      });

      // Rehearsal-authored content. Seeded assessments may have had a rehearsal
      // question attached; the seed re-syncs their question lists afterwards.
      await tx.assessmentQuestion.deleteMany({
        where: {
          OR: [
            { assessmentId: { in: scope.assessmentIds } },
            { questionId: { in: scope.questionIds } },
          ],
        },
      });
      const rehearsalAssessments = await tx.assessment.deleteMany({
        where: { id: { in: scope.assessmentIds } },
      });
      const rehearsalHintStages = await tx.hintStage.deleteMany({
        where: { id: { in: scope.stageIds } },
      });
      const rehearsalQuestions = await tx.question.deleteMany({
        where: { id: { in: scope.questionIds } },
      });

      const auditEvents = await tx.auditEvent.deleteMany({
        where: { OR: [{ actorId: { in: DEMO_ACCOUNTS } }, { entityId: { in: scope.userIds } }] },
      });
      const authSessions = await tx.authSession.deleteMany({
        where: { userId: { in: [...DEMO_ACCOUNTS, ...scope.userIds] } },
      });
      // Rehearsal-created accounts (their sessions and evidence went above). An
      // account that authored an assessment is kept rather than cascading further.
      const rehearsalUsers = await tx.user.deleteMany({
        where: { id: { in: scope.userIds }, createdAssessments: { none: {} } },
      });

      return {
        examSessions: examSessions.count,
        submissions: submissions.count,
        evaluationRuns: evaluationRuns.count,
        testCaseResults: testCaseResults.count,
        criterionScores: criterionScores.count,
        drafts: drafts.count,
        hintUsages: hintUsages.count,
        violations: violations.count,
        rehearsalAssessments: rehearsalAssessments.count,
        rehearsalQuestions: rehearsalQuestions.count,
        rehearsalHintStages: rehearsalHintStages.count,
        auditEvents: auditEvents.count,
        authSessions: authSessions.count,
        rehearsalUsers: rehearsalUsers.count,
      };
    },
    { timeout: 60_000 },
  );
}
