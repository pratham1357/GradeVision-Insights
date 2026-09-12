import { Prisma, type ProgrammingLanguage } from "@gradevision/database";
import type {
  ExamQuestion,
  ExamSessionView,
  ExamSubmissionSummary,
  ExamTransferCheck,
  ExternalProblemReference,
  HintRequestResult,
  HintStageView,
  QuestionHintsView,
  SaveDraftResult,
  SessionTiming,
  StudentAssessmentSummary,
  SubmissionResultView,
  SubmitResult,
  TransferCheckView,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { enqueueEvaluation } from "../../services/evaluation-queue.js";
import {
  HintProviderUnavailableError,
  requestInteractiveHint,
} from "../../services/hint-engine.js";
import { emitAssessmentChanged, emitSessionChanged } from "../../realtime/index.js";
import { getSessionIntegrity } from "../integrity/integrity.service.js";
import { toEvaluationDetail } from "../results/mapper.js";
import { buildHintExecutionEvidence } from "./hint-context.js";
import { decideHintStage, summariseHintEvidence } from "./hint-policy.js";
import {
  createHintUsage,
  createSession,
  createSubmissionInSession,
  findAssessmentQuestionLink,
  findDraft,
  findEligibleAssessment,
  findExistingSession,
  findHintStage,
  findHintUsage,
  findQuestionForHintContext,
  findSessionMeta,
  findSubmissionResultForStudent,
  findTransferTarget,
  isTransferQuestionForAssessment,
  latestSubmissionCode,
  listEligibleAssessments,
  listHintEvidence,
  listTransferSubmissions,
  loadQuestionHints,
  loadSessionView,
  markHintUsageConsumed,
  questionSupportsLanguage,
  updateSessionStatus,
  upsertDraft,
  type ExamQuestionRow,
  type SessionSubmissionRow,
} from "./student.repository.js";
import {
  countedTransferAttempt,
  isSourceSolved,
  transferGate,
  transferResultOf,
} from "./transfer-check.js";
import type { RequestHintInput, SaveDraftInput, SubmitInput } from "./student.schema.js";

type SessionMeta = NonNullable<Awaited<ReturnType<typeof findSessionMeta>>>;
type SessionRunRow = SessionSubmissionRow["evaluationRuns"][number];
type DraftRow = { language: ProgrammingLanguage; sourceCode: string; updatedAt: Date } | null;

/**
 * Parses a question's informational `externalReference` JSON blob for the exam
 * view. Tolerant of missing/malformed data - falls back to `null`.
 */
function toExternalReference(value: unknown): ExternalProblemReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string" || v.source.length === 0) return null;
  return {
    source: v.source,
    number: typeof v.number === "number" ? v.number : null,
    title: typeof v.title === "string" ? v.title : null,
    difficulty: typeof v.difficulty === "string" ? v.difficulty : null,
    url: typeof v.url === "string" ? v.url : null,
  };
}

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

function toSubmissionSummary(s: SessionSubmissionRow): ExamSubmissionSummary {
  return {
    id: s.id,
    language: s.language,
    status: s.status,
    attemptNumber: s.attemptNumber,
    createdAt: s.createdAt.toISOString(),
    evaluation: summariseSessionRun(s.evaluationRuns[0] ?? null),
  };
}

/** Shapes one question (assessment or transfer) for the exam client. */
function toExamQuestion(
  q: ExamQuestionRow,
  link: { position: number; points: number },
  draft: DraftRow,
  submissions: SessionSubmissionRow[],
  transferCheck: ExamTransferCheck | null,
): ExamQuestion {
  return {
    id: q.id,
    position: link.position,
    points: link.points,
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
    externalReference: toExternalReference(q.externalReference),
    draft: draft
      ? {
          language: draft.language,
          sourceCode: draft.sourceCode,
          updatedAt: draft.updatedAt.toISOString(),
        }
      : null,
    submissions: submissions.map(toSubmissionSummary),
    transferCheck,
  };
}

/**
 * The Transfer Check as the student sees it on the source question: available
 * once the source is solved, one counted attempt, a factual result.
 */
