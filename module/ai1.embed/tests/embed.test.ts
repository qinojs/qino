import { DatabaseSync } from "node:sqlite";
import { Db } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };

import schema from "../dbschema.json" with { type: "json" };
import { create, indexImage, indexText, remove, search, sync, upsert } from "../mod.ts";
import { init, install } from "../plugin.ts";

import type { App } from "@qino/qino";

Deno.test("ai1.embed: new installations start with Jina Omni Small", async () => {
  const db = new Db("sqlite::memory:");
  try {
    await db.migrate(schema);
    await db.loadTables();
    const app = { db } as App;
    await install({ app });
    assertEquals(await db.query`SELECT name, model, dimensions FROM ai1_embed_collection`, [{
      name: "jina-embeddings-v5-omni-small/1024", model: "jina-embeddings-v5-omni-small", dimensions: 1024,
    }]);
    await install({ app });
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM ai1_embed_collection`), 1);
  } finally { await db.close(); }
});

Deno.test("ai1.embed: local vectors link text and image embeddings to rows", async () => {
  const dir = await Deno.makeTempDir(), cache = dir + "/";
  try {
    const db = new Db("sqlite::memory:");
    await db.migrate({ properties: { ...ai1Schema.properties, ...schema.properties } });
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT, PRIMARY KEY (text_id, lang))`;
    await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY, text TEXT, mime TEXT, md5 TEXT)`;
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
        if (input.images?.[0]?.endsWith("Aw==")) return Promise.reject(new Error("image failed"));
        return Promise.resolve(input.images ? input.images.map(() => [0.8, 0.2]) : input.texts!.map((t) => t === "cat" ? [1, 0] : [0, 1]));
      } } } } },
      { name: "ai1.embed", cache, plugin: {} },
    ];
    const dbFiles = { file: async (id: number) => {
      const row = await db.table("file").selectByID(id);
      return { reload: () => Promise.resolve(), exists: () => Promise.resolve(true), mime: row!.mime, path: cache + row!.md5,
        transform: () => Promise.resolve(row!.md5 === "d".repeat(32)
          ? { path: cache + "svg.png", mime: "image/png" }
          : { path: cache + row!.md5, mime: row!.mime }),
      };
    } };
    const app = { db, dbFiles, settings: { core: { keys: {} }, "ai1.embed": { auto: true, primary: "", chunkChars: 4000 } }, fire: () => Promise.resolve(), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;

    const primary = await create(app, "multi", 2);
    assertEquals(primary.name, "multi/2");
    assertEquals((await create(app, "multi", 2)).id, primary.id);
    assertEquals(await search(app, "cat"), []);
    await indexText(app, { table: "text_lang", id: "1:en" }, "cat");
    await upsert(app, { table: "file", id: 7, part: "image" }, [0.9, 0.1]);
    assertEquals((await search(app, "cat")).map((hit) => [hit.table, hit.id]), [["text_lang", "1:en"], ["file", "7"]]);
    assertEquals(purposes, ["query", "index", "query"]);
    assertEquals((await search(app, [1, 0], { table: "file" })).map((hit) => hit.part), ["image"]);
    await upsert(app, { table: "file", id: 7, part: "image" }, [0, 1]);
    const cacheDb = new DatabaseSync(cache + "vectors.sqlite");
    assertEquals(cacheDb.prepare("SELECT value FROM revision WHERE collection_id = ?").get(primary.id), { value: 3 });
    cacheDb.close();
    assertEquals((await search(app, [1, 0])).map((hit) => hit.table), ["text_lang", "file"]); // stale cache rebuilt
    await remove(app, { table: "text_lang", id: "1:en" });
    const concurrent = await Promise.all([search(app, [1, 0]), search(app, [1, 0])]);
    for (const hits of concurrent) assertEquals(hits.map((hit) => hit.table), ["file"]);
    await assertRejects(() => upsert(app, { table: "file", id: 8 }, [1, 2, 3]), Error, "dimensions");
    await indexImage(app, { table: "file", id: 8, part: "image" }, "data:image/png;base64,AA==");
    assertEquals((await search(app, [1, 0], { table: "file" })).map((hit) => hit.id), ["8", "7"]);

    const controller = new AbortController();
    init(app, { signal: controller.signal });
    await db.transaction(async () => {
      await db.table("text_lang").insert({ text_id: 12, lang: "en", text: "dog" });
      await db.table("file").insert({ id: 9, text: "cat" });
    });
    for (let i = 0; i < 50 && (await search(app, [0, 1])).filter((hit) => ["9", "12:en"].includes(hit.id)).length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assertEquals((await search(app, [0, 1])).filter((hit) => ["9", "12:en"].includes(hit.id)).map((hit) => hit.table).sort(), ["file", "text_lang"]);
    await db.table("text_lang").delete("12:en");
    for (let i = 0; i < 50 && (await search(app, [0, 1])).some((hit) => hit.id === "12:en"); i++) await new Promise((r) => setTimeout(r, 10));
    assertEquals((await search(app, [0, 1])).filter((hit) => ["9", "12:en"].includes(hit.id)).map((hit) => hit.table), ["file"]);
    await db.exec`UPDATE file SET text = ${"dog"} WHERE id = ${9}`;
    assertEquals(await sync(app), { texts: 0, files: 1, errors: [] });
    assertEquals((await search(app, [0, 1])).find((hit) => hit.id === "9")?.content, "dog");
    controller.abort();

    const img1 = "a".repeat(32), img2 = "b".repeat(32), img3 = "c".repeat(32);
    await Deno.writeFile(cache + img1, new Uint8Array([1]));
    await db.table("file").insert({ id: 10, text: "", mime: "image/png", md5: img1 });
    await sync(app);
    assertEquals((await search(app, [1, 0], { table: "file" })).find((hit) => hit.id === img1)?.part, "image");
    const embedded = purposes.length;
    await sync(app);
    assertEquals(purposes.length, embedded);
    await Deno.writeFile(cache + img2, new Uint8Array([2]));
    const imageController = new AbortController();
    init(app, { signal: imageController.signal });
    await db.table("file").update(10, { md5: img2 });
    for (let i = 0; i < 50; i++) {
      const hits = await search(app, [1, 0], { table: "file" });
      if (hits.some((hit) => hit.id === img2) && !hits.some((hit) => hit.id === img1)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assertEquals((await search(app, [1, 0], { table: "file" })).filter((hit) => /^[a-f0-9]{32}$/.test(hit.id)).map((hit) => hit.id), [img2]);
    imageController.abort();
    await db.table("file").insert({ id: 12, text: "", mime: "image/png", md5: img2 });
    await sync(app);
    assertEquals((await search(app, [1, 0], { table: "file" })).filter((hit) => hit.id === img2).length, 1);
    const deleteController = new AbortController();
    init(app, { signal: deleteController.signal });
    await db.table("file").delete(10);
    await new Promise((r) => setTimeout(r, 20));
    assertEquals((await search(app, [1, 0], { table: "file" })).some((hit) => hit.id === img2), true);
    await db.table("file").delete(12);
    for (let i = 0; i < 50 && (await search(app, [1, 0], { table: "file" })).some((hit) => hit.id === img2); i++) await new Promise((r) => setTimeout(r, 10));
    assertEquals((await search(app, [1, 0], { table: "file" })).some((hit) => hit.id === img2), false);
    deleteController.abort();
    const svg = "d".repeat(32), unsupported = "e".repeat(32);
    await Deno.writeFile(cache + "svg.png", new Uint8Array([4]));
    await db.table("file").insert({ id: 13, text: "", mime: "image/svg+xml", md5: svg });
    await db.table("file").insert({ id: 14, text: "", mime: "image/svg+xml", md5: unsupported });
    assertEquals((await sync(app)).errors, []);
    assertEquals((await search(app, [1, 0], { table: "file" })).filter((hit) => [svg, unsupported].includes(hit.id)).map((hit) => hit.id), [svg]);
    await Deno.writeFile(cache + img3, new Uint8Array([3]));
    await db.table("file").insert({ id: 11, text: "cat", mime: "image/png", md5: img3 });
    assertEquals((await sync(app)).errors[0].endsWith("image failed"), true);
    assertEquals((await search(app, [1, 0], { table: "file" })).some((hit) => hit.id === "11" && hit.part === "text:0"), true);
    await db.close();
  } finally { await Deno.remove(dir, { recursive: true }); }
});
