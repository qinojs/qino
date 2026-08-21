import { assertEquals, assertStringIncludes } from "@std/assert";
import { Db, Output } from "@qino/qino";
import { fakeT, testContext } from "@qino/qino/tests";

import { renderer } from "../mod.ts";
import { headers, link, serveUnsubscribe } from "../lib/unsubscribe.ts";
import { messagingPlaceholders } from "../plugin.ts";

import type { App, Ctx } from "@qino/qino";

async function app(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER)`;
  await db.loadTables();
  await db.table("grp").insert({ name: "Newsletter" });
  await db.table("usr_grp").insert({ usr_id: 7, grp_id: 1 });
  return {
    db,
    t: fakeT,
    settings: { messaging: { _secret: "test-secret" } },
    url: () => Promise.resolve("https://qino.test/"),
    modules: { linked: () => [{ plugin: { messagingPlaceholders } }] },
  } as unknown as App;
}

const members = (a: App) => a.db.one<number>`SELECT COUNT(*) FROM usr_grp WHERE usr_id = ${7} AND grp_id = ${1}`;

/** What the route does with one request, as the caller sees it: an Output, or nothing at all. */
async function call(a: App, path: string, method = "GET"): Promise<Output | undefined> {
  const ctx = await testContext({ url: "https://qino.test/" + path, method, app: a });
  try {
    await serveUnsubscribe(ctx as Ctx);
  } catch (e) {
    if (e instanceof Output) return e;
    throw e;
  }
}

Deno.test("a get asks and drops nobody; the post is what unsubscribes", async () => {
  const a = await app();
  const path = (await link(a, 7, 1)).replace("https://qino.test/", "");

  const asked = await call(a, path);
  assertStringIncludes(String(asked?.body), "<form method=post");
  assertStringIncludes(String(asked?.body), "Newsletter"); // it says which group it is about
  assertEquals(await members(a), 1); // a scanner following links unsubscribes nobody

  const done = await call(a, path, "POST");
  assertStringIncludes(String(done?.body), "removed");
  assertEquals(await members(a), 0);

  await call(a, path, "POST"); // following it twice is following it once
  assertEquals(await members(a), 0);
  await a.db.close();
});

Deno.test("a token nobody signed is not one of ours, and other paths pass through", async () => {
  const a = await app();
  const path = (await link(a, 7, 1)).replace("https://qino.test/", "");

  const forged = await call(a, path.slice(0, -1) + "x", "POST");
  assertEquals(forged?.status, 404);
  assertEquals(await members(a), 1);

  // walking user ids is no use without the signature that goes with them
  assertEquals((await call(a, "messaging/unsubscribe/8-1-aaaaaaaa", "POST"))?.status, 404);
  assertEquals(await call(a, "somewhere/else"), undefined);
  await a.db.close();
});

Deno.test("the headers carry the same link, and say it may be posted to", async () => {
  const a = await app();
  const set = await headers(a, 7, 1);
  assertEquals(set["List-Unsubscribe"], `<${await link(a, 7, 1)}>`);
  assertEquals(set["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await a.db.close();
});

Deno.test("the placeholder becomes a link in markup and a bare address in text", async () => {
  const a = await app();
  await a.db.exec`CREATE TABLE message_template (name TEXT, channel TEXT, main INTEGER, format TEXT, text TEXT)`;
  await a.db.loadTables();
  await a.db.table("message_template").insert({
    name: "news", channel: "email", main: 1, format: "md",
    text: "{{content}}\n\n[{{unsubscribe}}]",
  });

  const { render: render } = await renderer(a, { text: "hi", format: "md" }, "email");
  const out = await render({ usrId: 7, grpId: 1 });
  const url = await link(a, 7, 1);
  assertStringIncludes(out.text, url); // plain text gets the address itself
  assertStringIncludes(out.html ?? "", `href="${url}"`);

  // nothing to leave: no group in the row, no link — and the placeholder simply stays empty
  assertEquals((await render({ usrId: 7 })).text.includes(url), false);
  await a.db.close();
});
