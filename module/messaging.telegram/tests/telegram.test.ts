import { assert, assertEquals, testContext } from "../../core/tests/deps.ts";
import { Db, Output, unixTime, type Ctx } from "../../core/mod.ts";
import { dbSchema as messageSchema } from "../../messaging/tests/deps.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { linkToken, readLinkToken } from "../lib/link.ts";
import { webhook } from "../lib/webhook.ts";
import { send } from "../mod.ts";

const SECRET = "test-secret";

async function makeDb(): Promise<Db> {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...dbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "user@qino.test" });
  return db;
}

/** Minimal `app.t`: substitutes the interpolated values, no lookup. */
const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));

const makeApp = (db?: Db) => ({
  db,
  t,
  settings: { "messaging.telegram": { botToken: "123456:test-token", webhookSecret: SECRET } },
  // deno-lint-ignore no-explicit-any
}) as any;

/** Collect every Bot API call and answer each with the next queued reply. */
function fakeTelegram(replies: unknown[] = []) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: String(input).split("/").pop()!, params: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies.shift() ?? { ok: true, result: {} };
    return Promise.resolve(new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } }));
  };
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const update = (db: Db, message: unknown, secret = SECRET): Promise<Ctx> =>
  testContext({
    url: "http://qino.test/telegram/webhook",
    method: "POST",
    body: JSON.stringify({ message }),
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    app: makeApp(db),
  });

/** The webhook always signals via a thrown `Output`; capture it. */
async function run(ctx: Ctx | Promise<Ctx>) {
  try {
    await webhook(await ctx);
  } catch (e) {
    if (e instanceof Output) return e.status;
    throw e;
  }
  throw new Error("expected an Output signal");
}

const startMessage = (payload: string, chatId = 555) =>
  ({ chat: { id: chatId, type: "private", username: "someone" }, text: `/start ${payload}` });

Deno.test("link token round-trips and rejects anything else", async () => {
  const app = makeApp();
  const token = await linkToken(app, 42);
  assert(/^[A-Za-z0-9_-]{1,64}$/.test(token), `payload not deep-link safe: ${token}`);
  assertEquals(await readLinkToken(app, token), 42);

  const [usr, exp, ...sig] = token.split("-");
  assertEquals(usr, "42");
  assertEquals(await readLinkToken(app, `43-${exp}-${sig.join("-")}`), undefined, "another user's id must not verify");
  assertEquals(await readLinkToken(app, `${usr}-${Number(exp) + 60}-${sig.join("-")}`), undefined, "extended expiry must not verify");
  assertEquals(await readLinkToken(app, `${usr}-${unixTime() - 1}-${sig.join("-")}`), undefined, "expired token");
  assertEquals(await readLinkToken(app, "hello"), undefined);

  const other = makeApp();
  other.settings["messaging.telegram"].botToken = "999:other-bot";
  assertEquals(await readLinkToken(other, token), undefined, "a token of another bot must not verify");
});

Deno.test("webhook only accepts POST carrying the secret", async () => {
  const db = await makeDb();
  const bot = fakeTelegram();
  try {
    assertEquals(await run(update(db, startMessage("x"), "wrong")), 403);
    assertEquals(await run(testContext({ url: "http://qino.test/telegram/webhook", app: makeApp(db) })), 405);
    assertEquals(bot.calls.length, 0);
  } finally {
    bot.restore();
  }
});

Deno.test("/start links the chat, links again, and /stop unlinks it", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  const bot = fakeTelegram();
  try {
    assertEquals(await run(update(db, startMessage(await linkToken(app, 1)))), 200);
    const linked = await db.row`SELECT usr_id, chat_id, username FROM telegram_chat`;
    assertEquals([linked?.usr_id, Number(linked?.chat_id), linked?.username], [1, 555, "someone"]);

    // an expired link is answered, not stored
    await db.table("usr").insert({ email: "second@qino.test" });
    assertEquals(await run(update(db, startMessage("42-1-nope", 556))), 200);
    assertEquals((await db.query`SELECT id FROM telegram_chat`).length, 1);

    // the same chat linking to another account re-points the single row
    assertEquals(await run(update(db, startMessage(await linkToken(app, 2)))), 200);
    const rows = await db.query`SELECT usr_id FROM telegram_chat`;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].usr_id, 2);

    assertEquals(await run(update(db, { chat: { id: 555, type: "private" }, text: "/stop" })), 200);
    assertEquals((await db.query`SELECT id FROM telegram_chat`).length, 0);
  } finally {
    bot.restore();
  }
});

Deno.test("a linked user's incoming Telegram message is journaled for the conversation", async () => {
  const db = await makeDb();
  await db.table("telegram_chat").insert({ usr_id: 1, chat_id: 555, created: unixTime() });
  const bot = fakeTelegram();
  try {
    assertEquals(await run(update(db, {
      message_id: 9,
      date: 123,
      chat: { id: 555, type: "private", username: "someone" },
      text: "Hello back",
    })), 200);
    const row = await db.row`
      SELECT m.channel, m.direction, m.data, d.usr_id
      FROM message m JOIN message_delivery d ON d.message_id = m.id`;
    assertEquals([row?.channel, row?.direction, row?.usr_id], ["telegram", "in", 1]);
    assertEquals(JSON.parse(String(row?.data)).text, "Hello back");
  } finally {
    bot.restore();
  }
});

Deno.test("send delivers, clears a stale error and drops a chat that blocked the bot", async () => {
  const db = await makeDb();
  const app = makeApp(db);
  await db.table("telegram_chat").insert({ usr_id: 1, chat_id: 555, created: unixTime(), error: "500: earlier" });
  const bot = fakeTelegram([{ ok: true, result: {} }]);
  try {
    assertEquals(await send(app, { usr: 1 }, { text: "hi", parse_mode: "HTML" }), 1);
    assertEquals(bot.calls[0].method, "sendMessage");
    assertEquals(bot.calls[0].params, { text: "hi", parse_mode: "HTML", chat_id: 555 });
    assertEquals((await db.row`SELECT error FROM telegram_chat`)?.error, null);
  } finally {
    bot.restore();
  }

  const blocked = fakeTelegram([{ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }]);
  try {
    assertEquals(await send(app, { all: true }, { text: "hi" }), 0);
    assertEquals((await db.query`SELECT id FROM telegram_chat`).length, 0, "a blocked chat is removed");
  } finally {
    blocked.restore();
  }
});
