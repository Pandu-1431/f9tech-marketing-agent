import { getFile, mimeFromKey } from "@/lib/storage";

/** Serves locally stored files (STORAGE_DRIVER=local). In production R2 serves them directly. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const k = key.join("/");
  const body = await getFile(k);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": mimeFromKey(k),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
