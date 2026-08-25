import { assertEquals } from "@std/assert";
import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { renderer, saveTemplate } from "../mod.ts";
import { messagingPlaceholders } from "../plugin.ts";

import type { App } from "@qino/qino";

const to = { firstname: "Ada", lastname: "Lovelace <&>" };

async function app(...rows: Record<string, unknown>[]): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  for (const row of rows) await db.table("message_template").insert(row);
  const linked = [{ name: "messaging", plugin: { messagingPlaceholders } }]; // what the module itself declares
  return { db, url: () => Promise.resolve("https://qino.test/"), modules: { linked: () => linked } } as unknown as App;
}

Deno.test("a channel's main template goes around every message, and only that channel's", async () => {
  const a = await app(
    { name: "signature", channel: "sms", main: true, text: "{{content}}\nSupport: https://qino.test" },
    { name: "letter", channel: "email", main: true, format: "md", text: "Hallo {{givenName|Kunde}},\n\n{{content}}" },
  );
  const { render: sms } = await renderer(a, { text: "wie gehts" }, "sms");
  assertEquals(await sms(to), { text: "wie gehts\nSupport: https://qino.test", html: undefined });

  const { render: mail } = await renderer(a, { text: "wie gehts" }, "email");
  assertEquals((await mail(to)).text, "Hallo Ada,\n\nwie gehts");
  assertEquals((await mail(to)).html, "<p>Hallo Ada,</p>\n<p>wie gehts</p>");
  assertEquals((await mail()).html, "<p>Hallo Kunde,</p>\n<p>wie gehts</p>"); // nobody to greet, so the fallback greets

  const { render: telegram } = await renderer(a, { text: "wie gehts" }, "telegram");
  assertEquals(await telegram(to), { text: "wie gehts", html: undefined }); // no row, no template
  await a.db.close();
});

Deno.test("a message chooses its template, drops it, or asks for one nobody wrote", async () => {
  const a = await app(
    { name: "signature", channel: "sms", main: true, text: "{{content}}\n--" },
    { name: "bare", channel: "sms", text: "» {{content}}" },
  );
  const text = (msg: Parameters<typeof renderer>[1]) => renderer(a, msg, "sms").then(async ({ render }) => (await render()).text);
  assertEquals(await text({ text: "hi" }), "hi\n--");
  assertEquals(await text({ text: "hi", template: "bare" }), "» hi");
  assertEquals(await text({ text: "hi", template: null }), "hi");
  assertEquals(await text({ text: "hi", template: "" }), "hi\n--"); // out of a variable, not a wish: the main one
  assertEquals(await text({ text: "hi", template: "gibtsnicht" }), "hi");
  await a.db.close();
});

Deno.test("recipient placeholders are escaped in markup, the message is not escaped twice", async () => {
  const a = await app({ name: "letter", channel: "email", main: true, format: "html", text: "<p>Hi {{familyName}}</p>{{content}}" });
  const { render: render } = await renderer(a, { text: "1 < 2 & **so**", format: "md" }, "email");
  assertEquals((await render(to)).html, "<p>Hi Lovelace &lt;&amp;&gt;</p><p>1 &lt; 2 &amp; <strong>so</strong></p>");
  assertEquals((await render(to)).text, "Hi Lovelace <&>\n\n1 < 2 & so"); // the template's <p> ends a paragraph
  await a.db.close();
});

Deno.test("a plain message in a markup template is lifted, and telegram keeps its own line breaks", async () => {
  const a = await app(
    { name: "letter", channel: "email", main: true, format: "html", text: "<div>{{content}}</div>" },
    { name: "chat", channel: "telegram", main: true, format: "md", text: "**{{givenName}}**\n\n{{content}}" },
  );
  const { render: mail } = await renderer(a, { text: "a < b\nnext line" }, "email");
  assertEquals((await mail()).html, "<div>a &lt; b<br>next line</div>");

  const { render: chat } = await renderer(a, { text: "a < b" }, "telegram", "telegram");
  assertEquals((await chat(to)).html, "<strong>Ada</strong>\n\na &lt; b");
  await a.db.close();
});

Deno.test("a channel has one main template — a new one takes the flag over", async () => {
  const a = await app(
    { name: "old", channel: "sms", main: true, text: "old {{content}}" },
    { name: "other", channel: "email", main: true, text: "mail {{content}}" },
  );
  await saveTemplate(a, { name: "new", channel: "sms", main: true, text: "new {{content}}" });

  const { render: render } = await renderer(a, { text: "hi" }, "sms");
  assertEquals((await render()).text, "new hi");
  assertEquals(Number(await a.db.one`SELECT COUNT(*) FROM message_template WHERE channel = ${"sms"} AND main = ${true}`), 1);
  assertEquals((await (await renderer(a, { text: "hi" }, "email")).render()).text, "mail hi"); // another channel keeps its own
  await a.db.close();
});

Deno.test("what the template assembles is tidied; what the message says is not", async () => {
  const a = await app({ name: "letter", channel: "sms", main: true, text: "  Hallo {{givenName}},\n\n\n\n{{content}}\n\n\n\n{{company}}  \n" });
  const { render: render } = await renderer(a, { text: "hi" }, "sms");
  assertEquals(await render({ firstname: "Ada" }), { text: "Hallo Ada,\n\nhi", html: undefined }); // no company, no hole

  const { render: bare } = await renderer(a, { text: "a\n\n\n\nb ", template: null }, "sms");
  assertEquals((await bare()).text, "a\n\n\n\nb "); // nobody templated it, so nobody touches it
  await a.db.close();
});

Deno.test("a template's paragraph that is only the placeholder steps aside for the message's own blocks", async () => {
  const a = await app({ name: "letter", channel: "email", main: true, format: "md", text: "Hallo,\n\n{{content}}\n\nTeam" });
  const { render: render } = await renderer(a, { text: "one\n\ntwo", format: "md" }, "email");
  assertEquals((await render()).html, "<p>Hallo,</p>\n<p>one</p>\n<p>two</p>\n<p>Team</p>");
  await a.db.close();
});

Deno.test("a value that reads like a placeholder stays text, and no inherited property is one", async () => {
  const a = await app(
    { name: "letter", channel: "email", main: true, text: "Hallo {{givenName}}, {{content}}" },
    // a recipient row is a bag of columns, not an object whose prototype can be read out
    { name: "proto", channel: "email", text: "[{{constructor}}{{toString}}{{nothing|—}}]{{content}}" },
  );
  const { render: render } = await renderer(a, { text: "hi" }, "email");
  // one round, never a second: what came out of a column is not looked at again
  assertEquals((await render({ firstname: "{{content}}" })).text, "Hallo {{content}}, hi");

  const { render: proto } = await renderer(a, { text: "hi", template: "proto" }, "email");
  assertEquals((await proto({ firstname: "Ada" })).text, "[—]hi");
  await a.db.close();
});
