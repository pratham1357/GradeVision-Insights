import type { ProgrammingLanguage, TransferCheckView } from "@gradevision/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { CodeEditor } from "../components/CodeEditor";
import { Alert, Badge, Button, Card, Spinner } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import { languageLabel } from "../lib/monaco";
import { studentApi } from "../lib/student-api";
import { messageFromError, useApi } from "../lib/use-api";
import { ProblemStatement, ResultPanel, transferResultLabel } from "./ExamPage";

const AUTOSAVE_DELAY_MS = 1500;
const EVALUATION_POLL_MS = 4_000;

/**
 * Transfer Check: a related question attempted WITHOUT hints, once, after the
 * source question was solved. Same editor and result view as the exam; no
 * hints panel exists here at all, and the API refuses hint requests for the
 * transfer question regardless. The result is recorded separately from the
 * assessment score.
 */
export function TransferCheckPage() {
  const { sessionId, questionId } = useParams();
  if (!sessionId || !questionId) return <Navigate to="/student" replace />;
  return <Loader sessionId={sessionId} sourceQuestionId={questionId} />;
}

function Loader({ sessionId, sourceQuestionId }: { sessionId: string; sourceQuestionId: string }) {
  const { data, loading, error, reload } = useApi(
    () => studentApi.getTransferCheck(sessionId, sourceQuestionId),
    [sessionId, sourceQuestionId],
  );
  if (loading && !data) return <Spinner label="Loading transfer check…" />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <BackToExam sessionId={sessionId} />
        <Alert kind="info" title="Transfer Check unavailable">
          {error ?? "Solve the original question first."}
        </Alert>
      </div>
    );
  }
  return (
    <Runner sessionId={sessionId} sourceQuestionId={sourceQuestionId} view={data} reload={reload} />
  );
}

function BackToExam({ sessionId }: { sessionId: string }) {
  return (
    <Link to={`/student/exam/${sessionId}`} className="text-xs text-blue-700 hover:underline">
      ← Back to the assessment
    </Link>
  );
}

function starterFor(view: TransferCheckView, language: ProgrammingLanguage): string {
  return view.question.languages.find((l) => l.language === language)?.starterCode ?? "";
}

function Runner({
  sessionId,
  sourceQuestionId,
  view,
  reload,
}: {
  sessionId: string;
  sourceQuestionId: string;
  view: TransferCheckView;
  reload: () => void;
}) {
  const question = view.question;
  const locked = view.timing.status !== "IN_PROGRESS";
  const attempted = view.transfer.attempted;
  const pending = view.transfer.result === "PENDING";

  const [language, setLanguage] = useState<ProgrammingLanguage>(
    () => question.draft?.language ?? question.languages[0]?.language ?? "PYTHON",
  );
  const [code, setCode] = useState(
    () => question.draft?.sourceCode ?? starterFor(view, question.draft?.language ?? language),
  );
  const [dirty, setDirty] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-fetch while the single attempt is being graded.
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(reload, EVALUATION_POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, reload]);

  // Debounced autosave of the transfer draft (same endpoint family as the exam).
  const latest = useRef({ language, code });
  latest.current = { language, code };
  const persist = useCallback(async () => {
    try {
      await studentApi.saveTransferDraft(sessionId, sourceQuestionId, {
        language: latest.current.language,
        sourceCode: latest.current.code,
      });
      setDirty(false);
      setSaveNote("Saved");
    } catch (err) {
      setSaveNote(messageFromError(err));
    }
  }, [sessionId, sourceQuestionId]);
  useEffect(() => {
    if (!dirty || locked || attempted) return;
    const id = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [dirty, code, language, locked, attempted, persist]);

  function changeLanguage(next: ProgrammingLanguage) {
    const wasStarter = code.trim() === "" || code === starterFor(view, language);
    setLanguage(next);
    if (wasStarter) setCode(starterFor(view, next));
    setDirty(true);
  }

  async function submit() {
    if (submitting) return;
    if (
      !window.confirm(
        "Submit your Transfer Check? This is your single attempt and it cannot be resubmitted.",
      )
    ) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      await studentApi.submitTransfer(sessionId, sourceQuestionId, {
        language,
        sourceCode: code,
      });
      setDirty(false);
      reload();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setSubmitError(messageFromError(err));
        reload();
      } else {
        setSubmitError(messageFromError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <BackToExam sessionId={sessionId} />
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            Transfer Check
            <Badge tone="neutral">Hints off</Badge>
          </h1>
          <p className="text-sm text-neutral-600">
            Related to <span className="font-medium">{view.sourceTitle}</span>
            {view.transfer.concepts.length > 0 ? ` · ${view.transfer.concepts.join(", ")}` : ""}
          </p>
        </div>
        {attempted ? (
          <span className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium">
            {transferResultLabel(view.transfer.result)}
          </span>
        ) : null}
      </div>

      <Alert kind="info" title="Hints are unavailable during this Transfer Check">
        Solve this related problem on your own, in a single attempt. The result is recorded
        separately from your assessment score - it does not change any marks.
      </Alert>

      {locked && !attempted ? (
        <Alert kind="warning">
          This session is no longer in progress; the transfer check cannot be attempted.
        </Alert>
      ) : null}

      <ProblemStatement question={question} showPoints={false} />

      <Card
        title={
          <span className="flex items-center gap-2">
            Your solution
            {saveNote ? (
              <span className="text-xs font-normal text-neutral-400">{saveNote}</span>
            ) : null}
          </span>
        }
        actions={
          <select
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
            value={language}
            disabled={locked || attempted}
            onChange={(e) => changeLanguage(e.target.value as ProgrammingLanguage)}
          >
            {question.languages.map((l) => (
              <option key={l.language} value={l.language}>
                {languageLabel(l.language)}
              </option>
            ))}
          </select>
        }
      >
        <CodeEditor
          language={language}
          value={code}
          onChange={(next) => {
            setCode(next);
            setDirty(true);
          }}
          readOnly={locked || attempted}
        />
        {submitError ? (
          <div className="mt-3">
            <Alert kind="error">{submitError}</Alert>
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">
            {attempted ? "Your attempt has been submitted." : "One attempt only."}
          </span>
          <Button loading={submitting} disabled={locked || attempted} onClick={() => void submit()}>
            {submitting ? "Submitting…" : "Submit transfer check"}
          </Button>
        </div>
      </Card>

      {attempted ? (
        <Card title="Transfer Check result">
          <p className="text-sm text-neutral-700">
            <span className="font-medium">{transferResultLabel(view.transfer.result)}</span>
            {view.transfer.result === "NOT_EVALUATED"
              ? " - the grader could not run your code; this does not count as your attempt, so you may submit again."
              : " - recorded separately from your assessment score."}
          </p>
        </Card>
      ) : null}

      <ResultPanel
        key={`transfer-result-${question.submissions[0]?.id ?? "none"}`}
        question={question}
      />
    </div>
  );
}
