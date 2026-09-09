import type {
  InstructorAssessmentStats,
  InstructorResultQuestionScore,
  InstructorResultRow,
  InstructorSessionResult,
  InstructorSubmissionVersion,
  SessionViolationsView,
} from "@gradevision/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { CodeEditor } from "../components/CodeEditor";
import { Alert, Badge, Button, Card, PageHeader, Spinner } from "../components/ui";
import { instructorApi } from "../lib/instructor-api";
import { languageLabel } from "../lib/monaco";
import { connectRealtime } from "../lib/realtime";
import { messageFromError, useApi } from "../lib/use-api";

/** No-op onChange - the instructor's viewer is read-only and never autosaves. */
function noopChange(): void {
  /* read-only */
}

export function AssessmentResultsPage() {
  const { assessmentId } = useParams();
  if (!assessmentId) return <Navigate to="/dashboard" replace />;
  return <Results assessmentId={assessmentId} />;
}

function cellBadge(cell: InstructorResultQuestionScore) {
  if (!cell.submissionStatus) return <span className="text-neutral-300">—</span>;
  if (cell.evaluationStatus === "COMPLETED") {
    const perfect = cell.testsTotal > 0 && cell.testsPassed === cell.testsTotal;
    return (
      <span title={`${cell.testsPassed}/${cell.testsTotal} tests`}>
        <Badge tone={perfect ? "success" : "warning"}>
          {cell.score ?? 0}/{cell.maxScore ?? 0}
        </Badge>
      </span>
    );
  }
  if (cell.evaluationStatus === "FAILED" || cell.evaluationStatus === "CANCELLED") {
    return <Badge tone="danger">error</Badge>;
  }
  return <Badge tone="info">{cell.submissionStatus === "QUEUED" ? "queued" : "running"}</Badge>;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
    </div>
  );
}

function StatsRow({ stats }: { stats: InstructorAssessmentStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Students" value={stats.totalStudents} />
      <StatTile label="Started" value={stats.startedCount} />
      <StatTile label="Submitted" value={stats.submittedCount} />
      <StatTile
        label="Avg score"
        value={stats.averageScorePercent === null ? "—" : `${stats.averageScorePercent}%`}
      />
      <StatTile
        label="High / low"
        value={
          stats.highestScorePercent === null
            ? "—"
            : `${stats.highestScorePercent}% / ${stats.lowestScorePercent}%`
        }
      />
      <StatTile label="Integrity flags" value={stats.totalViolations} />
    </div>
  );
}

