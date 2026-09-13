import type { ProgrammingLanguage } from "@gradevision/shared";
import Editor from "@monaco-editor/react";

import { monacoLanguage } from "../lib/monaco";

/**
 * Monaco editor for exam code. Authoring only - it never runs code. Monaco itself
 * is loaded on demand by `@monaco-editor/react` (from a CDN by default).
 */
export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  height = "440px",
}: {
  language: ProgrammingLanguage;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Editor height; read-only viewers pass a content-sized value. */
  height?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-300">
      <Editor
        height={height}
        theme="vs-dark"
        language={monacoLanguage(language)}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        loading={<div className="p-4 text-sm text-neutral-500">Loading editor…</div>}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 4,
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}
