// Public API of messaging.telegram. The qino plugin lives in ./plugin.ts.
import { hee, sql, unixTime } from "@qino/qino";
import { delivered, msgOf, record, renderer, unsubscribeGroup } from "@qino/qino/messaging";

import { BotError, call, getMe, webhookSecret } from "./lib/bot.ts";
import { linkToken } from "./lib/link.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "@qino/qino/messaging";

/**
 * Deliver a message to groups, users, chats, or everyone who linked their account.
 *
 * Resolves with the number of chats reached; chats the bot was blocked in are removed on the
 * way. A `format` becomes Telegram's own HTML subset — no headings, no lists, so those arrive as
 * bold lines and bullets. Everything besides `title`, `text` and `format` reaches sendMessage()
 * as is: `reply_markup`, `disable_notification` and friends, and an explicit `parse_mode` still
 * hands the text over untouched. A `title` becomes the first line, bold when markup is on.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number | number[]; all?: true; chat?: number | number[] },
  message: string | Msg & Record<string, unknown>,
): Promise<number> {
  const msg = msgOf(message);
  const chats = [to.chat ?? []].flat();
  const usrs = [to.usr ?? []].flat();
  const who = [
    to.grp != null ? sql`c.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})` : null,
    usrs.length ? sql`c.usr_id IN (${sql.join(usrs.map((id) => sql`${id}`), ", ")})` : null,
    chats.length ? sql`c.id IN (${sql.join(chats.map((id) => sql`${id}`), ", ")})` : null,
    to.all ? sql`${true}` : null,
  ].flatMap((term) => term ?? []);
  if (!who.length) throw new Error("send needs a recipient: { grp }, { usr }, { chat } or { all: true }");
  const where = sql`WHERE ${sql.join(who, " OR ")}`;
  const time = unixTime();

  const [rows, { render }] = await Promise.all([
    app.db.query`SELECT c.id, c.usr_id, c.chat_id, c.error, u.given_name, u.family_name, u.organization, u.username
      FROM telegram_chat c LEFT JOIN usr u ON u.id = c.usr_id ${where}`,
    renderer(app, msg, "telegram", "telegram"),
  ]);

  // Telegram has no title of its own; it becomes the first line, bold where markup is on
  const { text, title, format: _format, template: _template, attachments: _attachments, ...extra } = msg;
  const own = Boolean(extra.parse_mode); // an own parse_mode owns the text, escaping included
  const params = async (recipient: Row, deliveryId: number) => {
    const usrId = Number(recipient.usr_id);
    const { text: plain, html } = await render({ ...recipient, usrId, deliveryId, grpId: leavable(usrId) });
    const body = own ? text : html ?? plain;
    const head = title ? (html || extra.parse_mode === "HTML" ? `<b>${hee(title)}</b>` : title) : "";
    return { ...extra, ...(!own && html ? { parse_mode: "HTML" } : {}), text: head ? `${head}\n${body}` : body };
  };
  const leavable = await unsubscribeGroup(app, to.grp, rows.map((row) => Number(row.usr_id)));
  const table = app.db.table("telegram_chat");
  const gone: number[] = [];
  const { ids } = await record(app, { channel: "telegram", direction: "out", grpId: to.grp, msg, data: { to }, time },
    rows.map((row) => ({ usrId: Number(row.usr_id), address: String(row.chat_id), due: time })));
  let sent = 0;
  const deliver = async (row: Row, i: number) => {
    try {
      await sendMessage(app, { ...await params(row, ids[i]), chat_id: Number(row.chat_id) });
      await delivered(app, ids[i]);
      sent++;
      if (row.error) await table.update(row.id, { error: null }); // it delivers again
    } catch (e) {
      // 403 = blocked or deactivated, 400 "chat not found" = the chat is gone for good
      const status = e instanceof BotError ? e.status : 0;
      const reason = (e as Error).message;
      const error = `${status || "no status"}: ${reason}`;
      await delivered(app, ids[i], error);
      if (status === 403 || (status === 400 && /chat not found/i.test(reason))) return void gone.push(Number(row.id));
      console.warn(`telegram: chat ${row.id} rejected —`, reason);
      await table.update(row.id, { error: error.slice(0, 255) });
    }
  };
  // Telegram takes about 30 messages a second across chats — one batch per second stays under that
  for (let i = 0; i < rows.length; i += 25) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    await Promise.all(rows.slice(i, i + 25).map((row, j) => deliver(row, i + j)));
  }
  if (gone.length) await app.db.exec`DELETE FROM telegram_chat WHERE id IN (${sql.join(gone.map((id) => sql`${id}`))})`;
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
  await call(app, "setWebhook", { url, secret_token: await webhookSecret(app), allowed_updates: ["message"] });
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
