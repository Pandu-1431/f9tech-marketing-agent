import type { ProviderConfig } from "@/lib/config";
import { httpTimeoutMs } from "@/lib/config";
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

/** Google Gemini via the REST generateContent endpoint (free tier available). */
export class GeminiProvider implements TextProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly cfg: ProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }

  async generate(req: TextRequest): Promise<TextResult> {
    if (!this.cfg.apiKey) throw new ProviderError(`${this.name}: missing API key`, undefined, false);

    const url = `${this.cfg.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.8,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(httpTimeoutMs()),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new ProviderError(`${this.name} HTTP ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new ProviderError(`${this.name}: empty response`);

    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
