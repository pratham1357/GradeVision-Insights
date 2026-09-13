import type {
  ConceptEvidenceGroup,
  QuestionCohortEvidence,
  QuestionEvidence,
  QuestionOutcome,
  ReplayAttempt,
  ReplayHint,
  SessionEvidenceSummary,
  TransferCheckResult,
} from "@gradevision/shared";

import { summariseHintEvidence, type HintEvidenceRow } from "../student/hint-policy.js";

/**
 * Instructor evidence report: deterministic counts and sentences derived from
 * the Evidence Replay of one session (and, for the cohort view, from the same
 * persisted submission rows the results grid already loads).
 *
 * Every number here is reconcilable with the replay it was computed from, and
 * every sentence states what the records show. Nothing here estimates ability,
 * mastery, competence, intent or risk - by design there is no score of any
 * kind beyond the assessment marks the grader already produced.
 */

/** The replay slice of one question that the summary reads. */
export interface ReplayQuestionInput {
  questionId: string;
  title: string;
  position: number;
  points: number;
  concepts: string[];
  scorePercent: number | null;
  attempts: ReplayAttempt[];
  hintsAfterFinalAttempt: ReplayHint[];
  transferCheck: {
    title: string;
    attempted: boolean;
    result: TransferCheckResult | null;
  } | null;
}

