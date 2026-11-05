import type { Brand, Channel } from "@/db/schema";
import { connectChannelAction, removeChannelAction } from "@/app/actions/publishing";
import { ChannelForm } from "./channel-form";
import { PLATFORM_LABELS } from "@/lib/platforms";

/** Where this business publishes: Telegram, Facebook Page, Instagram. */
const YOUTUBE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "YouTube connected. Approved reels on YouTube now upload as Shorts." },
  cancelled: { ok: false, text: "You cancelled the Google sign-in. Click Connect YouTube to try again." },
  "no-channel": { ok: false, text: "That Google account has no YouTube channel. Sign in with the account that owns the Chakravyuh channel." },
  expired: { ok: false, text: "The sign-in took too long. Click Connect YouTube again." },
  failed: { ok: false, text: "Google sign-in failed. Check the Google Client ID/Secret and the redirect address, then try again." },
  "not-configured": { ok: false, text: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see the steps)." },
};

export function ChannelsSection({ brand, channels, youtubeReady = false, youtubeStatus }: { brand: Brand; channels: Channel[]; youtubeReady?: boolean; youtubeStatus?: string }) {
  const yt = youtubeStatus ? YOUTUBE_MESSAGES[youtubeStatus] : undefined;
  const ytChannel = channels.find((c) => c.platform === "youtube");
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
              <span className="badge bg-emerald-50 text-emerald-700">{PLATFORM_LABELS[c.platform] ?? c.platform}</span>
              <span className="font-medium">{c.name}</span>
              {c.lastError && <span className="text-xs text-red-700">Last error: {c.lastError.slice(0, 160)}</span>}
              <form action={removeChannelAction.bind(null, brand.id, c.id)} className="ml-auto">
                <button className="text-xs text-red-600 underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
        </div>
      </div>
    </section>
  );
}
