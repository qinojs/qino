import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };
import embedSchema from "@qino/m/ai1.embed/dbschema.json" with { type: "json" };
import { create, search, upsert } from "@qino/qino/ai1.embed";

import { sync } from "../mod.ts";

import type { App } from "@qino/qino";

Deno.test("cms.embed: indexes page text and extracted file text, preserving image vectors", async () => {
  const dir = await Deno.makeTempDir(), cache = dir + "/";
  try {
    const db = new Db("sqlite::memory:");
    await db.migrate({ properties: { ...ai1Schema.properties, ...embedSchema.properties } });
    await db.exec`CREATE TABLE page (id INTEGER PRIMARY KEY, title_id INTEGER)`;
    await db.exec`CREATE TABLE page_text (page_id INTEGER, text_id INTEGER)`;
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT)`;
    await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY, text TEXT)`;
    await db.exec`CREATE TABLE page_file (page_id INTEGER, file_id INTEGER)`;
    await db.loadTables();
    await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await db.table("ai1_model").insert({ name: "multi" });
    await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    await db.table("ai1_model_capability").insert({ model_id: 1, capability: "embed" });
    await db.exec`INSERT INTO page VALUES (1, 5)`;
    await db.exec`INSERT INTO text_lang VALUES (5, 'en', 'cat page')`;
    await db.exec`INSERT INTO file VALUES (7, 'cat picture')`;
    await db.exec`INSERT INTO page_file VALUES (1, 7)`;
    let embeds = 0;
    const mods = [
      { name: "ai1", plugin: { ai1Capabilities, ai1Adapters: { fake: { embed: (_call: unknown, input: { texts: string[] }) => {
        embeds++;
        return Promise.resolve(input.texts.map((t) => t.includes("cat") ? [1, 0] : [0, 1]));
      } } } } },
      { name: "ai1.embed", cache, plugin: {} },
    ];
    const app = { db, settings: { core: { keys: {} }, "cms.embed": { chunkChars: 4000 }, "ai1.embed": { primary: "" } }, fire: () => Promise.resolve(), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
    await create(app, "multi", 2);
    await upsert(app, { table: "file", id: 7, part: "image" }, [1, 0], { content: "photo" });
    assertEquals(await sync(app), { texts: 1, files: 1, errors: [] });
    assertEquals(embeds, 2);
    assertEquals((await search(app, [1, 0])).map((hit) => [hit.table, hit.part]).sort(), [["file", "image"], ["file", "text:0"], ["text_lang", "text:0"]]);
    await db.exec`UPDATE text_lang SET text = 'dog page' WHERE text_id = 5`;
    assertEquals(await sync(app), { texts: 1, files: 1, errors: [] });
    assertEquals(embeds, 3); // unchanged file text was not embedded again
    assertEquals((await search(app, [0, 1], { table: "text_lang" }))[0].content, "dog page");
    await db.exec`DELETE FROM page_file WHERE file_id = 7`;
    assertEquals(await sync(app), { texts: 1, files: 0, errors: [] });
    assertEquals((await search(app, [1, 0], { table: "file" })).map((hit) => hit.part), ["image"]);
    await db.close();
  } finally { await Deno.remove(dir, { recursive: true }); }
});
