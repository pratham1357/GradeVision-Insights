import type { ViolationType } from "@gradevision/shared";
import { useEffect, useRef } from "react";

/** Collapse the blur/visibility burst a single tab-switch fires into one event. */
export const COOLDOWN_MS = 1_200;

/**
 * Stateful debouncer for integrity signals. A tab-switch fires `blur` then
 * `visibilitychange` in quick succession - both map to "left the exam", so only
 * the first within {@link COOLDOWN_MS} is reported. Pure and unit-testable.
 */
export function createIntegrityDebouncer(cooldownMs = COOLDOWN_MS, now: () => number = Date.now) {
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    /** Returns true if this signal should be recorded now. */
    shouldRecord(): boolean {
      const t = now();
      if (t - lastAt < cooldownMs) return false;
      lastAt = t;
      return true;
    },
  };
}

/**
 * Lightweight, non-invasive integrity monitor. Watches only page focus and
 * fullscreen state - no camera, microphone, screen capture, or keystroke
 * logging. Reports at most once per {@link COOLDOWN_MS}.
 */
export function useIntegrityMonitor(
  enabled: boolean,
  report: (type: ViolationType, note?: string) => void,
): void {
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!enabled) return;
    const debouncer = createIntegrityDebouncer();

    const fire = (type: ViolationType, note: string) => {
      if (!debouncer.shouldRecord()) return;
      reportRef.current(type, note);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") fire("VISIBILITY_CHANGE", "exam tab hidden");
    };
    const onBlur = () => fire("WINDOW_BLUR", "exam window lost focus");
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) fire("FULLSCREEN_EXIT", "left fullscreen");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [enabled]);
}

/** Best-effort request for fullscreen. Never throws. */
export async function requestExamFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    /* denied or unsupported - the exam still works */
  }
}
