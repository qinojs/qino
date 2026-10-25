import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { keepUrls } from "./keepUrls.ts";

import type { App } from "@qino/qino";

Deno.test("keepUrls: every PHP URL redirects to its page; existing redirects stay, a second run adds nothing", async () => {
  const db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE text (id INTEGER, lang TEXT, text TEXT)`;
  await db.exec`CREATE TABLE page_url (page_id INTEGER, lang TEXT, url TEXT, custom INTEGER)`;
  await db.exec`CREATE TABLE page_redirect (request TEXT PRIMARY KEY, redirect TEXT)`;
  await db.exec`INSERT INTO page_url VALUES (881, 'de', 'de/backend/weiterbildungstage-de881', 0), (2, 'de', 'de/start', 1), (3, 'de', '', 0)`;
  await db.exec`INSERT INTO page_redirect VALUES ('de/start', 'https://example.com/')`;
  const app = { db } as unknown as App;

  await keepUrls(app);
  await keepUrls(app);

  assertEquals(await db.query`SELECT request, redirect FROM page_redirect ORDER BY request`, [
    { request: "de/backend/weiterbildungstage-de881", redirect: "881" },
    { request: "de/start", redirect: "https://example.com/" },
  ]);
  await db.close();
});
