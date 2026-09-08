import type { InstructorStudentActivity, MonitoredLatestSubmission } from "@gradevision/shared";
import { useEffect } from "react";

import { instructorApi } from "../lib/instructor-api";
import { useApi } from "../lib/use-api";
import { Alert, Badge, Card, EmptyState, Spinner, StatTile } from "./ui";

// --- formatting helpers (pure) -------------------------------------------------

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function bytesToMb(value: number): string {
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

// --- Student monitoring -------------------------------------------------------

function latestBadge(latest: MonitoredLatestSubmission | null) {
  if (!latest) return <span className="text-neutral-300">no submissions</span>;
  const status = latest.evaluationStatus;
  if (status === "COMPLETED") {
    return (
      <span title={`${latest.questionTitle} · ${relativeTime(latest.submittedAt)}`}>
        <Badge tone={latest.scorePercent === 100 ? "success" : "warning"}>
          {latest.scorePercent === null ? "graded" : `${latest.scorePercent}%`}
        </Badge>
      </span>
    );
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return <Badge tone="danger">error</Badge>;
  }
  return <Badge tone="info">{latest.submissionStatus === "QUEUED" ? "queued" : "running"}</Badge>;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200">
        <span
          className="block h-full rounded-full bg-blue-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="tabular-nums text-xs text-neutral-500">
        {done}/{total}
      </span>
    </span>
  );
}

function StudentRow({ student }: { student: InstructorStudentActivity }) {
  return (
    <tr className="border-t border-neutral-100">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5 font-medium">
          {student.name}
          {student.inProgress ? <Badge tone="info">in exam</Badge> : null}
          {student.flagged ? <Badge tone="danger">flagged</Badge> : null}
        </div>
        <div className="text-xs text-neutral-400">{student.email}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-500">
        {student.sections.map((s) => `${s.courseCode} / ${s.name}`).join(", ") || "—"}
      </td>
      <td className="py-2 pr-3">
        <ProgressBar done={student.assessmentsSubmitted} total={student.assessmentsAssigned} />
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-600">
        {student.submissionCount}
      </td>
      <td className="py-2 pr-3">{latestBadge(student.latestSubmission)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {student.averageScorePercent === null ? (
          <span className="text-neutral-300">—</span>
        ) : (
          student.averageScorePercent + "%"
        )}
      </td>
      <td className="py-2 pr-3 text-center">
        {student.violationCount > 0 ? (
          <Badge tone={student.flagged ? "danger" : "warning"}>{student.violationCount}</Badge>
        ) : (
          <span className="text-neutral-300">0</span>
        )}
      </td>
      <td className="py-2 text-right text-xs text-neutral-500">
        {relativeTime(student.lastActivityAt)}
      </td>
    </tr>
  );
}

/** Real student roster + activity, from `GET /monitoring/students`. Polls slowly. */
export function StudentMonitorCard() {
  const { data, loading, error, reload } = useApi(() => instructorApi.getStudentMonitor(), []);

  useEffect(() => {
    const id = window.setInterval(reload, 20_000);
    return () => window.clearInterval(id);
  }, [reload]);

  return (
    <Card
      title="Student monitoring"
      actions={
        data ? (
          <span className="text-xs text-neutral-400">
            {data.summary.totalStudents} students · {data.summary.sectionsCount} sections
          </span>
        ) : null
      }
    >
      {loading && !data ? (
        <Spinner label="Loading students…" />
      ) : error && !data ? (
        <Alert kind="error" onRetry={reload}>
          {error}
        </Alert>
      ) : !data || data.students.length === 0 ? (
        <EmptyState>No students are enrolled in your sections yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Students" value={data.summary.totalStudents} />
            <StatTile label="In exam" value={data.summary.inProgressCount} />
            <StatTile label="Submitted" value={data.summary.submittedCount} />
            <StatTile label="Avg score" value={pct(data.summary.averageScorePercent)} />
            <StatTile
              label="Integrity flags"
              value={data.summary.totalViolations}
              hint={`${data.summary.flaggedStudents} students flagged`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-neutral-400">
                <tr>
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Sections</th>
                  <th className="pb-2 pr-3">Submitted</th>
                  <th className="pb-2 pr-3 text-right">Subs</th>
                  <th className="pb-2 pr-3">Latest</th>
                  <th className="pb-2 pr-3 text-right">Avg</th>
                  <th className="pb-2 pr-3 text-center">Flags</th>
                  <th className="pb-2 text-right">Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((student) => (
                  <StudentRow key={student.studentId} student={student} />
                ))}
              </tbody>
            </table>
          </div>
          {error ? (
            <p className="text-xs text-amber-600">Showing the last successful load. {error}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// --- System metrics ----------------------------------------------------------

/** API-process runtime metrics, from `GET /monitoring/system`. Instructor-only. */
export function SystemMetricsCard() {
  const { data, loading, error, reload } = useApi(() => instructorApi.getSystemMetrics(), []);

  useEffect(() => {
    const id = window.setInterval(reload, 10_000);
    return () => window.clearInterval(id);
  }, [reload]);

  return (
    <Card
      title="System metrics"
      actions={
        data ? (
          <span className="text-xs text-neutral-400">updated {relativeTime(data.generatedAt)}</span>
        ) : null
      }
    >
      {loading && !data ? (
        <Spinner label="Loading metrics…" />
      ) : error && !data ? (
        <Alert kind="error" onRetry={reload}>
          {error}
        </Alert>
      ) : !data ? (
        <EmptyState>Metrics are unavailable right now.</EmptyState>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile
              label="Uptime"
              value={duration(data.process.uptimeSeconds)}
              hint={`Started ${new Date(data.process.startedAt).toLocaleString()}`}
            />
            <StatTile
              label="CPU"
              value={pct(data.cpu.percent)}
              hint={`${data.cpu.userMs} ms user / ${data.cpu.systemMs} ms system over ${data.cpu.sampleMs} ms`}
            />
            <StatTile
              label="Memory (RSS)"
              value={bytesToMb(data.memory.rssBytes)}
              hint={`heap ${bytesToMb(data.memory.heapUsedBytes)} / ${bytesToMb(data.memory.heapTotalBytes)}`}
            />
            <StatTile label="In-flight requests" value={data.requests.inFlight} />
            <StatTile
              label="Requests handled"
              value={data.requests.total}
              hint="Since the process started"
            />
            <StatTile
              label="Avg response"
              value={ms(data.requests.averageResponseTimeMs)}
              hint={`Server-side processing time over the last ${data.requests.sampleSize} requests`}
            />
            <StatTile label="Last response" value={ms(data.requests.lastResponseTimeMs)} />
            <StatTile
              label="Database"
              value={
                data.database.status === "up"
                  ? ms(data.database.latencyMs).replace(" ms", "ms")
                  : "down"
              }
              hint={`SELECT 1 round-trip (${data.database.status})`}
            />
          </div>
          <p className="text-xs text-neutral-400">
            Measured by the API process. Response time is server-side request processing duration
            (request received to response finished).
          </p>
          {error ? (
            <p className="text-xs text-amber-600">Showing the last successful reading. {error}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
