import type { Brand, Channel } from "@/db/schema";
import { connectChannelAction, removeChannelAction, syncSheetNowAction } from "@/app/actions/publishing";
import { ChannelForm } from "./channel-form";
import { PLATFORM_LABELS } from "@/lib/platforms";

/** Where this business publishes (Telegram, Facebook, Instagram, YouTube, Google Business Profile) + its Google Sheet. */
const YOUTUBE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "YouTube connected. Approved reels on YouTube now upload as Shorts." },
  cancelled: { ok: false, text: "You cancelled the Google sign-in. Click Connect YouTube to try again." },
  "no-channel": { ok: false, text: "That Google account has no YouTube channel. Sign in with the account that owns the Chakravyuh channel." },
  expired: { ok: false, text: "The sign-in took too long. Click Connect YouTube again." },
  failed: { ok: false, text: "Google sign-in failed. Check the Google Client ID/Secret and the redirect address, then try again." },
  "not-configured": { ok: false, text: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see the steps)." },
};

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  cancelled: YOUTUBE_MESSAGES.cancelled,
  expired: YOUTUBE_MESSAGES.expired,
  failed: YOUTUBE_MESSAGES.failed,
  "not-configured": YOUTUBE_MESSAGES["not-configured"],
  "no-profile": { ok: false, text: "That Google account manages no Business Profile. Sign in with an owner or manager of the profile." },
  "no-api": { ok: false, text: "Google has not given this project Business Profile API access yet. Request it (free), enable the 3 APIs, then try again." },
};
const GBP_OK = { ok: true, text: "Google Business Profile connected. Approved google_business posts now appear on Google Search and Maps." };
const SHEET_OK = { ok: true, text: "Google Sheet created and filled. It refreshes daily and when you click Sync now." };

