import { Db } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { intake } from "../lib/intake.ts";
import api from "../nodeApi.ts";
import { dbSchema } from "../plugin.ts";
import { errors, instances } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const KEY = "k".repeat(32);
const auth = (id: string, key = KEY) => `Bearer ${id}.${key}`;
const error = (o: Record<string, unknown> = {}) => ({
  source: "deno", file: "qino/module/x/plugin.ts", line: 3, col: 7, prio: "error", message: "boom",
  hits: 2, first_seen: "2026-10-20 10:00:00", last_seen: "2026-10-20 11:00:00", ...o,
});

async function testApp() {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema, { patch: true });
  db.schema = dbSchema;
  await db.loadTables();
  const app = { db, t: fakeT } as unknown as App;
  return { db, app, node: { app } as unknown as Node };
}

Deno.test("cms.backend.reporting_server: an instance registers with its key and has to keep it", async () => {
  const { db, app } = await testApp();
  try {
    const report = { url: "https://a.ch/", qino: "0.7.7", modules: ["core", "cms"], errors: [error()] };
    assertEquals(await intake(app, auth("instance-a-000001"), report, "1.2.3.4", true), undefined);
    assertEquals(await intake(app, auth("instance-a-000001"), { errors: [error({ hits: 3 })] }, "", true), undefined);
    const row = await db.row`SELECT * FROM reporting_instance`;
    assertEquals([row?.url, row?.modules, row?.ip, String(row?.key_hash).length], ["", "", "", 64]); // the latest report wins
    assertEquals(await db.query`SELECT hits, first_seen FROM reporting_error`, [{ hits: 5, first_seen: "2026-10-20 10:00:00" }]);

    assertEquals(await intake(app, auth("instance-a-000001", "x".repeat(32)), report, "", true), "unknown instance");
    assertEquals(await intake(app, auth("instance-b-000001"), report, "", false), "unknown instance");
    assertEquals(await intake(app, "Bearer short.key", report, "", true), "invalid credentials");
    assertEquals(await intake(app, auth("instance-c-000001"), [], "", true), "invalid report");
    assertEquals(await db.one`SELECT COUNT(*) FROM reporting_instance`, 1);
  } finally {
    await db.close();
  }
});

Deno.test("cms.backend.reporting_server: the same error on two instances is one row, done on both", async () => {
  const { db, app, node } = await testApp();
  try {
    await intake(app, auth("instance-a-000001"), { url: "https://a.ch/", errors: [error({ message: "<b>boom" })] }, "", true);
    await intake(app, auth("instance-b-000001"), { url: "https://b.ch/", errors: [error({ message: "<b>boom" }), error({ line: 9 })] }, "", true);
    const out = String(await errors(node));
    assertEquals(out.match(/data-delete-error=/g)?.length, 2);
    assertStringIncludes(out, "&lt;b&gt;boom");
    assertStringIncludes(out, "<code>qino/module/x/plugin.ts:3:7</code>");
    assertStringIncludes(String(await instances(node)), `href="https://b.ch/"`);

    const fp = String(await db.one`SELECT fp FROM reporting_error WHERE line = ${3} LIMIT 1`);
    assertEquals(await api(node, { deleteError: fp }), { ok: true });
    assertEquals(await db.one`SELECT COUNT(*) FROM reporting_error`, 1);
    assertEquals(await api(node, { deleteInstance: "instance-b-000001" }), { ok: true });
    assertEquals(await db.one`SELECT COUNT(*) FROM reporting_error`, 0); // cascades
    assertEquals(await api(node, {}), false);
  } finally {
    await db.close();
  }
});
