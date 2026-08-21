import { assertEquals, assertStringIncludes } from "@std/assert";
import { Db, Output } from "@qino/qino";
import { fakeT, testContext } from "@qino/qino/tests";

import { headers, link, serveUnsubscribe } from "../lib/unsubscribe.ts";

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
