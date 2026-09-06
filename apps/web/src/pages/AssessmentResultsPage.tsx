import type { InstructorResultQuestionScore } from "@gradevision/shared";
import { Link, Navigate, useParams } from "react-router-dom";

import { Alert, Badge, Card, Spinner } from "../components/ui";
import { instructorApi } from "../lib/instructor-api";
import { useApi } from "../lib/use-api";

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

function Results({ assessmentId }: { assessmentId: string }) {
  const { data, loading, error } = useApi(
    () => instructorApi.getAssessmentResults(assessmentId),
    [assessmentId],
  );

  if (loading) return <Spinner label="Loading results…" />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <Alert kind="error">{error ?? "Results not available"}</Alert>
        <Link to="/dashboard" className="text-sm text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const attempted = data.students.filter((s) => s.sessionId !== null).length;

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/assessments/${assessmentId}`} className="text-xs text-blue-700 hover:underline">
          ← {data.assessmentTitle}
        </Link>
        <h1 className="text-lg font-semibold">Results</h1>
        <p className="text-sm text-neutral-500">
          {attempted} of {data.students.length} enrolled students have started this assessment.
        </p>
      </div>

      <Card title="Scores">
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
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((student) => (
                  <tr key={student.studentId} className="border-t border-neutral-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{student.studentName}</div>
                      <div className="text-xs text-neutral-400">{student.studentEmail}</div>
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {student.sessionStatus ?? "not started"}
                    </td>
                    {student.questions.map((cell) => (
                      <td key={cell.questionId} className="py-2 pr-3">
                        {cellBadge(cell)}
                      </td>
                    ))}
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
      </Card>
    </div>
  );
}
