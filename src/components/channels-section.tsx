import type { Brand, Channel } from "@/db/schema";
import { connectChannelAction, removeChannelAction } from "@/app/actions/publishing";
import { ChannelForm } from "./channel-form";
import { PLATFORM_LABELS } from "@/lib/platforms";

/** Where this business publishes: Telegram, Facebook Page, Instagram. */
export function ChannelsSection({ brand, channels }: { brand: Brand; channels: Channel[] }) {
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
      <div className="grid gap-3 md:grid-cols-3">
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
      </div>
    </section>
  );
}
