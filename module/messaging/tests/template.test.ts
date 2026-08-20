import { assertEquals } from "@std/assert";
import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { renderer, saveTemplate } from "../mod.ts";

import type { App } from "@qino/qino";

const to = { firstname: "Ada", lastname: "Lovelace <&>" };

async function app(...rows: Record<string, unknown>[]): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  for (const row of rows) await db.table("message_template").insert(row);
  return { db } as App;
}

Deno.test("a channel's main template frames every message, and only that channel's", async () => {
  const a = await app(
    { name: "signature", channel: "sms", main: true, text: "{{content}}\nSupport: https://qino.test" },
    { name: "letter", channel: "email", main: true, format: "md", text: "Hallo {{firstname|Kunde}},\n\n{{content}}" },
  );
  const sms = await renderer(a, { text: "wie gehts" }, "sms");
  assertEquals(sms(to), { text: "wie gehts\nSupport: https://qino.test", html: undefined });

  const mail = await renderer(a, { text: "wie gehts" }, "email");
  assertEquals(mail(to).text, "Hallo Ada,\n\nwie gehts");
  assertEquals(mail(to).html, "<p>Hallo Ada,</p><p>wie gehts</p>");
  assertEquals(mail().html, "<p>Hallo Kunde,</p><p>wie gehts</p>"); // nobody to greet, so the fallback greets

  const telegram = await renderer(a, { text: "wie gehts" }, "telegram");
  assertEquals(telegram(to), { text: "wie gehts", html: undefined }); // no row, no frame
  await a.db.close();
});

Deno.test("a message chooses its frame, drops it, or asks for one nobody wrote", async () => {
  const a = await app(
    { name: "signature", channel: "sms", main: true, text: "{{content}}\n--" },
    { name: "bare", channel: "sms", text: "» {{content}}" },
  );
  const text = (msg: Parameters<typeof renderer>[1]) => renderer(a, msg, "sms").then((render) => render().text);
  assertEquals(await text({ text: "hi" }), "hi\n--");
  assertEquals(await text({ text: "hi", template: "bare" }), "» hi");
  assertEquals(await text({ text: "hi", template: "" }), "hi");
  assertEquals(await text({ text: "hi", template: "gibtsnicht" }), "hi");
  await a.db.close();
});

Deno.test("recipient markers are escaped in markup, the message is not escaped twice", async () => {
  const a = await app({ name: "letter", channel: "email", main: true, format: "html", text: "<p>Hi {{lastname}}</p>{{content}}" });
  const render = await renderer(a, { text: "1 < 2 & **so**", format: "md" }, "email");
  assertEquals(render(to).html, "<p>Hi Lovelace &lt;&amp;&gt;</p><p>1 &lt; 2 &amp; <b>so</b></p>");
  assertEquals(render(to).text, "Hi Lovelace <&>\n\n1 < 2 & so"); // the frame's <p> ends a paragraph
  await a.db.close();
});

Deno.test("a plain message in a markup frame is lifted, and telegram keeps its own line breaks", async () => {
  const a = await app(
    { name: "letter", channel: "email", main: true, format: "html", text: "<div>{{content}}</div>" },
    { name: "chat", channel: "telegram", main: true, format: "md", text: "**{{firstname}}**\n\n{{content}}" },
  );
  const mail = await renderer(a, { text: "a < b\nnext line" }, "email");
  assertEquals(mail().html, "<div>a &lt; b<br>next line</div>");

  const chat = await renderer(a, { text: "a < b" }, "telegram", "telegram");
  assertEquals(chat(to).html, "<b>Ada</b>\n\na &lt; b");
  await a.db.close();
});

Deno.test("a channel has one main frame — a new one takes the flag over", async () => {
  const a = await app(
    { name: "old", channel: "sms", main: true, text: "old {{content}}" },
    { name: "other", channel: "email", main: true, text: "mail {{content}}" },
  );
  await saveTemplate(a, { name: "new", channel: "sms", main: true, text: "new {{content}}" });

  const render = await renderer(a, { text: "hi" }, "sms");
  assertEquals(render().text, "new hi");
  assertEquals(Number(await a.db.one`SELECT COUNT(*) FROM message_template WHERE channel = ${"sms"} AND main = ${true}`), 1);
  assertEquals((await renderer(a, { text: "hi" }, "email"))().text, "mail hi"); // another channel keeps its own
  await a.db.close();
});

Deno.test("what the frame assembles is tidied; what the message says is not", async () => {
  const a = await app({ name: "letter", channel: "sms", main: true, text: "  Hallo {{firstname}},\n\n\n\n{{content}}\n\n\n\n{{company}}  \n" });
  const render = await renderer(a, { text: "hi" }, "sms");
  assertEquals(render({ firstname: "Ada" }), { text: "Hallo Ada,\n\nhi", html: undefined }); // no company, no hole

  const bare = await renderer(a, { text: "a\n\n\n\nb ", template: "" }, "sms");
  assertEquals(bare().text, "a\n\n\n\nb "); // nobody framed it, so nobody touches it
  await a.db.close();
});

Deno.test("a frame's paragraph that is only the marker steps aside for the message's own blocks", async () => {
  const a = await app({ name: "letter", channel: "email", main: true, format: "md", text: "Hallo,\n\n{{content}}\n\nTeam" });
  const render = await renderer(a, { text: "one\n\ntwo", format: "md" }, "email");
  assertEquals(render().html, "<p>Hallo,</p><p>one</p><p>two</p><p>Team</p>");
  await a.db.close();
});