function attemptPassed(attempt: ReplayAttempt): boolean | null {
  const ev = attempt.evaluation;
  if (!ev || ev.status !== "COMPLETED") return null; // not an evaluated attempt
  return ev.testsTotal > 0 && ev.testsPassed === ev.testsTotal;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function buildQuestionEvidence(q: ReplayQuestionInput): QuestionEvidence {
  let evaluatedAttempts = 0;
  let unsuccessfulAttempts = 0;
  let pendingAttempts = 0;
  let notEvaluatedAttempts = 0;
  let firstPassIndex: number | null = null; // 1-based among evaluated attempts
  let unsuccessfulBeforeFirstPass = 0;
  let hintsBeforeFirstPass = 0;
  let latestEvaluated: boolean | null = null;

  for (const attempt of q.attempts) {
    const passed = attemptPassed(attempt);
    if (passed === null) {
      if (attempt.submissionStatus === "FAILED" || attempt.evaluation?.status === "FAILED") {
        notEvaluatedAttempts += 1;
      } else {
        pendingAttempts += 1;
      }
      continue;
    }
    evaluatedAttempts += 1;
    latestEvaluated = passed;
    if (!passed) unsuccessfulAttempts += 1;
    if (firstPassIndex === null) {
      hintsBeforeFirstPass += attempt.hintsBefore.length;
      if (passed) {
        firstPassIndex = evaluatedAttempts;
      } else {
        unsuccessfulBeforeFirstPass += 1;
      }
    }
  }
  if (firstPassIndex === null) unsuccessfulBeforeFirstPass = unsuccessfulAttempts;

  const hintStagesConsumed =
    q.attempts.reduce((n, a) => n + a.hintsBefore.length, 0) + q.hintsAfterFinalAttempt.length;

  let finalOutcome: QuestionOutcome;
  if (q.attempts.length === 0) finalOutcome = "NOT_ATTEMPTED";
  else if (latestEvaluated === null) {
    finalOutcome = pendingAttempts > 0 ? "PENDING" : "NOT_EVALUATED";
  } else finalOutcome = latestEvaluated ? "PASSED" : "FAILED";

  const observations: string[] = [];
  switch (finalOutcome) {
    case "NOT_ATTEMPTED":
      observations.push("No submission.");
      break;
    case "PENDING":
      observations.push("Latest attempt is still being evaluated.");
      break;
    case "NOT_EVALUATED":
      observations.push("Latest attempt could not be evaluated by the grader.");
      break;
    case "PASSED":
      observations.push(
        evaluatedAttempts === 1
          ? "Passed on the first evaluated attempt."
          : `Passed after ${plural(evaluatedAttempts, "evaluated attempt")} (${unsuccessfulBeforeFirstPass} unsuccessful before the first pass).`,
      );
      break;
    case "FAILED":
      observations.push(
        firstPassIndex !== null
          ? `Final evaluated attempt failed; evaluated attempt ${firstPassIndex} had passed.`
          : `Final evaluated attempt failed (${plural(evaluatedAttempts, "evaluated attempt")}, ${unsuccessfulAttempts} unsuccessful).`,
      );
      break;
  }
  if (hintStagesConsumed > 0) {
    observations.push(
      firstPassIndex !== null
        ? `${plural(hintStagesConsumed, "hint stage")} consumed (${hintsBeforeFirstPass} before the first passing attempt).`
        : `${plural(hintStagesConsumed, "hint stage")} consumed.`,
    );
  }
  if (q.transferCheck) {
    const t = q.transferCheck;
    if (t.attempted) {
      const verb =
        t.result === "PASSED"
          ? "passed without hints"
          : t.result === "FAILED"
            ? "did not pass (attempted without hints)"
            : t.result === "PENDING"
              ? "is still being evaluated"
              : "could not be evaluated";
      observations.push(`Transfer Check (${t.title}) ${verb} - not part of the score.`);
    } else if (finalOutcome === "PASSED") {
      observations.push(`Transfer Check (${t.title}) available but not attempted.`);
    }
  }

  return {
    questionId: q.questionId,
    title: q.title,
    position: q.position,
    points: q.points,
    scorePercent: q.scorePercent,
    concepts: q.concepts,
    evaluatedAttempts,
    unsuccessfulAttempts,
    pendingAttempts,
    notEvaluatedAttempts,
    finalOutcome,
    attemptsUntilFirstPass: firstPassIndex,
    unsuccessfulBeforeFirstPass: firstPassIndex !== null ? unsuccessfulBeforeFirstPass : null,
    hintStagesConsumed,
    hintStagesBeforeFirstPass: firstPassIndex !== null ? hintsBeforeFirstPass : null,
    transfer: q.transferCheck
      ? {
          title: q.transferCheck.title,
          attempted: q.transferCheck.attempted,
          result: q.transferCheck.result,
        }
      : null,
    observations,
  };
}

function shortOutcome(q: QuestionEvidence): string {
  switch (q.finalOutcome) {
    case "PASSED":
      return q.evaluatedAttempts === 1
        ? "passed on the first evaluated attempt"
        : `passed after ${plural(q.evaluatedAttempts, "evaluated attempt")}`;
    case "FAILED":
      return `final evaluated attempt failed (${plural(q.evaluatedAttempts, "evaluated attempt")})`;
    case "PENDING":
      return "still being evaluated";
    case "NOT_EVALUATED":
      return "could not be evaluated";
    case "NOT_ATTEMPTED":
      return "no submission";
  }
}

export function buildSessionEvidenceSummary(input: {
  totalScore: number;
  maxScore: number;
  scorePercent: number | null;
  questions: ReplayQuestionInput[];
}): SessionEvidenceSummary {
  const questions = input.questions.map(buildQuestionEvidence);
  const count = (outcome: QuestionOutcome) =>
    questions.filter((q) => q.finalOutcome === outcome).length;

  const hintStagesConsumed = questions.reduce((n, q) => n + q.hintStagesConsumed, 0);
  const questionsWithHints = questions.filter((q) => q.hintStagesConsumed > 0).length;
  const withTransfer = questions.filter((q) => q.transfer !== null);
  const transferAttempted = withTransfer.filter((q) => q.transfer!.attempted);

  // Concept groups: the same per-question facts, labelled by the instructor's concepts.
  const byConcept = new Map<string, QuestionEvidence[]>();
  for (const q of questions) {
    for (const name of q.concepts) {
      const list = byConcept.get(name) ?? [];
      list.push(q);
      byConcept.set(name, list);
    }
  }
  const concepts: ConceptEvidenceGroup[] = [...byConcept.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, qs]) => ({
      name,
      questions: qs.map((q) => ({
        questionId: q.questionId,
        title: q.title,
        finalOutcome: q.finalOutcome,
        evaluatedAttempts: q.evaluatedAttempts,
        hintStagesConsumed: q.hintStagesConsumed,
      })),
      observation: `${plural(qs.length, "assessed question")} tagged ${name}: ${qs
        .map((q) => `${q.title} ${shortOutcome(q)}`)
        .join("; ")}.`,
    }));

  const observations: string[] = [];
  const passed = count("PASSED");
  const failed = count("FAILED");
  const notAttempted = count("NOT_ATTEMPTED");
  const pending = count("PENDING") + count("NOT_EVALUATED");
  const parts = [`${passed} of ${plural(questions.length, "question")} passed`];
  if (failed > 0) parts.push(`${failed} failed on the final evaluated attempt`);
  if (pending > 0) parts.push(`${pending} not yet evaluated`);
  if (notAttempted > 0) parts.push(`${notAttempted} without a submission`);
  observations.push(`${parts.join("; ")}.`);
  observations.push(
    hintStagesConsumed > 0
      ? `${plural(hintStagesConsumed, "hint stage")} consumed across ${plural(questionsWithHints, "question")}.`
      : "No hint stages consumed.",
  );
  for (const q of transferAttempted) {
    const r = q.transfer!.result;
    observations.push(
      `Transfer Check ${q.title} → ${q.transfer!.title}: ${
        r === "PASSED"
          ? "passed without hints"
          : r === "FAILED"
            ? "did not pass"
            : r === "PENDING"
              ? "still being evaluated"
              : "could not be evaluated"
      } - not part of the score.`,
    );
  }

  return {
    score: {
      totalScore: input.totalScore,
      maxScore: input.maxScore,
      scorePercent: input.scorePercent,
    },
    questions: {
      total: questions.length,
      attempted: questions.length - notAttempted,
      passed,
      failed,
      pending,
      notAttempted,
    },
    hints: { stagesConsumed: hintStagesConsumed, questionsWithHints },
    transfer: {
      available: withTransfer.length,
      attempted: transferAttempted.length,
      passed: transferAttempted.filter((q) => q.transfer!.result === "PASSED").length,
      failed: transferAttempted.filter((q) => q.transfer!.result === "FAILED").length,
    },
    questionEvidence: questions,
    concepts,
    observations,
  };
}

