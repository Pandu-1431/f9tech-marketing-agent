/*
 * Local stand-in for Google Gemini and Cloudflare Workers AI, used ONLY by the browser tests.
 * The app talks to it through the normal Gemini and Cloudflare adapters (via GEMINI_BASE_URL and
 * CLOUDFLARE_BASE_URL), so tests run the real provider code without any internet AI calls.
 *
 * Deterministic rules:
 *   - Text: answers with the same JSON the built-in demo generator writes.
 *   - Brand name containing "DemoFallback": every Gemini call fails (503), so the app falls back
 *     to the built-in demo generator. Brand colour #0de403 does the same for images.
 */
import http from "node:http";
import sharp from "sharp";
import { FakeProvider } from "@/agent/providers/fake";

const PORT = Number(process.env.STUB_AI_PORT ?? 4111);
const brain = new FakeProvider();

async function readBody(req: http.IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url ?? "";
    const raw = await readBody(req);

    if (url.includes(":generateContent")) {
      const body = JSON.parse(raw);
      const system: string = body.systemInstruction?.parts?.[0]?.text ?? "";
      if (/DemoFallback/i.test(system)) return send(res, 503, { error: { code: 503, message: "stub: model busy (test fallback)" } });
      const out = await brain.generate({
        system,
        prompt: body.contents?.[0]?.parts?.[0]?.text ?? "",
        json: body.generationConfig?.responseMimeType === "application/json",
      });
      return send(res, 200, {
        candidates: [{ content: { parts: [{ text: out.text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      });
    }

    if (url.includes("/ai/run/")) {
      const body = JSON.parse(raw);
      if (/#0de403/i.test(body.prompt ?? "")) return send(res, 500, { errors: [{ message: "stub: image model failed (test fallback)" }] });
      // A small photo-like image: a two-tone diagonal, different per seed.
      const seed = Number(body.seed ?? 1);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${(seed * 47) % 360},55%,45%)"/><stop offset="1" stop-color="hsl(${(seed * 47 + 90) % 360},55%,30%)"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="380" cy="140" r="90" fill="rgba(255,255,255,0.25)"/></svg>`;
      const jpeg = await sharp(Buffer.from(svg)).jpeg().toBuffer();
      return send(res, 200, { result: { image: jpeg.toString("base64") }, success: true });
    }

    if (url === "/health") return send(res, 200, { ok: true });
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`stub AI server on ${PORT}`));
