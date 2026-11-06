import { PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * LinkedIn personal profile with the free "Share on LinkedIn" product (scope w_member_social,
 * plus openid + profile to know who is posting). Paste an access token from LinkedIn's token
 * generator (valid 60 days). Company pages need LinkedIn's Community Management API approval.
 */
const API = () => (process.env.LINKEDIN_API_URL ?? "https://api.linkedin.com").replace(/\/$/, "");

/** LinkedIn's versioned API wants a recent YYYYMM (two months back is always supported). */
export function linkedinVersion(now = new Date()): string {
  if (process.env.LINKEDIN_VERSION) return process.env.LINKEDIN_VERSION;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": linkedinVersion(),
      "x-restli-protocol-version": "2.0.0",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(res);
  if (!res.ok) {
    const msg = `LinkedIn ${path}: ${(json.message as string) ?? res.status}`;
    if (res.status === 401 || res.status === 403) throw new PublishConfigError(`${msg} (the token may have expired: LinkedIn tokens last 60 days)`);
    throw new Error(msg);
  }
  return { json, res };
}

async function me(token: string): Promise<{ urn: string; name: string }> {
  const { json } = await call("GET", "/v2/userinfo", token);
  if (!json.sub) throw new PublishConfigError("LinkedIn token is missing the openid/profile scopes.");
  return { urn: `urn:li:person:${json.sub}`, name: String(json.name ?? "LinkedIn profile") };
}

export async function testLinkedIn(auth: ChannelAuth): Promise<string> {
  return (await me(auth.token)).name;
}

/** LinkedIn's post text format treats these characters as markup: escape them so the text shows as written. */
export function littleText(s: string): string {
  return s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

export async function publishLinkedIn(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  const { urn } = await me(auth.token);
  let image: string | null = null;
  if (input.image) {
    const { json } = await call("POST", "/rest/images?action=initializeUpload", auth.token, { initializeUploadRequest: { owner: urn } });
    const value = (json.value ?? {}) as Record<string, string>;
    if (value.uploadUrl && value.image) {
      const up = await fetch(value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${auth.token}` }, body: new Uint8Array(input.image.data) });
      if (up.ok) image = value.image;
    }
  }
  const text = [input.text, input.link && !input.text.includes(input.link) ? input.link : ""].filter(Boolean).join("\n\n").slice(0, 2900);
  const { res } = await call("POST", "/rest/posts", auth.token, {
    author: urn,
    commentary: littleText(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    ...(image ? { content: { media: { id: image } } } : {}),
  });
  const id = res.headers.get("x-restli-id") ?? "";
  return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
}
