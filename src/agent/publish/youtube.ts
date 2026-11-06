import { PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * YouTube Shorts via the YouTube Data API v3, connected with "Sign in with Google" (OAuth).
 * The channel stores a refresh token (encrypted); each upload gets a fresh access token.
 *
 * Setup (once): a Google Cloud project with "YouTube Data API v3" enabled and an OAuth client
 * (Web application) whose redirect URI is <app>/api/oauth/google/callback.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 *
 * Note: Google keeps videos uploaded by an unaudited API project PRIVATE until the project
 * passes a YouTube API audit. The upload still works; you can make it public in YouTube Studio.
 */
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const API = () => (process.env.YOUTUBE_API_URL ?? "https://www.googleapis.com").replace(/\/$/, "");

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL());
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // we need a refresh token
  u.searchParams.set("prompt", "consent"); // always return a refresh token
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
  });
  const json = await readJson(res);
  if (!res.ok || json.error) {
    const msg = `Google sign-in: ${String(json.error_description ?? json.error ?? res.status)}`;
    // invalid_grant = the user revoked access or the refresh token expired: connect again.
    if (json.error === "invalid_grant" || json.error === "invalid_client" || res.status === 400 || res.status === 401) {
      throw new PublishConfigError(`${msg}. Click "Connect YouTube" again.`);
    }
    throw new Error(msg);
  }
  return json;
}

/** Callback: code -> refresh token (+ the channel it belongs to). */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string }> {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new PublishConfigError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  return { refreshToken: String(t.refresh_token), accessToken: String(t.access_token) };
}

/** A fresh access token from the channel's refresh token (uploads and the Analyst's reads). */
export async function accessToken(refreshToken: string): Promise<string> {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return String(t.access_token);
}

/** The signed-in user's own channel: { id, title }. */
export async function myChannel(token: string): Promise<{ id: string; title: string }> {
  const res = await fetch(`${API()}/youtube/v3/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${token}` } });
  const json = await readJson(res);
  const item = (json.items as { id: string; snippet?: { title?: string } }[] | undefined)?.[0];
  if (!res.ok || !item) throw new PublishConfigError("This Google account has no YouTube channel. Create the channel first, or sign in with the account that owns it.");
  return { id: item.id, title: item.snippet?.title ?? item.id };
}

export async function testYouTube(auth: ChannelAuth): Promise<string> {
  const ch = await myChannel(await accessToken(auth.token));
  return ch.title;
}

/** Title (max 100 chars, ends with #Shorts) and description from the approved caption. */
export function shortsText(text: string): { title: string; description: string } {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "New video";
  const clean = firstLine.replace(/\s+/g, " ").replace(/[<>]/g, "");
  const tag = " #Shorts";
  const title = (clean.length + tag.length > 100 ? `${clean.slice(0, 100 - tag.length - 1).trimEnd()}…` : clean) + tag;
  return { title, description: text.replace(/[<>]/g, "").slice(0, 4900) };
}

export async function publishYouTube(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  if (!input.video) throw new PublishConfigError("YouTube needs a video: make this post a reel (Make reel), approve it, then publish.");
  const token = await accessToken(auth.token);
  const { title, description } = shortsText(input.text);
  const privacy = process.env.YOUTUBE_PRIVACY ?? "public";
  // 1) start a resumable upload with the video details
  const start = await fetch(`${API()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.video.mime,
      "x-upload-content-length": String(input.video.data.length),
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: process.env.YOUTUBE_CATEGORY_ID ?? "27" /* Education */ },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!start.ok) {
    const json = await readJson(start);
    const msg = `YouTube upload: ${String((json.error as { message?: string })?.message ?? start.status)}`;
    if (start.status === 401 || start.status === 403) throw new PublishConfigError(msg);
    throw new Error(msg);
  }
  const location = start.headers.get("location");
  if (!location) throw new Error("YouTube upload: no upload address returned");
  // 2) send the video bytes
  const put = await fetch(location, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": input.video.mime, "content-length": String(input.video.data.length) },
    body: new Uint8Array(input.video.data),
  });
  const video = await readJson(put);
  if (!put.ok || !video.id) {
    const msg = `YouTube upload: ${String((video.error as { message?: string })?.message ?? put.status)}`;
    if (put.status === 403 && /quota/i.test(msg)) throw new PublishConfigError(`${msg} (daily YouTube API quota used up; try tomorrow)`);
    throw new Error(msg);
  }
  return { externalId: String(video.id), url: `https://youtube.com/shorts/${video.id}` };
}
