import type {
  ExamQuestion,
  ExamSessionView,
  ProgrammingLanguage,
  SessionTiming,
} from "@gradevision/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { CodeEditor } from "../components/CodeEditor";
import { Alert, Badge, Button, Card, Spinner } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import { languageLabel } from "../lib/monaco";
import { studentApi } from "../lib/student-api";
import { messageFromError, useApi } from "../lib/use-api";

const AUTOSAVE_DELAY_MS = 1500;
const REFRESH_INTERVAL_MS = 20_000;

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
  | { kind: "error"; message: string };

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

  // Periodic re-sync of timing / submissions (never touches the editor).
  useEffect(() => {
    if (locked) return;
    const id = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [locked, refresh]);

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
        if (err instanceof ApiClientError && err.status === 409) {
          setSave({ kind: "error", message: "Session closed - your last save is safe." });
          void refresh();
        } else {
          setSave({ kind: "error", message: messageFromError(err) });
        }
      }
    },
    [sessionId, refresh],
  );

  // Debounced autosave of the current question.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    if (locked || save.kind !== "unsaved") return;
    const id = window.setTimeout(() => {
      void persistDraft(currentId, editorRef.current);
    }, AUTOSAVE_DELAY_MS);
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
    if (!locked && save.kind === "unsaved") await persistDraft(currentId, editorRef.current);
    setCurrentIndex(index);
    setSubmitError(null);
    setSave({ kind: "idle" });
  }

  async function submitCurrent() {
    if (!current) return;
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
      if (err instanceof ApiClientError && err.status === 409) {
        setSubmitError("The session is closed - submissions are no longer accepted.");
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
      if (!locked && save.kind === "unsaved") await persistDraft(currentId, editorRef.current);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/student" className="text-xs text-blue-700 hover:underline">
            ← Your assessments
          </Link>
          <h1 className="text-lg font-semibold">{view.assessmentTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Timer remaining={remaining} locked={locked} />
          <Button
            variant="secondary"
            disabled={finishing}
            onClick={() => {
              if (window.confirm("Finish and submit the whole assessment? You cannot reopen it.")) {
                void finishExam();
              }
            }}
          >
            {finishing ? "Finishing…" : "Finish exam"}
          </Button>
        </div>
      </div>

      {locked ? (
        <Alert kind={view.timing.status === "EXPIRED" ? "error" : "info"}>
          {view.timing.status === "EXPIRED"
            ? "Time is up. Your saved work is preserved; no more changes can be made."
            : `This session is ${view.timing.status}.`}
        </Alert>
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

              <div className="mt-3 flex items-center justify-between">
                <SubmissionList question={current} />
                <Button disabled={locked || submitting} onClick={() => void submitCurrent()}>
                  {submitting ? "Submitting…" : "Submit this question"}
                </Button>
              </div>
            </Card>
          </div>
        ) : (
          <Alert kind="info">This assessment has no questions.</Alert>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Timer({ remaining, locked }: { remaining: number | null; locked: boolean }) {
  if (remaining === null) {
    return <span className="text-sm text-neutral-500">No time limit</span>;
  }
  const danger = !locked && remaining <= 60;
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-sm ${
        danger ? "bg-red-100 text-red-800" : "bg-neutral-100 text-neutral-700"
      }`}
      title="Time remaining (server clock)"
    >
      {locked && remaining === 0 ? "00:00" : formatClock(remaining)}
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = {
    idle: "",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    saved: "",
    error: "",
  }[status.kind];

  if (status.kind === "saved") {
    return (
      <span className="text-xs font-normal text-green-600">
        Saved {new Date(status.at).toLocaleTimeString()}
      </span>
    );
  }
  if (status.kind === "error") {
    return <span className="text-xs font-normal text-red-600">{status.message}</span>;
  }
  return <span className="text-xs font-normal text-neutral-400">{text}</span>;
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
    <nav className="space-y-1">
      {questions.map((q, index) => {
        const answered = q.submissions.length > 0;
        const active = index === currentIndex;
        return (
          <button
            key={q.id}
            onClick={() => onSelect(index)}
            className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
              active
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-neutral-200 bg-white hover:bg-neutral-50"
            }`}
          >
            <span className="truncate">
              {index + 1}. {q.title}
            </span>
            {answered ? <span className="text-xs text-green-600">✓</span> : null}
          </button>
        );
      })}
      <p className="px-1 pt-2 text-xs text-neutral-400">
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
    <div className="mx-auto max-w-md space-y-4 py-10 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-neutral-600">
        You submitted {submitted} of {view.questions.length} question
        {view.questions.length === 1 ? "" : "s"}. Your work is saved. Results are not available yet.
      </p>
      <Button onClick={onDone}>Back to your assessments</Button>
    </div>
  );
}
