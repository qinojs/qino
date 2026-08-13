// imported by package name: a test store must not depend on the host application's import map
import { assertEquals } from "@std/assert";
import { Db, requestStorage } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";
import { scored } from "@qino/qino/score";

import api from "../nodeApi.ts";
import { fileHit, pageHit, TABLES } from "../hooks.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { list } from "../render.ts";

import type { App, Ctx } from "@qino/qino";

const { name, dependencies } = manifest;

const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));

async function testApp() {
  const db = new Db("sqlite:");
  await db.exec`CREATE TABLE score_scope (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT)`;
  await db.exec`CREATE TABLE score (scope_id INTEGER, id INTEGER, score REAL, time INTEGER DEFAULT 0, PRIMARY KEY (scope_id, id))`;
  for (const [tbl, half] of Object.entries(TABLES)) await scored(db, tbl, half);
  return { db, app: { db, t } as unknown as App };
}

/** A request context as `cms:page-ready` leaves it. */
function pageCtx({ status = 200, node = 5, editmode = 0, ua = "Mozilla/5.0" } = {}) {
  const ctx = bareCtx(status, ua);
  const cms = cmsCtx(ctx);
  cms.mainNode = { id: node } as never;
  cms.editmode = editmode;
  return ctx;
}

/** Nothing rendered a node — `cms:page-ready` can still fire. */
const bareCtx = (status = 200, ua = "Mozilla/5.0") =>
  ({ res: { status }, req: { header: () => ua }, state: {} }) as unknown as Ctx;

const scoredIds = (db: Db, tbl: string) =>
  db.col<number>`SELECT id FROM score WHERE scope_id = (SELECT id FROM score_scope WHERE tbl = ${tbl}) ORDER BY id`;

Deno.test("cms.backend.superuser.score.test: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.score.test");
  assertEquals(dependencies, ["cms.backend", "cms", "score"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(Object.keys(TABLES), ["page", "file"]);
});

Deno.test("cms.backend.superuser.score.test: a rendered page scores its node", async () => {
  const { db, app } = await testApp();
  await pageHit(app, pageCtx({ node: 5 }));
  await pageHit(app, pageCtx({ node: 5 }));
  await pageHit(app, pageCtx({ node: 9 }));

  assertEquals(await scoredIds(db, "page"), [5, 9]);
  await db.close();
});

Deno.test("cms.backend.superuser.score.test: error pages, editmode, bots and missing nodes score nothing", async () => {
  const { db, app } = await testApp();
  await pageHit(app, pageCtx({ status: 404 }));
  await pageHit(app, pageCtx({ status: 401 }));
  await pageHit(app, pageCtx({ editmode: 1 }));
  await pageHit(app, pageCtx({ ua: BOT }));
  await pageHit(app, bareCtx());

  assertEquals(await scoredIds(db, "page"), []);
  await db.close();
});

Deno.test("cms.backend.superuser.score.test: a file scores only when the delivery route served it", async () => {
  const { db, app } = await testApp();
  const onRoute = (path: string, id: number, access = true) =>
    requestStorage.run({ req: { appPath: path } } as Ctx, () => fileHit(app, id, access));

  await onRoute("dbFile/12/u-abc/pic.png", 12);
  await onRoute("cms.filebrowser/list", 13); // a permission check elsewhere
  await onRoute("dbFile/14/u-abc/x.png", 14, false); // access denied
  await fileHit(app, 15, true); // no request at all (cron, install)

  assertEquals(await scoredIds(db, "file"), [12]);
  await db.close();
});

// The page list resolves titles and urls through `cms(app)`, which needs a linked cms module —
// out of reach here, so the panel is checked on the file scope.
Deno.test("cms.backend.superuser.score.test: the panel counts what was collected and can clear it", async () => {
  const { db, app } = await testApp();
  await requestStorage.run({ req: { appPath: "dbFile/12/u-a/x.png" } } as Ctx, () => fileHit(app, 12, true));
  const node = { app } as never;

  const out = String(await list(node));
  assertEquals(out.includes("<code>file</code>"), true);
  assertEquals(out.includes("<td>30d"), true);
  assertEquals(out.includes("<td>1"), true);

  assertEquals(await api(node, {}), false);
  assertEquals(await api(node, { clear: true }), { ok: true, message: "1 scores deleted" });
  assertEquals(await db.one`SELECT COUNT(*) FROM score`, 0);
  await db.close();
});
