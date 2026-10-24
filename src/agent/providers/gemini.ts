import type { ProviderConfig } from "@/lib/config";
import { httpTimeoutMs } from "@/lib/config";
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

/*
 * Google Gemini via the REST generateContent endpoint (free tier available).
 *
 * GEMINI_MODEL can be ONE model or a LIST, e.g. "gemini-flash-lite-latest,gemini-flash-latest".
 * The agent tries them in order and moves on when a model is:
 *   - retired (404)            -> also tries the replacement Google names in the error
 *   - busy / over quota (429, 503) -> rested for a few minutes, next model used meanwhile
 *   - too slow (timeout)       -> next model
 */

/** Fast, reliable on the free tier (tested Oct 2026: ~6 s), then bigger models as backup. */
export const DEFAULT_GEMINI_MODELS = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-flash-latest"];

/** Models Google has retired for new users: never call them. */
const RETIRED = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"]);

// Learned at runtime and shared by all requests.
const notFound = new Set<string>(); // 404: gone for good
const restingUntil = new Map<string, number>(); // 429/503: try again later
const noThinking = new Set<string>(); // rejected our thinking setting
const REST_MS = 5 * 60_000;

/** When Google retires a model, its 404 usually names the replacement ("...use models/gemini-X-flash..."). */
export function suggestedModel(errorText: string): string | null {
  const m = /use\s+(?:models\/)?(gemini-[\w.-]*[\w-])/i.exec(errorText);
  return m?.[1] ?? null;
}

/** The models to try, in order, from GEMINI_MODEL (retired ones dropped, defaults added as backup). */
export function geminiModelList(configured: string): string[] {
  const wanted = configured
    .split(",")
    .map((s) => s.trim())
    .filter((m) => m && !RETIRED.has(m));
  return [...new Set([...wanted, ...DEFAULT_GEMINI_MODELS])];
}

/** Speed: keep model "thinking" to a minimum — marketing copy doesn't need it. */
function thinkingConfig(model: string): Record<string, unknown> | null {
  if (noThinking.has(model) || process.env.GEMINI_THINKING === "default") return null;
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0) };
  if (/gemini-[3-9]/.test(model) || /latest/.test(model)) return { thinkingLevel: process.env.GEMINI_THINKING_LEVEL ?? "minimal" };
  return null;
}

/** Per-model wait. Kept below the overall limit so a slow model leaves time for the next one. */
function perModelTimeoutMs(): number {
  return Number(process.env.GEMINI_MODEL_TIMEOUT_MS ?? Math.min(45_000, httpTimeoutMs()));
}

export class GeminiProvider implements TextProvider {
  readonly name: string;
  private lastUsed: string | null = null;

  constructor(private readonly cfg: ProviderConfig) {
    this.name = cfg.name;
  }

  /** The model actually answering (first healthy model in the list). */
  get model(): string {
    return this.lastUsed ?? this.candidates()[0] ?? DEFAULT_GEMINI_MODELS[0];
  }

  private candidates(): string[] {
    const now = Date.now();
    const all = geminiModelList(this.cfg.model).filter((m) => !notFound.has(m));
    const ready = all.filter((m) => (restingUntil.get(m) ?? 0) <= now);
    // If every model is resting, still try them (soonest-to-recover first) rather than give up.
    return ready.length ? ready : all.sort((a, b) => (restingUntil.get(a) ?? 0) - (restingUntil.get(b) ?? 0));
  }

  private async call(model: string, req: TextRequest, withThinking: boolean): Promise<Response> {
    const thinking = withThinking ? thinkingConfig(model) : null;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.8,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    };
    return fetch(`${this.cfg.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(perModelTimeoutMs()),
    });
  }

  async generate(req: TextRequest): Promise<TextResult> {
    if (!this.cfg.apiKey) throw new ProviderError(`${this.name}: missing API key`, undefined, false);

    const queue = this.candidates();
    const tried = new Set<string>();
    const problems: string[] = [];
    let retryable = false;

    while (queue.length) {
      const model = queue.shift()!;
      if (tried.has(model)) continue;
      tried.add(model);

      let res: Response;
      try {
        res = await this.call(model, req, true);
        if (res.status === 400) {
          const detail = await res.text();
          if (!/thinking/i.test(detail)) throw new ProviderError(`${this.name} (${model}) HTTP 400: ${detail.slice(0, 400)}`, 400, false);
          noThinking.add(model); // model rejects the thinking setting: retry without it
          res = await this.call(model, req, false);
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        problems.push(`${model}: ${/timeout|abort/i.test(msg) ? "too slow (no answer in time)" : msg}`);
        retryable = true;
        continue; // timeout / network: next model
      }

      if (res.status === 404) {
        const detail = await res.text();
        notFound.add(model);
        const next = suggestedModel(detail);
        if (next && !tried.has(next) && !RETIRED.has(next)) queue.unshift(next);
        problems.push(`${model}: not available (404)`);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const detail = (await res.text()).slice(0, 300);
        restingUntil.set(model, Date.now() + REST_MS);
        problems.push(`${model}: ${res.status === 429 ? "free limit reached" : "busy"} (${res.status}) ${detail.replace(/\s+/g, " ").slice(0, 120)}`);
        retryable = true;
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        throw new ProviderError(`${this.name} (${model}) HTTP ${res.status}: ${detail}`, res.status, false);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text =
        data.candidates?.[0]?.content?.parts
          ?.filter((p) => !p.thought)
          .map((p) => p.text ?? "")
          .join("") ?? "";
      if (!text) {
        problems.push(`${model}: empty answer`);
        retryable = true;
        continue;
      }
      this.lastUsed = model;
      restingUntil.delete(model);
      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }

    throw new ProviderError(`${this.name}: no Gemini model could answer — ${problems.join("; ")}`, undefined, retryable);
  }
}

/** Tests only: forget what was learned about models. */
export function resetGeminiState(): void {
  notFound.clear();
  restingUntil.clear();
  noThinking.clear();
}
