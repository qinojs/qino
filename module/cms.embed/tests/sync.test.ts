import { sql } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { create, search } from "@qino/qino/ai1.embed";
import { fakeApp } from "@qino/m/ai1.embed/tests/fake.ts";

import schema from "../dbschema.json" with { type: "json" };
import { sync } from "../mod.ts";

import type { App } from "@qino/qino";

const hits = async (app: App) => (await search(app, "node_text", "cat", { limit: 20 })).map((h) => Object.values(h.key).join(":")).sort();

export async function check(conn: string) {
  const { app, db, calls } = await fakeApp(conn, schema.properties);
  try {
    await db.exec`CREATE TABLE page (id INTEGER PRIMARY KEY, title_id INTEGER)`;
    await db.exec`CREATE TABLE page_text (page_id INTEGER, name VARCHAR(128), text_id INTEGER)`;
    await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang VARCHAR(5), text TEXT)`;
    await db.loadTables();
    await db.exec`INSERT INTO page VALUES (1, 5)`;
    await db.exec`INSERT INTO page_text VALUES (1, ${"main"}, 6)`;
    await db.exec`INSERT INTO text_lang VALUES (5, 'en', 'cat page'), (5, 'de', 'Katzenseite'), (6, 'en', '<h2>Cats</h2><p>A <b>cat</b> &amp; dog</p><ul><li>one</li><li>two</li></ul>'), (9, 'en', 'unused cat')`;
    await create(app, "multi", 2);

    assertEquals(await sync(app), { nodes: 2, errors: [] });
    assertEquals(await hits(app), ["1:de", "1:en"]);
    const english = await search(app, { node_text: sql`e.lang = ${"en"}` }, "cat");
    assertEquals(english.map((h) => [h.key, h.content]), [[{ node_id: 1, lang: "en" }, "# cat page\n\n## Cats\n\nA **cat** & dog\n\n- one\n- two"]]);
    const embedded = calls.length;
    assertEquals(await sync(app), { nodes: 2, errors: [] });
    assertEquals(calls.length, embedded); // nothing changed, nothing embedded

    await db.exec`DELETE FROM page_text`;
    await sync(app);
    assertEquals(await hits(app), ["1:de", "1:en"]);
    assertEquals((await search(app, { node_text: sql`e.lang = ${"en"}` }, "cat"))[0].content, "# cat page");
    await db.exec`DELETE FROM text_lang WHERE lang = ${"de"}`;
    await sync(app);
    assertEquals(await hits(app), ["1:en"]); // the node has no German any more
  } finally { await db.close(); }
}

Deno.test("cms.embed: indexes page texts, skips unchanged content, drops unused vectors", () => check("sqlite::memory:"));
