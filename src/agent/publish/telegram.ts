import { blob, PublishConfigError, readJson, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * Telegram channel via the Bot API (free, instant, no app review).
 * Setup: create a bot with @BotFather, add it to the channel as an admin who can post.
 * config.chatId = "@channelname" (public) or the numeric id (-100...).
 */
const API = () => (process.env.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/$/, "");
const CAPTION_LIMIT = 1024;
const MESSAGE_LIMIT = 4096;

async function call(token: string, method: string, body: FormData | Record<string, unknown>) {
  const res = await fetch(`${API()}/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  const json = await readJson(res);
  if (!json.ok) {
    const msg = `Telegram ${method}: ${String(json.description ?? res.status)}`;
    // 400/401/403 = wrong token, wrong chat or the bot is not an admin: retrying will not help.
    if ([400, 401, 403].includes(res.status)) throw new PublishConfigError(msg);
    throw new Error(msg);
  }
  return json.result as Record<string, unknown>;
}

/** Checks the token and the channel; returns a display name ("@channel"). */
export async function testTelegram(auth: ChannelAuth): Promise<string> {
  const me = await call(auth.token, "getMe", {});
  const chat = await call(auth.token, "getChat", { chat_id: auth.config.chatId });
  const name = chat.username ? `@${chat.username}` : String(chat.title ?? auth.config.chatId);
  return `${name} (bot @${me.username})`;
}

function linkFor(chat: Record<string, unknown> | undefined, messageId: unknown): string | null {
  if (!chat || !messageId) return null;
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat.id ?? "");
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

export async function publishTelegram(auth: ChannelAuth, input: PublishInput): Promise<PublishResult> {
  const chatId = auth.config.chatId;
  const text = input.text.slice(0, MESSAGE_LIMIT);
  const media = input.video ?? input.image;
  let result: Record<string, unknown>;
  if (media) {
    const form = new FormData();
    form.append("chat_id", chatId);
    const isVideo = Boolean(input.video);
    form.append(isVideo ? "video" : "photo", blob(media.data, media.mime), isVideo ? "reel.mp4" : "poster.png");
    if (isVideo) form.append("supports_streaming", "true");
    // A long caption goes in its own message right after the picture.
    const fits = text.length <= CAPTION_LIMIT;
    if (fits) form.append("caption", text);
    result = await call(auth.token, isVideo ? "sendVideo" : "sendPhoto", form);
    if (!fits) await call(auth.token, "sendMessage", { chat_id: chatId, text, reply_to_message_id: result.message_id });
  } else {
    result = await call(auth.token, "sendMessage", { chat_id: chatId, text });
  }
  return { externalId: String(result.message_id), url: linkFor(result.chat as Record<string, unknown>, result.message_id) };
}

export type TelegramChat = { id: string; title: string; username: string | null; canPost: boolean };

/**
 * One-paste connect: after the owner adds the bot to their channel as an admin, Telegram tells the
 * bot (my_chat_member update). Read those and list the channels and groups the bot can post in.
 */
export async function findTelegramChats(token: string): Promise<{ bot: string; chats: TelegramChat[] }> {
  const me = await call(token, "getMe", {});
  const updates = (await call(token, "getUpdates", { allowed_updates: ["my_chat_member", "channel_post"], timeout: 0 })) as unknown as Record<string, unknown>[];
  const chats = new Map<string, TelegramChat>();
  for (const u of updates ?? []) {
    const m = (u.my_chat_member ?? null) as Record<string, unknown> | null;
    const post = (u.channel_post ?? null) as Record<string, unknown> | null;
    const chat = ((m?.chat ?? post?.chat) ?? null) as Record<string, unknown> | null;
    if (!chat || (chat.type !== "channel" && chat.type !== "supergroup" && chat.type !== "group")) continue;
    const member = (m?.new_chat_member ?? null) as Record<string, unknown> | null;
    const status = member ? String(member.status) : "administrator";
    if (status === "left" || status === "kicked") {
      chats.delete(String(chat.id));
      continue;
    }
    const canPost = status === "administrator" && (chat.type !== "channel" || member?.can_post_messages !== false);
    chats.set(String(chat.id), { id: String(chat.id), title: String(chat.title ?? chat.username ?? chat.id), username: chat.username ? String(chat.username) : null, canPost });
  }
  return { bot: String(me.username ?? "your bot"), chats: [...chats.values()] };
}

/** A real message in the channel, so the owner sees the connection work. */
export async function sendTelegramHello(auth: ChannelAuth, businessName: string): Promise<void> {
  await call(auth.token, "sendMessage", { chat_id: auth.config.chatId, text: `✅ ${businessName} is connected to MarketingAgent. Approved posts will appear here.` });
}
