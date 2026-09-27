import * as sqliteVec from "sqlite-vec";
import { Db, sql } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };
import embedSchema from "@qino/m/ai1.embed/dbschema.json" with { type: "json" };
import { create, search } from "@qino/qino/ai1.embed";

import { sync } from "../mod.ts";

import type { App } from "@qino/qino";

const hits = async (app: App) => (await search(app, "cat", { limit: 20 })).map((h) => `${h.source}/${h.id}/${h.part}`).sort();

export async function check(conn: string) {
  const dir = await Deno.makeTempDir(), db = new Db(conn);
  try {
    if (db.dialect === "sqlite") sqliteVec.load(db);
    await db.migrate({ properties: { ...ai1Schema.properties, ...embedSchema.properties } }, { patch: true });
    await db.exec`CREATE TABLE page (id INTEGER PRIMARY KEY, title_id INTEGER)`;
    await db.exec`CREATE TABLE page_text (page_id INTEGER, text_id INTEGER)`;
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang VARCHAR(5), text TEXT)`;
    await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY, text TEXT, mime VARCHAR(64), md5 VARCHAR(32))`;
    await db.exec`CREATE TABLE page_file (page_id INTEGER, file_id INTEGER)`;
    await db.loadTables();
    await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await db.table("ai1_model").insert({ name: "multi" });
    await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    await db.table("ai1_model_capability").insert({ model_id: 1, capability: "embed" });
    await db.table("ai1_model_capability").insert({ model_id: 1, capability: "vision" });
    await db.exec`INSERT INTO page VALUES (1, 5)`;
    await db.exec`INSERT INTO page_text VALUES (1, 6)`;
    await db.exec`INSERT INTO text_lang VALUES (5, 'en', 'cat page'), (5, 'de', 'Katzenseite'), (6, 'en', '<p>cat &amp; dog</p>'), (9, 'en', 'unused cat')`;
    await db.exec`INSERT INTO file VALUES (7, 'cat picture', 'image/png', ${"a".repeat(32)}), (8, NULL, 'image/png', ${"a".repeat(32)})`;
    await db.exec`INSERT INTO page_file VALUES (1, 7), (1, 8)`;
    await Deno.writeFile(`${dir}/image.png`, new Uint8Array([1]));
    let embeds = 0;
    const embed = (_call: unknown, input: { texts?: string[]; images?: string[] }) => {
      embeds++;
      return Promise.resolve(input.images ? [[0.8, 0.2]] : input.texts!.map((t) => t.includes("cat") ? [1, 0] : [0, 1]));
    };
    const mods = [{ name: "ai1", plugin: { ai1Capabilities, ai1Adapters: { fake: { embed } } } }];
    const dbFiles = { file: (id: number) => Promise.resolve({
      exists: () => Promise.resolve(true), path: `${dir}/image.png`, mime: "image/png", extractText: () => Promise.resolve(id === 8 ? "" : "?"),
    }) };
    const app = {
      db, dbFiles, settings: { core: { keys: {} }, "ai1.embed": { primary: 0, chunkChars: 4000 } }, fire: () => Promise.resolve(),
      modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
    } as unknown as App;
    await create(app, "multi", 2);

    assertEquals(await sync(app), { texts: 3, files: 2, errors: [] });
    assertEquals(await hits(app), ["file/7/image", "file/7/text", "file/8/image", "text/5/de", "text/5/en", "text/6/en"]);
    const english = await search(app, "cat", { where: sql`e.source = ${"text"} AND e.part = ${"en"}` });
    assertEquals(english.map((h) => [h.id, h.content]).sort(), [[5, "cat page"], [6, "cat & dog"]]);
    const embedded = embeds;
    assertEquals(await sync(app), { texts: 3, files: 2, errors: [] });
    assertEquals(embeds, embedded); // nothing changed, nothing embedded

    await db.exec`DELETE FROM page_text`;
    await db.exec`DELETE FROM page_file WHERE file_id = ${7}`;
    await db.exec`UPDATE file SET mime = ${"application/pdf"} WHERE id = ${8}`;
    await sync(app);
    assertEquals(await hits(app), ["text/5/de", "text/5/en"]);
  } finally {
    await db.close();
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("cms.embed: indexes page texts and files, skips unchanged content, drops unused vectors", () => check("sqlite::memory:"));
