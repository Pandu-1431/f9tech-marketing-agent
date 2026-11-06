import { NextResponse } from "next/server";
import { recordClick } from "@/lib/links";

export const dynamic = "force-dynamic";

/** Short tracking link from a post: count the click, then go to the business's page. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const target = await recordClick(code).catch(() => null);
  if (!target) return new NextResponse("Link not found", { status: 404 });
  return NextResponse.redirect(target, { status: 302, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
