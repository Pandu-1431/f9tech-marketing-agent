import crypto from "node:crypto";
import { blob, PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * X (Twitter) with the free API tier: OAuth 1.0a user keys from developer.x.com
 * (API key + secret, access token + secret with Read and Write). Posts text + the poster image.
 * The free tier allows a limited number of posts per month.
 */
const API = () => (process.env.X_API_URL ?? "https://api.x.com").replace(/\/$/, "");
const UPLOAD = () => (process.env.X_UPLOAD_URL ?? "https://upload.twitter.com").replace(/\/$/, "");

type Keys = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };

export function parseXKeys(token: string): Keys {
  try {
    const k = JSON.parse(token) as Keys;
    if (k.apiKey && k.apiSecret && k.accessToken && k.accessSecret) return k;
  } catch {
    // fall through
  }
  throw new PublishConfigError("X keys are incomplete: reconnect with all four keys.");
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a Authorization header (HMAC-SHA1). Query parameters are signed; JSON and multipart bodies are not. */
export function oauthHeader(method: string, url: string, keys: Keys, opts: { nonce?: string; timestamp?: string } = {}): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: opts.nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const params = [...Object.entries(oauth), ...[...u.searchParams.entries()]].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const signature = crypto.createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ")}`;
}

async function call(method: "GET" | "POST", url: string, keys: Keys, body?: { json?: unknown; form?: FormData }) {
  const headers: Record<string, string> = { authorization: oauthHeader(method, url, keys) };
  if (body?.json) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body?.json ? JSON.stringify(body.json) : body?.form });
  const json = await readJson(res);
  if (!res.ok) {
    const detail = (json.detail as string) ?? ((json.errors as { message?: string }[])?.[0]?.message ?? res.status);
    const msg = `X: ${detail}`;
    if (res.status === 401 || res.status === 403) throw new PublishConfigError(`${msg} (check the keys have Read and Write access)`);
    throw new Error(msg);
  }
  return json;
}

export async function testX(auth: ChannelAuth): Promise<string> {
  const me = await call("GET", `${API()}/2/users/me`, parseXKeys(auth.token));
  const user = (me.data ?? {}) as Record<string, string>;
  return user.username ? `@${user.username}` : "X account";
}

/** Fit a caption into one post: X counts every link as 23 characters; keep 2 hashtags. */
export function xText(text: string, link?: string | null, limit = 280): string {
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 2);
  const body = text.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/https?:\/\/\S+/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const tail = [link ?? "", tags.join(" ")].filter(Boolean).join("\n");
  const tailLen = (link ? 23 : 0) + (tags.length ? tags.join(" ").length + (link ? 1 : 0) : 0) + (tail ? 2 : 0);
  const room = limit - tailLen;
  const short = body.length <= room ? body : `${body.slice(0, room - 1).replace(/\s+\S*$/, "")}…`;
  return tail ? `${short}\n\n${tail}` : short;
}

export async function publishX(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  const keys = parseXKeys(auth.token);
  let mediaId: string | null = null;
  if (input.image) {
    try {
      const form = new FormData();
      form.append("media", blob(input.image.data, input.image.mime), "poster.png");
      const up = await call("POST", `${UPLOAD()}/1.1/media/upload.json`, keys, { form });
      mediaId = String(up.media_id_string ?? up.media_id ?? "") || null;
    } catch (err) {
      if (err instanceof PublishConfigError) throw err;
      mediaId = null; // the post still goes out, without the picture
    }
  }
  const out = await call("POST", `${API()}/2/tweets`, keys, { json: { text: xText(input.text, input.link), ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) } });
  const id = String((out.data as Record<string, string>)?.id ?? "");
  const handle = auth.config.username?.replace(/^@/, "");
  return { externalId: id, url: id ? `https://x.com/${handle || "i/web"}/status/${id}` : null };
}
