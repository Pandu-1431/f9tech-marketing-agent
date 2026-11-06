import { graph } from "./meta";
import { PublishConfigError } from "./types";

/*
 * "Connect with Facebook": the owner logs in with Facebook and picks a Page; the Instagram account
 * linked to that Page comes with it. No tokens or IDs to copy. Needs a Meta app (META_APP_ID +
 * META_APP_SECRET) with Facebook Login; it works at once for the app's admins and testers, and for
 * everyone after Meta's app review. A pasted token (user or Page) works too: the Pages are listed.
 * Page tokens obtained from a long-lived user token do not expire.
 */

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "business_management",
];

const DIALOG = () => (process.env.META_DIALOG_URL ?? "https://www.facebook.com").replace(/\/$/, "");
const VERSION = () => process.env.META_GRAPH_VERSION ?? "v23.0";

export const metaConfigured = () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

export function metaRedirectUri(requestUrl: string): string {
  const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : new URL(requestUrl).origin.replace("//0.0.0.0", "//localhost");
  return `${base}/api/oauth/meta/callback`;
}

export function metaAuthUrl(redirectUri: string, state: string): string {
  const u = new URL(`${DIALOG()}/${VERSION()}/dialog/oauth`);
  u.searchParams.set("client_id", process.env.META_APP_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

/** One-time code -> long-lived user token (about 60 days; the Page tokens made from it do not expire). */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const short = await graph("GET", "oauth/access_token", "", {
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code,
  });
  const longLived = await graph("GET", "oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: String(short.access_token ?? ""),
  }).catch(() => short);
  const token = String(longLived.access_token ?? short.access_token ?? "");
  if (!token) throw new PublishConfigError("Facebook did not return a token. Try again.");
  return token;
}

export type MetaPage = { id: string; name: string; token: string; picture: string | null; instagram: { id: string; username: string } | null };

const IG_FIELDS = "instagram_business_account{id,username}";

/** The Pages this token can post to (a Page token lists just its own Page). */
export async function listPages(token: string): Promise<MetaPage[]> {
  const toPage = (p: Record<string, unknown>, pageToken: string): MetaPage => {
    const ig = (p.instagram_business_account ?? null) as Record<string, string> | null;
    const pic = ((p.picture as { data?: { url?: string } })?.data?.url ?? null) as string | null;
    return { id: String(p.id), name: String(p.name ?? p.id), token: pageToken, picture: pic, instagram: ig?.id ? { id: ig.id, username: ig.username ?? ig.id } : null };
  };
  try {
    const out = await graph("GET", "me/accounts", token, { fields: `id,name,access_token,picture{url},${IG_FIELDS}`, limit: "100" });
    const pages = ((out.data as Record<string, unknown>[]) ?? []).filter((p) => p.access_token);
    if (pages.length) return pages.map((p) => toPage(p, String(p.access_token)));
  } catch (err) {
    if (!(err instanceof PublishConfigError)) throw err;
    // A Page token cannot list accounts: fall through and treat it as that Page.
  }
  try {
    // "category" exists only on a Page: a user token with no Pages fails here and gets an empty list.
    const me = await graph("GET", "me", token, { fields: `id,name,category,picture{url},${IG_FIELDS}` });
    return me.id ? [toPage(me, token)] : [];
  } catch {
    return [];
  }
}
