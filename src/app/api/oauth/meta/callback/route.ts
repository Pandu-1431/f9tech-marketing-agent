import { NextResponse, type NextRequest } from "next/server";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { exchangeMetaCode, metaRedirectUri } from "@/agent/publish/meta-connect";
import { checkOAuthState, OAUTH_COOKIE } from "@/lib/oauth";
import { META_PICK_COOKIE, pickCookieOptions, pickCookieValue } from "@/lib/meta-pick";

export const dynamic = "force-dynamic";

/** Facebook sends the owner back here: swap the code for a token, then let them pick a Page. */
export async function GET(req: NextRequest) {
  const { workspace } = await requireEditor();
  const brandId = checkOAuthState(req.cookies.get(OAUTH_COOKIE)?.value, req.nextUrl.searchParams.get("state"));
  const to = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  if (!brandId || !(await getBrand(workspace.id, brandId))) return to("/brands");
  if (req.nextUrl.searchParams.get("error")) return to(`/brands/${brandId}?meta=cancelled#channels`);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return to(`/brands/${brandId}?meta=failed#channels`);
  try {
    const token = await exchangeMetaCode(code, metaRedirectUri(req.url));
    const res = to(`/brands/${brandId}/connect/meta`);
    res.cookies.set(META_PICK_COOKIE, pickCookieValue(brandId, token), pickCookieOptions);
    return res;
  } catch (err) {
    console.error("[meta connect]", err);
    return to(`/brands/${brandId}?meta=failed#channels`);
  }
}
