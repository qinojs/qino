import * as sqliteVec from "sqlite-vec";
import { Db } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };
import embedSchema from "@qino/m/ai1.embed/dbschema.json" with { type: "json" };
import { collection, index } from "@qino/qino/ai1.embed";

import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.embed: collections can be managed and searched", async () => {
  const db = new Db("sqlite::memory:");
  try {
    sqliteVec.load(db);
    await db.migrate({ properties: { ...ai1Schema.properties, ...embedSchema.properties } });
    await db.loadTables();
    await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    for (const name of ["one", "two"]) await db.table("ai1_model").insert({ name });
    for (const model_id of [1, 2]) {
      await db.table("ai1_model_provider").insert({ model_id, provider_id: 1 });
      await db.table("ai1_model_capability").insert({ model_id, capability: "embed" });
    }
    const embed = (_call: unknown, input: { texts: string[] }) => Promise.resolve(input.texts.map((t) => t.includes("cat") ? [1, 0] : [0, 1]));
    const mods = [{ name: "ai1", plugin: { ai1Capabilities, ai1Adapters: { fake: { embed } } } }];
    let primary = 0;
    const setting = Object.assign((value?: number) => { if (value !== undefined) primary = value; return primary; }, { then: (resolve: (value: number) => void) => resolve(primary) });
    const app = {
      db, settings: { core: { keys: {} }, "ai1.embed": { primary: setting, chunkChars: 4000 }, "cms.embed": { auto: false } }, fire: () => Promise.resolve(),
      modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
    } as unknown as App;
    const node = { app } as Node, api = cms.node.api;

    assertEquals(await api(node, { create: { model: "one", dimensions: "2" } }), { ok: true });
    assertEquals(await api(node, { create: { model: "two", dimensions: "2" } }), { ok: true });
    await index(app, { source: "text", id: 1, part: "en" }, "a cat");
    const rendered = String(await cms.node.render(node));
    assertStringIncludes(rendered, "<th>one");
    assertStringIncludes(rendered, "<td>1\n");
    const { hits } = await api(node, { search: "cat" }) as { hits: { id: number; content: string }[] };
    assertEquals(hits.map((h) => [h.id, h.content]), [[1, "a cat"]]);

    assertEquals(await api(node, { primary: 2 }), { ok: true });
    assertEquals((await collection(app))?.model, "two");
    assertEquals((await api(node, { primary: 9 }))?.ok, false);
    assertEquals(await api(node, { drop: 2 }), { ok: true });
    assertEquals(primary, 0);
    assertEquals((await collection(app))?.model, "one");
    assertEquals((await api(node, { config: { chunkChars: "50" } }))?.ok, false);
  } finally { await db.close(); }
});
