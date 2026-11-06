"use client";

import { useActionState } from "react";
import type { TelegramFindState } from "@/app/actions/publishing";

/** Telegram in two steps: paste the bot token, pick your channel. A real hello message proves it works. */
export function TelegramConnect({ action, connected }: { action: (prev: TelegramFindState, formData: FormData) => Promise<TelegramFindState>; connected?: string | null }) {
  const [state, formAction, pending] = useActionState<TelegramFindState, FormData>(action, undefined);
  const token = state?.token ?? "";
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3" data-testid="telegram-connect">
      <p className="font-medium">Telegram channel {connected && <span className="badge ml-1 bg-emerald-50 text-emerald-700">connected</span>}</p>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-zinc-600">
        <li>In Telegram open <b>@BotFather</b> → send <code>/newbot</code> → copy the token it gives you.</li>
        <li>Open your channel → Administrators → <b>Add admin</b> → pick your new bot → allow <b>Post messages</b>.</li>
        <li>Paste the token here and click <b>Find my channel</b>.</li>
      </ol>
      <form action={formAction} className="space-y-2">
        <input className="input" name="token" type="password" placeholder="123456789:AAE…" defaultValue={token} autoComplete="off" required />
        <button className="btn-secondary" disabled={pending}>{pending ? "Looking…" : "Find my channel"}</button>
      </form>

      {state?.chats && (
        <div className="space-y-2" data-testid="telegram-chats">
          {state.chats.length === 0 ? (
            <p className="text-sm text-amber-800">
              @{state.bot} is not in any channel yet. Add it as an admin of your channel (step 2), then click Find my channel again. Or type the
              channel name:
            </p>
          ) : (
            <p className="text-sm text-zinc-700">@{state.bot} can see these. Pick the one for this business:</p>
          )}
          {state.chats.map((c) => (
            <form key={c.id} action={formAction} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="chatId" value={c.username ? `@${c.username}` : c.id} />
              <span className="flex-1 text-sm">
                <b>{c.title}</b> {c.username && <span className="text-zinc-500">@{c.username}</span>}
                {!c.canPost && <span className="block text-xs text-amber-700">The bot is not allowed to post here yet.</span>}
              </span>
              <button className="btn" disabled={pending}>Use this</button>
            </form>
          ))}
          <form action={formAction} className="flex gap-2">
            <input type="hidden" name="token" value={token} />
            <input className="input" name="chatId" placeholder="@yourchannel" />
            <button className="btn-secondary" disabled={pending}>Connect</button>
          </form>
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700" data-testid="telegram-ok">✓ {state.ok}</p>}
    </div>
  );
}
