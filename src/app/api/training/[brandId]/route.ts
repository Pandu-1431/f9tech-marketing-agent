import { getAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { getBrand } from "@/lib/data";
import { buildDataset, toJsonl } from "@/agent/training/dataset";

/** Download a brand's training data as JSONL: ?type=sft (default) or ?type=dpo. Editors only. */
export async function GET(req: Request, ctx: { params: Promise<{ brandId: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Sign in first", { status: 401 });
  if (!canEditContent(auth.role)) return new Response("Not allowed", { status: 403 });
  const { brandId } = await ctx.params;
  const brand = await getBrand(auth.workspace.id, Number(brandId));
  if (!brand) return new Response("Not found", { status: 404 });

  const type = new URL(req.url).searchParams.get("type") === "dpo" ? "dpo" : "sft";
  const data = await buildDataset(auth.workspace.id, brand);
  const slug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
  return new Response(toJsonl(type === "dpo" ? data.dpo : data.sft), {
    headers: {
      "content-type": "application/jsonl; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-${type}-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      "cache-control": "no-store",
    },
  });
}
