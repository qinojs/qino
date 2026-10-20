import { Db, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, contactDbSchema, fakeT, testContext } from "@qino/qino/tests";

import nodeApi from "../nodeApi.ts";
import { adoptUsername, backendDashboardWidget, backendRowWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name, dependencies } = manifest;

Deno.test("cms.backend.users: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.users");
  assertEquals(dependencies, ["cms.backend"]);
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
  assertEquals(typeof cms.node.parts.contacts, "function");
});

Deno.test("cms.backend.users: dashboard widget renders counts and recent logins", async () => {
  const oneValues = [7, 5];
  const app = {
    db: {
      one: () => oneValues.shift(),
      query: () => Promise.resolve([{ username: "user@example.test", access: 1700000000 }]),
    },
    t: (s: TemplateStringsArray) => Promise.resolve(s.join("")),
  } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = String(await backendDashboardWidget(app));
  assertEquals(out.includes("Total:<td>7"), true);
  assertEquals(out.includes("Active:<td>5"), true);
  assertEquals(out.includes("user@example.test"), true);
  assertEquals(out.includes("2023-11-14T22:13:20.000Z"), true);
});

Deno.test("cms.backend.users: empty password save is ignored", async () => {
  let saved: Record<string, unknown> | undefined;
  const usr = {
    superuser: false,
    $set: (values: Record<string, unknown>) => { saved = values; },
  };
  const ctx = await testContext();
  const node = {
    access: () => 2,
    app: { db: { table: () => ({ get: () => usr, row: () => usr }) } },
  };

  const res = await requestStorage.run(ctx, () =>
    nodeApi(node as any, { save: 1, name: "pw", value: "" })
  );

  assertEquals(res, false);
  assertEquals(saved, undefined);
});

Deno.test("a username that is no address is a login handle, not a failure", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate(contactDbSchema);
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "hans" });
  await db.table("usr").insert({ username: "eva@qino.test" });
  const app = { db } as unknown as App;

  await adoptUsername(app, 1, "hans");
  await adoptUsername(app, 2, "eva@qino.test");
  assertEquals(await db.col`SELECT usr_id FROM usr_contact WHERE type = ${"email"}`, [2]);
  assertEquals(await db.one`SELECT main FROM usr_contact WHERE usr_id = ${2}`, 1);
  await db.close();
});

Deno.test("how a user signs in, as a card on other pages, links to where it is changed", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate(contactDbSchema);
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, active INTEGER, superuser INTEGER)`;
  await db.query`CREATE TABLE grp (id INTEGER PRIMARY KEY, name TEXT)`;
  await db.query`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "<eva>", active: 1, superuser: 0 });
  await db.query`INSERT INTO grp VALUES (1, 'admin')`;
  await db.query`INSERT INTO usr_grp VALUES (1, 1)`;
  await adoptUsername({ db } as unknown as App, 1, "eva@qino.test");
  const app = { db, t: fakeT } as unknown as App;
  const page = { url: () => Promise.resolve("/backend/users") } as never;
  const out = await backendRowWidget.usr(app, 1, page);
  assertEquals(out && out.title, "Login"); // one user: not the page's name, "Users"
  const card = String(out && out.body);
  assertStringIncludes(card, `<a href="/backend/users?id=1">&lt;eva&gt;</a>`);
  assertStringIncludes(card, "eva@qino.test");
  assertStringIncludes(card, "<td>admin");
  assertEquals(await backendRowWidget.usr(app, 2, page), "");
  await db.close();
});
