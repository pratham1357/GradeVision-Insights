import type {
  InstructorSessionResult,
  ReplayAttempt,
  ReplayHint,
  SubmissionEvaluationDetail,
} from "@gradevision/shared";
import { useState } from "react";

import { languageLabel } from "../lib/monaco";
import { lineDiff } from "../lib/line-diff";
import { CodeEditor } from "./CodeEditor";
import { Badge } from "./ui";

type ReplayQuestion = InstructorSessionResult["questions"][number];

/**
 * Evidence Replay for one question of one student's session: every attempt in
 * order with its code, its evaluation and the hints delivered before it, then
 * the Transfer Check - all read from persisted rows. Wording states what the
 * records show ("Attempt 2 passed 4/4 tests", "Hint stage 2 was requested
 * before Attempt 2"); it never interprets, scores or profiles the student.
 */
export function QuestionReplay({ question }: { question: ReplayQuestion }) {
  const { attempts, hintsAfterFinalAttempt, transferCheck } = question;
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium">
          Q{question.position + 1}. {question.title}
        </span>
        <span className="text-xs text-neutral-400">
          {question.evaluation
            ? `latest: ${question.evaluation.testsPassed}/${question.evaluation.testsTotal} tests · ${question.evaluation.score ?? 0}/${question.evaluation.maxScore ?? 0} · ${question.points} pts`
            : question.submissionStatus
              ? question.submissionStatus.toLowerCase()
              : "no submission"}
        </span>
      </div>

      {attempts.length === 0 ? (
        <p className="text-xs text-neutral-400">No submission for this question.</p>
      ) : (
        <ol className="space-y-2">
          {attempts.map((attempt, index) => (
            <li key={attempt.submissionId} className="space-y-2">
              {attempt.hintsBefore.map((hint) => (
                <HintRow
                  key={`${hint.stageNumber}-${hint.requestedAt}`}
                  hint={hint}
                  context={`before Attempt ${attempt.attemptNumber}`}
                />
              ))}
              <AttemptRow attempt={attempt} previous={attempts[index - 1] ?? null} />
            </li>
          ))}
        </ol>
      )}

      {hintsAfterFinalAttempt.map((hint) => (
        <div key={`${hint.stageNumber}-${hint.requestedAt}`} className="mt-2">
          <HintRow
            hint={hint}
            context={
              attempts.length === 0 ? "with no attempt submitted" : "after the final attempt"
            }
          />
        </div>
      ))}

      {transferCheck ? <TransferRow transfer={transferCheck} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function outcomeOf(evaluation: SubmissionEvaluationDetail | null, submissionStatus: string) {
  if (!evaluation) {
    return submissionStatus === "FAILED"
      ? { label: "Could not be evaluated", tone: "neutral" as const }
      : { label: "Being evaluated", tone: "info" as const };
  }
  if (evaluation.status === "PENDING" || evaluation.status === "RUNNING") {
    return { label: "Being evaluated", tone: "info" as const };
  }
  if (evaluation.status !== "COMPLETED") {
    return { label: "Could not be evaluated", tone: "neutral" as const };
  }
  const all = evaluation.testsTotal > 0 && evaluation.testsPassed === evaluation.testsTotal;
  return all
    ? { label: `Passed all ${evaluation.testsTotal} tests`, tone: "success" as const }
    : {
        label: `Failed ${evaluation.testsTotal - evaluation.testsPassed}/${evaluation.testsTotal} tests`,
        tone: evaluation.testsPassed > 0 ? ("warning" as const) : ("danger" as const),
      };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function AttemptRow({
  attempt,
  previous,
}: {
  attempt: ReplayAttempt;
  previous: ReplayAttempt | null;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"code" | "diff">("code");
  const outcome = outcomeOf(attempt.evaluation, attempt.submissionStatus);

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="font-medium">Attempt {attempt.attemptNumber}</span>
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          {attempt.evaluation?.status === "COMPLETED" ? (
            <span className="text-xs text-neutral-500">
              score {attempt.evaluation.score ?? 0}/{attempt.evaluation.maxScore ?? 0}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-neutral-400">
          {languageLabel(attempt.language)} · {when(attempt.submittedAt)} ·{" "}
          {open ? "hide evidence" : "show evidence"}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-neutral-200 px-3 py-3">
          <TestEvidence
            evaluation={attempt.evaluation}
            submissionStatus={attempt.submissionStatus}
          />

          <div>
            <div className="mb-1 flex items-center gap-3 text-xs">
              <span className="font-semibold uppercase text-neutral-400">Submitted code</span>
              <button
                type="button"
                className={`hover:underline ${view === "code" ? "font-medium text-neutral-800" : "text-blue-700"}`}
                onClick={() => setView("code")}
              >
                Code
              </button>
              {previous ? (
                <button
                  type="button"
                  className={`hover:underline ${view === "diff" ? "font-medium text-neutral-800" : "text-blue-700"}`}
                  onClick={() => setView("diff")}
                >
                  Changes since Attempt {previous.attemptNumber}
                </button>
              ) : null}
            </div>
            {view === "diff" && previous ? (
              <DiffView before={previous.sourceCode} after={attempt.sourceCode} />
            ) : (
              <CodeEditor
                language={attempt.language}
                value={attempt.sourceCode}
                onChange={noop}
                readOnly
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function noop(): void {
  /* read-only viewer */
}

function TestEvidence({
  evaluation,
  submissionStatus,
}: {
  evaluation: SubmissionEvaluationDetail | null;
  submissionStatus: string;
}) {
  if (!evaluation) {
    return (
      <p className="text-xs text-neutral-500">
        {submissionStatus === "FAILED"
          ? "The automated grader could not evaluate this submission."
          : "This submission has not finished evaluating."}
      </p>
    );
  }
  if (evaluation.status !== "COMPLETED") {
    return (
      <p className="text-xs text-neutral-500">
        {evaluation.error?.message ?? "The automated grader could not evaluate this submission."}
      </p>
    );
  }
  const hiddenFailed = evaluation.testResults.filter((t) => t.hidden && !t.passed).length;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">
        Test evidence · {evaluation.testsPassed}/{evaluation.testsTotal} passed
        {hiddenFailed > 0
          ? ` · ${hiddenFailed} hidden test${hiddenFailed === 1 ? "" : "s"} failed`
          : ""}
      </p>
      <ul className="space-y-0.5 text-xs text-neutral-600">
        {evaluation.testResults.map((t) => (
          <li key={t.index}>
            <span className={t.passed ? "text-green-600" : "text-red-600"}>
              {t.passed ? "✓" : "✗"}
            </span>{" "}
            {t.hidden ? `Hidden test ${t.index}` : (t.name ?? `Test ${t.index}`)} · {t.status}
            {!t.hidden && !t.passed && t.actualOutput !== null ? (
              <span className="text-neutral-400">
                {" "}
                · expected <code>{JSON.stringify(t.expectedOutput ?? "")}</code>, printed{" "}
                <code>{JSON.stringify(t.actualOutput)}</code>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {evaluation.rubric.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-neutral-500">
          {evaluation.rubric.map((r) => (
            <li key={r.name}>
              {r.name}: {r.pointsAwarded}/{r.maxPoints}
              {r.notes ? ` — ${r.notes}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function HintRow({ hint, context }: { hint: ReplayHint; context: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-900">
          <span className="font-medium">Hint stage {hint.stageNumber}</span>
          {hint.title ? ` (${hint.title})` : ""} · {hint.source === "ai" ? "AI mentor" : "authored"}{" "}
          · requested {context}
          {hint.grantedAfter
            ? ` · granted after ${hint.grantedAfter.unsuccessfulAttempts} unsuccessful evaluated attempt${hint.grantedAfter.unsuccessfulAttempts === 1 ? "" : "s"}`
            : ""}
        </span>
        <span className="text-amber-700">
          {when(hint.requestedAt)}
          {hint.content ? (
            <>
              {" · "}
              <button type="button" className="hover:underline" onClick={() => setOpen((o) => !o)}>
                {open ? "hide text" : "show text"}
              </button>
            </>
          ) : null}
        </span>
      </div>
      {open && hint.content ? (
        <p className="mt-1 whitespace-pre-wrap text-amber-900">{hint.content}</p>
      ) : null}
    </div>
  );
}

function TransferRow({ transfer }: { transfer: NonNullable<ReplayQuestion["transferCheck"]> }) {
  const [open, setOpen] = useState(false);
  const attempt = transfer.attempt;
  const label =
    transfer.result === "PASSED"
      ? `Passed all ${transfer.testsTotal ?? 0} tests`
      : transfer.result === "FAILED"
        ? `Failed ${(transfer.testsTotal ?? 0) - (transfer.testsPassed ?? 0)}/${transfer.testsTotal ?? 0} tests`
        : transfer.result === "PENDING"
          ? "Being evaluated"
          : transfer.result === "NOT_EVALUATED"
            ? "Could not be evaluated"
            : "Not attempted";
  const tone =
    transfer.result === "PASSED"
      ? ("success" as const)
      : transfer.result === "FAILED"
        ? ("danger" as const)
        : ("neutral" as const);

  return (
    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => attempt && setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="font-medium">Transfer Check</span>
          <span className="text-neutral-600">{transfer.title}</span>
          <Badge tone={tone}>{label}</Badge>
          <Badge tone="neutral">hints off</Badge>
          <Badge tone="neutral">not part of the assessment score</Badge>
        </span>
        <span className="text-xs text-neutral-400">
          {attempt
            ? `${languageLabel(attempt.language)} · ${when(attempt.submittedAt)} · ${open ? "hide evidence" : "show evidence"}`
            : "no independent attempt recorded"}
        </span>
      </button>
      {open && attempt ? (
        <div className="space-y-3 border-t border-blue-200 px-3 py-3">
          <TestEvidence
            evaluation={attempt.evaluation}
            submissionStatus={attempt.submissionStatus}
          />
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">
              Independent submission
            </p>
            <CodeEditor
              language={attempt.language}
              value={attempt.sourceCode}
              onChange={noop}
              readOnly
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const diff = lineDiff(before, after);
  if (!diff) {
    return (
      <p className="text-xs text-neutral-500">
        These submissions are too large to diff here; view each attempt's code instead.
      </p>
    );
  }
  if (diff.added === 0 && diff.removed === 0) {
    return <p className="text-xs text-neutral-500">Identical to the previous attempt.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-300 bg-white">
      <p className="border-b border-neutral-200 px-2 py-1 text-xs text-neutral-500">
        +{diff.added} added · −{diff.removed} removed (line-based)
      </p>
      <pre className="p-2 font-mono text-xs leading-5">
        {diff.ops.map((op, i) => (
          <div
            key={i}
            className={
              op.kind === "add"
                ? "bg-green-50 text-green-800"
                : op.kind === "del"
                  ? "bg-red-50 text-red-800 line-through decoration-red-300"
                  : "text-neutral-600"
            }
          >
            <span className="select-none pr-2 text-neutral-400">
              {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
            </span>
            {op.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
