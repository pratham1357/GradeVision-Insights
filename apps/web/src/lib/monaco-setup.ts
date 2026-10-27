/**
 * Serve Monaco from the app bundle instead of `@monaco-editor/react`'s default
 * CDN (jsDelivr), so the exam editor works with no internet connection. Vite
 * bundles the editor and its web workers; nothing is fetched at runtime.
 *
 * Import this module once, before any `<Editor>` renders.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    // JavaScript questions use the TypeScript language service; everything
    // else (Python, Java, C, C++) only needs the base editor worker.
    if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });
