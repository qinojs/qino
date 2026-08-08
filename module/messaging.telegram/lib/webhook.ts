import { Output, safeEqual, unixTime, type App, type Ctx } from "../../core/mod.ts";
import { call, webhookSecret } from "./bot.ts";
import { readLinkToken } from "./link.ts";

/** Telegram's update endpoint. Always answers 200 — any other status only makes Telegram retry. */
export async function webhook(ctx: Ctx): Promise<never> {
  if (ctx.req.method !== "POST") throw new Output("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  // the shared secret is the only authentication Telegram offers, and it is enough
  if (!safeEqual(ctx.req.header("x-telegram-bot-api-secret-token"), await webhookSecret(ctx.app))) throw new Output("Forbidden", { status: 403 });
  await update(ctx.app, ctx.req.body).catch((e) => console.error("[telegram]", e));
  throw new Output(undefined, { status: 200 });
}

/** Only `/start` and `/stop` in a private chat mean anything; everything else is ignored. */
// deno-lint-ignore no-explicit-any
async function update(app: App, up: any): Promise<void> {
  const msg = up?.message;
  if (msg?.chat?.type !== "private") return;
  const chatId = Number(msg.chat.id);
  const [, command, payload] = /^\/(start|stop)(?:\s+(\S+))?/.exec(String(msg.text ?? "")) ?? [];
  if (!command) return;

  if (command === "stop") {
    await app.db.exec`DELETE FROM telegram_chat WHERE chat_id = ${chatId}`;
    return reply(app, chatId, await app.t`You will not receive messages here any more.`);
  }

  const usrId = payload && await readLinkToken(app, payload);
  if (!usrId) return reply(app, chatId, await app.t`This link has expired. Please open it again from your account.`);

  const table = app.db.table("telegram_chat");
  const values = { usr_id: usrId, username: String(msg.chat.username ?? "").slice(0, 64) || null, error: null };
  // linking again re-points the same chat — one Telegram account belongs to one person at a time
  const known = await app.db.one`SELECT id FROM telegram_chat WHERE chat_id = ${chatId}`;
  if (known) await table.update(known, values);
  else await table.insert({ ...values, chat_id: chatId, created: unixTime() });
  await reply(app, chatId, await app.t`Connected. You will receive messages here.`);
}

const reply = async (app: App, chat_id: number, text: string) => void await call(app, "sendMessage", { chat_id, text });
