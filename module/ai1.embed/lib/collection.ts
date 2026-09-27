import { sql } from "@qino/qino";

import { unfit } from "./vector.ts";

import type { App, Db, Row } from "@qino/qino";

/** One embedding model with its vector length; `vision` if the model embeds images too, as in ai1. */
export type Collection = { id: number; model: string; dimensions: number; vision: boolean };

/** A table `embedding_<name>`, declared by the module that embeds something; `keys` are its primary
 *  key columns besides chunk and collection_id. */
export type Embedding = { name: string; table: string; keys: string[] };

/** All embedding tables of the database. */
export const embeddings = (db: Db): Embedding[] => Object.keys(db.tables).flatMap((table) => {
  const props = db.schema.properties[table]?.additionalProperties?.properties;
  if (!table.startsWith("embedding_") || !props) return [];
  const keys = Object.keys(props).filter((col) => props[col]["x-index"] === "primary" && col !== "chunk" && col !== "collection_id");
  return [{ name: table.slice("embedding_".length), table, keys }];
});

const select = sql`SELECT id, model, dimensions, EXISTS (SELECT 1 FROM ai1_model_capability k JOIN ai1_model m ON m.id = k.model_id
  WHERE m.name = ai1_embed_collection.model AND k.capability = ${"vision"}) AS vision FROM ai1_embed_collection`;
const read = (row?: Row): Collection | undefined => row && { id: Number(row.id), model: String(row.model), dimensions: Number(row.dimensions), vision: !!Number(row.vision) };

/** The collection for `model` and `dimensions`, created if missing. */
export async function create(app: App, model: string, dimensions: number): Promise<Collection> {
  model = model.trim();
  if (!model || !Number.isSafeInteger(dimensions) || dimensions < 1) throw new Error("A model and a positive vector length are required");
  const find = async () => read(await app.db.row`${select} WHERE model = ${model} AND dimensions = ${dimensions}`);
  return await find() ?? (await app.db.table("ai1_embed_collection").insert({ model, dimensions }).then(find))!;
}

/** The collection `id`; without one the primary collection, else the first. */
export async function collection(app: App, id?: number): Promise<Collection | undefined> {
  const primary = Number(await app.settings["ai1.embed"].primary);
  return read(await app.db.row`${select} ${id ? sql`WHERE id = ${id}` : sql`ORDER BY id = ${primary} DESC, id LIMIT 1`}`);
}

/** All collections, oldest first. */
export const collections = async (app: App): Promise<Collection[]> => (await app.db.query`${select} ORDER BY id`).map((row) => read(row)!);

/** Delete a collection with its vectors. */
export async function drop(app: App, id: number): Promise<void> {
  const db = app.db;
  // one DELETE per table; the row-wise cascade of the collection row would take ages here
  for (const { table } of embeddings(db)) {
    await db.exec`DELETE FROM ${sql.id(table)} WHERE collection_id = ${id}`;
    await unfit(db, table, id);
  }
  await db.table("ai1_embed_collection").delete(id);
  if (Number(await app.settings["ai1.embed"].primary) === id) await app.settings["ai1.embed"].primary(0);
}
