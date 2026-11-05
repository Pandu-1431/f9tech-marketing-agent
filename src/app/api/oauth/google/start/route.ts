import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { googleAuthUrl, googleConfigured } from "@/agent/publish/youtube";
import { googleRedirectUri, newOAuthState, OAUTH_COOKIE } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** "Connect YouTube": send the user to Google's sign-in, then back to /callback. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = Number(req.nextUrl.searchParams.get("brandId"));
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return NextResponse.redirect(new URL("/brands", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/brands/${brandId}?youtube=not-configured`, req.url));
  const { state, cookie } = newOAuthState(brandId);
  const res = NextResponse.redirect(googleAuthUrl(googleRedirectUri(req.url), state));
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
