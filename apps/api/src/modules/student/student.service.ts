import { Prisma, type ProgrammingLanguage } from "@gradevision/database";
import type {
  ExamQuestion,
  ExamSessionView,
  SaveDraftResult,
  SessionTiming,
  StudentAssessmentSummary,
  SubmitResult,
} from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import {
  createSession,
  createSubmissionInSession,
  findAssessmentQuestionLink,
  findEligibleAssessment,
  findExistingSession,
  findSessionMeta,
  listEligibleAssessments,
  loadSessionView,
  questionSupportsLanguage,
  updateSessionStatus,
  upsertDraft,
} from "./student.repository.js";
import type { SaveDraftInput, SubmitInput } from "./student.schema.js";

type SessionMeta = NonNullable<Awaited<ReturnType<typeof findSessionMeta>>>;
type SessionViewRow = Awaited<ReturnType<typeof loadSessionView>>;

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

  return {
    submission: {
      id: submission.id,
      questionId: submission.questionId,
      language: submission.language,
      status: submission.status,
      attemptNumber: submission.attemptNumber,
      createdAt: submission.createdAt.toISOString(),
    },
    timing: computeTiming(meta, now),
  };
}
