import type { StudentAssessmentSummary } from "@gradevision/shared";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { studentApi } from "../lib/student-api";
import { messageFromError, useApi } from "../lib/use-api";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

const REFRESH_MS = 20_000;

export function StudentDashboardPage() {
  const { data, loading, error, reload } = useApi(() => studentApi.listAssessments(), []);

  // Light poll so an assessment the instructor just activated shows up without
  // a manual reload. (The dashboard has no session/assessment to subscribe to.)
  useEffect(() => {
    const id = window.setInterval(() => reload(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your assessments"
        subtitle="Assessments your instructor has made available to you."
        actions={
          <Button size="sm" variant="secondary" onClick={reload}>
            Refresh
          </Button>
        }
      />

      {loading && !data ? (
        <Spinner label="Loading your assessments…" />
      ) : error ? (
        <Alert kind="error" onRetry={reload}>
          {error}
        </Alert>
      ) : !data?.length ? (
        <EmptyState>
          No assessments are open for you right now. This page refreshes automatically.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {data.map((assessment) => (
            <AssessmentCard key={assessment.id} assessment={assessment} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssessmentCard({ assessment }: { assessment: StudentAssessmentSummary }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = assessment.session;
  const resumable = session?.status === "IN_PROGRESS";
  const finished =
    session?.status === "SUBMITTED" ||
    session?.status === "EXPIRED" ||
    session?.status === "TERMINATED";

  async function open() {
    setError(null);
    setStarting(true);
    try {
      const view = await studentApi.startSession(assessment.id);
      navigate(`/student/exam/${view.id}`);
    } catch (err) {
      setError(messageFromError(err));
      setStarting(false);
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {assessment.title}
          {resumable ? <Badge tone="info">In progress</Badge> : null}
          {finished ? <Badge tone="neutral">{session?.status}</Badge> : null}
        </span>
      }
      actions={
        finished ? null : (
          <Button loading={starting} onClick={open}>
            {starting ? "Opening…" : resumable ? "Resume exam" : "Start exam"}
          </Button>
        )
      }
    >
      {error ? (
        <div className="mb-2">
          <Alert kind="error" onRetry={open}>
            {error}
          </Alert>
        </div>
      ) : null}
      {assessment.description ? (
        <p className="text-sm text-neutral-600">{assessment.description}</p>
      ) : null}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
        <span>
          <span className="font-medium">Course:</span> {assessment.courseCode ?? "—"} /{" "}
          {assessment.sectionName ?? "—"}
        </span>
        <span>
          <span className="font-medium">Questions:</span> {assessment.questionCount}
        </span>
        <span>
          <span className="font-medium">Time limit:</span>{" "}
          {assessment.durationMinutes ? `${assessment.durationMinutes} min` : "none"}
        </span>
        {finished ? <span className="text-neutral-400">Your attempt is complete.</span> : null}
      </dl>
    </Card>
  );
}
