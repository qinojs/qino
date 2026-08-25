import { Output, safeEqual, unixTime } from "@qino/qino";
import { record } from "@qino/qino/messaging";

import { call, webhookSecret } from "./bot.ts";
import { readLinkToken } from "./link.ts";

import type { App, Ctx } from "@qino/qino";

/** Telegram's update endpoint. Always answers 200 — any other status only makes Telegram retry. */
export async function webhook(ctx: Ctx): Promise<never> {
  if (ctx.req.method !== "POST") throw new Output("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  // the shared secret is the only authentication Telegram offers, and it is enough
  if (!safeEqual(ctx.req.header("x-telegram-bot-api-secret-token"), await webhookSecret(ctx.app))) throw new Output("Forbidden", { status: 403 });
  await update(ctx.app, ctx.req.body).catch((e) => console.error("[telegram]", e));
  throw new Output(undefined, { status: 200 });
}

/** Journal private messages; `/start` and `/stop` additionally manage the chat link. */
// deno-lint-ignore no-explicit-any
async function update(app: App, up: any): Promise<void> {
  const msg = up?.message;
  if (msg?.chat?.type !== "private") return;
  const chatId = Number(msg.chat.id);
  const [, command, payload] = /^\/(start|stop)(?:\s+(\S+))?/.exec(String(msg.text ?? "")) ?? [];
  const knownUsrId = Number(await app.db.one`SELECT usr_id FROM telegram_chat WHERE chat_id = ${chatId}`) || undefined;
  const linkedUsrId = command === "start" && payload ? await readLinkToken(app, payload) : undefined;
  const usrId = linkedUsrId || knownUsrId;
  await record(app, {
    channel: "telegram",
    direction: "in",
    msg: { text: String(msg.text ?? "") },
    data: { updateId: up.update_id, messageId: msg.message_id, chatId },
    time: Number(msg.date) || unixTime(),
  }, [{ usrId, sent: unixTime() }]);
  if (!command) return;

  if (command === "stop") {
    await app.db.exec`DELETE FROM telegram_chat WHERE chat_id = ${chatId}`;
    return reply(app, chatId, await app.t`You will not receive messages here any more.`, usrId);
  }

  if (!linkedUsrId) return reply(app, chatId, await app.t`This link has expired. Please open it again from your account.`, usrId);

  const table = app.db.table("telegram_chat");
  const values = { usr_id: linkedUsrId, username: String(msg.chat.username ?? "").slice(0, 64) || null, error: null };
  // linking again re-points the same chat — one Telegram account belongs to one person at a time
  const known = await app.db.one`SELECT id FROM telegram_chat WHERE chat_id = ${chatId}`;
  if (known) await table.update(known, values);
  else await table.insert({ ...values, chat_id: chatId, created: unixTime() });
  await reply(app, chatId, await app.t`Connected. You will receive messages here.`, linkedUsrId);
}

async function reply(app: App, chatId: number, text: string, usrId?: number): Promise<void> {
  const time = unixTime();
  let failed = false;
  let failure: unknown;
  try { await call(app, "sendMessage", { chat_id: chatId, text }); } catch (e) { failed = true; failure = e; }
  await record(app, { channel: "telegram", direction: "out", msg: { text }, data: { to: { chat: chatId } }, time }, [{
    usrId,
    error: failure instanceof Error ? failure.message : failure == null ? undefined : String(failure),
    sent: unixTime(),
  }]);
  if (failed) throw failure;
}
