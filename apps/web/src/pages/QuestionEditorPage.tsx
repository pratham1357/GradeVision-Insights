import {
  PROGRAMMING_LANGUAGES,
  QUESTION_DIFFICULTIES,
  RUBRIC_CRITERION_TYPES,
  type ProgrammingLanguage,
  type QuestionDetail,
  type RubricCriterionType,
  type TestCaseDto,
} from "@gradevision/shared";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { QuestionInput, RubricCriterionInput, TestCaseInput } from "../lib/instructor-api";
import { instructorApi } from "../lib/instructor-api";
import { messageFromError, useApi } from "../lib/use-api";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";

const EMPTY: QuestionInput = {
  title: "",
  statement: "",
  constraints: "",
  inputFormat: "",
  outputFormat: "",
  difficulty: "MEDIUM",
  timeLimitMs: null,
  memoryLimitMb: null,
  languages: [],
};

export function QuestionEditorPage() {
  const { questionId } = useParams();
  return questionId ? <EditQuestion key={questionId} id={questionId} /> : <CreateQuestion />;
}

function CreateQuestion() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(input: QuestionInput) {
    setError(null);
    setSaving(true);
    try {
      const created = await instructorApi.createQuestion(input);
      navigate(`/questions/${created.id}`, { replace: true });
    } catch (err) {
      setError(messageFromError(err));
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink />
      <h1 className="text-xl font-semibold">New question</h1>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <QuestionForm initial={EMPTY} saving={saving} onSave={save} submitLabel="Create question" />
      <p className="text-sm text-neutral-500">
        Save the question first, then add test cases and rubric criteria.
      </p>
    </div>
  );
}

function EditQuestion({ id }: { id: string }) {
  const { data, loading, error, reload } = useApi(() => instructorApi.getQuestion(id), [id]);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) return <Spinner />;
  if (error || !data) return <Alert kind="error">{error ?? "Question not found"}</Alert>;

  async function save(input: QuestionInput) {
    setBanner(null);
    setSaving(true);
    try {
      await instructorApi.updateQuestion(id, input);
      setBanner({ kind: "success", text: "Question saved" });
      reload();
    } catch (err) {
      setBanner({ kind: "error", text: messageFromError(err) });
    } finally {
      setSaving(false);
    }
  }

  const initial: QuestionInput = {
    title: data.title,
    statement: data.statement,
    constraints: data.constraints ?? "",
    inputFormat: data.inputFormat ?? "",
    outputFormat: data.outputFormat ?? "",
    difficulty: data.difficulty,
    timeLimitMs: data.timeLimitMs,
    memoryLimitMb: data.memoryLimitMb,
    languages: data.languages.map((l) => ({ language: l.language, starterCode: l.starterCode })),
  };

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink />
      <h1 className="text-xl font-semibold">{data.title}</h1>
      {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
      <QuestionForm initial={initial} saving={saving} onSave={save} submitLabel="Save question" />
      <TestCaseEditor question={data} onChanged={reload} />
      <RubricEditor question={data} onChanged={reload} />
    </div>
  );
}

