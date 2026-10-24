import type { ProviderConfig } from "@/lib/config";
import { httpTimeoutMs } from "@/lib/config";
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

/**
 * Any OpenAI-style /chat/completions API: Groq, OpenRouter, Ollama, LM Studio,
 * and later paid OpenAI. One adapter, many providers.
 */
export class OpenAICompatibleProvider implements TextProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly cfg: ProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }

  async generate(req: TextRequest): Promise<TextResult> {
    if (!this.cfg.apiKey) throw new ProviderError(`${this.name}: missing API key`, undefined, false);

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.8,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(httpTimeoutMs()),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new ProviderError(`${this.name} HTTP ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError(`${this.name}: empty response`);

    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
