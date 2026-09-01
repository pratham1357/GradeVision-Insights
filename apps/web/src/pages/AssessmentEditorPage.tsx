import type { AssessmentDetail } from "@gradevision/shared";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { instructorApi } from "../lib/instructor-api";
import { messageFromError, useApi } from "../lib/use-api";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";

export function AssessmentEditorPage() {
  const { assessmentId } = useParams();
  const isNew = !assessmentId;

  return isNew ? <CreateAssessment /> : <EditAssessment key={assessmentId} id={assessmentId} />;
}

function CreateAssessment() {
  const navigate = useNavigate();
  const courses = useApi(() => instructorApi.listCourses(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sections = useMemo(
    () =>
      (courses.data ?? []).flatMap((c) =>
        c.sections.map((s) => ({ id: s.id, label: `${c.code} / ${s.name}` })),
      ),
    [courses.data],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await instructorApi.createAssessment({
        title: title.trim(),
        description: description.trim() || null,
        sectionId,
        durationMinutes: duration ? Number(duration) : null,
      });
      navigate(`/assessments/${created.id}`, { replace: true });
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />
      <h1 className="text-xl font-semibold">New assessment</h1>
      {courses.error ? <Alert kind="error">{courses.error}</Alert> : null}
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Field label="Title">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Section" hint="Only sections you teach are listed">
            <Select
              required
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={courses.loading}
            >
              <option value="" disabled>
                {courses.loading ? "Loading…" : "Choose a section"}
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration (minutes)" hint="Optional">
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={saving || !sectionId}>
            {saving ? "Creating…" : "Create draft"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function EditAssessment({ id }: { id: string }) {
  const { data, loading, error, reload } = useApi(() => instructorApi.getAssessment(id), [id]);

  if (loading) return <Spinner />;
  if (error || !data) return <Alert kind="error">{error ?? "Assessment not found"}</Alert>;
  return <AssessmentForm assessment={data} onChanged={reload} />;
}

function AssessmentForm({
  assessment,
  onChanged,
}: {
  assessment: AssessmentDetail;
  onChanged: () => void;
}) {
  const editable = assessment.status === "DRAFT";
  const [title, setTitle] = useState(assessment.title);
  const [description, setDescription] = useState(assessment.description ?? "");
  const [duration, setDuration] = useState(
    assessment.durationMinutes == null ? "" : String(assessment.durationMinutes),
  );
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(action: () => Promise<unknown>, successText: string) {
    setBanner(null);
    setSaving(true);
    try {
      await action();
      setBanner({ kind: "success", text: successText });
      onChanged();
    } catch (err) {
      setBanner({ kind: "error", text: messageFromError(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{assessment.title}</h1>
        <Badge>{assessment.status}</Badge>
      </div>

      {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
      {!editable ? (
        <Alert kind="info">
          This assessment is {assessment.status}. Only DRAFT assessments can be edited.
        </Alert>
      ) : null}

      <Card
        title="Details"
        actions={
          <div className="flex gap-2">
            {assessment.status === "DRAFT" ? (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() =>
                  run(
                    () => instructorApi.updateAssessment(assessment.id, { status: "SCHEDULED" }),
                    "Marked as scheduled",
                  )
                }
              >
                Schedule
              </Button>
            ) : null}
            {assessment.status !== "ARCHIVED" ? (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() =>
                  run(
                    () => instructorApi.updateAssessment(assessment.id, { status: "ARCHIVED" }),
                    "Assessment archived",
                  )
                }
              >
                Archive
              </Button>
            ) : null}
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                instructorApi.updateAssessment(assessment.id, {
                  title: title.trim(),
                  description: description.trim() || null,
                  durationMinutes: duration ? Number(duration) : null,
                }),
              "Saved",
            );
          }}
        >
          <Field label="Title">
            <Input
              required
              disabled={!editable}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              disabled={!editable}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min={1}
              disabled={!editable}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          {editable ? (
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          ) : null}
        </form>
      </Card>

      <AssessmentQuestions assessment={assessment} editable={editable} onChanged={onChanged} />
    </div>
  );
}

function AssessmentQuestions({
  assessment,
  editable,
  onChanged,
}: {
  assessment: AssessmentDetail;
  editable: boolean;
  onChanged: () => void;
}) {
  const bank = useApi(() => instructorApi.listQuestions(), []);
  const [pick, setPick] = useState("");
  const [pickPoints, setPickPoints] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedIds = new Set(assessment.questions.map((q) => q.questionId));
  const available = (bank.data ?? []).filter((q) => !attachedIds.has(q.id));

  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    const ordered = assessment.questions.map((q) => q.questionId);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]] as [string, string];
    void mutate(() => instructorApi.reorderQuestions(assessment.id, ordered));
  }

  return (
    <Card
      title="Questions"
      actions={
        <Link to="/questions/new" className="text-xs text-blue-700 hover:underline">
          Create a new question
        </Link>
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}

      {assessment.questions.length === 0 ? (
        <EmptyState>No questions attached yet.</EmptyState>
      ) : (
        <ol className="space-y-2">
          {assessment.questions.map((q, index) => (
            <li
              key={q.questionId}
              className="flex items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="w-5 text-neutral-400">{index + 1}.</span>
              <Link
                className="flex-1 font-medium text-blue-700 hover:underline"
                to={`/questions/${q.questionId}`}
              >
                {q.title}
              </Link>
              <Badge>{q.difficulty}</Badge>
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                pts
                <Input
                  type="number"
                  min={0}
                  className="w-20"
                  disabled={!editable || busy}
                  defaultValue={q.points}
                  onBlur={(e) => {
                    const points = Number(e.target.value);
                    if (points !== q.points) {
                      void mutate(() =>
                        instructorApi.updateAssessmentQuestion(assessment.id, q.questionId, {
                          points,
                        }),
                      );
                    }
                  }}
                />
              </label>
              {editable ? (
                <span className="flex gap-1">
                  <Button
                    variant="secondary"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || index === assessment.questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() => instructorApi.detachQuestion(assessment.id, q.questionId))
                    }
                  >
                    Remove
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4">
          <Field label="Add an existing question">
            <Select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={bank.loading || available.length === 0}
              className="min-w-[16rem]"
            >
              <option value="">
                {bank.loading
                  ? "Loading…"
                  : available.length === 0
                    ? "No unattached questions"
                    : "Choose a question"}
              </option>
              {available.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} ({q.difficulty})
                </option>
              ))}
            </Select>
          </Field>
          <label className="text-xs text-neutral-500">
            Points
            <Input
              type="number"
              min={0}
              className="w-24"
              value={pickPoints}
              onChange={(e) => setPickPoints(e.target.value)}
            />
          </label>
          <Button
            disabled={!pick || busy}
            onClick={() =>
              void mutate(async () => {
                await instructorApi.attachQuestion(assessment.id, {
                  questionId: pick,
                  points: Number(pickPoints) || 0,
                });
                setPick("");
              })
            }
          >
            Add
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function BackLink() {
  return (
    <Link to="/dashboard" className="text-sm text-blue-700 hover:underline">
      ← Back to dashboard
    </Link>
  );
}
