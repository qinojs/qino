import { Db } from "@qino/qino";
import { assertEquals, assertStringIncludes, contactDbSchema, DbFileManager, fileDbSchema, fakeT, messagingDbSchema as messageSchema, messagingPlaceholders } from "@qino/qino/tests";

import { messages } from "@qino/qino/messaging";

import { send, setTransport } from "../mod.ts";

import type { App } from "@qino/qino";

async function makeApp(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...fileDbSchema.properties, ...messageSchema.properties, ...contactDbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, firstname TEXT, lastname TEXT, company TEXT)`;
  await db.query`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.query`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "one@qino.test", firstname: "One", lastname: "User" });
  await db.table("usr_contact").insert({ type: "email", address: "one@qino.test", usr_id: 1, main: true, created: 1 });
  const dir = await Deno.makeTempDir();
  const app = {
    db,
    dir,
    settings: {
      messaging: { _secret: "test-secret" },
      "messaging.email": { sender: "app@qino.test", sendername: "Qino", inbound: {}, transport: {} },
    },
    url: () => Promise.resolve("https://qino.test/"),
    modules: { linked: () => [{ plugin: { messagingPlaceholders } }] },
    t: fakeT,
  } as unknown as App;
  app.dbFiles = new DbFileManager(app, dir + "/files/");
  return app;
}

async function close(app: App): Promise<void> {
  await new Promise((r) => setTimeout(r, 0)); // send leaves contact bookkeeping running on purpose
  await app.db.close();
  await Deno.remove(app.dir, { recursive: true });
}

Deno.test("a mail to a user reaches their address and lands in the journal", async () => {
  const app = await makeApp();
  const sent: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (sent.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  assertEquals(await send(app, { usr: 1 }, { title: "Invoice", text: "Attached." }), 1);
  assertEquals(String(sent[0].subject), "Invoice");
  assertEquals(String((sent[0].recipients as { address: string }[])[0].address), "one@qino.test");

  const [journaled] = await messages(app);
  assertEquals(journaled.channel, "email");
  assertEquals(journaled.title, "Invoice");
  assertEquals(journaled.text, "Attached.");
  assertEquals(journaled.deliveries, [{ id: 1, usr_id: 1, address: "one@qino.test", email: "one@qino.test", time: journaled.deliveries[0].time, error: null }]);

  await close(app);
});

Deno.test("a debug redirect is journaled as a delivery that never reached the recipient", async () => {
  const app = await makeApp();
  const settings = (app.settings as unknown as Record<string, Record<string, unknown>>)["messaging.email"];
  settings.debug_to = "dev@qino.test";
  const sent: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (sent.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  assertEquals(await send(app, { usr: 1 }, { title: "Invoice", text: "Attached." }), 1);
  assertEquals(String((sent[0].recipients as { address: string }[])[0].address), "dev@qino.test");
  assertEquals(String(sent[0].subject), "Debug! Invoice");

  const [journaled] = await messages(app);
  assertEquals(journaled.deliveries.map((d) => [d.address, d.error]), [["one@qino.test", "redirected to debug address dev@qino.test"]]);

  await close(app);
});

Deno.test("literal addresses find owners, keep sending past invalid ones, and journal every result", async () => {
  const app = await makeApp();
  setTransport(app, { send: () => Promise.resolve({ successful: false, errorMessages: ["mailbox full"] }) });

  assertEquals(await send(app, { email: ["one@qino.test", "invalid", "other@qino.test"] }, "Hello"), 0);

  const [journaled] = await messages(app);
  assertEquals(journaled.text, "Hello");
  assertEquals(journaled.deliveries.map((d) => [d.address, d.usr_id, d.error]), [
    ["one@qino.test", 1, "mailbox full"],
    ["invalid", null, "Use an email address such as name@example.com"],
    ["other@qino.test", null, "mailbox full"],
  ]);

  await close(app);
});

Deno.test("a markdown mail carries both parts, a plain one only text", async () => {
  const app = await makeApp();
  const sent: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (sent.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  await send(app, { usr: 1 }, { text: "Hi **there**", format: "md" });
  assertEquals((sent[0].content as { html: string; text: string }).html, "<p>Hi <strong>there</strong></p>");
  assertEquals((sent[0].content as { html: string; text: string }).text, "Hi there");

  await send(app, { usr: 1 }, "Hi **there**");
  assertEquals(sent[1].content, { text: "Hi **there**" });

  const [plain, markdown] = await messages(app); // newest first: the plain mail, then the markdown one
  assertEquals([markdown.text, markdown.format], ["Hi **there**", "md"]); // the journal keeps the source
  assertEquals([plain.text, plain.format], ["Hi **there**", null]);
  await close(app);
});

Deno.test("email carries generic attachments as MIME files", async () => {
  const app = await makeApp();
  const sent: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (sent.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  await send(app, { usr: 1 }, {
    text: "Files attached.",
    attachments: [
      new File(["invoice"], "invoice.txt", { type: "text/plain" }),
      { name: "terms.txt", type: "text/plain", content: new TextEncoder().encode("terms") },
    ],
  });

  const files = sent[0].attachments as { filename: string; contentType: string; content: Promise<Uint8Array> }[];
  assertEquals(files.map((file) => [file.filename, file.contentType]), [
    ["invoice.txt", "text/plain"],
    ["terms.txt", "text/plain"],
  ]);
  assertEquals((await Promise.all(files.map((file) => file.content))).map((bytes) => new TextDecoder().decode(bytes)), ["invoice", "terms"]);

  const [journaled] = await messages(app);
  assertEquals(journaled.attachments.map((file) => [file.name, file.mime, file.size, file.sort]), [
    ["invoice.txt", "text/plain", 7, 0],
    ["terms.txt", "text/plain", 5, 1],
  ]);
  assertEquals(await Deno.readTextFile((await app.dbFiles.file(Number(journaled.attachments[0].file_id))).path), "invoice");
  await close(app);
});

Deno.test("unsubscribe headers ride along only where the message offers the way out", async () => {
  const app = await makeApp();
  await app.db.exec`INSERT INTO grp (name) VALUES ('Newsletter')`;
  await app.db.exec`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER)`;
  await app.db.loadTables();
  await app.db.table("usr_grp").insert({ usr_id: 1, grp_id: 1 });
  await app.db.table("message_template").insert({
    name: "news", channel: "email", main: 1, format: "md", text: "{{content}}\n\n[{{unsubscribe}}]",
  });
  const sent: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (sent.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  await send(app, { grp: 1 }, { title: "News", text: "Hello.", format: "md" });
  const headers = sent[0].headers as Headers;
  assertStringIncludes(headers.get("List-Unsubscribe") ?? "", "messaging/unsubscribe/");
  assertEquals(headers.get("List-Unsubscribe-Post"), "List-Unsubscribe=One-Click");

  // the same mail without the template: nothing to leave, so the client is offered nothing
  await send(app, { grp: 1 }, { title: "News", text: "Hello.", format: "md", template: "" });
  assertEquals((sent[1].headers as Headers).get("List-Unsubscribe"), null);
  await close(app);
});