function toTransferCheck(
  target: NonNullable<ExamQuestionRow["transferQuestion"]>,
  sourceSubmissions: readonly SessionSubmissionRow[],
  transferSubmissions: readonly SessionSubmissionRow[],
): ExamTransferCheck {
  const gate = transferGate(isSourceSolved(sourceSubmissions));
  const counted = countedTransferAttempt(transferSubmissions);
  return {
    questionId: target.id,
    title: target.title,
    concepts: target.concepts.map((c) => c.concept.name),
    available: gate.available,
    lockedReason: gate.lockedReason,
    attempted: counted !== null,
    submission: counted ? toSubmissionSummary(counted) : null,
    result: counted ? transferResultOf(counted) : null,
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
  const [row, integrity] = await Promise.all([
    loadSessionView(sessionId),
    getSessionIntegrity(sessionId),
  ]);
  const draftByQuestion = new Map(row.drafts.map((d) => [d.questionId, d]));
  // Normal submissions by their question; transfer submissions by the source
  // question they were offered for (their own questionId is never an
  // assessment question, so the two never mix).
  const submissionsByQuestion = new Map<string, SessionSubmissionRow[]>();
  const transferByQuestion = new Map<string, SessionSubmissionRow[]>();
  for (const submission of row.submissions) {
    const target = submission.transferSourceQuestionId ? transferByQuestion : submissionsByQuestion;
    const key = submission.transferSourceQuestionId ?? submission.questionId;
    const list = target.get(key) ?? [];
    list.push(submission);
    target.set(key, list);
  }

  const questions: ExamQuestion[] = row.assessment.questions.map((link) => {
    const q = link.question;
    const submissions = submissionsByQuestion.get(q.id) ?? [];
    return toExamQuestion(
      q,
      { position: link.position, points: Number(link.points) },
      draftByQuestion.get(q.id) ?? null,
      submissions,
      q.transferQuestion
        ? toTransferCheck(q.transferQuestion, submissions, transferByQuestion.get(q.id) ?? [])
        : null,
    );
  });

  return {
    id: row.id,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    assessmentDescription: row.assessment.description,
    assessmentStatus: row.assessment.status,
    timing: computeTiming(row, now),
    integrity,
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
  // Push the "queued" state to any connected exam client immediately, and let
  // the instructor's monitoring dashboard reflect the new submission promptly.
  emitSessionChanged(sessionId);
  emitAssessmentChanged(meta.assessmentId);

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

// --- Transfer Check ---------------------------------------------------------

/**
 * Resolves the Transfer Check for a question in this session. The source must
 * be in the assessment (so a transfer id from the browser can never reach an
 * arbitrary question) and must have a target.
 */
async function loadTransferContext(meta: SessionMeta, sourceQuestionId: string) {
  if (!(await findAssessmentQuestionLink(meta.assessmentId, sourceQuestionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }
  const source = await findTransferTarget(sourceQuestionId);
  if (!source?.transferQuestion) {
    throw ApiError.notFound("This question has no transfer check");
  }
  const [sourceRows, transferRows] = await Promise.all([
    listHintEvidence(meta.id, sourceQuestionId),
    listTransferSubmissions(meta.id, sourceQuestionId),
  ]);
  const solved = isSourceSolved(sourceRows);
  if (!solved) {
    throw new ApiError(409, "TRANSFER_LOCKED", "Solve the original question first");
  }
  return { source, target: source.transferQuestion, transferRows };
}

export async function getTransferCheck(
  sessionId: string,
  sourceQuestionId: string,
  studentId: string,
): Promise<TransferCheckView> {
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  const now = new Date();
  const { source, target, transferRows } = await loadTransferContext(meta, sourceQuestionId);
  const draft = await findDraft(sessionId, target.id);
  // Source rows are not re-fetched here: the gate already passed, so `available`
  // is true by construction for this view.
  const transfer: ExamTransferCheck = {
    questionId: target.id,
    title: target.title,
    concepts: target.concepts.map((c) => c.concept.name),
    available: true,
    lockedReason: null,
    attempted: countedTransferAttempt(transferRows) !== null,
    submission: (() => {
      const counted = countedTransferAttempt(transferRows);
      return counted ? toSubmissionSummary(counted) : null;
    })(),
    result: (() => {
      const counted = countedTransferAttempt(transferRows);
      return counted ? transferResultOf(counted) : null;
    })(),
  };
  return {
    sourceQuestionId,
    sourceTitle: source.title,
    question: toExamQuestion(target, { position: 0, points: 0 }, draft, transferRows, null),
    transfer,
    timing: computeTiming(meta, now),
  };
}

export async function saveTransferDraft(
  sessionId: string,
  sourceQuestionId: string,
  input: SaveDraftInput,
  studentId: string,
): Promise<SaveDraftResult> {
  const now = new Date();
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await ensureSessionIsActive(meta, now);
  const { target } = await loadTransferContext(meta, sourceQuestionId);
  if (!(await questionSupportsLanguage(target.id, input.language))) {
    throw ApiError.badRequest("That language is not available for this question");
  }
  const draft = await upsertDraft({
    examSessionId: sessionId,
    questionId: target.id,
    language: input.language,
    sourceCode: input.sourceCode,
  });
  return {
    questionId: target.id,
    language: draft.language,
    sourceCode: draft.sourceCode,
    updatedAt: draft.updatedAt.toISOString(),
    timing: computeTiming(meta, now),
  };
}

/**
 * The single independent attempt. Runs through the very same submission ->
 * evaluator path as an assessment question; only `transferSourceQuestionId`
 * marks it, which keeps it out of the source question's history and out of
 * every score.
 */
export async function submitTransfer(
  sessionId: string,
  sourceQuestionId: string,
  input: SubmitInput,
  studentId: string,
): Promise<SubmitResult> {
  const now = new Date();
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await ensureSessionIsActive(meta, now);
  const { target, transferRows } = await loadTransferContext(meta, sourceQuestionId);
  if (!(await questionSupportsLanguage(target.id, input.language))) {
    throw ApiError.badRequest("That language is not available for this question");
  }
  if (countedTransferAttempt(transferRows)) {
    throw new ApiError(
      409,
      "TRANSFER_ALREADY_ATTEMPTED",
      "The transfer check allows a single attempt",
    );
  }

  await upsertDraft({
    examSessionId: sessionId,
    questionId: target.id,
    language: input.language,
    sourceCode: input.sourceCode,
  });
  const submission = await createSubmissionInSession({
    examSessionId: sessionId,
    questionId: target.id,
    language: input.language,
    sourceCode: input.sourceCode,
    transferSourceQuestionId: sourceQuestionId,
  });
  await enqueueEvaluation(submission.id);
  emitSessionChanged(sessionId);
  emitAssessmentChanged(meta.assessmentId);

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

/**
 * Hints are off, server-side, for a Transfer Check: the transfer question is
 * attempted without assistance by definition. (It is also never an assessment
 * question of this session, so the link check below would 404 anyway - this
 * makes the refusal explicit.)
 */
async function assertHintsAllowed(meta: SessionMeta, questionId: string): Promise<void> {
  if (await isTransferQuestionForAssessment(meta.assessmentId, questionId)) {
    throw new ApiError(
      409,
      "HINTS_UNAVAILABLE_FOR_TRANSFER",
      "Hints are unavailable during a Transfer Check",
    );
  }
}

/** The persisted execution evidence for this session+question, folded for the policy. */
async function loadHintEvidence(sessionId: string, questionId: string) {
  return summariseHintEvidence(await listHintEvidence(sessionId, questionId));
}

export async function getQuestionHints(
  sessionId: string,
  questionId: string,
  studentId: string,
): Promise<QuestionHintsView> {
  const meta = await loadOwnedSessionMeta(sessionId, studentId);
  await assertHintsAllowed(meta, questionId);
  if (!(await findAssessmentQuestionLink(meta.assessmentId, questionId))) {
    throw ApiError.notFound("Question is not part of this assessment");
  }

  const [stages, evidence] = await Promise.all([
    loadQuestionHints(questionId, sessionId),
    loadHintEvidence(sessionId, questionId),
  ]);

  const views: HintStageView[] = stages.map((stage, index) => {
    const usage = (stage.usages[0] ?? null) as HintUsageRow | null;
    const previousUsed = index === 0 || stages[index - 1]!.usages.length > 0;
    // Escalation is gated on the student's own execution evidence (see
    // hint-policy.ts), never on elapsed time - `unlockDelaySeconds` is legacy
    // configuration that no longer controls availability.
    const decision = decideHintStage({
      stageNumber: stage.stageNumber,
      previousStageUsed: previousUsed,
      evidence,
    });

    const consumed = usage?.status === "CONSUMED";
    return {
      stageNumber: stage.stageNumber,
      title: stage.title,
      description: stage.description,
      deliveryType: stage.deliveryType,
      unlockDelaySeconds: stage.unlockDelaySeconds,
      available: !usage && decision.eligible && meta.status === "IN_PROGRESS",
      lockedReason: usage ? null : decision.lockedReason,
      // No time gate means there is never an instant to count down to.
      unlockAt: null,
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
  await assertHintsAllowed(meta, questionId);
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
  let previousStageUsed = true;
  if (stage.stageNumber > 1) {
    const prev = await findHintStage(questionId, stage.stageNumber - 1);
    const prevUsage = prev ? await findHintUsage(sessionId, prev.id) : null;
    previousStageUsed = prevUsage !== null;
  }

  // Escalation is decided from persisted execution evidence, never from elapsed
  // time (see hint-policy.ts). Same decision the listing endpoint shows. The
  // same rows also feed the sanitized evidence an interactive hint is given.
  const evidenceRows = await listHintEvidence(sessionId, questionId);
  const decision = decideHintStage({
    stageNumber: stage.stageNumber,
    previousStageUsed,
    evidence: summariseHintEvidence(evidenceRows),
  });
  if (!decision.eligible) {
    throw new ApiError(409, "HINT_LOCKED", decision.lockedReason ?? "This hint is not available");
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

  // INTERACTIVE: call the backend hint-engine with the minimum context - the
  // student's latest code, earlier hint text, and the sanitized execution
  // evidence (visible-case detail only; hidden cases as counts - hint-context.ts).
  const question = await findQuestionForHintContext(questionId);
  const latest = await latestSubmissionCode(sessionId, questionId);
  const priorStages = await loadQuestionHints(questionId, sessionId);
  const previousHints = priorStages
    .filter((s) => s.stageNumber < stage.stageNumber && s.usages[0]?.status === "CONSUMED")
    .map((s) => usageHintText(s.content, s.usages[0]?.detail ?? null))
    .filter((t): t is string => Boolean(t));
  const evidence = buildHintExecutionEvidence(evidenceRows);

  let hint: string;
  try {
    hint = await requestInteractiveHint({
      stageNumber: stage.stageNumber,
      language: latest?.language ?? "PYTHON",
      questionTitle: question?.title ?? "this problem",
      questionStatement: question?.statement ?? "",
      studentCode: latest?.sourceCode ?? null,
      previousHints,
      evidence,
    });
  } catch (error) {
    if (error instanceof HintProviderUnavailableError) {
      throw new ApiError(503, "HINT_PROVIDER_UNAVAILABLE", error.message);
    }
    throw error;
  }

  // Record what the delivered guidance was grounded in (counts only) so the
  // usage row can later be read as "given after N unsuccessful attempts".
  const latestAttempt = evidence.attempts.at(-1) ?? null;
  const detail = {
    hint,
    evidence: {
      evaluatedAttempts: evidence.evaluatedAttempts,
      unsuccessfulAttempts: evidence.unsuccessfulAttempts,
      latestOutcome: evidence.latestOutcome,
      latestTestsPassed: latestAttempt?.testsPassed ?? null,
      latestTestsTotal: latestAttempt?.testsTotal ?? null,
    },
  } satisfies Prisma.InputJsonObject;
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
