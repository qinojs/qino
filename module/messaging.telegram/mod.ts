// Public API of messaging.telegram. The qino plugin lives in ./plugin.ts.
import { hee, sql } from "@qino/qino";
import { ChannelError, delivered, send as dispatch, selectors } from "@qino/qino/messaging";

import { BotError, call, getMe, webhookSecret } from "./lib/bot.ts";
import { linkToken } from "./lib/link.ts";

import type { App, Row } from "@qino/qino";
import type { Channel, Msg, Recipient, Rendering, To } from "@qino/qino/messaging";

export { call } from "./lib/bot.ts";

/** Who a `to` means as chats — a chat exists only where someone linked their account. */
async function recipients(app: App, to: To & { chat?: number | number[] }): Promise<Recipient[]> {
  const chats = [to.chat ?? []].flat();
  const who = [
    ...selectors(to, "c.usr_id"),
    ...chats.length ? [sql.in("c.id", chats)] : [],
  ];
  if (!who.length) throw new Error("send needs a recipient: { grp }, { usr }, { chat } or { all: true }");
  const rows = await app.db.query`SELECT c.usr_id, c.chat_id FROM telegram_chat c WHERE ${sql.join(who, " OR ")}`;
  return rows.map((row) => ({ ...row, address: String(row.chat_id), usrId: Number(row.usr_id) || undefined }));
}

/**
 * Message groups, users, chats, or everyone who linked their account.
 *
 * Resolves with the number of chats reached; chats the bot was blocked in are removed on the
 * way. A `format` becomes Telegram's own HTML subset — no headings, no lists, so those arrive as
 * bold lines and bullets. A `title` becomes the first line, bold when markup is on.
 */
export const send = (app: App, to: To & { chat?: number | number[] }, message: string | Msg): Promise<number> =>
  dispatch(app, messagingChannel, to, message);

/** Telegram has no title of its own; it becomes the first line, bold where the body is markup.
 *  `parse_mode` follows from what the renderer produced — a caller says `format`, never the wire. */
function telegramText(msg: Msg, rendered: { text: string; html?: string }): { text: string; parse_mode?: string } {
  const body = rendered.html ?? rendered.text;
  const head = msg.title ? (rendered.html ? `<b>${hee(msg.title)}</b>` : msg.title) : "";
  return { ...(rendered.html ? { parse_mode: "HTML" } : {}), text: head ? `${head}\n${body}` : body };
}

/** One batch of messages, paced: Telegram takes about 30 a second across chats. */
async function deliver(app: App, rows: Row[], msg: Msg, { render }: Rendering): Promise<number> {
  const table = app.db.table("telegram_chat");
  const known = new Map((await app.db.query`SELECT id, chat_id, error FROM telegram_chat
    WHERE ${sql.in("chat_id", rows.map((row) => Number(row.address)))}`).map((chat) => [String(chat.chat_id), chat]));
  const gone: number[] = [];
  let sent = 0;
  const one = async (row: Row) => {
    const chat = known.get(String(row.address));
    try {
      await sendMessage(app, { ...telegramText(msg, await render(row)), chat_id: Number(row.address) });
      await delivered(app, Number(row.id));
      sent++;
      if (chat?.error) await table.update(chat.id, { error: null }); // it delivers again
    } catch (e) {
      // 403 = blocked or deactivated, 400 "chat not found" = the chat is gone for good
      const status = e instanceof BotError ? e.status : 0;
      const reason = (e as Error).message;
      const error = `${status || "no status"}: ${reason}`;
      await delivered(app, Number(row.id), e instanceof ChannelError ? e : error);
      if (!chat) return;
      if (status === 403 || (status === 400 && /chat not found/i.test(reason))) return void gone.push(Number(chat.id));
      console.warn(`telegram: chat ${chat.id} rejected —`, reason);
      await table.update(chat.id, { error: error.slice(0, 255) });
    }
  };
  // one batch per second stays under Telegram's rate
  for (let i = 0; i < rows.length; i += 25) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    await Promise.all(rows.slice(i, i + 25).map(one));
  }
  if (gone.length) await app.db.exec`DELETE FROM telegram_chat WHERE ${sql.in("id", gone)}`;
  return sent;
}

/** One retry on 429 — the answer carries how long to wait, and waiting is the documented fix. */
async function sendMessage(app: App, params: Record<string, unknown>) {
  try {
    await call(app, "sendMessage", params);
  } catch (e) {
    const wait = e instanceof BotError ? e.retryAfter : undefined;
    if (!wait || wait > 60) throw e;
    await new Promise((r) => setTimeout(r, wait * 1000));
    await call(app, "sendMessage", params);
  }
}

/** Where to send a user so the bot may write to them — the deep link carrying the signed token. */
export async function linkUrl(app: App, usrId: number): Promise<string> {
  const me = await getMe(app);
  return `https://t.me/${me.username}?start=${await linkToken(app, usrId)}`;
}

/** The bot behind the configured token — throws when no token is set. */
// deno-lint-ignore no-explicit-any
export function bot(app: App): Promise<any> {
  return getMe(app);
}

/** The chats one user linked — usually one, two when they connected a second Telegram account. */
export function userChats(app: App, usrId: number): Promise<Row[]> {
  return app.db.query`SELECT id, chat_id, username, created, error FROM telegram_chat WHERE usr_id = ${usrId} ORDER BY created`;
}

/** Every linked chat with its user's e-mail. */
export function chats(app: App, limit = 500): Promise<Row[]> {
  return app.db.query`
    SELECT c.*, u.username
    FROM telegram_chat c
    LEFT JOIN usr u ON u.id = c.usr_id
    ORDER BY c.created DESC LIMIT ${limit}`;
}

/** Forget one chat. */
export async function removeChat(app: App, id: number): Promise<void> {
  await app.db.table("telegram_chat").delete(id);
}

/** Point Telegram at this app's webhook route — `url` must be public HTTPS. */
export async function setWebhook(app: App, url: string): Promise<void> {
  await call(app, "setWebhook", {
    url,
    secret_token: await webhookSecret(app),
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
  });
}

/** Stop Telegram from delivering updates. Linked chats keep working — only `/start` stops arriving. */
export async function deleteWebhook(app: App): Promise<void> {
  await call(app, "deleteWebhook", {});
}

/** What Telegram thinks the webhook is: `url`, `pending_update_count`, `last_error_message`, … */
// deno-lint-ignore no-explicit-any
export function webhookInfo(app: App): Promise<any> {
  return call(app, "getWebhookInfo");
}

/** The channel this module is. */
export const messagingChannel: Channel = {
  name: "telegram",
  label: "Telegram",
  color: "--blue",
  profile: "telegram",
  reach: async (app: App, usrId: number) => Number(await app.db.one`SELECT COUNT(*) FROM telegram_chat WHERE usr_id = ${usrId}`),
  recipients,
  send,
  deliver,
};
