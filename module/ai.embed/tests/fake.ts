import * as sqliteVec from "sqlite-vec";
import { Db } from "@qino/qino";
import { aiCapabilities } from "@qino/m/ai/plugin.ts";
import aiSchema from "@qino/m/ai/dbschema.json" with { type: "json" };

import schema from "../dbschema.json" with { type: "json" };

import type { App } from "@qino/qino";

/** A table a module declares to embed something, as in the README: its key columns plus the fixed ones. */
export const embeddingTable = (key: Record<string, Record<string, unknown>>) => ({
  additionalProperties: {
    properties: {
      ...Object.fromEntries(Object.entries(key).map(([col, prop]) => [col, { ...prop, "x-index": "primary" }])),
      chunk: { type: "integer", "x-index": "primary", default: 0 },
      collection_id: { type: "integer", "x-index": "primary", "x-qg-parent": "ai_embed_collection", "x-qg-on-parent-delete": "cascade" },
      hash: { type: "string", maxLength: 64, "x-index": true },
      content: { type: "string" },
      embedding: { type: "array", items: { type: "number" }, "x-vector": true, "x-index": true },
    },
    required: [...Object.keys(key), "chunk", "collection_id", "hash", "embedding"],
  },
});

/** An app with the fake models "multi" (2 dimensions: "cat" → [1,0], other texts → [0,1], images →
 *  [0.8,0.6]), "wide" (the same plus a third dimension of 1) and "textonly" (no images). */
export async function fakeApp(conn: string, tables: Record<string, unknown> = {}) {
  const db = new Db(conn);
  if (db.dialect === "sqlite") sqliteVec.load(db);
  db.schema = { properties: { ...aiSchema.properties, ...schema.properties, ...tables } };
  await db.migrate(db.schema, { patch: true });
  await db.loadTables();
  await db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  for (const name of ["multi", "wide", "textonly"]) {
    const model_id = Number(await db.table("ai_model").insert({ name }));
    await db.table("ai_model_provider").insert({ model_id, provider_id: 1 });
    await db.table("ai_model_capability").insert({ model_id, capability: "embed" });
    if (name !== "textonly") await db.table("ai_model_capability").insert({ model_id, capability: "vision" });
  }
  const calls: string[] = [];
  const embed = (call: { model: string }, input: { texts?: string[]; images?: string[]; purpose?: string }) => {
    calls.push(`${input.purpose}:${input.texts?.length ?? 0}t${input.images?.length ?? 0}i`);
    const pad = (v: number[]) => call.model === "wide" ? [...v, 1] : v;
    return Promise.resolve(input.images ? input.images.map(() => pad([0.8, 0.6])) : input.texts!.map((t) => pad(t.includes("cat") ? [1, 0] : [0, 1])));
  };
  const mods = [{ name: "ai", plugin: { aiCapabilities, aiAdapters: { fake: { embed } } } }];
  const settings = { primary: 0, chunkChars: 4000 };
  const app = {
    db, settings: { core: { keys: {} }, "ai.embed": settings }, fire: () => Promise.resolve(),
    modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
  } as unknown as App;
  return { app, db, calls, settings };
}
