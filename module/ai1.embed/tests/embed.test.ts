import { sql } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { collection, create, drop, index, remove, search } from "../mod.ts";
import { install } from "../plugin.ts";
import { embeddingTable, fakeApp } from "./fake.ts";

const article = { additionalProperties: { properties: { id: { type: "integer", "x-index": "primary", "x-autoincrement": true } } } };
const articleId = { type: "integer", "x-qg-parent": "article", "x-qg-on-parent-delete": "cascade" };
const tables = {
  article,
  embedding_article_text: embeddingTable({ article_id: articleId, lang: { type: "string", maxLength: 12 } }),
  embedding_article_image: embeddingTable({ article_id: articleId }),
};

const ids = (hits: { name: string; key: Record<string, unknown>; chunk: number }[]) => hits.map((h) => `${h.name}/${Object.values(h.key).join(":")}/${h.chunk}`);

export async function check(conn: string) {
  const { app, db, calls, settings } = await fakeApp(conn, tables);
  const count = async () => Number(await db.one`SELECT COUNT(*) FROM embedding_article_text`) + Number(await db.one`SELECT COUNT(*) FROM embedding_article_image`);
  const both = { article_text: true, article_image: true } as const;
  const image = { image: "data:image/png;base64,AA==", hash: "a".repeat(32) };
  try {
    await install({ app });
    assertEquals((await collection(app))?.model, "jina-embeddings-v5-omni-small");
    await drop(app, (await collection(app))!.id);

    const multi = await create(app, "multi", 2);
    assertEquals((await create(app, "multi", 2)).id, multi.id);
    assertEquals(await search(app, both, "cat"), []);
    calls.length = 0;

    await index(app, "article_text", { article_id: 1, lang: "en" }, "a cat");
    await index(app, "article_text", { article_id: 1, lang: "de" }, "ein Hund");
    await index(app, "article_image", { article_id: 7 }, image);
    await index(app, "article_image", { article_id: 8 }, image);
    assertEquals(calls, ["index:1t0i", "index:1t0i", "index:0t1i"]); // article 8 reused the vector of equal content
    const hits = await search(app, both, "cat");
    assertEquals([ids(hits)[0], ids(hits).slice(1, 3).sort(), ids(hits)[3]], ["article_text/1:en/0", ["article_image/7/0", "article_image/8/0"], "article_text/1:de/0"]); // equal images tie
    assertEquals(hits.map((h) => Math.round(h.score * 100) / 100 + 0), [1, 0.8, 0.8, 0]); // + 0 turns a rounded -0 into 0
    assertEquals(hits[0].key, { article_id: 1, lang: "en" });
    assertEquals(hits[0].content, "a cat");
    assertEquals(ids(await search(app, { article_text: sql`e.lang = ${"de"}` }, "cat")), ["article_text/1:de/0"]);
    assertEquals(ids(await search(app, "article_image", "cat", { limit: 1 })).length, 1);
    await assertRejects(() => search(app, "unknown", "cat"), Error, "embedding_unknown");
    await assertRejects(() => index(app, "article_text", { article_id: 1 }, "cat"), Error, "article_id, lang");

    calls.length = 0;
    await index(app, "article_text", { article_id: 1, lang: "en" }, "a cat");
    assertEquals(calls, []); // unchanged

    settings.chunkChars = 100;
    const key = { article_id: 3, lang: "en" };
    await index(app, "article_text", key, Array.from({ length: 50 }, (_, i) => `dog${i}`).join(" "));
    assertEquals(calls, ["index:3t0i"]);
    await index(app, "article_text", key, "short dog");
    assertEquals(ids(await search(app, { article_text: sql`e.article_id = ${3}` }, "dog")), ["article_text/3:en/0"]);
    await index(app, "article_text", key, "");
    assertEquals(await search(app, { article_text: sql`e.article_id = ${3}` }, "dog"), []);

    // a second, longer model beside the first: its own vectors, the first stays searchable
    const wide = await create(app, "wide", 3);
    await index(app, "article_text", { article_id: 1, lang: "en" }, "a cat", { collection: wide.id });
    assertEquals(ids(await search(app, both, "cat", { collection: wide.id })), ["article_text/1:en/0"]);
    assertEquals((await search(app, both, "cat")).length, 4);
    await drop(app, wide.id);
    assertEquals(await count(), 4);

    const textonly = await create(app, "textonly", 2);
    assertEquals([multi.vision, textonly.vision], [true, false]);
    await assertRejects(() => index(app, "article_image", { article_id: 7 }, image, { collection: textonly.id }), Error, "has no vision");
    await drop(app, textonly.id);

    await remove(app, "article_image", { article_id: 7 });
    await remove(app, "article_text", { article_id: 1 }); // part of the key: every language
    assertEquals(ids(await search(app, both, "cat")), ["article_image/8/0"]);
    await db.table("article").insert({ id: 8 });
    await db.table("article").delete(8); // the article takes its vectors along
    assertEquals(await count(), 0);

    await assertRejects(() => index(app, "article_image", { article_id: 1 }, image, { collection: 999 }), Error, "No embedding collection");
    await drop(app, multi.id);
    assertEquals(await collection(app), undefined);
  } finally { await db.close(); }
}

Deno.test("ai1.embed: index, reuse, chunk, filter and remove vectors (sqlite)", () => check("sqlite::memory:"));
