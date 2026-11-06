import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/app-url";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { saveChannel } from "@/agent/publish";
import { exchangeGoogleCode, myChannel } from "@/agent/publish/youtube";
import { myLocations } from "@/agent/publish/google-business";
import { createTrackerSheet, SHEETS_PLATFORM, syncBrandSheet } from "@/agent/sheets";
import { checkOAuthState, googleRedirectUri, googleService, OAUTH_COOKIE, OAUTH_SERVICE_COOKIE } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Google sends the user back here with a one-time code: save the YouTube channel, Business Profile or Sheet. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = checkOAuthState(req.cookies.get(OAUTH_COOKIE)?.value, req.nextUrl.searchParams.get("state"));
  const service = googleService(req.cookies.get(OAUTH_SERVICE_COOKIE)?.value);
  const back = (status: string, brand = brandId) => {
    const res = NextResponse.redirect(appUrl(brand ? `/brands/${brand}?${service}=${encodeURIComponent(status)}` : "/brands", req));
    res.cookies.delete(OAUTH_COOKIE);
    res.cookies.delete(OAUTH_SERVICE_COOKIE);
    return res;
  };
  const brand = brandId ? await getBrand(workspace.id, brandId) : null;
  if (!brandId || !brand) return back("expired", null);
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("failed");
  try {
    const { refreshToken, accessToken } = await exchangeGoogleCode(code, googleRedirectUri(req.url));
    if (service === "youtube") {
      const channel = await myChannel(accessToken);
      await saveChannel(workspace.id, brandId, "youtube", channel.title, refreshToken, { channelId: channel.id });
    } else if (service === "gbp") {
      // First profile this account manages (most small businesses have one).
      const [loc] = await myLocations(accessToken);
      await saveChannel(workspace.id, brandId, "google_business", loc.title, refreshToken, { account: loc.account, location: loc.location });
    } else {
      const sheet = await createTrackerSheet(accessToken, brand.name);
      await saveChannel(workspace.id, brandId, SHEETS_PLATFORM, sheet.title, refreshToken, { spreadsheetId: sheet.spreadsheetId, url: sheet.url });
      await syncBrandSheet(workspace.id, brandId).catch(() => 0);
    }
    return back("connected");
  } catch (err) {
    console.error(`[google connect: ${service}]`, err);
    const msg = err instanceof Error ? err.message : "";
    if (/no YouTube channel/i.test(msg)) return back("no-channel");
    if (/no Business Profile/i.test(msg)) return back("no-profile");
    if (/Business Profile/i.test(msg) && /(403|denied|not been used|disabled)/i.test(msg)) return back("no-api");
    return back("failed");
  }
}
