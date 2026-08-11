import { assertEquals } from "../../core/tests/deps.ts";
import { Db, type App } from "../../core/mod.ts";
import { hit, scored } from "../../score/mod.ts";
import { dbSchema } from "../../score/tests/deps.ts";
import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;
import { list } from "../render.ts";

const DAY = 86400;
const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));

async function testNode() {
  const db = new Db("sqlite:");
  await db.migrate(dbSchema);
  await scored(db, "doc", 30 * DAY);
  const app = { db, t } as unknown as App;
  return { node: { app } as never, db };
}

Deno.test("cms.backend.superuser.score: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.score");
  assertEquals(dependencies, ["cms.backend", "score"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.superuser.score: a scope shows its numbers and strongest rows", async () => {
  const { node, db } = await testNode();
  await hit(db, "doc", 7, 4);
  await hit(db, "doc", 8);

  const out = String(await list(node));
  assertEquals(out.includes("<code>doc</code>"), true);
  assertEquals(out.includes("half-life 30d"), true);
  assertEquals(out.includes("<b>2</b> rows"), true);
  assertEquals(out.includes("<code>7</code>"), true); // strongest first
  assertEquals(out.indexOf("<code>7</code>") < out.indexOf("<code>8</code>"), true);
  assertEquals(out.includes("4.00"), true); // strength in accesses
  await db.close();
});

Deno.test("cms.backend.superuser.score: an empty scope says so instead of showing a table", async () => {
  const { node, db } = await testNode();
  const out = String(await list(node));
  assertEquals(out.includes("No accesses recorded yet."), true);
  assertEquals(out.includes("<b>1</b> scopes"), true);
  await db.close();
});

Deno.test("cms.backend.superuser.score: scopes no module registers are listed as leftovers", async () => {
  const { node, db } = await testNode();
  await db.exec`INSERT INTO score_scope (id, tbl) VALUES (99, 'gone')`;
  await db.exec`INSERT INTO score (scope_id, id, score, time) VALUES (99, 1, 5, 0)`;

  const out = String(await list(node));
  assertEquals(out.includes("Not registered"), true);
  assertEquals(out.includes("<code>gone</code> · 1 rows"), true);
  await db.close();
});

Deno.test("cms.backend.superuser.score: prune reports how many scores it deleted", async () => {
  const { node, db } = await testNode();
  await hit(db, "doc", 1);
  await db.exec`UPDATE score SET score = 0 WHERE id = 1`; // faded far below the limit

  assertEquals(await api(node, {}), false);
  assertEquals(await api(node, { prune: true }), { ok: true, message: "1 faded scores deleted" });
  assertEquals(await db.one`SELECT COUNT(*) FROM score`, 0);
  await db.close();
});
