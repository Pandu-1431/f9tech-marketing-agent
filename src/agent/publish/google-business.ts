import { accessToken } from "./youtube";
import { PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * Google Business Profile "updates" (local posts), connected with "Sign in with Google".
 * Same Google OAuth client as YouTube; scope business.manage. The channel stores a refresh
 * token (encrypted) and { account: "accounts/1", location: "locations/2" }.
 *
 * Google gives the Business Profile APIs only to approved projects: request access at
 * https://developers.google.com/my-business/content/prereqs (free; usually a few days),
 * then enable "My Business Account Management API", "My Business Business Information API"
 * and "Google My Business API" in the same Cloud project.
 *
 * Posts show on Google Search and Maps for the business. Max 1500 characters, no hashtags,
 * one photo (needs a public https link, like Instagram), optional "Learn more" button.
 */
export const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"];

/** In tests one stub server stands in for all three Google hosts. */
const host = (real: string) => (process.env.GBP_API_URL ?? real).replace(/\/$/, "");
const ACCOUNTS = () => host("https://mybusinessaccountmanagement.googleapis.com");
const INFO = () => host("https://mybusinessbusinessinformation.googleapis.com");
const POSTS = () => host("https://mybusiness.googleapis.com");

async function call(method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(res);
  if (!res.ok) {
    const msg = `Google Business Profile: ${String((json.error as { message?: string })?.message ?? res.status)}`;
    // 401/403 = not signed in, no access to the API (project not approved) or not a manager of the profile.
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new PublishConfigError(msg);
    throw new Error(msg);
  }
  return json;
}

export type GbpLocation = { account: string; location: string; title: string };

/** Every business profile this Google account manages. */
export async function myLocations(token: string): Promise<GbpLocation[]> {
  const acc = await call("GET", `${ACCOUNTS()}/v1/accounts`, token);
  const accounts = (acc.accounts as { name: string }[] | undefined) ?? [];
  const out: GbpLocation[] = [];
  for (const a of accounts) {
    const u = new URL(`${INFO()}/v1/${a.name}/locations`);
    u.searchParams.set("readMask", "name,title");
    u.searchParams.set("pageSize", "100");
    const loc = await call("GET", u.toString(), token);
    for (const l of (loc.locations as { name: string; title?: string }[] | undefined) ?? []) {
      out.push({ account: a.name, location: l.name, title: l.title ?? l.name });
    }
  }
  if (!out.length) throw new PublishConfigError("This Google account manages no Business Profile. Sign in with an owner or manager of the profile.");
  return out;
}

export async function testGoogleBusiness(auth: ChannelAuth): Promise<string> {
  const token = await accessToken(auth.token);
  const all = await myLocations(token);
  return all.find((l) => l.location === auth.config.location)?.title ?? all[0].title;
}

/** Caption -> Business Profile text: no hashtags, max 1500 characters. */
export function gbpSummary(text: string): string {
  const clean = text
    .split("\n")
    .filter((line) => !/^\s*(#\S+\s*)+$/.test(line))
    .join("\n")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > 1500 ? `${clean.slice(0, 1499).trimEnd()}…` : clean;
}

export async function publishGoogleBusiness(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  const { account, location } = auth.config;
  if (!account || !location) throw new PublishConfigError("Connect Google Business Profile again (no location saved).");
  const summary = gbpSummary(input.text);
  if (!summary) throw new PublishConfigError("The caption is empty after removing hashtags.");
  const photo = input.image?.publicUrl && /^https:\/\//.test(input.image.publicUrl) ? input.image.publicUrl : null;
  const body: Record<string, unknown> = { languageCode: input.language ?? "en", summary, topicType: "STANDARD" };
  if (photo) body.media = [{ mediaFormat: "PHOTO", sourceUrl: photo }];
  if (input.link && /^https?:\/\//.test(input.link)) body.callToAction = { actionType: "LEARN_MORE", url: input.link };
  const token = await accessToken(auth.token);
  const out = await call("POST", `${POSTS()}/v4/${account}/${location}/localPosts`, token, body);
  return { externalId: String(out.name ?? ""), url: typeof out.searchUrl === "string" ? out.searchUrl : null };
}
