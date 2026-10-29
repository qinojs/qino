import { Db } from "@qino/qino";
import { assertEquals, scoreDbSchema as dbSchema } from "@qino/qino/tests";
import { hit } from "@qino/qino/score";

import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { list } from "../render.ts";

import type { App } from "@qino/qino";

const { name, dependencies } = manifest;

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));

const declared = { properties: { score_doc_view: { additionalProperties: { properties: { doc_id: { type: "integer" } } } } } };

async function testNode() {
  const db = new Db("sqlite:");
  db.schema = dbSchema(declared);
  await db.migrate(db.schema);
  await db.loadTables();
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

Deno.test("cms.backend.superuser.score: a score table shows its numbers and strongest rows", async () => {
  const { node, db } = await testNode();
  await hit(db, "doc_view", { doc_id: 7 }, 4);
  await hit(db, "doc_view", { doc_id: 8 });

  const out = String(await list(node));
  assertEquals(out.includes("<code>score_doc_view</code>"), true);
  assertEquals(out.includes("half-life 30d"), true);
  assertEquals(out.includes("<b>2</b> rows"), true);
  assertEquals(out.indexOf("<code>doc_id 7</code>") < out.indexOf("<code>doc_id 8</code>"), true); // strongest first
  assertEquals(out.includes("4.00"), true); // strength in accesses
  await db.close();
});

Deno.test("cms.backend.superuser.score: an empty score table says so instead of showing a table", async () => {
  const { node, db } = await testNode();
  const out = String(await list(node));
  assertEquals(out.includes("No accesses recorded yet."), true);
  assertEquals(out.includes("<b>1</b> score tables"), true);
  await db.close();
});

Deno.test("cms.backend.superuser.score: prune reports how many scores it deleted", async () => {
  const { node, db } = await testNode();
  await hit(db, "doc_view", { doc_id: 1 });
  await db.exec`UPDATE score_doc_view SET score = 0 WHERE doc_id = 1`; // faded far below the limit

  assertEquals(await api(node, {}), false);
  assertEquals(await api(node, { prune: true }), { ok: true, message: "1 faded scores deleted" });
  assertEquals(await db.one`SELECT COUNT(*) FROM score_doc_view`, 0);
  await db.close();
});
