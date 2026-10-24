// TEMPORARY diagnostic (dev only). Safe to delete.
import { requireEditor } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function tryCall(label: string, url: string, init: RequestInit, timeoutMs: number) {
  const t = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    const names = label === "list models" ? (body.match(/"models\/[^"]+"/g) ?? []).join(" ") : "";
    return { label, status: res.status, ms: Date.now() - t, body: names ? names.slice(0, 3000) : body.slice(0, 700) };
  } catch (e) {
    return { label, status: 0, ms: Date.now() - t, body: String((e as Error)?.message ?? e) + " | cause: " + String((e as { cause?: unknown })?.cause ?? "") };
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") return new Response("off", { status: 404 });
  await requireEditor();
  const key = process.env.GEMINI_API_KEY ?? "";
  const base = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const headers = { "content-type": "application/json", "x-goog-api-key": key };
  const body = (thinking?: object) =>
    JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
      generationConfig: { temperature: 0.5, ...(thinking ? { thinkingConfig: thinking } : {}) },
    });
  const gen = (m: string) => `${base}/models/${m}:generateContent`;
  const task = "Write 4 Instagram captions (2 sentences each) and 5 hashtags each for a Diwali donation drive for an orphanage in Vizag. Reply as JSON {\"posts\":[{\"caption\":\"\",\"hashtags\":[]}]}";
  const big = (thinking?: object) =>
    JSON.stringify({
      contents: [{ role: "user", parts: [{ text: task }] }],
      generationConfig: { temperature: 0.8, responseMimeType: "application/json", ...(thinking ? { thinkingConfig: thinking } : {}) },
    });
  const models = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
  const results = await Promise.all(
    models.flatMap((m) => [
      tryCall(`${m} minimal`, gen(m), { method: "POST", headers, body: big({ thinkingLevel: "minimal" }) }, 75000),
      tryCall(`${m} low`, gen(m), { method: "POST", headers, body: big({ thinkingLevel: "low" }) }, 75000),
    ]),
  );
  for (const r of results) if (r.status === 200) r.body = r.body.slice(0, 160);
  void body;
  const keyInfo = { keyLength: key.length, keyPrefix: key.slice(0, 3) };
  return Response.json({ keyInfo, results });
}
