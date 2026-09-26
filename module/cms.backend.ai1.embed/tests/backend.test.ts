import { Db } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };
import embedSchema from "@qino/m/ai1.embed/dbschema.json" with { type: "json" };
import { upsert } from "@qino/qino/ai1.embed";

import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.embed: collections can be managed and searched", async () => {
  const dir = await Deno.makeTempDir(), cache = dir + "/";
  try {
    const db = new Db("sqlite::memory:");
    await db.migrate({ properties: { ...ai1Schema.properties, ...embedSchema.properties } });
    await db.loadTables();
    const mods = [{ name: "ai1.embed", cache, plugin: {} }];
    const app = { db, settings: { "ai1.embed": { auto: false, collection: "main", chunkChars: 4000 } }, modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
    const node = { app } as Node;
    const api = cms.node.api;
    assertEquals(await api(node, { add: { name: "pictures", model: "image-model" } }), { ok: true });
    await upsert(app, "pictures", { table: "file", id: 7, part: "image" }, [1, 0], "cat picture");
    assertStringIncludes(String(await cms.node.render(node)), "pictures");
    const result = await api(node, { search: { collection: "pictures", query: [1, 0] } });
    assertEquals((result as { hits: { id: string }[] }).hits[0].id, "7");
    assertEquals(await api(node, { enable: { id: 1, on: false } }), { ok: true });
    assertEquals((await db.one`SELECT enabled FROM ai1_embed_collection WHERE id = 1`), 0);
    assertEquals(await api(node, { remove: 1 }), { ok: true });
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM ai1_embed_collection`), 0);
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM ai1_embed_entry`), 0);
    await db.close();
  } finally { await Deno.remove(dir, { recursive: true }); }
});
