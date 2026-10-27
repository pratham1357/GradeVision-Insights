import type { InstructorHintStage } from "@gradevision/shared";
import { useEffect, useId, useState } from "react";

import { instructorApi, type HintStageInput } from "../lib/instructor-api";
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
} from "./ui";

type Banner = { kind: "success" | "error"; text: string } | null;

const DELIVERY_LABEL: Record<HintStageInput["deliveryType"], string> = {
  STATIC: "Written hint",
  INTERACTIVE: "AI mentor (local model)",
};

/**
 * Authoring for a question's progressive hints. Students unlock stage N only
 * after using stage N-1 and after N-1 unsuccessful evaluated attempts - the
 * policy lives on the server; this editor only manages the stages' content.
 */
export function HintStageEditor({ questionId }: { questionId: string }) {
  const { data, loading, error, reload } = useApi(
    () => instructorApi.listHintStages(questionId),
    [questionId],
  );
  const [stages, setStages] = useState<InstructorHintStage[]>([]);
  const [banner, setBanner] = useState<Banner>(null);

  useEffect(() => {
    if (data) setStages(data);
  }, [data]);

  async function run(action: () => Promise<InstructorHintStage[]>, success: string) {
    setBanner(null);
    try {
      setStages(await action());
      setBanner({ kind: "success", text: success });
    } catch (err) {
      setBanner({ kind: "error", text: messageFromError(err) });
      reload();
    }
  }

  return (
    <Card
      title="Hint stages"
      actions={
        <span className="text-xs text-neutral-500">
          Stage N unlocks after N − 1 unsuccessful evaluated attempts
        </span>
      }
    >
      <div aria-live="polite">
        {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
      </div>
      {loading && stages.length === 0 ? <Spinner label="Loading hint stages…" /> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      {!loading && stages.length === 0 && !error ? (
        <EmptyState>No hints yet. Students will see no assistance for this question.</EmptyState>
      ) : null}

      <ol className="space-y-3">
        {stages.map((stage, index) => (
          <HintStageRow
            key={stage.id}
            stage={stage}
            isLast={index === stages.length - 1}
            onSave={(body) =>
              run(
                () => instructorApi.updateHintStage(questionId, stage.id, body),
                `Stage ${stage.stageNumber} saved`,
              )
            }
            onDelete={() =>
              run(
                () => instructorApi.deleteHintStage(questionId, stage.id),
                `Stage ${stage.stageNumber} removed`,
              )
            }
          />
        ))}
      </ol>

      <NewHintStage
        nextNumber={stages.length + 1}
        disabled={stages.length >= 6}
        onCreate={(body) =>
          run(() => instructorApi.createHintStage(questionId, body), "Hint stage added")
        }
      />
    </Card>
  );
}

function HintStageRow({
  stage,
  isLast,
  onSave,
  onDelete,
}: {
  stage: InstructorHintStage;
  isLast: boolean;
  onSave: (body: HintStageInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<HintStageInput>({
    title: stage.title,
    deliveryType: stage.deliveryType,
    content: stage.content,
  });
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const dirty =
    (draft.title ?? "") !== (stage.title ?? "") ||
    draft.deliveryType !== stage.deliveryType ||
    (draft.content ?? "") !== (stage.content ?? "");

  async function act(kind: "save" | "delete") {
    setBusy(kind);
    try {
      if (kind === "save") {
        await onSave({
          title: draft.title?.trim() || null,
          deliveryType: draft.deliveryType,
          content: draft.deliveryType === "STATIC" ? (draft.content ?? "").trim() : null,
        });
      } else {
        await onDelete();
      }
    } finally {
      setBusy(null);
    }
  }

  const removable = isLast && stage.usageCount === 0;
  return (
    <li className="space-y-2 rounded-md border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-700">Stage {stage.stageNumber}</span>
        {stage.deliveryType === "INTERACTIVE" ? <Badge tone="info">AI mentor</Badge> : null}
        {stage.usageCount > 0 ? (
          <Badge tone="neutral">
            delivered {stage.usageCount}× · past deliveries keep their original text
          </Badge>
        ) : null}
      </div>
      <StageFields draft={draft} onChange={setDraft} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void act("save")}
          disabled={!dirty}
          loading={busy === "save"}
        >
          Save stage
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => void act("delete")}
          disabled={!removable}
          loading={busy === "delete"}
          title={
            removable
              ? undefined
              : stage.usageCount > 0
                ? "Already delivered to a student - part of their evidence record"
                : "Only the last stage can be removed"
          }
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

function NewHintStage({
  nextNumber,
  disabled,
  onCreate,
}: {
  nextNumber: number;
  disabled: boolean;
  onCreate: (body: HintStageInput) => Promise<void>;
}) {
  const empty: HintStageInput = { title: "", deliveryType: "STATIC", content: "" };
  const [draft, setDraft] = useState<HintStageInput>(empty);
  const [busy, setBusy] = useState(false);
  const valid = draft.deliveryType === "INTERACTIVE" || Boolean(draft.content?.trim());

  async function create() {
    setBusy(true);
    try {
      await onCreate({
        title: draft.title?.trim() || null,
        deliveryType: draft.deliveryType,
        content: draft.deliveryType === "STATIC" ? (draft.content ?? "").trim() : null,
      });
      setDraft(empty);
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return <p className="mt-3 text-xs text-neutral-500">A question can have at most 6 stages.</p>;
  }
  return (
    <div className="mt-4 space-y-2 rounded-md border border-dashed border-neutral-300 p-3">
      <p className="text-sm font-medium text-neutral-700">Add stage {nextNumber}</p>
      <StageFields draft={draft} onChange={setDraft} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void create()}
        disabled={!valid}
        loading={busy}
      >
        Add hint stage
      </Button>
    </div>
  );
}

function StageFields({
  draft,
  onChange,
}: {
  draft: HintStageInput;
  onChange: (next: HintStageInput) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Title (optional)">
          <Input
            maxLength={120}
            value={draft.title ?? ""}
            placeholder="e.g. Conceptual nudge"
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
          />
        </Field>
        <Field label="Delivery">
          <Select
            value={draft.deliveryType}
            onChange={(e) =>
              onChange({ ...draft, deliveryType: e.target.value as HintStageInput["deliveryType"] })
            }
          >
            {(Object.keys(DELIVERY_LABEL) as HintStageInput["deliveryType"][]).map((t) => (
              <option key={t} value={t}>
                {DELIVERY_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {draft.deliveryType === "STATIC" ? (
        <Field label="Hint text" hint="Shown exactly as written. Do not include a solution.">
          <Textarea
            id={`${id}-content`}
            rows={3}
            maxLength={2000}
            value={draft.content ?? ""}
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
          />
        </Field>
      ) : (
        <p className="text-xs text-neutral-500">
          Generated on request by the local model from the student&apos;s code and visible-test
          results only. Hidden tests are never sent. Output is checked before it is shown.
        </p>
      )}
    </div>
  );
}
