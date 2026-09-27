import * as sqliteVec from "sqlite-vec";
import { Db, sql } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";
import { ai1Capabilities } from "@qino/m/ai1/plugin.ts";
import ai1Schema from "@qino/m/ai1/dbschema.json" with { type: "json" };

import schema from "../dbschema.json" with { type: "json" };
import { collection, create, drop, index, remove, search, table } from "../mod.ts";
import { install } from "../plugin.ts";

import type { App } from "@qino/qino";

/** An app with one fake embedding model "multi": "cat" texts → [1,0], other texts → [0,1], images → [0.8,0.2]. */
async function fakeApp(conn: string) {
  const db = new Db(conn);
  if (db.dialect === "sqlite") sqliteVec.load(db);
  await db.migrate({ properties: { ...ai1Schema.properties, ...schema.properties } }, { patch: true });
  await db.loadTables();
  await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai1_model").insert({ name: "multi" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
  await db.table("ai1_model_capability").insert({ model_id: 1, capability: "embed" });
  await db.table("ai1_model_capability").insert({ model_id: 1, capability: "vision" });
  const calls: string[] = [];
  const embed = (_call: unknown, input: { texts?: string[]; images?: string[]; purpose?: string }) => {
    calls.push(`${input.purpose}:${input.texts?.length ?? 0}t${input.images?.length ?? 0}i`);
    return Promise.resolve(input.images ? input.images.map(() => [0.8, 0.2]) : input.texts!.map((t) => t.includes("cat") ? [1, 0] : [0, 1]));
  };
  const mods = [{ name: "ai1", plugin: { ai1Capabilities, ai1Adapters: { fake: { embed } } } }];
  const settings = { primary: 0, chunkChars: 4000 };
  const app = {
    db, settings: { core: { keys: {} }, "ai1.embed": settings }, fire: () => Promise.resolve(),
    modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
  } as unknown as App;
  return { app, db, calls, settings };
}

const ids = (hits: { source: string; id: number; part: string; chunk: number }[]) => hits.map((h) => `${h.source}/${h.id}/${h.part}/${h.chunk}`);

export async function check(conn: string) {
  const { app, db, calls, settings } = await fakeApp(conn);
  try {
    await install({ app });
    assertEquals((await collection(app))?.model, "jina-embeddings-v5-omni-small");
    await drop(app, (await collection(app))!.id);

    const multi = await create(app, "multi", 2);
    assertEquals((await create(app, "multi", 2)).id, multi.id);
    assertEquals((await collection(app))?.id, multi.id);
    assertEquals(await search(app, "cat"), []);
    calls.length = 0;

    await index(app, { source: "text", id: 1, part: "en" }, "a cat");
    await index(app, { source: "text", id: 2, part: "en" }, "a dog");
    await index(app, { source: "file", id: 7, part: "image" }, { image: "data:image/png;base64,AA==", hash: "a".repeat(32) });
    await index(app, { source: "file", id: 8, part: "image" }, { image: "data:image/png;base64,AA==", hash: "a".repeat(32) });
    assertEquals(calls, ["index:1t0i", "index:1t0i", "index:0t1i"]); // file 8 reused the vector of equal content
    const hits = ids(await search(app, "cat"));
    assertEquals([hits[0], hits.slice(1, 3).sort(), hits[3]], ["text/1/en/0", ["file/7/image/0", "file/8/image/0"], "text/2/en/0"]); // equal images tie
    assertEquals(ids(await search(app, "cat", { where: sql`e.source = ${"text"}`, limit: 1 })), ["text/1/en/0"]);
    assertEquals((await search(app, "cat", { limit: 1 }))[0].content, "a cat");

    calls.length = 0;
    await index(app, { source: "text", id: 1, part: "en" }, "a cat");
    assertEquals(calls, []); // unchanged

    settings.chunkChars = 100;
    const long = Array.from({ length: 50 }, (_, i) => `dog${i}`).join(" ");
    await index(app, { source: "text", id: 3, part: "de" }, long);
    assertEquals(calls, ["index:3t0i"]);
    await index(app, { source: "text", id: 3, part: "de" }, "short dog");
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table(multi))} WHERE source_id = ${3}`), 1);
    await index(app, { source: "text", id: 3, part: "de" }, "");
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table(multi))} WHERE source_id = ${3}`), 0);

    await remove(app, { source: "file", id: 7 });
    await remove(app, { source: "text", id: 2, part: "en" });
    assertEquals(ids(await search(app, "cat")), ["text/1/en/0", "file/8/image/0"]);

    const wide = await create(app, "multi", 3);
    await assertRejects(() => index(app, { source: "text", id: 1 }, "cat", { collection: wide.id }), Error, "3 dimensions");
    await assertRejects(() => index(app, { source: "text", id: 1 }, "cat", { collection: 999 }), Error, "Unknown");
    await drop(app, wide.id);
    await drop(app, multi.id);
    assertEquals(await collection(app), undefined);
  } finally { await db.close(); }
}

Deno.test("ai1.embed: index, reuse, chunk, filter and remove vectors (sqlite)", () => check("sqlite::memory:"));
