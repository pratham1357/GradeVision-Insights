import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  buildHintPrompt,
  HINT_SYSTEM_PROMPT,
  type HintRequest,
  type LLMProvider,
} from "./provider.js";

interface GeminiConfig {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini via the REST `generateContent` endpoint. Zero SDK - just
 * `fetch`. Key and model come only from the environment.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly config: GeminiConfig;

  constructor(config: GeminiConfig = env.gemini) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generateHint(request: HintRequest): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("Gemini API key is not configured");
    }

    const url =
      `${this.config.baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent` +
      `?key=${encodeURIComponent(this.config.apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: HINT_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildHintPrompt(request) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300, topP: 0.9 },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      logger.warn("gemini request failed", { status: response.status });
      throw new Error(`Gemini responded ${response.status}: ${bodyText.slice(0, 200)}`);
    }

    const body = (await response.json()) as GeminiResponse;
    if (body.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`);
    }

    const text = body.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new Error("Gemini returned an empty response");
    }
    return text;
  }
}
