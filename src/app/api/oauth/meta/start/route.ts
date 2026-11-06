import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/app-url";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { metaAuthUrl, metaConfigured, metaRedirectUri } from "@/agent/publish/meta-connect";
import { newOAuthState, OAUTH_COOKIE } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** "Connect with Facebook": off to Facebook's login, then back to /callback. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = Number(req.nextUrl.searchParams.get("brandId"));
  if (!(await getBrand(workspace.id, brandId))) return NextResponse.redirect(appUrl("/brands", req));
  if (!metaConfigured()) return NextResponse.redirect(appUrl(`/brands/${brandId}?meta=not-configured#channels`, req));
  const { state, cookie } = newOAuthState(brandId);
  const res = NextResponse.redirect(metaAuthUrl(metaRedirectUri(req.url), state));
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !(process.env.APP_URL ?? "").startsWith("http://"), maxAge: 600, path: "/" });
  return res;
}
