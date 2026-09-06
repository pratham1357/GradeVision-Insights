/**
 * Client for the backend-only hint-engine service (progressive AI hints).
 *
 * The browser never talks to the hint-engine directly - the API forwards the
 * minimum necessary context and returns plain guidance text. Provider errors,
 * API keys and model names are never surfaced to the caller: any failure becomes
 * a single `HintProviderUnavailableError`.
 */
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
}

export class HintProviderUnavailableError extends Error {
  constructor(message = "The AI hint provider is not available") {
    super(message);
    this.name = "HintProviderUnavailableError";
  }
}

interface HintEngineResponse {
  data?: { hint?: unknown };
  hint?: unknown;
}

/**
 * Ask the hint-engine for an interactive hint. Resolves with guidance text or
 * rejects with `HintProviderUnavailableError` - callers translate that to a 503.
 */
export async function requestInteractiveHint(context: InteractiveHintContext): Promise<string> {
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
      signal: AbortSignal.timeout(20_000),
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
  if (typeof hint !== "string" || hint.trim().length === 0) {
    throw new HintProviderUnavailableError();
  }
  return hint.trim();
}
