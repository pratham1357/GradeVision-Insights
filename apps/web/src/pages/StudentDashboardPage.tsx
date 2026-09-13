import { EVIDENCE_POLICY, type StudentAssessmentSummary } from "@gradevision/shared";
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

function PolicyList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="font-medium text-neutral-600">{label}</dt>
      <dd>
        <ul className="list-disc pl-4">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function AssessmentCard({ assessment }: { assessment: StudentAssessmentSummary }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  const session = assessment.session;
  const resumable = session?.status === "IN_PROGRESS";
  // A new start shows the evidence notice; resuming does not repeat it. The
  // acknowledgement is recorded server-side when given; it never gates the API.
  const needsNotice = !session;
  const finished =
    session?.status === "SUBMITTED" ||
    session?.status === "EXPIRED" ||
    session?.status === "TERMINATED";

  async function open() {
    setError(null);
    setStarting(true);
    try {
      const view = await studentApi.startSession(
        assessment.id,
        needsNotice ? { acknowledgeEvidenceNotice: acknowledged } : {},
      );
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
          <Button loading={starting} disabled={needsNotice && !acknowledged} onClick={open}>
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
      {needsNotice ? (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          <p className="font-medium">What this assessment records</p>
          <p className="mt-1">
            Your submitted code, what happened when it ran, the hints you request and any Transfer
            Check attempt form the evidence record for this session. Your instructor can review it
            attempt by attempt. Hidden test details are never shown to you; keystrokes, clipboard
            and recordings are never collected.{" "}
            <button
              type="button"
              className="text-blue-700 hover:underline"
              onClick={() => setShowPolicy((v) => !v)}
            >
              {showPolicy ? "Hide details" : "Full notice"}
            </button>
          </p>
          {showPolicy ? (
            <dl className="mt-2 space-y-2">
              <PolicyList label="Recorded" items={EVIDENCE_POLICY.collected} />
              <PolicyList label="Never recorded" items={EVIDENCE_POLICY.notCollected} />
              <PolicyList label="Who can see it" items={EVIDENCE_POLICY.access} />
              <PolicyList label="Retention" items={EVIDENCE_POLICY.retention} />
              <PolicyList label="Not automated" items={EVIDENCE_POLICY.notEnforced} />
            </dl>
          ) : null}
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I have read this notice and understand what is recorded for this assessment.
            </span>
          </label>
        </div>
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
