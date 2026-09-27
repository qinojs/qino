import { sql } from "@qino/qino";

import { addColumn } from "./vector.ts";

import type { App } from "@qino/qino";

/** One embedding model with its vector length; its vectors live in their own table. */
export type Collection = { id: number; model: string; dimensions: number };

/** The collection's table; the id comes from the database, never from input. */
export const table = (collection: Pick<Collection, "id">): string => `ai1_embed_${collection.id}`;

// `source` + `source_id` point to the row, `part` names a field, language or image of it, `chunk`
// numbers the pieces of a long text. `hash` identifies the content: unchanged content is not
// embedded again, and equal content elsewhere lends its vector.
const columns = {
  properties: {
    id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
    source: { type: "string", maxLength: 64 },
    source_id: { type: "integer" },
    part: { type: "string", maxLength: 64, default: "" },
    chunk: { type: "integer", default: 0 },
    hash: { type: "string", maxLength: 64, "x-index": true },
    content: { type: "string" },
  },
  required: ["id", "source", "source_id", "part", "chunk", "hash"],
};

const select = sql`SELECT id, model, dimensions FROM ai1_embed_collection`;

/** The collection for `model` and `dimensions`, created with its table if missing. */
export async function create(app: App, model: string, dimensions: number): Promise<Collection> {
  model = String(model ?? "").trim();
  if (!model || !Number.isSafeInteger(dimensions) || dimensions < 1) throw new Error("A model and a positive vector length are required");
  const db = app.db;
  const found = await db.row<Collection>`${select} WHERE model = ${model} AND dimensions = ${dimensions}`;
  if (found) return found;
  const collection = { id: Number(await db.table("ai1_embed_collection").insert({ model, dimensions })), model, dimensions };
  const name = table(collection);
  try {
    await db.migrate({ properties: { [name]: { additionalProperties: columns } } }, { patch: true });
    await db.exec`CREATE UNIQUE INDEX ${sql.id(name + "_ref")} ON ${sql.id(name)} (source, source_id, part, chunk)`;
    await addColumn(db, name, dimensions);
    await db.loadTables();
  } catch (e) {
    await drop(app, collection.id);
    throw e;
  }
  return collection;
}

/** The collection `id`; without one the primary collection, else the first. */
export async function collection(app: App, id?: number): Promise<Collection | undefined> {
  if (id) return app.db.row<Collection>`${select} WHERE id = ${id}`;
  const primary = Number(await app.settings["ai1.embed"].primary);
  return primary && await app.db.row<Collection>`${select} WHERE id = ${primary}` || app.db.row<Collection>`${select} ORDER BY id LIMIT 1`;
}

/** All collections, oldest first. */
export const collections = (app: App): Promise<Collection[]> => app.db.query<Collection>`${select} ORDER BY id`;

/** Delete a collection with its vectors. */
export async function drop(app: App, id: number): Promise<void> {
  await app.db.exec`DROP TABLE IF EXISTS ${sql.id(table({ id }))}`;
  await app.db.exec`DELETE FROM ai1_embed_collection WHERE id = ${id}`;
  if (Number(await app.settings["ai1.embed"].primary) === id) await app.settings["ai1.embed"].primary(0);
  await app.db.loadTables();
}
