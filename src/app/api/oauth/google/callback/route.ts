import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { saveChannel } from "@/agent/publish";
import { exchangeGoogleCode, myChannel } from "@/agent/publish/youtube";
import { checkOAuthState, googleRedirectUri, OAUTH_COOKIE } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Google sends the user back here with a one-time code: save the YouTube channel. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = checkOAuthState(req.cookies.get(OAUTH_COOKIE)?.value, req.nextUrl.searchParams.get("state"));
  const back = (status: string, brand = brandId) => {
    const res = NextResponse.redirect(new URL(brand ? `/brands/${brand}?youtube=${encodeURIComponent(status)}` : "/brands", req.url));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  if (!brandId || !(await getBrand(workspace.id, brandId))) return back("expired", null);
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("failed");
  try {
    const { refreshToken, accessToken } = await exchangeGoogleCode(code, googleRedirectUri(req.url));
    const channel = await myChannel(accessToken);
    await saveChannel(workspace.id, brandId, "youtube", channel.title, refreshToken, { channelId: channel.id });
    return back("connected");
  } catch (err) {
    console.error("[youtube connect]", err);
    return back(err instanceof Error && /no YouTube channel/i.test(err.message) ? "no-channel" : "failed");
  }
}
