import type {
  ExamQuestion,
  ExamSessionView,
  HintStageView,
  ProgrammingLanguage,
  SessionTiming,
  SubmissionEvaluationSummary,
  SubmissionResultView,
  ViolationType,
} from "@gradevision/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { CodeEditor } from "../components/CodeEditor";
import { Alert, Badge, Button, Card, Spinner } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import { languageLabel } from "../lib/monaco";
import { connectRealtime } from "../lib/realtime";
import { studentApi } from "../lib/student-api";
import { requestExamFullscreen, useIntegrityMonitor } from "../lib/use-integrity-monitor";
import { messageFromError, useApi } from "../lib/use-api";

const AUTOSAVE_DELAY_MS = 1500;
const AUTOSAVE_RETRY_MS = 6_000;
const REFRESH_INTERVAL_MS = 20_000;
const EVALUATION_POLL_MS = 4_000;
const LIVE_SAFETY_REFRESH_MS = 45_000;
const SLOW_EVAL_NOTICE_MS = 35_000;

const PENDING_EVAL_STATUSES = new Set(["PENDING", "RUNNING"]);

function isEvaluationPending(q: ExamQuestion): boolean {
  return q.submissions.some(
    (s) =>
      s.status === "QUEUED" ||
      s.status === "RUNNING" ||
      (s.evaluation !== null && PENDING_EVAL_STATUSES.has(s.evaluation.status)),
  );
}

type QuestionState = "unanswered" | "evaluating" | "passed" | "partial" | "failed";

function questionState(q: ExamQuestion): QuestionState {
  const latest = q.submissions[0];
  if (!latest) return "unanswered";
  const evaluation = latest.evaluation;
  if (!evaluation || evaluation.status === "PENDING" || evaluation.status === "RUNNING") {
    return latest.status === "FAILED" ? "failed" : "evaluating";
  }
  if (evaluation.status === "FAILED" || evaluation.status === "CANCELLED") return "failed";
  if (evaluation.testsTotal > 0 && evaluation.testsPassed === evaluation.testsTotal)
    return "passed";
  return evaluation.testsPassed > 0 ? "partial" : "failed";
}

const STATE_DOT: Record<QuestionState, string> = {
  unanswered: "bg-neutral-300",
  evaluating: "bg-blue-400 animate-pulse",
  passed: "bg-green-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
};

export function ExamPage() {
  const { sessionId } = useParams();
  if (!sessionId) return <Navigate to="/student" replace />;
  return <ExamLoader sessionId={sessionId} />;
}

function ExamLoader({ sessionId }: { sessionId: string }) {
  const { data, loading, error } = useApi(() => studentApi.getSession(sessionId), [sessionId]);

  if (loading) return <Spinner label="Loading your exam…" />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <Alert kind="error">{error ?? "Session not found"}</Alert>
        <Link to="/student" className="text-sm text-blue-700 hover:underline">
          ← Back to your assessments
        </Link>
      </div>
    );
  }
  return <ExamRunner key={sessionId} sessionId={sessionId} initialView={data} />;
}

// ---------------------------------------------------------------------------

interface EditorState {
  language: ProgrammingLanguage;
  code: string;
}

function starterFor(question: ExamQuestion, language: ProgrammingLanguage): string {
  return question.languages.find((l) => l.language === language)?.starterCode ?? "";
}

function seedEditors(view: ExamSessionView): Record<string, EditorState> {
  const map: Record<string, EditorState> = {};
  for (const q of view.questions) {
    if (q.draft) {
      map[q.id] = { language: q.draft.language, code: q.draft.sourceCode };
    } else {
      const language = q.languages[0]?.language ?? "PYTHON";
      map[q.id] = { language, code: starterFor(q, language) };
    }
  }
  return map;
}