function Results({ assessmentId }: { assessmentId: string }) {
  const { data, loading, error, reload } = useApi(
    () => instructorApi.getAssessmentResults(assessmentId),
    [assessmentId],
  );
  const [selected, setSelected] = useState<InstructorResultRow | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // Realtime nudge; a slow poll below is the fallback when the socket is down.
    return connectRealtime(
      { assessmentId },
      { onStatus: setLive, onReady: () => reload(), onAssessmentChanged: () => reload() },
    );
  }, [assessmentId, reload]);

  useEffect(() => {
    if (live) return;
    const id = window.setInterval(() => reload(), 15_000);
    return () => window.clearInterval(id);
  }, [live, reload]);

  if (loading && !data) return <Spinner label="Loading results…" />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <Alert kind="error" onRetry={reload}>
          {error ?? "Results not available"}
        </Alert>
        <Link to="/dashboard" className="text-sm text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            to={`/assessments/${assessmentId}`}
            className="text-xs text-blue-700 hover:underline"
          >
            ← {data.assessmentTitle}
          </Link>
        }
        title="Results & monitoring"
        subtitle={`${data.stats.startedCount} of ${data.stats.totalStudents} students started · ${data.stats.gradedCount} graded`}
        actions={
          <span className="flex items-center gap-1.5 text-xs text-neutral-400">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-green-500" : "bg-neutral-300"}`} />
            {live ? "Live" : "Auto-refresh"}
            <Button size="sm" variant="ghost" onClick={reload}>
              Refresh
            </Button>
          </span>
        }
      />

      <StatsRow stats={data.stats} />

      <Card title="Students">
        {data.students.length === 0 ? (
          <p className="text-sm text-neutral-500">No students are enrolled in this section.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-neutral-400">
                <tr>
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Status</th>
                  {data.questions.map((q) => (
                    <th key={q.questionId} className="pb-2 pr-3" title={q.title}>
                      Q{q.position + 1}
                    </th>
                  ))}
                  <th className="pb-2 pr-3 text-center">Flags</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((student) => (
                  <tr
                    key={student.studentId}
                    className={`border-t border-neutral-100 ${
                      student.sessionId ? "cursor-pointer hover:bg-neutral-50" : ""
                    }`}
                    onClick={() => student.sessionId && setSelected(student)}
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium">{student.studentName}</div>
                      <div className="text-xs text-neutral-400">{student.studentEmail}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {student.sessionStatus ? (
                        <Badge
                          tone={
                            student.sessionStatus === "IN_PROGRESS"
                              ? "info"
                              : student.sessionStatus === "SUBMITTED"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {student.sessionStatus === "IN_PROGRESS"
                            ? "in exam"
                            : student.sessionStatus.toLowerCase()}
                        </Badge>
                      ) : (
                        <span className="text-xs text-neutral-400">not started</span>
                      )}
                    </td>
                    {student.questions.map((cell) => (
                      <td key={cell.questionId} className="py-2 pr-3">
                        {cellBadge(cell)}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-center">
                      {student.violationCount > 0 ? (
                        <Badge tone={student.violationCount >= 3 ? "danger" : "warning"}>
                          {student.violationCount}
                        </Badge>
                      ) : (
                        <span className="text-neutral-300">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {student.totalScore}/{student.maxScore}
                      {student.scorePercent !== null ? (
                        <span className="ml-1 text-xs font-normal text-neutral-400">
                          ({student.scorePercent}%)
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-400">Select a student to see their breakdown.</p>
      </Card>

      {selected && selected.sessionId ? (
        <SessionDetail
          assessmentId={assessmentId}
          sessionId={selected.sessionId}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function SessionDetail({
  assessmentId,
  sessionId,
  onClose,
}: {
  assessmentId: string;
  sessionId: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<InstructorSessionResult | null>(null);
  const [violations, setViolations] = useState<SessionViolationsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      instructorApi.getSessionResult(assessmentId, sessionId),
      instructorApi.getSessionViolations(assessmentId, sessionId),
    ])
      .then(([r, v]) => {
        setResult(r);
        setViolations(v);
      })
      .catch((e) => setError(messageFromError(e)));
  }, [assessmentId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card
      title={result ? `${result.studentName} — breakdown` : "Breakdown"}
      actions={
        <button className="text-xs text-blue-700 hover:underline" onClick={onClose}>
          Close
        </button>
      }
    >
      {error ? (
        <Alert kind="error" onRetry={load}>
          {error}
        </Alert>
      ) : null}
      {!result || !violations ? (
        <Spinner label="Loading breakdown…" />
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-neutral-500">
            {result.sessionStatus} · score {result.totalScore}/{result.maxScore}
            {result.scorePercent !== null ? ` (${result.scorePercent}%)` : ""} ·{" "}
            {result.violationCount} integrity flag{result.violationCount === 1 ? "" : "s"}
          </p>

          {result.questions.map((q) => (
            <div key={q.questionId} className="rounded-md border border-neutral-200 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">
                  Q{q.position + 1}. {q.title}
                </span>
                <span className="text-xs text-neutral-400">
                  {q.evaluation
                    ? `${q.evaluation.testsPassed}/${q.evaluation.testsTotal} tests · ${q.evaluation.score ?? 0}/${q.evaluation.maxScore ?? 0}`
                    : q.submissionStatus
                      ? q.submissionStatus
                      : "no submission"}
                </span>
              </div>
              {q.evaluation ? (
                <>
                  <ul className="space-y-0.5 text-xs text-neutral-600">
                    {q.evaluation.testResults.map((t) => (
                      <li key={t.index}>
                        <span className={t.passed ? "text-green-600" : "text-red-600"}>
                          {t.passed ? "✓" : "✗"}
                        </span>{" "}
                        {t.hidden ? `Hidden test ${t.index}` : (t.name ?? `Test ${t.index}`)} ·{" "}
                        {t.status}
                      </li>
                    ))}
                  </ul>
                  {q.evaluation.rubric.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                      {q.evaluation.rubric.map((r) => (
                        <li key={r.name}>
                          {r.name}: {r.pointsAwarded}/{r.maxPoints}
                          {r.notes ? ` — ${r.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
              <CodeViewer versions={q.versions} />
            </div>
          ))}

          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-400">
              Integrity events ({violations.violationCount})
            </p>
            {violations.violations.length === 0 ? (
              <p className="text-xs text-neutral-400">None recorded.</p>
            ) : (
              <ul className="space-y-0.5 text-xs text-neutral-600">
                {violations.violations.map((v) => (
                  <li key={v.id}>
                    {new Date(v.occurredAt).toLocaleTimeString()} · {v.type.replace(/_/g, " ")} (
                    {v.severity.toLowerCase()}){v.note ? ` — ${v.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Read-only, Monaco-styled inspection of a student's submitted code for one
 * question. Never editable, never runs code, never autosaves. If the student
 * resubmitted, the instructor can switch between attempts.
 */
function CodeViewer({ versions }: { versions: InstructorSubmissionVersion[] }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(versions[0]?.submissionId ?? "");

  if (versions.length === 0) {
    return <p className="mt-2 text-xs text-neutral-400">No submission to inspect.</p>;
  }

  const selected = versions.find((v) => v.submissionId === selectedId) ?? versions[0]!;

  return (
    <div className="mt-2 border-t border-neutral-100 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs font-medium text-blue-700 hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide code" : "View code"}
        </button>
        {open && versions.length > 1 ? (
          <select
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
            value={selected.submissionId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.submissionId} value={v.submissionId}>
                Attempt #{v.attemptNumber} · {v.status} · {new Date(v.submittedAt).toLocaleString()}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-neutral-400">
            {languageLabel(selected.language)} · attempt #{selected.attemptNumber} ·{" "}
            {selected.status.toLowerCase()} · submitted{" "}
            {new Date(selected.submittedAt).toLocaleString()}
          </p>
          <CodeEditor
            language={selected.language}
            value={selected.sourceCode}
            onChange={noopChange}
            readOnly
          />
        </div>
      ) : null}
    </div>
  );
}
