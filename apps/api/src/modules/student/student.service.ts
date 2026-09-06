import { Prisma, type ProgrammingLanguage } from "@gradevision/database";
import type {
  ExamQuestion,
  ExamSessionView,
  HintRequestResult,
  HintStageView,
  QuestionHintsView,
  SaveDraftResult,
  SessionTiming,
  StudentAssessmentSummary,
  SubmissionResultView,
  SubmitResult,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { enqueueEvaluation } from "../../services/evaluation-queue.js";
import {
  HintProviderUnavailableError,
  requestInteractiveHint,
} from "../../services/hint-engine.js";
import { toEvaluationDetail } from "../results/mapper.js";
import {
  createHintUsage,
  createSession,
  createSubmissionInSession,
  findAssessmentQuestionLink,
  findEligibleAssessment,
  findExistingSession,
  findHintStage,
  findHintUsage,
  findQuestionForHintContext,
  findSessionMeta,
  findSubmissionResultForStudent,
  latestSubmissionCode,
  listEligibleAssessments,
  loadQuestionHints,
  loadSessionView,
  markHintUsageConsumed,
  questionSupportsLanguage,
  updateSessionStatus,
  upsertDraft,
} from "./student.repository.js";
import type { RequestHintInput, SaveDraftInput, SubmitInput } from "./student.schema.js";

type SessionMeta = NonNullable<Awaited<ReturnType<typeof findSessionMeta>>>;
type SessionViewRow = Awaited<ReturnType<typeof loadSessionView>>;
type SessionRunRow = SessionViewRow["submissions"][number]["evaluationRuns"][number];

/** Compact evaluation status for the exam view (lighter than the full result). */
function summariseSessionRun(run: SessionRunRow | null) {
  if (!run) return null;
  const graded = run.testCaseResults.filter((r) => r.status !== "SKIPPED");
  const total = run.totalScore === null ? null : Number(run.totalScore);
  const max = run.maxScore === null ? null : Number(run.maxScore);
  return {
    status: run.status,
    score: total,
    maxScore: max,
    scorePercent:
      total !== null && max !== null && max > 0 ? Math.round((total / max) * 100) : null,
    testsPassed: graded.filter((r) => r.status === "PASSED").length,
    testsTotal: graded.length,
  };
}

function computeTiming(
  session: {
    status: SessionMeta["status"];
    startedAt: Date | null;
    expiresAt: Date | null;
    submittedAt: Date | null;
  },
  now: Date,
): SessionTiming {
  const expired =
    session.status === "IN_PROGRESS" && session.expiresAt !== null && session.expiresAt <= now;

  return {
    status: expired ? "EXPIRED" : session.status,
    startedAt: session.startedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt?.toISOString() ?? null,
    submittedAt: session.submittedAt?.toISOString() ?? null,
    serverTime: now.toISOString(),
    remainingSeconds:
      session.expiresAt === null
        ? null
        : Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Guards a mutation: throws 409 unless the session is live (persists EXPIRED if the clock ran out). */
async function ensureSessionIsActive(meta: SessionMeta, now: Date): Promise<void> {
  if (meta.status === "IN_PROGRESS") {
    if (meta.expiresAt !== null && meta.expiresAt <= now) {
      await updateSessionStatus(meta.id, "EXPIRED");
      throw new ApiError(409, "SESSION_EXPIRED", "This exam session has expired");
    }
    return;
  }
  if (meta.status === "EXPIRED") {
    throw new ApiError(409, "SESSION_EXPIRED", "This exam session has expired");
  }
  if (meta.status === "SUBMITTED") {
    throw new ApiError(409, "SESSION_SUBMITTED", "This exam session has already been submitted");
  }
  throw new ApiError(409, "SESSION_NOT_ACTIVE", `This exam session is ${meta.status}`);
}

async function loadOwnedSessionMeta(sessionId: string, studentId: string): Promise<SessionMeta> {
  const meta = await findSessionMeta(sessionId, studentId);
  if (!meta) {
    // 404 (not 403) so another student's session id is not confirmed to exist.
    throw ApiError.notFound("Exam session not found");
  }
  return meta;
}

async function assertQuestionInSession(
  assessmentId: string,
  questionId: string,
  language: ProgrammingLanguage,
): Promise<void> {
  if (!(await findAssessmentQuestionLink(assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }
  if (!(await questionSupportsLanguage(questionId, language))) {
    throw ApiError.badRequest("That language is not available for this question");
  }
}

// --- Discovery -----------------------------------------------------------

export async function getEligibleAssessments(
  studentId: string,
): Promise<StudentAssessmentSummary[]> {
  const rows = await listEligibleAssessments(studentId, new Date());
  return rows.map((row) => {
    const session = row.examSessions[0] ?? null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      durationMinutes: row.durationMinutes,
      questionCount: row._count.questions,
      courseCode: row.section?.course.code ?? null,
      sectionName: row.section?.name ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      session: session
        ? {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt?.toISOString() ?? null,
            expiresAt: session.expiresAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}

// --- Sessions -----------------------------------------------------------

export async function startSession(
  assessmentId: string,
  studentId: string,
): Promise<ExamSessionView> {
  const now = new Date();
  const eligible = await findEligibleAssessment(assessmentId, studentId, now);
  if (!eligible) {
    throw ApiError.notFound("Assessment not available");
  }

  const existing = await findExistingSession(assessmentId, studentId);
  if (existing) {
    if (existing.status === "IN_PROGRESS") {
      if (existing.expiresAt !== null && existing.expiresAt <= now) {
        await updateSessionStatus(existing.id, "EXPIRED");
      }
      return buildSessionView(existing.id, now);
    }
    throw new ApiError(
      409,
      "SESSION_ALREADY_COMPLETE",
      "You have already used your attempt at this assessment",
    );
  }

  const expiresAt =
    eligible.durationMinutes != null
      ? new Date(now.getTime() + eligible.durationMinutes * 60_000)
      : eligible.endsAt;

  try {
    const created = await createSession({ assessmentId, studentId, expiresAt: expiresAt ?? null });
    return buildSessionView(created.id, now);
  } catch (error) {
    // Lost a race with a concurrent start - return the session that won.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findExistingSession(assessmentId, studentId);
      if (winner) return buildSessionView(winner.id, now);
    }
    throw error;
  }
}

export async function getSession(sessionId: string, studentId: string): Promise<ExamSessionView> {
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  const now = new Date();
  if (meta.status === "IN_PROGRESS" && meta.expiresAt !== null && meta.expiresAt <= now) {
    await updateSessionStatus(sessionId, "EXPIRED");
  }
  return buildSessionView(sessionId, now);
}

export async function finishSession(
  sessionId: string,
  studentId: string,
): Promise<ExamSessionView> {
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  const now = new Date();
  if (meta.status === "IN_PROGRESS") {
    await updateSessionStatus(
      sessionId,
      meta.expiresAt !== null && meta.expiresAt <= now ? "EXPIRED" : "SUBMITTED",
      { submittedAt: now },
    );
  }
  return buildSessionView(sessionId, now);
}

async function buildSessionView(sessionId: string, now: Date): Promise<ExamSessionView> {
  const row: SessionViewRow = await loadSessionView(sessionId);
  const draftByQuestion = new Map(row.drafts.map((d) => [d.questionId, d]));
  const submissionsByQuestion = new Map<string, SessionViewRow["submissions"]>();
  for (const submission of row.submissions) {
    const list = submissionsByQuestion.get(submission.questionId) ?? [];
    list.push(submission);
    submissionsByQuestion.set(submission.questionId, list);
  }

  const questions: ExamQuestion[] = row.assessment.questions.map((link) => {
    const q = link.question;
    const draft = draftByQuestion.get(q.id);
    return {
      id: q.id,
      position: link.position,
      points: Number(link.points),
      title: q.title,
      statement: q.statement,
      constraints: q.constraints,
      inputFormat: q.inputFormat,
      outputFormat: q.outputFormat,
      difficulty: q.difficulty,
      timeLimitMs: q.timeLimitMs,
      memoryLimitMb: q.memoryLimitMb,
      languages: q.languages.map((l) => ({ language: l.language, starterCode: l.starterCode })),
      sampleTestCases: q.testCases.map((tc) => ({
        name: tc.name,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
      })),
      draft: draft
        ? {
            language: draft.language,
            sourceCode: draft.sourceCode,
            updatedAt: draft.updatedAt.toISOString(),
          }
        : null,
      submissions: (submissionsByQuestion.get(q.id) ?? []).map((s) => ({
        id: s.id,
        language: s.language,
        status: s.status,
        attemptNumber: s.attemptNumber,
        createdAt: s.createdAt.toISOString(),
        evaluation: summariseSessionRun(s.evaluationRuns[0] ?? null),
      })),
    };
  });

  return {
    id: row.id,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    assessmentDescription: row.assessment.description,
    timing: computeTiming(row, now),
    questions,
  };
}

// --- Drafts & submissions ---------------------------------------------

export async function saveDraft(
  sessionId: string,
  questionId: string,
  input: SaveDraftInput,
  studentId: string,
): Promise<SaveDraftResult> {
  const now = new Date();
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await ensureSessionIsActive(meta, now);
  await assertQuestionInSession(meta.assessmentId, questionId, input.language);

  const draft = await upsertDraft({
    examSessionId: sessionId,
    questionId,
    language: input.language,
    sourceCode: input.sourceCode,
  });

  return {
    questionId,
    language: draft.language,
    sourceCode: draft.sourceCode,
    updatedAt: draft.updatedAt.toISOString(),
    timing: computeTiming(meta, now),
  };
}

export async function submitCode(
  sessionId: string,
  questionId: string,
  input: SubmitInput,
  studentId: string,
): Promise<SubmitResult> {
  const now = new Date();
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await ensureSessionIsActive(meta, now);
  await assertQuestionInSession(meta.assessmentId, questionId, input.language);

  // Keep the draft in step with what was just submitted so a reload shows it.
  await upsertDraft({
    examSessionId: sessionId,
    questionId,
    language: input.language,
    sourceCode: input.sourceCode,
  });

  const submission = await createSubmissionInSession({
    examSessionId: sessionId,
    questionId,
    language: input.language,
    sourceCode: input.sourceCode,
  });

  // Best-effort: nudge the evaluator. Without Redis this is a no-op and the
  // evaluator's PostgreSQL poller picks the QUEUED row up instead.
  await enqueueEvaluation(submission.id);

  return {
    submission: {
      id: submission.id,
      questionId: submission.questionId,
      language: submission.language,
      status: submission.status,
      attemptNumber: submission.attemptNumber,
      createdAt: submission.createdAt.toISOString(),
      evaluation: null,
    },
    timing: computeTiming(meta, now),
  };
}

// --- Results ---------------------------------------------------------------

export async function getSubmissionResult(
  submissionId: string,
  studentId: string,
): Promise<SubmissionResultView> {
  const submission = await findSubmissionResultForStudent(submissionId, studentId);
  if (!submission) {
    // 404 (not 403) so another student's submission id is not confirmed to exist.
    throw ApiError.notFound("Submission not found");
  }
  return {
    submissionId: submission.id,
    questionId: submission.questionId,
    questionTitle: submission.question.title,
    attemptNumber: submission.attemptNumber,
    language: submission.language,
    submittedAt: submission.createdAt.toISOString(),
    submissionStatus: submission.status,
    evaluation: toEvaluationDetail(submission.evaluationRuns[0] ?? null),
  };
}

// --- Progressive hints ----------------------------------------------------

interface HintUsageRow {
  status: "REQUESTED" | "UNLOCKED" | "CONSUMED";
  requestedAt: Date;
  consumedAt: Date | null;
  detail: Prisma.JsonValue | null;
}

/** The hint text already delivered for a usage row (static content or stored AI text). */
function usageHintText(
  stageContent: string | null,
  detail: Prisma.JsonValue | null,
): string | null {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const hint = (detail as Record<string, unknown>).hint;
    if (typeof hint === "string" && hint.length > 0) return hint;
  }
  return stageContent;
}

function secondsSince(from: Date | null, now: Date): number {
  if (!from) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - from.getTime()) / 1000);
}

export async function getQuestionHints(
  sessionId: string,
  questionId: string,
  studentId: string,
): Promise<QuestionHintsView> {
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  if (!(await findAssessmentQuestionLink(meta.assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }

  const now = new Date();
  const stages = await loadQuestionHints(questionId, sessionId);
  const elapsed = secondsSince(meta.startedAt, now);

  const views: HintStageView[] = stages.map((stage, index) => {
    const usage = (stage.usages[0] ?? null) as HintUsageRow | null;
    const previousUsed = index === 0 || stages[index - 1]!.usages.length > 0;
    const delayOk = elapsed >= stage.unlockDelaySeconds;

    let lockedReason: string | null = null;
    if (!usage) {
      if (!previousUsed) lockedReason = "Use the previous hint first";
      else if (!delayOk) {
        lockedReason = `Available ${stage.unlockDelaySeconds - elapsed}s from now`;
      }
    }

    const consumed = usage?.status === "CONSUMED";
    return {
      stageNumber: stage.stageNumber,
      title: stage.title,
      description: stage.description,
      deliveryType: stage.deliveryType,
      unlockDelaySeconds: stage.unlockDelaySeconds,
      available: !usage && previousUsed && delayOk && meta.status === "IN_PROGRESS",
      lockedReason,
      status: usage?.status ?? null,
      content: consumed ? usageHintText(stage.content, usage?.detail ?? null) : null,
      requestedAt: usage?.requestedAt.toISOString() ?? null,
    };
  });

  return { questionId, stages: views };
}

export async function requestHint(
  sessionId: string,
  questionId: string,
  input: RequestHintInput,
  studentId: string,
): Promise<HintRequestResult> {
  const now = new Date();
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await ensureSessionIsActive(meta, now);
  if (!(await findAssessmentQuestionLink(meta.assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }

  const stage = await findHintStage(questionId, input.stageNumber);
  if (!stage) {
    throw ApiError.notFound("Hint stage not found");
  }

  // Idempotent: a stage already requested for this session returns its content.
  const existing = await findHintUsage(sessionId, stage.id);
  if (existing?.status === "CONSUMED") {
    const text = usageHintText(stage.content, existing.detail);
    if (text) {
      return {
        stageNumber: stage.stageNumber,
        deliveryType: stage.deliveryType,
        status: "CONSUMED",
        content: text,
        source: stage.deliveryType === "STATIC" ? "static" : "ai",
      };
    }
  }

  // Progression: stage 1, or the previous stage has been requested.
  if (stage.stageNumber > 1) {
    const prev = await findHintStage(questionId, stage.stageNumber - 1);
    const prevUsage = prev ? await findHintUsage(sessionId, prev.id) : null;
    if (!prevUsage) {
      throw new ApiError(409, "HINT_LOCKED", "Use the previous hint before this one");
    }
  }

  const elapsed = secondsSince(meta.startedAt, now);
  if (elapsed < stage.unlockDelaySeconds) {
    throw new ApiError(
      409,
      "HINT_LOCKED",
      `This hint unlocks ${stage.unlockDelaySeconds - elapsed}s from now`,
    );
  }

  if (stage.deliveryType === "STATIC") {
    const content = stage.content?.trim();
    if (!content) {
      throw new ApiError(409, "HINT_UNAVAILABLE", "This hint has no content configured");
    }
    if (existing) {
      await markHintUsageConsumed(existing.id);
    } else {
      await createHintUsage({
        hintStageId: stage.id,
        examSessionId: sessionId,
        studentId,
        questionId,
        status: "CONSUMED",
      });
    }
    return {
      stageNumber: stage.stageNumber,
      deliveryType: "STATIC",
      status: "CONSUMED",
      content,
      source: "static",
    };
  }

  // INTERACTIVE: call the backend hint-engine with the minimum context.
  const question = await findQuestionForHintContext(questionId);
  const latest = await latestSubmissionCode(sessionId, questionId);
  const priorStages = await loadQuestionHints(questionId, sessionId);
  const previousHints = priorStages
    .filter((s) => s.stageNumber < stage.stageNumber && s.usages[0]?.status === "CONSUMED")
    .map((s) => usageHintText(s.content, s.usages[0]?.detail ?? null))
    .filter((t): t is string => Boolean(t));

  let hint: string;
  try {
    hint = await requestInteractiveHint({
      stageNumber: stage.stageNumber,
      language: latest?.language ?? "PYTHON",
      questionTitle: question?.title ?? "this problem",
      questionStatement: question?.statement ?? "",
      studentCode: latest?.sourceCode ?? null,
      previousHints,
    });
  } catch (error) {
    if (error instanceof HintProviderUnavailableError) {
      throw new ApiError(503, "HINT_PROVIDER_UNAVAILABLE", error.message);
    }
    throw error;
  }

  const detail = { hint } satisfies Prisma.InputJsonObject;
  if (existing) {
    await markHintUsageConsumed(existing.id, detail);
  } else {
    try {
      await createHintUsage({
        hintStageId: stage.id,
        examSessionId: sessionId,
        studentId,
        questionId,
        status: "CONSUMED",
        detail,
      });
    } catch (error) {
      // Lost a race with a concurrent identical request.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }
  }

  return {
    stageNumber: stage.stageNumber,
    deliveryType: "INTERACTIVE",
    status: "CONSUMED",
    content: hint,
    source: "ai",
  };
}
