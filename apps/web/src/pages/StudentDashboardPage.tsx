import type { StudentAssessmentSummary } from "@gradevision/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { studentApi } from "../lib/student-api";
import { messageFromError, useApi } from "../lib/use-api";
import { Alert, Badge, Button, Card, EmptyState, Spinner } from "../components/ui";

export function StudentDashboardPage() {
  const { data, loading, error } = useApi(() => studentApi.listAssessments(), []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Your assessments</h1>

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : !data?.length ? (
        <EmptyState>No assessments are open for you right now.</EmptyState>
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
      title={assessment.title}
      actions={
        finished ? (
          <Badge>{session?.status}</Badge>
        ) : (
          <Button onClick={open} disabled={starting}>
            {starting ? "Opening…" : resumable ? "Resume" : "Start assessment"}
          </Button>
        )
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      {assessment.description ? (
        <p className="text-sm text-neutral-600">{assessment.description}</p>
      ) : null}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
        <div>
          <dt className="inline font-medium">Course:</dt>{" "}
          <dd className="inline">
            {assessment.courseCode ?? "—"} / {assessment.sectionName ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Questions:</dt>{" "}
          <dd className="inline">{assessment.questionCount}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Time limit:</dt>{" "}
          <dd className="inline">
            {assessment.durationMinutes ? `${assessment.durationMinutes} min` : "none"}
          </dd>
        </div>
        {finished ? <div className="text-neutral-400">Your attempt is complete.</div> : null}
      </dl>
    </Card>
  );
}
