import type {
  InstructorAssessmentResults,
  QuestionEvidence,
  SessionEvidenceSummary,
} from "@gradevision/shared";
import { useState } from "react";

import { Badge, Card } from "./ui";

/**
 * Observed per-question counts across the students of an assessment. Plain
 * statistics over persisted attempts - not a difficulty rating or a ranking.
 */
export function CohortEvidence({
  questions,
}: {
  questions: InstructorAssessmentResults["questions"];
}) {
  if (questions.length === 0) return null;
  return (
    <Card title="Observed question evidence (all students)">
      <ul className="space-y-1 text-xs text-neutral-700">
        {questions.map((q) => {
          const e = q.evidence;
          return (
            <li key={q.questionId}>
              <span className="font-medium">
                Q{q.position + 1}. {q.title}
              </span>
              {e.studentsAttempted === 0 ? (
                <span className="text-neutral-400"> — no submissions yet</span>
              ) : (
                <span className="text-neutral-600">
                  {" "}
                  — {e.studentsAttempted} attempted · first evaluated attempt passed:{" "}
                  {e.firstEvaluatedAttemptPassed}/{e.studentsAttempted} · eventually passed:{" "}
                  {e.eventuallyPassed}/{e.studentsAttempted}
                  {e.meanEvaluatedAttemptsAmongPassed !== null
                    ? ` · mean evaluated attempts among those who passed: ${e.meanEvaluatedAttemptsAmongPassed}`
                    : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Instructor evidence report for one session: counts and plain statements
 * derived from the Evidence Replay below it. Every line links to the question's
 * replay so it can be checked against the underlying attempts. It never rates
 * the student - there is no score here beyond the assessment marks.
 */
export function EvidenceSummary({ summary }: { summary: SessionEvidenceSummary }) {
  const [showConcepts, setShowConcepts] = useState(false);
  const q = summary.questions;
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Evidence summary</span>
        <span className="text-xs text-neutral-500">
          {summary.score.totalScore}/{summary.score.maxScore}
          {summary.score.scorePercent !== null ? ` (${summary.score.scorePercent}%)` : ""} ·{" "}
          {q.attempted}/{q.total} attempted · {q.passed} passed · {q.failed} failed
          {q.pending > 0 ? ` · ${q.pending} evaluating` : ""}
          {q.notAttempted > 0 ? ` · ${q.notAttempted} not attempted` : ""} ·{" "}
          {summary.hints.stagesConsumed} hint stage{summary.hints.stagesConsumed === 1 ? "" : "s"}
          {summary.transfer.available > 0
            ? ` · transfer ${summary.transfer.passed} passed / ${summary.transfer.attempted} attempted`
            : ""}
        </span>
      </div>

      <ul className="mb-3 list-disc space-y-0.5 pl-4 text-xs text-neutral-700">
        {summary.observations.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">Observed per question</p>
      <ul className="space-y-1">
        {summary.questionEvidence.map((qe) => (
          <QuestionLine key={qe.questionId} evidence={qe} />
        ))}
      </ul>

      {summary.concepts.length > 0 ? (
        <div className="mt-3 border-t border-neutral-100 pt-2">
          <button
            type="button"
            className="text-xs text-blue-700 hover:underline"
            onClick={() => setShowConcepts((v) => !v)}
          >
            {showConcepts ? "Hide" : "Show"} evidence grouped by concept ({summary.concepts.length})
          </button>
          {showConcepts ? (
            <ul className="mt-1 space-y-1 text-xs text-neutral-700">
              {summary.concepts.map((group) => (
                <li key={group.name}>
                  <span className="font-medium">{group.name}</span> — {group.observation}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-[11px] text-neutral-400">
            Concepts are instructor labels used to group the observations above; they are not a
            measure of the student.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function outcomeBadge(outcome: QuestionEvidence["finalOutcome"]) {
  switch (outcome) {
    case "PASSED":
      return <Badge tone="success">passed</Badge>;
    case "FAILED":
      return <Badge tone="danger">failed</Badge>;
    case "PENDING":
      return <Badge tone="info">evaluating</Badge>;
    case "NOT_EVALUATED":
      return <Badge tone="neutral">not evaluated</Badge>;
    case "NOT_ATTEMPTED":
      return <Badge tone="neutral">no submission</Badge>;
  }
}

function QuestionLine({ evidence }: { evidence: QuestionEvidence }) {
  return (
    <li className="text-xs text-neutral-700">
      <a
        href={`#replay-${evidence.questionId}`}
        className="font-medium text-blue-700 hover:underline"
      >
        Q{evidence.position + 1}. {evidence.title}
      </a>{" "}
      {outcomeBadge(evidence.finalOutcome)}{" "}
      <span className="text-neutral-500">
        {evidence.evaluatedAttempts} evaluated attempt{evidence.evaluatedAttempts === 1 ? "" : "s"}
        {evidence.unsuccessfulAttempts > 0
          ? ` (${evidence.unsuccessfulAttempts} unsuccessful)`
          : ""}
        {" · "}
        {evidence.hintStagesConsumed} hint stage{evidence.hintStagesConsumed === 1 ? "" : "s"}
        {evidence.transfer
          ? ` · transfer: ${
              !evidence.transfer.attempted
                ? "not attempted"
                : evidence.transfer.result === "PASSED"
                  ? "passed without hints"
                  : evidence.transfer.result === "FAILED"
                    ? "did not pass"
                    : evidence.transfer.result === "PENDING"
                      ? "evaluating"
                      : "not evaluated"
            } (not part of the score)`
          : ""}
      </span>
      <ul className="ml-3 list-disc pl-3 text-neutral-500">
        {evidence.observations.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </li>
  );
}
