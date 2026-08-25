import { Db, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, contactDbSchema, emailMessagingChannel as email, fakeT, messagingDbSchema as messageSchema, telegramDbSchema as telegramSchema, telegramMessagingChannel as telegram, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { backendDashboardWidget, cms, render } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("messaging detail replies to the selected user's Telegram chat", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...telegramSchema.properties, ...contactDbSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, given_name TEXT, family_name TEXT, organization TEXT)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER)`;
  await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, mime TEXT, size INTEGER)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "user@qino.test" });
  await db.table("usr_contact").insert({ type: "email", address: "user@qino.test", usr_id: 1, main: true, created: 1 });
  await db.table("telegram_chat").insert({ usr_id: 1, chat_id: 555, created: 1 });
  const linked = {
    "messaging.telegram": { name: "messaging.telegram", plugin: { messagingChannel: telegram } },
    "messaging.email": { name: "messaging.email", plugin: { messagingChannel: email } },
  };
  const fileUrls: Record<string, unknown>[] = [];
  const app = {
    db,
    t: fakeT,
    url: () => Promise.resolve("https://qino.test/"),
    modules: {
      linked: (name?: string) => name === undefined ? Object.values(linked) : linked[name as keyof typeof linked],
      get: (name: string) => linked[name as keyof typeof linked],
    },
    dbFiles: {
      file: (id: number) => Promise.resolve({
        url: (params: Record<string, unknown>) => {
          fileUrls.push(params);
          return Promise.resolve(params.dl ? `/dbFile/${id}/download` : `/dbFile/${id}/preview.avif`);
        },
      }),
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
    const fileId = await db.table("file").insert({ name: "invoice.png", mime: "image/png", size: 7 });
    await db.table("message_attachment").insert({ message_id: 1, file_id: fileId, sort: 0 });

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
    assertStringIncludes(normal, "invoice.png");
    assertStringIncludes(normal, "/dbFile/1/preview.avif");
    assertStringIncludes(normal, "/dbFile/1/download");

    const overview = await render("http://qino.test/de/backend/superuser/nachrichten");
    assertStringIncludes(overview, "<table class=u2-table");
    assertStringIncludes(overview, 'name=search');
    assertStringIncludes(overview, '<option value="telegram">Telegram');
    assertStringIncludes(overview, "Hello");
    assertStringIncludes(overview, "<tbody cms-part=list>");
    assertStringIncludes(overview, "icon=call_made");
    assertStringIncludes(overview, 'href="/de/backend/superuser/nachrichten?msg=1"');
    assertStringIncludes(overview, "<td data-attachments>1");
    const widget = String(await backendDashboardWidget(app as never, {
      url: () => Promise.resolve("/de/backend/superuser/nachrichten"),
    } as never));
    assertStringIncludes(widget, "messages in 7 days");
    assertStringIncludes(widget, 'class=u2-badge style="--color-dark:var(--blue)">Telegram');
    assertStringIncludes(widget, 'href="/de/backend/superuser/nachrichten?msg=1"');
    assertStringIncludes(widget, "Hello");
    const detail = await render("http://qino.test/de/backend/superuser/nachrichten?msg=1");
    assertStringIncludes(detail, "user@qino.test");
    assertStringIncludes(detail, "<pre>");
    assertStringIncludes(detail, "invoice.png");
    assertStringIncludes(detail, "/dbFile/1/preview.avif");
    assertStringIncludes(detail, "/dbFile/1/download");
    assertStringIncludes(detail, "<div class=-head>Links</div>");
    assertStringIncludes(detail, "<tr><td colspan=3>No links yet.");
    assertEquals(fileUrls.every((params) => params.grant === "session"), true);

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

Deno.test("the message detail counts opens and clicks, and lists what was reached", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messageSchema.properties, ...contactDbSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, given_name TEXT, family_name TEXT, organization TEXT)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, mime TEXT, size INTEGER)`;
  await db.exec`CREATE TABLE shorturl (code TEXT PRIMARY KEY, url TEXT, hits INTEGER)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "user@qino.test" });
  await db.table("usr").insert({ username: "second@qino.test" });
  await db.table("message").insert({ channel: "email", direction: "out", data: "null", time: 1 });
  await db.table("message_delivery").insert({ message_id: 1, usr_id: 1, address: "user@qino.test", time: 1 });
  await db.table("message_delivery").insert({ message_id: 1, usr_id: 2, address: "second@qino.test", time: 1 });
  await db.table("message_track").insert({ delivery_id: 1, code: "Ab3-x9Qm", kind: "load", time: 2 });
  await db.table("message_track").insert({ delivery_id: 1, code: "Kp7-r2Ls", kind: "click", time: 3 });
  await db.table("message_track").insert({ delivery_id: 1, code: "Kp7-r2Ls", kind: "click", time: 4 });
  await db.table("message_track").insert({ delivery_id: 2, code: "Kp7-r2Ls", kind: "click", time: 5 });
  await db.exec`INSERT INTO shorturl (code, url, hits) VALUES (${"Ab3-x9Qm"}, ${"https://qino.test/messaging/open.gif"}, ${1})`;
  await db.exec`INSERT INTO shorturl (code, url, hits) VALUES (${"Kp7-r2Ls"}, ${"https://target.qino.test/orders"}, ${3})`;

  const app = { db, t: fakeT, url: () => Promise.resolve("https://qino.test/"), modules: { linked: () => [] } };
  const node = {
    app,
    page: () => Promise.resolve({ children: () => Promise.resolve(new Map()), url: () => Promise.resolve("/backend") }),
  } as unknown as Node;
  const ctx = await testContext({ url: "http://qino.test/backend?msg=1", app });
  const detail = String(await requestStorage.run(ctx, () => render(node)));

  assertStringIncludes(detail, "Opened");
  assertStringIncludes(detail, "<div class=-head>Links</div>");
  assertStringIncludes(detail, "<th>Loads\n          <th>Clicks");
  assertStringIncludes(detail, '<a href="https://qino.test/messaging/open.gif" target=_blank rel=noreferrer>https://qino.test/messaging/open.gif</a>');
  assertStringIncludes(detail, "<td>1\n            <td>0");
  assertStringIncludes(detail, '<a href="https://target.qino.test/orders" target=_blank rel=noreferrer>https://target.qino.test/orders</a>');
  assertStringIncludes(detail, "<td>0\n            <td>3");
  assertEquals(detail.split("https://target.qino.test/orders").length - 1, 2); // one aggregated row: href and label

  const overviewCtx = await testContext({ url: "http://qino.test/backend", app });
  const overview = String(await requestStorage.run(overviewCtx, () => render(node)));
  assertStringIncludes(overview, "<th>Opened");
  assertStringIncludes(overview, "<th>Clicks");
  assertStringIncludes(overview, '<td style="white-space:nowrap">1<br><small><u2-time datetime="1970-01-01T00:00:02.000Z"');
  assertStringIncludes(overview, '<td style="white-space:nowrap">2<br><small><u2-time datetime="1970-01-01T00:00:03.000Z"');
  await db.close();
});
