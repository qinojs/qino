import { Db, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, contactDbSchema, emailMessagingChannel as email, fakeT, messagingDbSchema as messageSchema, telegramDbSchema as telegramSchema, telegramMessagingChannel as telegram, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("messaging detail replies to the selected user's Telegram chat", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...telegramSchema.properties, ...contactDbSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, firstname TEXT, lastname TEXT)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "user@qino.test" });
  await db.table("usr_contact").insert({ channel: "email", address: "user@qino.test", usr_id: 1, main: true, created: 1 });
  await db.table("telegram_chat").insert({ usr_id: 1, chat_id: 555, created: 1 });
  const linked = {
    "messaging.telegram": { name: "messaging.telegram", plugin: { messagingChannel: telegram } },
    "messaging.email": { name: "messaging.email", plugin: { messagingChannel: email } },
  };
  const app = {
    db,
    t: fakeT,
    modules: {
      linked: (name?: string) => name === undefined ? Object.values(linked) : linked[name as keyof typeof linked],
      get: (name: string) => linked[name as keyof typeof linked],
    },
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
      const node = {
        app,
        page: () => Promise.resolve({ children: () => Promise.resolve(new Map()), url: () => Promise.resolve("/de/backend/superuser/nachrichten") }),
      } as unknown as Node;
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
    assertStringIncludes(normal, '<option value="email">Email'); // reachable, because the user has an address

    const overview = await render("http://qino.test/de/backend/superuser/nachrichten");
    assertStringIncludes(overview, "<table class=u2-table");
    assertStringIncludes(overview, 'name=search');
    assertStringIncludes(overview, '<option value="telegram">Telegram');
    assertStringIncludes(overview, "Hello");
    assertStringIncludes(overview, "<tbody cms-part=list>");
    assertStringIncludes(overview, "icon=call_made");
    assertStringIncludes(overview, 'href="/de/backend/superuser/nachrichten?msg=1"');
    const detail = await render("http://qino.test/de/backend/superuser/nachrichten?msg=1");
    assertStringIncludes(detail, "user@qino.test");
    assertStringIncludes(detail, "<pre>");

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
