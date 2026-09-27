import { sql } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { create, search } from "@qino/qino/ai1.embed";
import { fakeApp } from "@qino/m/ai1.embed/tests/fake.ts";

import schema from "../dbschema.json" with { type: "json" };
import { sync } from "../mod.ts";

import type { App } from "@qino/qino";

const all = { node_text: true, file_text: true, file_image: true } as const;
const hits = async (app: App) => (await search(app, all, "cat", { limit: 20 })).map((h) => `${h.name}/${Object.values(h.key).join(":")}`).sort();

export async function check(conn: string) {
  const dir = await Deno.makeTempDir();
  const { app, db, calls } = await fakeApp(conn, schema.properties);
  try {
    await db.exec`CREATE TABLE page (id INTEGER PRIMARY KEY, title_id INTEGER)`;
    await db.exec`CREATE TABLE page_text (page_id INTEGER, name VARCHAR(128), text_id INTEGER)`;
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang VARCHAR(5), text TEXT)`;
    await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY, text TEXT, mime VARCHAR(64), md5 VARCHAR(32))`;
    await db.exec`CREATE TABLE page_file (page_id INTEGER, file_id INTEGER)`;
    await db.loadTables();
    await db.exec`INSERT INTO page VALUES (1, 5)`;
    await db.exec`INSERT INTO page_text VALUES (1, ${"main"}, 6)`;
    await db.exec`INSERT INTO text_lang VALUES (5, 'en', 'cat page'), (5, 'de', 'Katzenseite'), (6, 'en', '<h2>Cats</h2><p>A <b>cat</b> &amp; dog</p><ul><li>one</li><li>two</li></ul>'), (9, 'en', 'unused cat')`;
    await db.exec`INSERT INTO file VALUES (7, 'cat picture', 'image/png', ${"a".repeat(32)}), (8, NULL, 'image/png', ${"a".repeat(32)})`;
    await db.exec`INSERT INTO page_file VALUES (1, 7), (1, 8)`;
    await Deno.writeFile(`${dir}/image.png`, new Uint8Array([1]));
    Object.assign(app, { dbFiles: { file: (id: number) => Promise.resolve({
      exists: () => Promise.resolve(true), path: `${dir}/image.png`, mime: "image/png", extractText: () => Promise.resolve(id === 8 ? "" : "?"),
    }) } });
    await create(app, "multi", 2);

    assertEquals(await sync(app), { nodes: 2, files: 2, errors: [] });
    assertEquals(await hits(app), ["file_image/7", "file_image/8", "file_text/7", "node_text/1:de", "node_text/1:en"]);
    const english = await search(app, { node_text: sql`e.lang = ${"en"}` }, "cat");
    assertEquals(english.map((h) => [h.key, h.content]), [[{ node_id: 1, lang: "en" }, "# cat page\n\n## Cats\n\nA **cat** & dog\n\n- one\n- two"]]);
    const embedded = calls.length;
    assertEquals(await sync(app), { nodes: 2, files: 2, errors: [] });
    assertEquals(calls.length, embedded); // nothing changed, nothing embedded

    await db.exec`DELETE FROM page_text`;
    await db.exec`DELETE FROM page_file WHERE file_id = ${7}`;
    await db.exec`UPDATE file SET mime = ${"application/pdf"} WHERE id = ${8}`;
    await sync(app);
    assertEquals(await hits(app), ["node_text/1:de", "node_text/1:en"]);
    assertEquals((await search(app, { node_text: sql`e.lang = ${"en"}` }, "cat"))[0].content, "# cat page");
  } finally {
    await db.close();
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("cms.embed: indexes page texts and files, skips unchanged content, drops unused vectors", () => check("sqlite::memory:"));
