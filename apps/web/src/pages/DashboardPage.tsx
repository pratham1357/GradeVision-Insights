import type { AssessmentStatus } from "@gradevision/shared";
import { Link } from "react-router-dom";

import { instructorApi } from "../lib/instructor-api";
import { useApi } from "../lib/use-api";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

const STATUS_TONE: Record<AssessmentStatus, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  ACTIVE: "success",
  CLOSED: "warning",
  ARCHIVED: "neutral",
};

export function DashboardPage() {
  const courses = useApi(() => instructorApi.listCourses(), []);
  const assessments = useApi(() => instructorApi.listAssessments(), []);
  const questions = useApi(() => instructorApi.listQuestions(), []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Author questions and assessments, then monitor results live."
        actions={
          <>
            <Link to="/questions/new">
              <Button variant="secondary">New question</Button>
            </Link>
            <Link to="/assessments/new">
              <Button>New assessment</Button>
            </Link>
          </>
        }
      />

      <Card title="Your courses & sections">
        {courses.loading ? (
          <Spinner />
        ) : courses.error ? (
          <Alert kind="error" onRetry={courses.reload}>
            {courses.error}
          </Alert>
        ) : !courses.data?.length ? (
          <EmptyState>You are not assigned to any sections yet.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {courses.data.map((course) => (
              <li key={course.id}>
                <p className="text-sm font-medium">
                  {course.code} — {course.name}
                </p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {course.sections.map((section) => (
                    <li
                      key={section.id}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600"
                    >
                      {section.name}
                      {section.term ? ` · ${section.term} ${section.year ?? ""}` : ""} ·{" "}
                      {section.enrollmentCount} enrolled
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Assessments">
        {assessments.loading ? (
          <Spinner />
        ) : assessments.error ? (
          <Alert kind="error" onRetry={assessments.reload}>
            {assessments.error}
          </Alert>
        ) : !assessments.data?.length ? (
          <EmptyState>No assessments yet. Create one to get started.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="pb-2 pr-3">Title</th>
                  <th className="pb-2 pr-3">Section</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3 text-right">Questions</th>
                  <th className="pb-2 pr-3 text-right">Points</th>
                  <th className="pb-2 text-right">Monitor</th>
                </tr>
              </thead>
              <tbody>
                {assessments.data.map((a) => (
                  <tr key={a.id} className="border-t border-neutral-100">
                    <td className="py-2 pr-3">
                      <Link
                        className="font-medium text-blue-700 hover:underline"
                        to={`/assessments/${a.id}`}
                      >
                        {a.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">
                      {a.section ? `${a.section.courseCode} / ${a.section.name}` : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-500">{a.questionCount}</td>
                    <td className="py-2 pr-3 text-right text-neutral-500">{a.totalPoints}</td>
                    <td className="py-2 text-right">
                      <Link
                        className="text-xs font-medium text-blue-700 hover:underline"
                        to={`/assessments/${a.id}/results`}
                      >
                        Results
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Question bank">
        {questions.loading ? (
          <Spinner />
        ) : questions.error ? (
          <Alert kind="error" onRetry={questions.reload}>
            {questions.error}
          </Alert>
        ) : !questions.data?.length ? (
          <EmptyState>No questions yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {questions.data.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-2 py-2">
                <Link
                  className="font-medium text-blue-700 hover:underline"
                  to={`/questions/${q.id}`}
                >
                  {q.title}
                </Link>
                <span className="flex items-center gap-2 text-xs text-neutral-500">
                  <Badge>{q.difficulty}</Badge>
                  {q.languageCount} lang · {q.testCaseCount} tests
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
