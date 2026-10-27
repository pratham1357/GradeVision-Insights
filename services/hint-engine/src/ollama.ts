import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  buildHintPrompt,
  HINT_SYSTEM_PROMPT,
  type HintRequest,
  type LLMProvider,
} from "./provider.js";

/**
 * Local LLM provider: a model served by Ollama on this machine (`/api/chat`,
 * non-streaming). Same prompt builder and system prompt as every provider, so
 * the context that leaves the API (sanitized evidence, no hidden tests) is
 * identical. `OLLAMA_BASE_URL` is loopback-only (enforced in env.ts).
 */
export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive: string;
  numCtx: number;
}

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: { name?: string; model?: string }[];
}

export interface OllamaProbe {
  reachable: boolean;
  modelAvailable: boolean;
}

/** Hard cap on generated tokens - the prompt asks for < 90 words. */
export const OLLAMA_NUM_PREDICT = 220;

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly config: OllamaConfig;

  constructor(config: OllamaConfig = env.ollama) {
    this.config = config;
  }

  get model(): string {
    return this.config.model;
  }

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.model);
  }

  /** Whether the local server answers and has the configured model pulled. */
  async probe(timeoutMs = 2_000): Promise<OllamaProbe> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { reachable: true, modelAvailable: false };
      const body = (await response.json()) as OllamaTagsResponse;
      const names = (body.models ?? []).flatMap((m) => [m.name, m.model]);
      return { reachable: true, modelAvailable: names.includes(this.config.model) };
    } catch {
      return { reachable: false, modelAvailable: false };
    }
  }

  async generateHint(request: HintRequest): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        keep_alive: this.config.keepAlive,
        messages: [
          { role: "system", content: HINT_SYSTEM_PROMPT },
          { role: "user", content: buildHintPrompt(request) },
        ],
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: OLLAMA_NUM_PREDICT,
          num_ctx: this.config.numCtx,
        },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      logger.warn("ollama request failed", { status: response.status });
      throw new Error(`Ollama responded ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    logger.info("ollama hint generated", {
      model: this.config.model,
      totalMs: body.total_duration ? Math.round(body.total_duration / 1e6) : null,
      loadMs: body.load_duration ? Math.round(body.load_duration / 1e6) : null,
      promptTokens: body.prompt_eval_count ?? null,
      outputTokens: body.eval_count ?? null,
      doneReason: body.done_reason ?? null,
    });

    const text = body.message?.content?.trim();
    if (!text) {
      throw new Error("Ollama returned an empty response");
    }
    return text;
  }
}
