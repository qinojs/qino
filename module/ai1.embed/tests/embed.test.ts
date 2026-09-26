import { DatabaseSync } from "node:sqlite";
import { Db } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };

import schema from "../dbschema.json" with { type: "json" };
import { collection, indexImage, indexText, remove, search, sync, upsert } from "../mod.ts";
import { init } from "../plugin.ts";

import type { App } from "@qino/qino";

Deno.test("ai1.embed: local vectors link text and image embeddings to rows", async () => {
  const dir = await Deno.makeTempDir(), cache = dir + "/";
  try {
    const db = new Db("sqlite::memory:");
    await db.migrate({ properties: { ...ai1Schema.properties, ...schema.properties } });
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT, PRIMARY KEY (text_id, lang))`;
    await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY, text TEXT)`;
    await db.loadTables();
    await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await db.table("ai1_model").insert({ name: "multi" });
    await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    await db.table("ai1_model_capability").insert({ model_id: 1, capability: "embed" });
    await db.table("ai1_model_capability").insert({ model_id: 1, capability: "vision" });
    const purposes: (string | undefined)[] = [];
    const mods = [
      { name: "ai1", plugin: { ai1Capabilities, ai1Adapters: { fake: { embed: (_call: unknown, input: { texts?: string[]; images?: string[]; purpose?: string }) => {
        purposes.push(input.purpose);
        return Promise.resolve(input.images ? input.images.map(() => [0.8, 0.2]) : input.texts!.map((t) => t === "cat" ? [1, 0] : [0, 1]));
      } } } } },
      { name: "ai1.embed", cache, plugin: {} },
    ];
    const app = { db, settings: { core: { keys: {} }, "ai1.embed": { auto: true, collection: "source", chunkChars: 4000 } }, fire: () => Promise.resolve(), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;

    await collection(app, "empty", "multi");
    assertEquals(await search(app, "empty", "cat"), []);
    await indexText(app, "main", { table: "text_lang", id: "1:en" }, "cat");
    await upsert(app, "main", { table: "file", id: 7, part: "image" }, [0.9, 0.1]);
    assertEquals((await search(app, "main", "cat")).map((hit) => [hit.table, hit.id]), [["text_lang", "1:en"], ["file", "7"]]);
    assertEquals(purposes, ["index", "query"]);
    assertEquals((await search(app, "main", [1, 0], { table: "file" })).map((hit) => hit.part), ["image"]);
    await upsert(app, "main", { table: "file", id: 7, part: "image" }, [0, 1]);
    const cacheDb = new DatabaseSync(cache + "vectors.sqlite");
    assertEquals(cacheDb.prepare("SELECT value FROM revision WHERE collection_id = ?").get((await collection(app, "main")).id), { value: 3 });
    cacheDb.close();
    assertEquals((await search(app, "main", [1, 0])).map((hit) => hit.table), ["text_lang", "file"]); // stale cache rebuilt
    await remove(app, "main", { table: "text_lang", id: "1:en" });
    const concurrent = await Promise.all([search(app, "main", [1, 0]), search(app, "main", [1, 0])]);
    for (const hits of concurrent) assertEquals(hits.map((hit) => hit.table), ["file"]);
    assertEquals((await collection(app, "main")).dimensions, 2);
    await assertRejects(() => upsert(app, "main", { table: "file", id: 8 }, [1, 2, 3]), Error, "dimensions");
    await indexImage(app, "main", { table: "file", id: 8, part: "image" }, "data:image/png;base64,AA==", "multi");
    assertEquals((await search(app, "main", [1, 0], { table: "file" })).map((hit) => hit.id), ["8", "7"]);

    const controller = new AbortController();
    init(app, { signal: controller.signal });
    await db.transaction(async () => {
      await db.table("text_lang").insert({ text_id: 12, lang: "en", text: "dog" });
      await db.table("file").insert({ id: 9, text: "cat" });
    });
    for (let i = 0; i < 50 && (await search(app, "source", [0, 1])).length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assertEquals((await search(app, "source", [0, 1])).map((hit) => hit.table).sort(), ["file", "text_lang"]);
    await db.table("text_lang").delete("12:en");
    for (let i = 0; i < 50 && (await search(app, "source", [0, 1])).length > 1; i++) await new Promise((r) => setTimeout(r, 10));
    assertEquals((await search(app, "source", [0, 1])).map((hit) => hit.table), ["file"]);
    await db.exec`UPDATE file SET text = ${"dog"} WHERE id = ${9}`;
    assertEquals(await sync(app, "source"), { texts: 0, files: 1, errors: [] });
    assertEquals((await search(app, "source", [0, 1]))[0].content, "dog");
    controller.abort();
    await db.close();
  } finally { await Deno.remove(dir, { recursive: true }); }
});
