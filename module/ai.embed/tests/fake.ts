import * as sqliteVec from "sqlite-vec";
import { Db } from "@qino/qino";
import { aiCapabilities } from "@qino/m/ai/plugin.ts";
import aiSchema from "@qino/m/ai/dbschema.json" with { type: "json" };

import { dbSchema } from "../plugin.ts";

import type { App } from "@qino/qino";

/** A table a module declares to embed something, as in the README: its key columns only. */
export const embeddingTable = (key: Record<string, Record<string, unknown>>) => ({ additionalProperties: { properties: key } });

/** An app with the fake models "multi" (2 dimensions: "cat" → [1,0], other texts → [0,1], images →
 *  [0.8,0.6]), "wide" (the same plus a third dimension of 1) and "textonly" (no images). */
export async function fakeApp(conn: string, tables: Record<string, unknown> = {}) {
  const db = new Db(conn);
  if (db.dialect === "sqlite") sqliteVec.load(db);
  db.schema = { properties: { ...aiSchema.properties, ...tables, ...dbSchema({ properties: tables as never }).properties } };
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
