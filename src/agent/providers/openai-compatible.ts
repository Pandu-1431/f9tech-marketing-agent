import type { ProviderConfig } from "@/lib/config";
import { httpTimeoutMs } from "@/lib/config";
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

/**
 * Any OpenAI-style /chat/completions API: Groq, OpenRouter, Ollama, LM Studio,
 * and later paid OpenAI. One adapter, many providers.
 *
 * cfg.model may be a comma-separated list. Models are tried in order:
 * - retired / unknown model (404, "decommissioned", "model_not_found") -> skipped for good, next one
 * - busy / over the free limit (429, 5xx) -> next one now
 * - JSON mode not supported -> the same model again without it (the prompt already asks for JSON)
 * Providers retire models every few months; this keeps the app working when they do.
 */
const retired = new Set<string>(); // "groq:llama-3.3-70b-versatile"

export function modelList(spec: string): string[] {
  return Array.from(new Set(spec.split(",").map((m) => m.trim()).filter(Boolean)));
}

/** Tests only. */
export function _resetRetiredModels() {
  retired.clear();
}

const isRetired = (status: number, detail: string) =>
  status === 404 || /model_not_found|does not exist|decommissioned|deprecated|no longer supported|not supported for this model/i.test(detail);

export class OpenAICompatibleProvider implements TextProvider {
  readonly name: string;
  readonly model: string;
  private readonly models: string[];

  constructor(private readonly cfg: ProviderConfig) {
    this.name = cfg.name;
    this.models = modelList(cfg.model);
    this.model = this.models[0] ?? cfg.model;
  }

  private call(model: string, req: TextRequest, json: boolean) {
    return fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: req.temperature ?? 0.8,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(httpTimeoutMs()),
    });
  }

  async generate(req: TextRequest): Promise<TextResult> {
    if (!this.cfg.apiKey) throw new ProviderError(`${this.name}: missing API key`, undefined, false);
    const problems: string[] = [];
    let retryable = false;
    let lastStatus: number | undefined;
    const usable = this.models.filter((m) => !retired.has(`${this.name}:${m}`));
    for (const model of usable.length ? usable : this.models) {
      let json = Boolean(req.json);
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          res = await this.call(model, req, json);
        } catch (err) {
          problems.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
          retryable = true;
          break;
        }
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const text = data.choices?.[0]?.message?.content ?? "";
          if (!text) {
            problems.push(`${model}: empty response`);
            retryable = true;
            break;
          }
          return { text, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
        }
        const detail = (await res.text()).slice(0, 400);
        lastStatus = res.status;
        if (json && res.status === 400 && /response_format|json/i.test(detail) && !isRetired(res.status, detail)) {
          json = false; // this model can't do JSON mode: ask again without it
          continue;
        }
        if (isRetired(res.status, detail)) {
          retired.add(`${this.name}:${model}`);
          problems.push(`${model}: retired by ${this.name}`);
        } else {
          problems.push(`${model}: HTTP ${res.status} ${detail.replace(/\s+/g, " ").slice(0, 160)}`);
          if (res.status === 429 || res.status >= 500) retryable = true;
        }
        break;
      }
    }
    throw new ProviderError(`${this.name}: no model could answer — ${problems.join("; ")}`, lastStatus, retryable);
  }
}