// ---------------------------------------------------------------------------
// Cohort: one question across the students of an assessment
// ---------------------------------------------------------------------------

/**
 * Per-question counts over the students' persisted submissions (transfer
 * submissions excluded by the caller). "Eventually passed" = latest evaluated
 * attempt passed; "first evaluated attempt passed" = the first attempt that
 * completed evaluation passed. Observed statistics only - not a difficulty
 * rating.
 */
export function buildQuestionCohortEvidence(
  perStudentRows: readonly (readonly HintEvidenceRow[])[],
): QuestionCohortEvidence {
  let studentsAttempted = 0;
  let firstEvaluatedAttemptPassed = 0;
  let eventuallyPassed = 0;
  const attemptsAmongPassed: number[] = [];

  for (const rows of perStudentRows) {
    if (rows.length === 0) continue;
    studentsAttempted += 1;
    const summary = summariseHintEvidence(rows);
    if (summary.evaluatedAttempts === 0) continue;
    const ordered = [...rows].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const first = ordered.find((r) => r.evaluationRuns[0]?.status === "COMPLETED")!;
    const firstCases = first.evaluationRuns[0]!.testCaseResults;
    if (firstCases.length > 0 && firstCases.every((c) => c.status === "PASSED")) {
      firstEvaluatedAttemptPassed += 1;
    }
    if (summary.latestOutcome === "PASSED") {
      eventuallyPassed += 1;
      attemptsAmongPassed.push(summary.evaluatedAttempts);
    }
  }

  return {
    studentsAttempted,
    firstEvaluatedAttemptPassed,
    eventuallyPassed,
    meanEvaluatedAttemptsAmongPassed:
      attemptsAmongPassed.length > 0
        ? Math.round(
            (attemptsAmongPassed.reduce((a, b) => a + b, 0) / attemptsAmongPassed.length) * 10,
          ) / 10
        : null,
  };
}
