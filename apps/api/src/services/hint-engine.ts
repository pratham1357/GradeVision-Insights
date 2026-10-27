/**
 * Client for the backend-only hint-engine service (progressive AI hints).
 *
 * The browser never talks to the hint-engine directly - the API forwards the
 * minimum necessary context and returns plain guidance text. Provider errors,
 * API keys and model names are never surfaced to the caller: any failure becomes
 * a single `HintProviderUnavailableError`.
 */
import type { HintExecutionEvidence } from "@gradevision/shared";

import { env } from "../env.js";
import { logger } from "../utils/logger.js";

export interface InteractiveHintContext {
  stageNumber: number;
  language: string;
  questionTitle: string;
  questionStatement: string;
  /** The student's latest code for this question, if any. */
  studentCode: string | null;
  /** Hint text already delivered for earlier stages (so the model escalates). */
  previousHints: string[];
  /**
   * Sanitized execution evidence (built by `hint-context.ts`): attempt counts,
   * per-attempt pass/total, and the latest attempt's VISIBLE failing cases.
   * Never hidden test data. `null` when the caller has none.
   */
  evidence: HintExecutionEvidence | null;
}

export class HintProviderUnavailableError extends Error {
  constructor(message = "The AI hint provider is not available") {
    super(message);
    this.name = "HintProviderUnavailableError";
  }
}

interface HintEngineResponse {
  data?: { hint?: unknown; provider?: unknown; model?: unknown; validator?: unknown };
  hint?: unknown;
}

/** A generated hint plus where it came from - persisted with the usage row, never sent to the browser. */
export interface InteractiveHint {
  hint: string;
  provider: string | null;
  model: string | null;
  validator: string | null;
}

/** Defensive ceiling; the hint-engine's validator already enforces a much tighter one. */
const MAX_DELIVERED_HINT_CHARS = 2_000;

const optionalLabel = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;

/**
 * Ask the hint-engine for an interactive hint. Resolves with validated guidance
 * text and its provenance, or rejects with `HintProviderUnavailableError` -
 * callers translate that to a 503.
 */
export async function requestInteractiveHint(
  context: InteractiveHintContext,
): Promise<InteractiveHint> {
  const url = `${env.HINT_ENGINE_URL}/hints`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.INTERNAL_SERVICE_TOKEN) {
    headers.authorization = `Bearer ${env.INTERNAL_SERVICE_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(env.HINT_ENGINE_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn("hint-engine request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HintProviderUnavailableError();
  }

  if (!response.ok) {
    // 503 => provider not configured; anything else is still "unavailable" to us.
    logger.warn("hint-engine returned an error", { status: response.status });
    throw new HintProviderUnavailableError(
      response.status === 503
        ? "The AI hint provider is not configured"
        : "The AI hint provider is not available",
    );
  }

  const body = (await response.json().catch(() => ({}))) as HintEngineResponse;
  const hint = body.data?.hint ?? body.hint;
  if (
    typeof hint !== "string" ||
    hint.trim().length === 0 ||
    hint.length > MAX_DELIVERED_HINT_CHARS
  ) {
    throw new HintProviderUnavailableError();
  }
  return {
    hint: hint.trim(),
    provider: optionalLabel(body.data?.provider),
    model: optionalLabel(body.data?.model),
    validator: optionalLabel(body.data?.validator),
  };
}