export function ChannelsSection({
  brand,
  channels,
  youtubeReady = false,
  youtubeStatus,
  gbpStatus,
  sheetsStatus,
}: {
  brand: Brand;
  channels: Channel[];
  youtubeReady?: boolean;
  youtubeStatus?: string;
  gbpStatus?: string;
  sheetsStatus?: string;
}) {
  const yt = youtubeStatus ? YOUTUBE_MESSAGES[youtubeStatus] : undefined;
  const gbp = gbpStatus ? (gbpStatus === "connected" ? GBP_OK : GOOGLE_MESSAGES[gbpStatus]) : undefined;
  const sheetMsg = sheetsStatus ? (sheetsStatus === "connected" ? SHEET_OK : GOOGLE_MESSAGES[sheetsStatus]) : undefined;
  const ytChannel = channels.find((c) => c.platform === "youtube");
  const gbpChannel = channels.find((c) => c.platform === "google_business");
  const sheet = channels.find((c) => c.platform === "google_sheets");
  return (
    <section className="card space-y-4" data-testid="channels">
      <div>
        <h2 className="font-semibold">Publishing channels</h2>
        <p className="text-sm text-zinc-600">
          Approved posts are published automatically at their scheduled time to the channel of their platform. Tokens are stored encrypted.
        </p>
      </div>
      {channels.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-sm">
          {channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="badge bg-emerald-50 text-emerald-700">{c.platform === "google_sheets" ? "Google Sheet" : (PLATFORM_LABELS[c.platform] ?? c.platform)}</span>
              <span className="font-medium">{c.name}</span>
              {c.platform === "google_sheets" && c.config.url && (
                <a href={c.config.url} target="_blank" rel="noreferrer" className="text-xs underline">Open sheet</a>
              )}
              {c.lastError && <span className="text-xs text-red-700">Last error: {c.lastError.slice(0, 160)}</span>}
              <form action={removeChannelAction.bind(null, brand.id, c.id)} className="ml-auto">
                <button className="text-xs text-red-600 underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <ChannelForm
          title="Telegram channel"
          help={<>Free and instant. 1) In Telegram, open @BotFather → /newbot, copy the token. 2) Add the bot to your channel as an admin who can post. 3) Channel = @yourchannel.</>}
          fields={[
            { name: "token", label: "Bot token", placeholder: "123456789:AA…", secret: true },
            { name: "chatId", label: "Channel", placeholder: "@chakravyuh_upsc" },
          ]}
          action={connectChannelAction.bind(null, brand.id, "telegram")}
        />
        <ChannelForm
          title="Facebook Page"
          help={<>Needs a long-lived Page access token with pages_manage_posts (Meta for Developers → Graph API Explorer). Your own Page works without app review.</>}
          fields={[
            { name: "token", label: "Page access token", placeholder: "EAAG…", secret: true },
            { name: "pageId", label: "Page ID", placeholder: "1234567890" },
          ]}
          action={connectChannelAction.bind(null, brand.id, "facebook")}
        />
        <ChannelForm
          title="Instagram"
          help={<>Professional account linked to your Facebook Page; token with instagram_content_publish. Needs public image storage (Supabase/R2) or APP_URL.</>}
          fields={[
            { name: "token", label: "Page access token", placeholder: "EAAG…", secret: true },
            { name: "igUserId", label: "Instagram account ID", placeholder: "1784…" },
          ]}
          action={connectChannelAction.bind(null, brand.id, "instagram")}
        />
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3" data-testid="youtube-connect">
          <p className="font-medium">YouTube Shorts</p>
          <div className="text-xs text-zinc-600">
            Sign in with the Google account that owns the channel. Approved reels upload as Shorts. Uploads from a new Google project stay
            private until Google&apos;s API audit; make them public in YouTube Studio.
          </div>
          {youtubeReady ? (
            <a href={`/api/oauth/google/start?brandId=${brand.id}`} className="btn-secondary inline-block">
              {ytChannel ? "Reconnect YouTube" : "Connect YouTube"}
            </a>
          ) : (
            <p className="text-xs text-amber-800">Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, then restart the app.</p>
          )}
          {yt && <p className={`text-sm ${yt.ok ? "text-emerald-700" : "text-red-700"}`}>{yt.text}</p>}
          {youtubeReady && (
            <details className="text-xs text-zinc-600" data-testid="youtube-help">
              <summary className="cursor-pointer">Google shows &quot;Error 400&quot; or &quot;Access blocked&quot;?</summary>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>Google Cloud → <b>APIs &amp; Services → Library</b>: enable <b>YouTube Data API v3</b>.</li>
                <li><b>Google Auth Platform → Audience</b>: keep the app in <b>Testing</b> and add the Google account that owns the channel under <b>Test users</b>. If the channel is a <i>brand account</i>, add that too, or pick your main account.</li>
                <li><b>Data Access</b>: add the scopes <code>youtube.upload</code> and <code>youtube.readonly</code>.</li>
                <li><b>Branding</b>: fill app name, support email and developer email, then Save.</li>
                <li><b>Clients → your web client</b>: redirect URI <code>{"<this address>"}/api/oauth/google/callback</code> (e.g. http://localhost:3000/...).</li>
                <li>A Google Workspace address (your own domain) may have YouTube turned off by its admin: try a Gmail account that owns the channel.</li>
              </ol>
              <p className="mt-1">Still blocked? Click &quot;Error 400&quot; on Google&apos;s page: the line under it names the exact reason.</p>
            </details>
          )}
        </div>
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3" data-testid="gbp-connect">
          <p className="font-medium">Google Business Profile</p>
          <div className="text-xs text-zinc-600">
            Posts show on Google Search and Maps for your business. Sign in with an owner or manager of the profile. Google must approve your
            Cloud project for the Business Profile APIs first (free request, a few days). Photos need public storage (Supabase/R2) or APP_URL.
          </div>
          {youtubeReady ? (
            <a href={`/api/oauth/google/start?brandId=${brand.id}&service=gbp`} className="btn-secondary inline-block">
              {gbpChannel ? "Reconnect Business Profile" : "Connect Business Profile"}
            </a>
          ) : (
            <p className="text-xs text-amber-800">Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, then restart the app.</p>
          )}
          {gbp && <p className={`text-sm ${gbp.ok ? "text-emerald-700" : "text-red-700"}`}>{gbp.text}</p>}
        </div>
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3" data-testid="sheets-connect">
          <p className="font-medium">Google Sheet tracker</p>
          <div className="text-xs text-zinc-600">
            Keeps every post (date, platform, status, link, likes, reach…) in a Google Sheet your team can open. The app can only see sheets it created.
          </div>
          {youtubeReady ? (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/oauth/google/start?brandId=${brand.id}&service=sheets`} className="btn-secondary inline-block">
                {sheet ? "Make a new sheet" : "Connect Google Sheet"}
              </a>
              {sheet && (
                <form action={syncSheetNowAction.bind(null, brand.id)}>
                  <button className="btn-secondary" type="submit">Sync now</button>
                </form>
              )}
            </div>
          ) : (
            <p className="text-xs text-amber-800">Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, then restart the app.</p>
          )}
          {sheetMsg && <p className={`text-sm ${sheetMsg.ok ? "text-emerald-700" : "text-red-700"}`}>{sheetMsg.text}</p>}
        </div>
      </div>
    </section>
  );
}
