import { blob, PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * Facebook Page and Instagram (professional account linked to that Page) via the Graph API.
 * Uses a long-lived Page access token with pages_manage_posts (Facebook) and
 * instagram_content_publish (Instagram). Your own Page/account works in Development mode;
 * other people's accounts need Meta App Review.
 */
const GRAPH = () => (process.env.META_GRAPH_URL ?? "https://graph.facebook.com").replace(/\/$/, "");
const VERSION = () => process.env.META_GRAPH_VERSION ?? "v23.0";
const url = (path: string) => `${GRAPH()}/${VERSION()}/${path.replace(/^\//, "")}`;

async function graph(method: "GET" | "POST", path: string, token: string, body?: FormData | Record<string, string>) {
  const target = new URL(url(path));
  let init: RequestInit = { method };
  if (method === "GET") {
    target.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries((body as Record<string, string>) ?? {})) target.searchParams.set(k, v);
  } else if (body instanceof FormData) {
    body.append("access_token", token);
    init = { method, body };
  } else {
    init = { method, body: new URLSearchParams({ ...(body ?? {}), access_token: token }) };
  }
  const res = await fetch(target, init);
  const json = await readJson(res);
  const err = json.error as { message?: string; code?: number } | undefined;
  if (!res.ok || err) {
    const msg = `Meta ${path}: ${err?.message ?? res.status}`;
    // 190 = bad/expired token, 10/200 = missing permission, 100 = wrong id: retrying will not help.
    if (err && [190, 10, 200, 100].includes(Number(err.code))) throw new PublishConfigError(msg);
    throw new Error(msg);
  }
  return json;
}

export async function testFacebook(auth: ChannelAuth): Promise<string> {
  const page = await graph("GET", auth.config.pageId, auth.token, { fields: "name" });
  return String(page.name ?? auth.config.pageId);
}

export async function publishFacebook(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  const pageId = auth.config.pageId;
  if (input.video) {
    const form = new FormData();
    form.append("source", blob(input.video.data, input.video.mime), "reel.mp4");
    form.append("description", input.text);
    const out = await graph("POST", `${pageId}/videos`, auth.token, form);
    return { externalId: String(out.id), url: `https://www.facebook.com/${out.id}` };
  }
  if (input.image) {
    const form = new FormData();
    form.append("source", blob(input.image.data, input.image.mime), "poster.png");
    form.append("message", input.text);
    const out = await graph("POST", `${pageId}/photos`, auth.token, form);
    const id = String(out.post_id ?? out.id);
    return { externalId: id, url: `https://www.facebook.com/${id}` };
  }
  const out = await graph("POST", `${pageId}/feed`, auth.token, { message: input.text });
  return { externalId: String(out.id), url: `https://www.facebook.com/${out.id}` };
}

export async function testInstagram(auth: ChannelAuth): Promise<string> {
  const ig = await graph("GET", auth.config.igUserId, auth.token, { fields: "username" });
  return ig.username ? `@${ig.username}` : auth.config.igUserId;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Instagram fetches the media itself, so it needs a public https URL (Supabase/R2 storage or APP_URL). */
export async function publishInstagram(auth: ChannelAuth, input: PublishInput, opts: { pollMs?: number } = {}): Promise<PublishResult> {
  const ig = auth.config.igUserId;
  const media = input.video ?? input.image;
  if (!media) throw new PublishConfigError("Instagram needs an image or a video.");
  if (!media.publicUrl || !/^https:\/\//.test(media.publicUrl)) {
    throw new PublishConfigError("Instagram needs the poster at a public https link. Use Supabase or R2 storage (STORAGE_DRIVER) or set APP_URL to your public site.");
  }
  const params: Record<string, string> = input.video
    ? { media_type: "REELS", video_url: media.publicUrl, caption: input.text, share_to_feed: "true" }
    : { image_url: media.publicUrl, caption: input.text };
  const container = await graph("POST", `${ig}/media`, auth.token, params);
  const creationId = String(container.id);
  // Videos are processed by Instagram first: wait until the container is ready (max ~5 minutes).
  if (input.video) {
    for (let i = 0; i < 60; i++) {
      const s = await graph("GET", creationId, auth.token, { fields: "status_code" });
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram could not process the video (${s.status_code}).`);
      await sleep(opts.pollMs ?? 5000);
    }
  }
  const out = await graph("POST", `${ig}/media_publish`, auth.token, { creation_id: creationId });
  let link: string | null = null;
  try {
    const p = await graph("GET", String(out.id), auth.token, { fields: "permalink" });
    link = (p.permalink as string) ?? null;
  } catch {
    link = null;
  }
  return { externalId: String(out.id), url: link };
}