function QuestionForm({
  initial,
  saving,
  onSave,
  submitLabel,
}: {
  initial: QuestionInput;
  saving: boolean;
  onSave: (input: QuestionInput) => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState(initial);
  const set = <K extends keyof QuestionInput>(key: K, value: QuestionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const selected = new Map(form.languages.map((l) => [l.language, l.starterCode ?? ""]));

  function toggleLanguage(language: ProgrammingLanguage, on: boolean) {
    setForm((f) => ({
      ...f,
      languages: on
        ? [...f.languages, { language, starterCode: "" }]
        : f.languages.filter((l) => l.language !== language),
    }));
  }
  function setStarter(language: ProgrammingLanguage, code: string) {
    setForm((f) => ({
      ...f,
      languages: f.languages.map((l) =>
        l.language === language ? { ...l, starterCode: code } : l,
      ),
    }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...form,
      title: form.title.trim(),
      statement: form.statement.trim(),
      constraints: form.constraints?.trim() || null,
      inputFormat: form.inputFormat?.trim() || null,
      outputFormat: form.outputFormat?.trim() || null,
      languages: form.languages.map((l) => ({
        language: l.language,
        starterCode: (l.starterCode ?? "").trim() || null,
      })),
    });
  }

  return (
    <Card title="Question details">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Title">
          <Input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Problem statement">
          <Textarea
            required
            rows={5}
            value={form.statement}
            onChange={(e) => set("statement", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Constraints" hint="Optional">
            <Textarea
              rows={2}
              value={form.constraints ?? ""}
              onChange={(e) => set("constraints", e.target.value)}
            />
          </Field>
          <Field label="Difficulty">
            <Select
              value={form.difficulty}
              onChange={(e) => set("difficulty", e.target.value as QuestionInput["difficulty"])}
            >
              {QUESTION_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Input description" hint="Optional">
            <Textarea
              rows={2}
              value={form.inputFormat ?? ""}
              onChange={(e) => set("inputFormat", e.target.value)}
            />
          </Field>
          <Field label="Output description" hint="Optional">
            <Textarea
              rows={2}
              value={form.outputFormat ?? ""}
              onChange={(e) => set("outputFormat", e.target.value)}
            />
          </Field>
          <Field label="Time limit (ms)" hint="Optional">
            <Input
              type="number"
              min={1}
              value={form.timeLimitMs ?? ""}
              onChange={(e) => set("timeLimitMs", e.target.value ? Number(e.target.value) : null)}
            />
          </Field>
          <Field label="Memory limit (MB)" hint="Optional">
            <Input
              type="number"
              min={1}
              value={form.memoryLimitMb ?? ""}
              onChange={(e) => set("memoryLimitMb", e.target.value ? Number(e.target.value) : null)}
            />
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-neutral-700">Supported languages</legend>
          {PROGRAMMING_LANGUAGES.map((language) => {
            const on = selected.has(language);
            return (
              <div key={language} className="rounded-md border border-neutral-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleLanguage(language, e.target.checked)}
                  />
                  {language}
                </label>
                {on ? (
                  <Textarea
                    rows={3}
                    className="mt-2 font-mono text-xs"
                    placeholder={`Starter code for ${language} (optional)`}
                    value={selected.get(language) ?? ""}
                    onChange={(e) => setStarter(language, e.target.value)}
                  />
                ) : null}
              </div>
            );
          })}
        </fieldset>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Card>
  );
}

const BLANK_TEST_CASE: TestCaseInput = {
  name: "",
  input: "",
  expectedOutput: "",
  visibility: "HIDDEN",
  weight: 1,
};

function TestCaseEditor({
  question,
  onChanged,
}: {
  question: QuestionDetail;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<TestCaseInput>(BLANK_TEST_CASE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mutate(action: () => Promise<unknown>, resetDraft = false) {
    setError(null);
    setBusy(true);
    try {
      await action();
      if (resetDraft) setDraft(BLANK_TEST_CASE);
      onChanged();
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Test cases">
      {error ? <Alert kind="error">{error}</Alert> : null}
      <p className="mb-3 text-xs text-neutral-500">
        <strong>Visible</strong> cases are shown to students; <strong>hidden</strong> cases and all
        expected outputs are never sent to students.
      </p>

      {question.testCases.length === 0 ? (
        <EmptyState>No test cases yet.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {question.testCases.map((tc) => (
            <TestCaseRow
              key={tc.id}
              testCase={tc}
              busy={busy}
              onSave={(patch) =>
                mutate(() => instructorApi.updateTestCase(question.id, tc.id, patch))
              }
              onDelete={() => mutate(() => instructorApi.deleteTestCase(question.id, tc.id))}
            />
          ))}
        </ul>
      )}

      <form
        className="mt-4 space-y-3 border-t border-neutral-100 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            () =>
              instructorApi.createTestCase(question.id, {
                ...draft,
                name: draft.name?.trim() || null,
              }),
            true,
          );
        }}
      >
        <p className="text-sm font-medium text-neutral-700">Add a test case</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label" hint="Optional">
            <Input
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Visibility">
            <Select
              value={draft.visibility}
              onChange={(e) =>
                setDraft({ ...draft, visibility: e.target.value as TestCaseInput["visibility"] })
              }
            >
              <option value="VISIBLE">VISIBLE — shown to students</option>
              <option value="HIDDEN">HIDDEN — never shown</option>
            </Select>
          </Field>
          <Field label="Input">
            <Textarea
              required
              rows={2}
              className="font-mono text-xs"
              value={draft.input}
              onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            />
          </Field>
          <Field label="Expected output">
            <Textarea
              required
              rows={2}
              className="font-mono text-xs"
              value={draft.expectedOutput}
              onChange={(e) => setDraft({ ...draft, expectedOutput: e.target.value })}
            />
          </Field>
          <Field label="Weight">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={draft.weight ?? 1}
              onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          Add test case
        </Button>
      </form>
    </Card>
  );
}

function TestCaseRow({
  testCase,
  busy,
  onSave,
  onDelete,
}: {
  testCase: TestCaseDto;
  busy: boolean;
  onSave: (patch: Partial<TestCaseInput>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(testCase.input);
  const [expectedOutput, setExpectedOutput] = useState(testCase.expectedOutput);
  const [visibility, setVisibility] = useState(testCase.visibility);

  return (
    <li className="rounded-md border border-neutral-200 text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            testCase.visibility === "HIDDEN"
              ? "bg-amber-100 text-amber-800"
              : "bg-green-100 text-green-800"
          }`}
        >
          {testCase.visibility}
        </span>
        <span className="flex-1 truncate text-neutral-600">
          {testCase.name || <span className="text-neutral-400">Untitled</span>} · weight{" "}
          {testCase.weight}
        </span>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Edit"}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-neutral-100 p-3">
          <Field label="Visibility">
            <Select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as TestCaseDto["visibility"])}
            >
              <option value="VISIBLE">VISIBLE</option>
              <option value="HIDDEN">HIDDEN</option>
            </Select>
          </Field>
          <Field label="Input">
            <Textarea
              rows={2}
              className="font-mono text-xs"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <Field label="Expected output">
            <Textarea
              rows={2}
              className="font-mono text-xs"
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy}
            onClick={() => {
              onSave({ input, expectedOutput, visibility });
              setOpen(false);
            }}
          >
            Save changes
          </Button>
        </div>
      ) : null}
    </li>
  );
}

interface CriterionRow extends RubricCriterionInput {
  key: string;
}

function RubricEditor({
  question,
  onChanged,
}: {
  question: QuestionDetail;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<CriterionRow[]>(
    question.rubric.criteria.map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      maxPoints: c.maxPoints,
    })),
  );
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const total = rows.reduce((sum, r) => sum + (Number.isFinite(r.maxPoints) ? r.maxPoints : 0), 0);

  function update(key: string, patch: Partial<CriterionRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((rs) => [
      ...rs,
      {
        key: `new-${Date.now()}-${rs.length}`,
        name: "",
        description: "",
        type: "FUNCTIONAL_CORRECTNESS" as RubricCriterionType,
        maxPoints: 10,
      },
    ]);
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function move(index: number, delta: number) {
    setRows((rs) => {
      const next = [...rs];
      const target = index + delta;
      if (target < 0 || target >= next.length) return rs;
      [next[index], next[target]] = [next[target], next[index]] as [CriterionRow, CriterionRow];
      return next;
    });
  }

  async function save() {
    setBanner(null);
    setSaving(true);
    try {
      const result = await instructorApi.saveRubric(
        question.id,
        rows.map((r) => ({
          id: r.id,
          name: r.name.trim(),
          description: r.description?.trim() || null,
          type: r.type,
          maxPoints: r.maxPoints,
        })),
      );
      setRows(
        result.criteria.map((c) => ({
          key: c.id,
          id: c.id,
          name: c.name,
          description: c.description,
          type: c.type,
          maxPoints: c.maxPoints,
        })),
      );
      setBanner({ kind: "success", text: "Rubric saved" });
      onChanged();
    } catch (err) {
      setBanner({ kind: "error", text: messageFromError(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Rubric criteria"
      actions={<span className="text-xs text-neutral-500">Total: {total} pts</span>}
    >
      {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}

      {rows.length === 0 ? (
        <EmptyState>No criteria yet. Grading uses multiple weighted criteria.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.key} className="space-y-2 rounded-md border border-neutral-200 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">#{index + 1}</span>
                <Input
                  className="flex-1"
                  placeholder="Criterion name"
                  value={row.name}
                  onChange={(e) => update(row.key, { name: e.target.value })}
                />
                <Button variant="secondary" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button variant="danger" onClick={() => remove(row.key)}>
                  ✕
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={row.type}
                  onChange={(e) => update(row.key, { type: e.target.value as RubricCriterionType })}
                >
                  {RUBRIC_CRITERION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-2 text-xs text-neutral-500">
                  Max points
                  <Input
                    type="number"
                    min={0.5}
                    step="0.5"
                    value={row.maxPoints}
                    onChange={(e) => update(row.key, { maxPoints: Number(e.target.value) })}
                  />
                </label>
              </div>
              <Input
                placeholder="Description (optional)"
                value={row.description ?? ""}
                onChange={(e) => update(row.key, { description: e.target.value })}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={add}>
          Add criterion
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save rubric"}
        </Button>
      </div>
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