function computeRemaining(timing: SessionTiming): number | null {
  if (timing.remainingSeconds === null) return null;
  const elapsed = Math.floor((Date.now() - Date.parse(timing.serverTime)) / 1000);
  return Math.max(0, timing.remainingSeconds - elapsed);
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "offline" } // network hiccup - will retry automatically
  | { kind: "error"; message: string };

function isNetworkError(err: unknown): boolean {
  return err instanceof ApiClientError && err.isNetwork;
}

function ExamRunner({
  sessionId,
  initialView,
}: {
  sessionId: string;
  initialView: ExamSessionView;
}) {
  const navigate = useNavigate();
  const [view, setView] = useState(initialView);
  const [editors, setEditors] = useState<Record<string, EditorState>>(() =>
    seedEditors(initialView),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [socketLive, setSocketLive] = useState(false);
  const [slowEval, setSlowEval] = useState(false);
  const [, forceTick] = useState(0);

  const questions = view.questions;
  const current = questions[currentIndex] ?? questions[0];
  const currentId = current?.id ?? "";
  const editor = editors[currentId] ?? { language: "PYTHON" as ProgrammingLanguage, code: "" };

  const locked = view.timing.status !== "IN_PROGRESS";
  const remaining = computeRemaining(view.timing);
  const timeUp = remaining === 0;

  const refresh = useCallback(async () => {
    try {
      setView(await studentApi.getSession(sessionId));
    } catch {
      /* transient - keep showing what we have */
    }
  }, [sessionId]);

  // 1-second display tick for the countdown.
  useEffect(() => {
    if (locked) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [locked]);

  // When the local countdown reaches zero, get the server's authoritative state.
  useEffect(() => {
    if (timeUp && !locked) void refresh();
  }, [timeUp, locked, refresh]);

  // Live updates over Socket.IO. The REST view stays the source of truth - the
  // socket only tells us when to re-fetch. `onStatus(false)` -> polling resumes.
  useEffect(() => {
    return connectRealtime(
      { sessionId },
      {
        onStatus: setSocketLive,
        // Re-fetch once on every (re)subscribe so a reconnect closes any gap.
        onReady: () => void refresh(),
        onSessionChanged: () => void refresh(),
        onViolation: (violationCount) =>
          setView((v) => ({ ...v, integrity: { ...v.integrity, violationCount } })),
      },
    );
  }, [sessionId, refresh]);

  // Re-sync loop. Fast polling only when the socket is down; a slow safety net
  // otherwise so a missed event still self-heals.
  const evaluationPending = questions.some(isEvaluationPending);
  useEffect(() => {
    if (locked && !evaluationPending) return;
    const interval = socketLive
      ? LIVE_SAFETY_REFRESH_MS
      : evaluationPending
        ? EVALUATION_POLL_MS
        : REFRESH_INTERVAL_MS;
    const id = window.setInterval(() => void refresh(), interval);
    return () => window.clearInterval(id);
  }, [locked, socketLive, evaluationPending, refresh]);

  // "Still working on it" reassurance if an evaluation runs long.
  useEffect(() => {
    if (!evaluationPending) {
      setSlowEval(false);
      return;
    }
    const id = window.setTimeout(() => setSlowEval(true), SLOW_EVAL_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [evaluationPending]);

  // Warn before a refresh / tab close swallows unsaved edits.
  const unsaved = save.kind === "unsaved" || save.kind === "offline";
  useEffect(() => {
    if (locked || !unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [locked, unsaved]);

  // Non-invasive integrity monitor: focus + fullscreen only.
  const reportViolation = useCallback(
    async (type: ViolationType, note?: string) => {
      try {
        const result = await studentApi.recordViolation(sessionId, { type, note });
        setView((v) => ({
          ...v,
          integrity: {
            violationCount: result.violationCount,
            lastViolationAt: new Date().toISOString(),
            warning: result.warning,
          },
        }));
      } catch {
        /* integrity signalling is best-effort - never disrupt the exam */
      }
    },
    [sessionId],
  );
  useIntegrityMonitor(!locked, reportViolation);

  const persistDraft = useCallback(
    async (questionId: string, state: EditorState) => {
      setSave({ kind: "saving" });
      try {
        const result = await studentApi.saveDraft(sessionId, questionId, {
          language: state.language,
          sourceCode: state.code,
        });
        setView((v) => ({ ...v, timing: result.timing }));
        setSave({ kind: "saved", at: Date.now() });
      } catch (err) {
        if (isNetworkError(err)) {
          // Keep the edit "dirty" so the retry effect saves it once we are back.
          setSave({ kind: "offline" });
        } else if (err instanceof ApiClientError && err.status === 409) {
          setSave({
            kind: "error",
            message: "This session is closed - your last saved version is safe.",
          });
          void refresh();
        } else {
          setSave({ kind: "error", message: messageFromError(err) });
        }
      }
    },
    [sessionId, refresh],
  );

  // Debounced autosave, plus automatic retry after a network hiccup.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    if (locked) return;
    const delay =
      save.kind === "unsaved" ? AUTOSAVE_DELAY_MS : save.kind === "offline" ? AUTOSAVE_RETRY_MS : 0;
    if (delay === 0) return;
    const id = window.setTimeout(() => {
      void persistDraft(currentId, editorRef.current);
    }, delay);
    return () => window.clearTimeout(id);
  }, [locked, save.kind, currentId, editor.code, editor.language, persistDraft]);

  function updateEditor(next: Partial<EditorState>) {
    setEditors((prev) => ({ ...prev, [currentId]: { ...editor, ...next } }));
    setSave({ kind: "unsaved" });
  }

  function changeLanguage(language: ProgrammingLanguage) {
    if (!current) return;
    const wasStarter =
      editor.code.trim() === "" || editor.code === starterFor(current, editor.language);
    updateEditor({
      language,
      code: wasStarter ? starterFor(current, language) : editor.code,
    });
  }

  async function goToQuestion(index: number) {
    if (index === currentIndex) return;
    if (!locked && (save.kind === "unsaved" || save.kind === "offline")) {
      await persistDraft(currentId, editorRef.current);
    }
    setCurrentIndex(index);
    setSubmitError(null);
    setSave({ kind: "idle" });
  }

  async function submitCurrent() {
    if (!current || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await studentApi.submit(sessionId, current.id, {
        language: editor.language,
        sourceCode: editor.code,
      });
      setView((v) => ({ ...v, timing: result.timing }));
      setSave({ kind: "saved", at: Date.now() });
      await refresh();
    } catch (err) {
      if (isNetworkError(err)) {
        setSubmitError(
          "Couldn't reach the server to submit. Your code is saved as a draft - check your connection and try again.",
        );
      } else if (err instanceof ApiClientError && err.status === 409) {
        setSubmitError("This session is closed - submissions are no longer accepted.");
        void refresh();
      } else {
        setSubmitError(messageFromError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function finishExam() {
    setFinishing(true);
    try {
      if (!locked && (save.kind === "unsaved" || save.kind === "offline")) {
        await persistDraft(currentId, editorRef.current);
      }
      setView(await studentApi.finishSession(sessionId));
    } catch (err) {
      setSubmitError(messageFromError(err));
    } finally {
      setFinishing(false);
    }
  }

  if (view.timing.status === "SUBMITTED") {
    return (
      <EndScreen title="Assessment submitted" view={view} onDone={() => navigate("/student")} />
    );
  }

  const answeredCount = questions.filter((q) => q.submissions.length > 0).length;
  const assessmentClosed = view.assessmentStatus === "CLOSED";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/90 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <Link to="/student" className="text-xs text-blue-700 hover:underline">
              ← Your assessments
            </Link>
            <h1 className="truncate text-base font-semibold">{view.assessmentTitle}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-neutral-500 sm:inline">
              {answeredCount}/{questions.length} submitted
            </span>
            <IntegrityChip summary={view.integrity} />
            <LiveDot connected={socketLive} />
            <Timer remaining={remaining} locked={locked} />
            {!locked ? (
              <Button size="sm" variant="secondary" onClick={() => void requestExamFullscreen()}>
                Fullscreen
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              loading={finishing}
              onClick={() => {
                if (
                  window.confirm(
                    "Finish and submit the whole assessment? You will not be able to reopen it.",
                  )
                ) {
                  void finishExam();
                }
              }}
            >
              {finishing ? "Finishing…" : "Finish exam"}
            </Button>
          </div>
        </div>
      </div>

      {locked ? (
        <Alert
          kind={view.timing.status === "EXPIRED" ? "warning" : "info"}
          title={
            view.timing.status === "EXPIRED"
              ? "Time is up"
              : `Session ${view.timing.status.toLowerCase()}`
          }
        >
          Your saved work is preserved. No more changes can be made; your submissions are still
          being graded.
        </Alert>
      ) : assessmentClosed ? (
        <Alert kind="warning" title="Your instructor closed this assessment">
          You can finish and submit your current work, but it may not be graded further.
        </Alert>
      ) : null}

      {view.integrity.warning ? (
        <Alert kind={view.integrity.violationCount >= 3 ? "error" : "warning"} title="Exam focus">
          {view.integrity.warning}
        </Alert>
      ) : !locked ? (
        <IntegrityIntro />
      ) : null}

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <QuestionNav
          questions={questions}
          view={view}
          currentIndex={currentIndex}
          onSelect={(i) => void goToQuestion(i)}
        />

        {current ? (
          <div className="space-y-4">
            <ProblemStatement question={current} />

            <Card
              title={
                <span className="flex items-center gap-2">
                  Your solution
                  <SaveIndicator status={save} />
                </span>
              }
              actions={
                <select
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                  value={editor.language}
                  disabled={locked}
                  onChange={(e) => changeLanguage(e.target.value as ProgrammingLanguage)}
                >
                  {current.languages.map((l) => (
                    <option key={l.language} value={l.language}>
                      {languageLabel(l.language)}
                    </option>
                  ))}
                </select>
              }
            >
              <CodeEditor
                language={editor.language}
                value={editor.code}
                onChange={(code) => updateEditor({ code })}
                readOnly={locked}
              />

              {submitError ? (
                <div className="mt-3">
                  <Alert kind="error">{submitError}</Alert>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <SubmissionList question={current} />
                <Button loading={submitting} disabled={locked} onClick={() => void submitCurrent()}>
                  {submitting ? "Submitting…" : "Submit this question"}
                </Button>
              </div>
            </Card>

            {slowEval ? (
              <Alert kind="info">
                Grading is taking longer than usual - it will update here automatically when it
                finishes.
              </Alert>
            ) : null}

            <ResultPanel key={`result-${currentId}`} question={current} />

            <HintsPanel
              key={`hints-${currentId}`}
              sessionId={sessionId}
              questionId={currentId}
              locked={locked}
            />
          </div>
        ) : (
          <Alert kind="info">This assessment has no questions.</Alert>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span
      className="flex items-center gap-1 text-xs text-neutral-400"
      title={
        connected
          ? "Live updates connected"
          : "Live updates unavailable - the page still refreshes periodically"
      }
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-neutral-300"
        }`}
      />
      <span className="hidden sm:inline">{connected ? "Live" : "Offline"}</span>
    </span>
  );
}

function IntegrityChip({ summary }: { summary: ExamSessionView["integrity"] }) {
  const count = summary.violationCount;
  const tone = count === 0 ? "neutral" : count >= 3 ? "danger" : "warning";
  return (
    <Badge tone={tone}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      Focus {count === 0 ? "OK" : count}
    </Badge>
  );
}

function IntegrityIntro() {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return (
    <Alert kind="info" title="Exam integrity">
      <div className="flex items-start justify-between gap-3">
        <span>
          Please stay in this window and use fullscreen. Switching tabs or leaving fullscreen is
          recorded and shown to your instructor - it is not a hard block.
        </span>
        <button
          className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
          onClick={() => setShow(false)}
        >
          Got it
        </button>
      </div>
    </Alert>
  );
}

function Timer({ remaining, locked }: { remaining: number | null; locked: boolean }) {
  if (remaining === null) {
    return (
      <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-500">No limit</span>
    );
  }
  const warn = !locked && remaining <= 300;
  const danger = !locked && remaining <= 60;
  const cls = danger
    ? "bg-red-100 text-red-800 ring-1 ring-red-300"
    : warn
      ? "bg-amber-100 text-amber-900"
      : "bg-neutral-100 text-neutral-700";
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-sm tabular-nums ${cls} ${danger ? "animate-pulse" : ""}`}
      title="Time remaining (server clock)"
    >
      {locked && remaining === 0 ? "00:00" : formatClock(remaining)}
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status.kind === "saved") {
    return (
      <span className="text-xs font-normal text-green-600">
        Saved {new Date(status.at).toLocaleTimeString()}
      </span>
    );
  }
  if (status.kind === "saving") {
    return <span className="text-xs font-normal text-neutral-400">Saving…</span>;
  }
  if (status.kind === "offline") {
    return <span className="text-xs font-normal text-amber-600">Offline – will retry</span>;
  }
  if (status.kind === "unsaved") {
    return <span className="text-xs font-normal text-neutral-400">Unsaved changes</span>;
  }
  if (status.kind === "error") {
    return <span className="text-xs font-normal text-red-600">{status.message}</span>;
  }
  return null;
}

function QuestionNav({
  questions,
  view,
  currentIndex,
  onSelect,
}: {
  questions: ExamQuestion[];
  view: ExamSessionView;
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
      {questions.map((q, index) => {
        const active = index === currentIndex;
        const state = questionState(q);
        return (
          <button
            key={q.id}
            onClick={() => onSelect(index)}
            className={`flex w-full min-w-[9rem] items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition md:min-w-0 ${
              active
                ? "border-blue-500 bg-blue-50 text-blue-900"
                : "border-neutral-200 bg-white hover:bg-neutral-50"
            }`}
            title={state}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[state]}`} />
            <span className="truncate">
              {index + 1}. {q.title}
            </span>
          </button>
        );
      })}
      <p className="hidden px-1 pt-1 text-xs text-neutral-400 md:block">
        {view.questions.filter((q) => q.submissions.length > 0).length}/{questions.length} submitted
      </p>
    </nav>
  );
}

function ProblemStatement({ question }: { question: ExamQuestion }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {question.title}
          <Badge>{question.difficulty}</Badge>
          <span className="text-xs font-normal text-neutral-400">{question.points} pts</span>
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="whitespace-pre-wrap text-neutral-700">{question.statement}</p>
        {question.constraints ? (
          <Section label="Constraints">{question.constraints}</Section>
        ) : null}
        {question.inputFormat ? <Section label="Input">{question.inputFormat}</Section> : null}
        {question.outputFormat ? <Section label="Output">{question.outputFormat}</Section> : null}

        {question.sampleTestCases.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">Examples</p>
            <div className="space-y-2">
              {question.sampleTestCases.map((tc, i) => (
                <div key={i} className="grid gap-2 rounded-md bg-neutral-50 p-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-neutral-500">Input</p>
                    <pre className="whitespace-pre-wrap font-mono text-xs">{tc.input}</pre>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-neutral-500">Expected output</p>
                    <pre className="whitespace-pre-wrap font-mono text-xs">{tc.expectedOutput}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-neutral-400">{label}</p>
      <p className="whitespace-pre-wrap text-neutral-700">{children}</p>
    </div>
  );
}

function SubmissionList({ question }: { question: ExamQuestion }) {
  if (question.submissions.length === 0) {
    return <span className="text-xs text-neutral-400">No submissions yet</span>;
  }
  const latest = question.submissions[0];
  return (
    <span className="text-xs text-neutral-500">
      {question.submissions.length} submission{question.submissions.length > 1 ? "s" : ""} · latest:{" "}
      {latest ? `#${latest.attemptNumber} (${latest.status})` : "—"}
    </span>
  );
}

function EvaluationBadge({
  evaluation,
  fallback,
}: {
  evaluation: SubmissionEvaluationSummary | null;
  fallback: string;
}) {
  if (!evaluation) {
    const queued = fallback === "QUEUED" || fallback === "RUNNING";
    return <Badge tone={queued ? "info" : "neutral"}>{queued ? "Evaluating…" : fallback}</Badge>;
  }
  if (evaluation.status === "PENDING" || evaluation.status === "RUNNING") {
    return <Badge tone="info">Evaluating…</Badge>;
  }
  if (evaluation.status === "FAILED" || evaluation.status === "CANCELLED") {
    return <Badge tone="danger">Could not evaluate</Badge>;
  }
  const perfect = evaluation.testsTotal > 0 && evaluation.testsPassed === evaluation.testsTotal;
  return (
    <Badge tone={perfect ? "success" : "warning"}>
      Scored {evaluation.score ?? 0}/{evaluation.maxScore ?? 0}
    </Badge>
  );
}

function ResultPanel({ question }: { question: ExamQuestion }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SubmissionResultView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = question.submissions[0] ?? null;
  const evaluation = latest?.evaluation ?? null;
  const completed = evaluation?.status === "COMPLETED";
  const submissionId = latest?.id ?? null;

  useEffect(() => {
    if (!open || !submissionId || !completed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    studentApi
      .getSubmissionResult(submissionId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(messageFromError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, submissionId, completed, evaluation?.scorePercent]);

  if (!latest) return null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Result
          <EvaluationBadge evaluation={evaluation} fallback={latest.status} />
        </span>
      }
      actions={
        completed ? (
          <button
            className="text-xs text-blue-700 hover:underline"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide details" : "Show details"}
          </button>
        ) : null
      }
    >
      {!evaluation || evaluation.status === "PENDING" || evaluation.status === "RUNNING" ? (
        <p className="text-sm text-neutral-500">
          Your latest submission (attempt #{latest.attemptNumber}) is being evaluated…
        </p>
      ) : evaluation.status === "FAILED" ? (
        <Alert kind="error">
          This submission could not be evaluated automatically. Your instructor can still review it.
        </Alert>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">
              {evaluation.testsPassed}/{evaluation.testsTotal}
            </span>{" "}
            test cases passed · score{" "}
            <span className="font-medium">
              {evaluation.score ?? 0}/{evaluation.maxScore ?? 0}
            </span>
            {evaluation.scorePercent !== null ? ` (${evaluation.scorePercent}%)` : ""}
          </p>

          {open ? (
            loading ? (
              <Spinner label="Loading result…" />
            ) : error ? (
              <Alert kind="error">{error}</Alert>
            ) : detail && detail.evaluation ? (
              <ResultDetail evaluation={detail.evaluation} />
            ) : null
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ResultDetail({
  evaluation,
}: {
  evaluation: NonNullable<SubmissionResultView["evaluation"]>;
}) {
  return (
    <div className="space-y-3 border-t border-neutral-100 pt-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">Test cases</p>
        <ul className="space-y-1">
          {evaluation.testResults.map((t) => (
            <li key={t.index} className="flex items-center gap-2 text-xs">
              <span
                className={
                  t.passed
                    ? "text-green-600"
                    : t.status === "SKIPPED"
                      ? "text-neutral-400"
                      : "text-red-600"
                }
              >
                {t.passed ? "✓" : t.status === "SKIPPED" ? "–" : "✗"}
              </span>
              <span className="text-neutral-600">
                {t.hidden ? `Hidden test ${t.index}` : (t.name ?? `Test ${t.index}`)} · {t.status}
                {t.executionTimeMs !== null ? ` · ${t.executionTimeMs}ms` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {evaluation.rubric.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">Rubric</p>
          <ul className="space-y-1">
            {evaluation.rubric.map((r) => (
              <li key={r.name} className="text-xs text-neutral-600">
                <span className="font-medium">{r.name}</span>: {r.pointsAwarded}/{r.maxPoints}
                {r.notes ? ` — ${r.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evaluation.feedback.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">Feedback</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-600">
            {evaluation.feedback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function HintsPanel({
  sessionId,
  questionId,
  locked,
}: {
  sessionId: string;
  questionId: string;
  locked: boolean;
}) {
  const [stages, setStages] = useState<HintStageView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const view = await studentApi.listHints(sessionId, questionId);
      setStages(view.stages);
    } catch (err) {
      setError(messageFromError(err));
    }
  }, [sessionId, questionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestStage(stageNumber: number) {
    setBusy(stageNumber);
    setNotice(null);
    setError(null);
    try {
      await studentApi.requestHint(sessionId, questionId, stageNumber);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 503) {
        setNotice("The AI mentor is not configured on this server. The written hints still work.");
      } else if (err instanceof ApiClientError && err.status === 409) {
        setNotice(messageFromError(err));
        void load();
      } else {
        setError(messageFromError(err));
      }
    } finally {
      setBusy(null);
    }
  }

  if (!stages || stages.length === 0) return null;

  return (
    <Card title="Hints">
      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? (
        <div className="mb-2">
          <Alert kind="info">{notice}</Alert>
        </div>
      ) : null}
      <ol className="space-y-2">
        {stages.map((stage) => (
          <li key={stage.stageNumber} className="rounded-md border border-neutral-200 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {stage.stageNumber}. {stage.title ?? `Hint ${stage.stageNumber}`}
                {stage.deliveryType === "INTERACTIVE" ? <Badge tone="info">AI mentor</Badge> : null}
              </span>
              {stage.content ? (
                <span className="text-xs text-green-600">Unlocked</span>
              ) : stage.available && !locked ? (
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void requestStage(stage.stageNumber)}
                >
                  {busy === stage.stageNumber ? "Getting…" : "Get hint"}
                </Button>
              ) : (
                <span className="text-xs text-neutral-400">{stage.lockedReason ?? "Locked"}</span>
              )}
            </div>
            {stage.content ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{stage.content}</p>
            ) : stage.description ? (
              <p className="mt-1 text-xs text-neutral-400">{stage.description}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EndScreen({
  title,
  view,
  onDone,
}: {
  title: string;
  view: ExamSessionView;
  onDone: () => void;
}) {
  const submitted = view.questions.filter((q) => q.submissions.length > 0).length;
  return (
    <div className="mx-auto max-w-lg space-y-4 py-8">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-700">
          ✓
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          You submitted {submitted} of {view.questions.length} question
          {view.questions.length === 1 ? "" : "s"}. Your work is saved and is being graded
          automatically.
        </p>
      </div>

      <Card title="Your submissions">
        <ul className="divide-y divide-neutral-100 text-sm">
          {view.questions.map((q, i) => {
            const latest = q.submissions[0] ?? null;
            const state = questionState(q);
            return (
              <li key={q.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} />
                  <span className="truncate">
                    {i + 1}. {q.title}
                  </span>
                </span>
                <span className="text-xs text-neutral-500">
                  {!latest
                    ? "Not submitted"
                    : latest.evaluation && latest.evaluation.status === "COMPLETED"
                      ? `${latest.evaluation.testsPassed}/${latest.evaluation.testsTotal} tests · ${latest.evaluation.score ?? 0}/${latest.evaluation.maxScore ?? 0}`
                      : state === "evaluating"
                        ? "Grading…"
                        : state === "failed"
                          ? "Could not grade"
                          : "Submitted"}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="text-center">
        <Button onClick={onDone}>Back to your assessments</Button>
      </div>
    </div>
  );
}
