import { assertEquals, assertNotEquals } from "@std/assert";
import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { valid } from "../lib/code.ts";
import { shorten } from "../mod.ts";

import type { App } from "@qino/qino";

const row = (app: App, code: string) => app.db.row`SELECT * FROM shorturl WHERE code = ${code}`;

async function app(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  db.schema = dbSchema;
  return { db, url: () => Promise.resolve("https://site.test/"), settings: { shorturl: { _secret: "test" } } } as unknown as App;
}

Deno.test("shorten stores the target and builds a link under the path", async () => {
  const testApp = await app();
  const link = await shorten(testApp, "https://example.test/a/long/one?x=1");
  const code = link.replace("https://site.test/s/", "");
  assertEquals(link, `https://site.test/s/${code}`);
  assertEquals((await row(testApp, code))?.url, "https://example.test/a/long/one?x=1");
});

Deno.test("the same target shortens to the same code, a different one does not", async () => {
  const testApp = await app();
  const one = await shorten(testApp, "https://example.test/a");
  assertEquals(await shorten(testApp, "https://example.test/a"), one);
  assertNotEquals(await shorten(testApp, "https://example.test/b"), one);
  assertEquals(Number(await testApp.db.one`SELECT COUNT(*) FROM shorturl`), 2);
  assertEquals(await shorten(await app(), "https://example.test/a"), one); // the code is the target, not a counter
});

Deno.test("a code the app never signed is recognisable without asking the database", async () => {
  const testApp = await app();
  const code = (await shorten(testApp, "https://example.test/a")).split("/").pop()!;
  assertEquals(await valid(testApp, code), true);
  assertEquals(await valid(testApp, code.slice(0, -1) + "x"), false);
  assertEquals(await valid(testApp, "abcdefgh"), false);
  assertEquals(await valid(testApp, ""), false);
});

Deno.test("relative targets resolve against the base", async () => {
  const testApp = await app();
  const link = await shorten(testApp, "invoice/7");
  assertEquals((await row(testApp, link.split("/").pop()!))?.url, "https://site.test/invoice/7");
});

Deno.test("shortening again lengthens the life of the link, never shortens it", async () => {
  const testApp = await app();
  const url = "https://example.test/c";
  const code = (await shorten(testApp, url, { expires: 100 })).split("/").pop()!;
  const expires = async () => (await row(testApp, code))?.expires;
  assertEquals(Number(await expires()), 100);

  await shorten(testApp, url, { expires: 50 });
  assertEquals(Number(await expires()), 100);

  await shorten(testApp, url, { expires: 200 });
  assertEquals(Number(await expires()), 200);

  await shorten(testApp, url); // no expiry outlives every expiry
  assertEquals(await expires(), null);

  await shorten(testApp, url, { expires: 300 });
  assertEquals(await expires(), null);
  assertEquals(Number(await testApp.db.one`SELECT COUNT(*) FROM shorturl`), 1);
});
