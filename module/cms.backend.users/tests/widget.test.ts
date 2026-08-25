import { Db, requestStorage } from "@qino/qino";
import { assertEquals, contactDbSchema, testContext } from "@qino/qino/tests";

import nodeApi from "../nodeApi.ts";
import { adoptUsername, backendDashboardWidget, cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import manifest from "../manifest.json" with { type: "json" };

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
    t: (s: TemplateStringsArray) => s.join(""),
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
