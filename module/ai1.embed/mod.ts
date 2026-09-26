import { sql, unixTime } from "@qino/qino";
import { candidates, embed } from "@qino/qino/ai1";

import { changed, matches } from "./lib/vec.ts";
export { sync } from "./lib/source.ts";

import type { App } from "@qino/qino";
import type { EmbedInput } from "@qino/qino/ai1";

type Collection = { id: number; name: string; model: string; dimensions: number | null; revision: number; enabled: boolean };
type Ref = { table: string; id: string | number; part?: string };
type Hit = Ref & { score: number; content: string; collection: string };

const vec = (values: number[], dimensions?: number | null): number[] => {
  if (!values.length || values.some((n) => !Number.isFinite(n))) throw new Error("An embedding needs finite vector values");
  if (dimensions && values.length !== Number(dimensions)) throw new Error(`Embedding dimensions: expected ${dimensions}, got ${values.length}`);
  return values;
};

const refKey = async (collection: string, ref: Ref): Promise<string> => {
  const data = new TextEncoder().encode(JSON.stringify([collection, ref.table, String(ref.id), ref.part ?? ""]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
};

async function embedding(app: App, group: Collection, input: EmbedInput): Promise<number[]> {
  if (!(await candidates(app, "embed", input, { model: group.model })).some((candidate) => candidate.model === group.model))
    throw new Error(`Embedding model "${group.model}" is unavailable`);
  return (await embed(app, input, { model: group.model }))[0];
}

/** A collection uses exactly one embedding model, so its vectors stay comparable. */
export async function collection(app: App, name = "main", model?: string): Promise<Collection> {
  const db = app.db;
  const found = await db.row<Collection>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`;
  if (found) {
    if (model && found.model !== model) throw new Error(`Collection "${name}" uses ${found.model}`);
    return found;
  }
  model ??= (await candidates(app, "embed", { texts: [""] }))[0]?.model;
  if (!model) throw new Error("No embedding model configured");
  await db.table("ai1_embed_collection").insert({ name, model });
  return (await db.row<Collection>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`)!;
}

/** Link any database row (and a named part of it) to a vector, including image vectors. */
export async function upsert(app: App, name: string, ref: Ref, values: number[], content = "", model?: string): Promise<void> {
  if (!ref.table || String(ref.id) === "") throw new Error("An embedding needs a table and row id");
  const db = app.db, group = await collection(app, name, model);
  if (!group.enabled) throw new Error(`Collection "${name}" is disabled`);
  vec(values, group.dimensions);
  const key = await refKey(name, ref);
  const saved = await db.transaction(async () => {
    if (!group.dimensions) await db.exec`UPDATE ai1_embed_collection SET dimensions = ${values.length} WHERE id = ${group.id} AND dimensions IS NULL`;
    const dimensions = Number(await db.one`SELECT dimensions FROM ai1_embed_collection WHERE id = ${group.id}`);
    vec(values, dimensions);
    let existing = await db.row`SELECT id FROM ai1_embed_entry WHERE ref = ${key}`;
    const data = { collection_id: group.id, ref: key, table_name: ref.table, row_id: String(ref.id), part: ref.part ?? "", content, vector: JSON.stringify(values), updated_at: unixTime() };
    if (existing) await db.table("ai1_embed_entry").update(existing.id, data);
    else existing = { id: await db.table("ai1_embed_entry").insert(data) };
    await db.exec`UPDATE ai1_embed_collection SET revision = revision + 1 WHERE id = ${group.id}`;
    return { id: Number(existing.id), revision: Number(await db.one`SELECT revision FROM ai1_embed_collection WHERE id = ${group.id}`) };
  });
  await changed(app, { id: group.id, dimensions: values.length, revision: saved.revision }, saved.id, values, ref.table).catch(() => {});
}

/** Embed text with the collection's pinned model, then store it against a database row. */
export async function indexText(app: App, name: string, ref: Ref, content: string, model?: string): Promise<void> {
  if (!content.trim()) { await remove(app, name, ref); return; }
  const group = await collection(app, name, model);
  const key = await refKey(name, ref);
  if ((await app.db.one`SELECT content FROM ai1_embed_entry WHERE ref = ${key}`) === content) return;
  const values = await embedding(app, group, { texts: [content], purpose: "index" });
  await upsert(app, name, ref, values, content);
}

/** Embed an image data URL or provider-readable URL with a multimodal embedding adapter. */
export async function indexImage(app: App, name: string, ref: Ref, image: string, model: string, content = ""): Promise<void> {
  const group = await collection(app, name, model);
  const values = await embedding(app, group, { images: [image], purpose: "index" });
  await upsert(app, name, ref, values, content);
}

/** Remove one part, or every part of a row when `part` is omitted. */
export async function remove(app: App, name: string, ref: Ref): Promise<void> {
  const group = await app.db.row<Collection>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`;
  if (!group) return;
  const where = ref.part === undefined ? sql`` : sql`AND part = ${ref.part}`;
  await app.db.transaction(async () => {
    const deleted = await app.db.exec`DELETE FROM ai1_embed_entry WHERE collection_id = ${group.id} AND table_name = ${ref.table} AND row_id = ${String(ref.id)} ${where}`;
    if (deleted.affectedRows) await app.db.exec`UPDATE ai1_embed_collection SET revision = revision + 1 WHERE id = ${group.id}`;
  });
}

/** Cosine search in the local sqlite-vec index; the SQL rows provide the source links. */
export async function search(app: App, name: string, query: number[] | string, { table, limit = 10 }: { table?: string; limit?: number } = {}): Promise<Hit[]> {
  const group = await app.db.row<Collection>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`;
  if (!group?.enabled || !group.dimensions) return [];
  if (typeof query === "string") {
    query = await embedding(app, group, { texts: [query], purpose: "query" });
  }
  vec(query, group.dimensions);
  limit = Math.min(Math.max(1, Math.floor(limit)), 100);
  if (!Math.hypot(...query)) throw new Error("A query embedding must be nonzero");
  const ranked = await matches(app, { id: group.id, dimensions: Number(group.dimensions), revision: group.revision }, query, limit, table);
  if (!ranked.length) return [];
  const rows = await app.db.query`SELECT id, table_name, row_id, part, content FROM ai1_embed_entry WHERE ${sql.in("id", ranked.map((hit) => hit.id))}`;
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ranked.flatMap(({ id, score }) => {
    const row = byId.get(id);
    return row ? [{ table: String(row.table_name), id: String(row.row_id), part: String(row.part), content: String(row.content ?? ""), collection: name, score }] : [];
  });
}
