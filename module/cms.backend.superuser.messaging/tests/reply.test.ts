import { assertEquals, assertStringIncludes, fakeT, testContext } from "../../core/tests/deps.ts";
import { Db, requestStorage } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";
import { dbSchema as messageSchema } from "../../messaging/tests/deps.ts";
import { dbSchema as telegramSchema, messagingChannel as telegram } from "../../messaging.telegram/tests/deps.ts";
import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";
import { messagingChannel as email } from "../../mail/tests/deps.ts";

Deno.test("messaging detail replies to the selected user's Telegram chat", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...telegramSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, firstname TEXT, lastname TEXT)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER)`;
  await db.exec`CREATE TABLE mail (id INTEGER PRIMARY KEY AUTOINCREMENT, log_id INTEGER, subject TEXT, text TEXT, html TEXT)`;
  await db.exec`CREATE TABLE mail_recipient (mail_id INTEGER, email TEXT, usr_id INTEGER, sent INTEGER, opened INTEGER, error TEXT)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "user@qino.test" });
  await db.table("telegram_chat").insert({ usr_id: 1, chat_id: 555, created: 1 });
  await db.exec`INSERT INTO mail (subject, text, html) VALUES (${"Earlier mail"}, ${"Mail body"}, ${""})`;
  await db.exec`INSERT INTO mail_recipient (mail_id, email, usr_id, sent, opened, error)
    VALUES (${1}, ${"user@qino.test"}, ${null}, ${2}, ${0}, ${""})`;
  const linked = {
    "messaging.telegram": { name: "messaging.telegram", plugin: { messagingChannel: telegram } },
    mail: { name: "mail", plugin: { messagingChannel: email } },
  };
  const app = {
    db,
    t: fakeT,
    modules: { all: () => linked, linked: () => true, get: (name: string) => linked[name as keyof typeof linked] },
    settings: { "messaging.telegram": { botToken: "123:test", webhookSecret: "secret" } },
  };
  const original = globalThis.fetch;
  let request: Record<string, unknown> | undefined;
  globalThis.fetch = (_input, init) => {
    request = JSON.parse(String(init?.body));
    return Promise.resolve(Response.json({ ok: true, result: {} }));
  };
  try {
    assertEquals(await api({ app } as unknown as Node, { reply: { usr: "1", channel: "telegram", text: " Hello " } }), {
      ok: true,
      message: "Delivered over Telegram (1).",
    });
    assertEquals(request, { text: "Hello", chat_id: 555 });
    assertEquals(await db.one`SELECT direction FROM message`, "out");
    assertEquals(await db.one`SELECT usr_id FROM message_delivery`, 1);
    assertEquals(await api({ app } as unknown as Node, { reply: { usr: "2", channel: "telegram", text: "Hello" } }), {
      ok: false,
      message: "User not found.",
    });

    const render = async (url: string) => {
      const ctx = await testContext({ url, app });
      const node = { app, page: () => Promise.resolve({ children: () => Promise.resolve(new Map()) }) } as unknown as Node;
      return requestStorage.run(ctx, () => cms.node.render(node).then(String));
    };
    const normal = await render("http://qino.test/de/backend/superuser/nachrichten?usr=1");
    assertStringIncludes(normal, 'action="/de/backend/superuser/nachrichten"');
    assertStringIncludes(normal, '<option value="1" selected>');
    assertStringIncludes(normal, "data-reply");
    assertStringIncludes(normal, "class=-chat");
    assertStringIncludes(normal, 'class="-platform"');
    assertStringIncludes(normal, "<u2-time");
    assertStringIncludes(normal, '<option value="telegram" selected>');
    assertStringIncludes(normal, 'class=u2-badge style="--color-dark:var(--blue)">Telegram');
    assertStringIncludes(normal, 'class=u2-badge style="--color-dark:var(--orange)">Email');
    assertStringIncludes(normal, "Earlier mail");
    assertStringIncludes(normal, "Mail body");

    const editmode = await render("http://qino.test/?cmspid=410&lang=de&usr=1");
    assertStringIncludes(editmode, 'action="/"');
    assertStringIncludes(editmode, 'name="cmspid" value="410"');
    assertStringIncludes(editmode, 'name="lang" value="de"');
    assertStringIncludes(editmode, '<option value="1" selected>');
  } finally {
    globalThis.fetch = original;
    await db.close();
  }
});
