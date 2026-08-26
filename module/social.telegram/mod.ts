// Public API of social.telegram. The qino plugin lives in ./plugin.ts.
import { errMsg, unixTime } from "@qino/qino";
import { bot, call } from "@qino/qino/messaging.telegram";
import { ingest, ProviderError } from "@qino/qino/social";

import type { App } from "@qino/qino";
import type { Post, Provider, Target } from "@qino/qino/social";

async function configured(app: App): Promise<Omit<Target, "provider">[]> {
  const source = String(await app.settings["social.telegram"].targets ?? "").trim();
  const ids = [...new Set(source.split(/[\s,]+/).filter(Boolean))];
  return (await Promise.all(ids.map((id) => target(app, id).catch((e) => {
    console.warn(`social.telegram: target ${id} failed —`, errMsg(e));
  })))).flatMap((target) => target ? [target] : []);
}

// deno-lint-ignore no-explicit-any
async function target(app: App, id: string): Promise<Omit<Target, "provider">> {
  const chat: any = await call(app, "getChat", { chat_id: /^-?\d+$/.test(id) ? Number(id) : id });
  const label = String(chat.title ?? chat.username ?? chat.id);
  return {
    id: String(chat.id),
    label,
    ...(chat.username ? { url: `https://t.me/${chat.username}` } : {}),
  };
}

/** A Telegram update already authenticated by messaging.telegram's shared webhook. */
// deno-lint-ignore no-explicit-any
export async function receive(app: App, up: any): Promise<void> {
  const msg = up?.channel_post ?? up?.edited_channel_post ?? up?.message ?? up?.edited_message;
  if (!msg || msg.chat?.type === "private") return;
  const target = (await configured(app)).find((item) => item.id === String(msg.chat.id));
  if (!target) return;
  const me = await bot(app);
  await ingest(app, "telegram", [postOf(target, msg, Number(me.id))]);
}

// deno-lint-ignore no-explicit-any
function postOf(target: Omit<Target, "provider">, msg: any, botId?: number): Post {
  const sender = msg.sender_chat ?? msg.from ?? {};
  const own = botId == null || msg.chat?.type === "channel" || Number(sender.id) === Number(msg.chat?.id) || Number(sender.id) === botId;
  const id = String(msg.message_id);
  return {
    target: target.id,
    id,
    parentId: msg.reply_to_message?.message_id == null ? undefined : String(msg.reply_to_message.message_id),
    own,
    text: String(msg.text ?? msg.caption ?? ""),
    url: target.url ? `${target.url}/${id}` : undefined,
    authorId: sender.id == null ? undefined : String(sender.id),
    authorName: String(sender.title ?? sender.username ?? [sender.first_name, sender.last_name].filter(Boolean).join(" ")) || undefined,
    time: Number(msg.date) || unixTime(),
  };
}

export const socialProvider: Provider = {
  name: "telegram",
  targets: configured,
  async publish(app, target, text) {
    if (!text || text.length > 4096) throw new Error("social.telegram: text must contain 1–4096 characters");
    let msg;
    try {
      msg = await call(app, "sendMessage", { chat_id: Number(target), text });
    } catch (e) {
      const status = Number((e as { status?: number }).status);
      if (status && status < 500 && status !== 429) throw e;
      const retryAfter = Number((e as { retryAfter?: number }).retryAfter) || undefined;
      throw new ProviderError(errMsg(e), retryAfter);
    }
    const username = String(msg.chat?.username ?? "");
    return postOf({ id: target, label: String(msg.chat?.title ?? (username || target)), ...(username ? { url: `https://t.me/${username}` } : {}) }, msg);
  },
};
