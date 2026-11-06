import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { googleAuthUrl, googleConfigured } from "@/agent/publish/youtube";
import { googleRedirectUri, googleService, newOAuthState, OAUTH_COOKIE, OAUTH_SERVICE_COOKIE, SERVICE_SCOPES } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** "Connect YouTube / Google Business Profile / Google Sheet": send the user to Google's sign-in, then back to /callback. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = Number(req.nextUrl.searchParams.get("brandId"));
  const service = googleService(req.nextUrl.searchParams.get("service"));
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return NextResponse.redirect(new URL("/brands", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/brands/${brandId}?${service}=not-configured`, req.url));
  const { state, cookie } = newOAuthState(brandId);
  const res = NextResponse.redirect(googleAuthUrl(googleRedirectUri(req.url), state, SERVICE_SCOPES[service]));
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" };
  res.cookies.set(OAUTH_COOKIE, cookie, opts);
  res.cookies.set(OAUTH_SERVICE_COOKIE, service, opts);
  return res;
}
