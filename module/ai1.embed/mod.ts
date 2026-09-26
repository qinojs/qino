import { sql, unixTime } from "@qino/qino";
import { candidates, embed } from "@qino/qino/ai1";

import { group } from "./lib/group.ts";
import { changed, matches } from "./lib/vec.ts";
export { create } from "./lib/group.ts";
export { sync } from "./lib/source.ts";

import type { App } from "@qino/qino";
import type { EmbedInput } from "@qino/qino/ai1";
import type { Group, Selection } from "./lib/group.ts";

type Ref = { table: string; id: string | number; part?: string };
type Hit = Omit<Ref, "id"> & { id: string; score: number; content: string; collection: string };

const vec = (values: number[], dimensions?: number | null): number[] => {
  if (!values.length || values.some((n) => !Number.isFinite(n))) throw new Error("An embedding needs finite vector values");
  if (dimensions && values.length !== Number(dimensions)) throw new Error(`Embedding dimensions: expected ${dimensions}, got ${values.length}`);
  return values;
};

const refKey = async (collection: string, ref: Ref): Promise<string> => {
  const data = new TextEncoder().encode(JSON.stringify([collection, ref.table, String(ref.id), ref.part ?? ""]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
};

async function embedding(app: App, group: Group, input: EmbedInput): Promise<number[]> {
  if (!(await candidates(app, "embed", input, { model: group.model })).some((candidate) => candidate.model === group.model))
    throw new Error(`Embedding model "${group.model}" is unavailable`);
  return (await embed(app, input, { model: group.model }))[0];
}

/** Link any database row (and a named part of it) to a vector, including image vectors. */
export async function upsert(app: App, ref: Ref, values: number[], { content = "", ...selection }: Selection & { content?: string } = {}): Promise<void> {
  if (!ref.table || String(ref.id) === "") throw new Error("An embedding needs a table and row id");
  const db = app.db, selected = await group(app, selection, true);
  if (!selected) throw new Error("Create an embedding collection first");
  if (!selected.enabled) throw new Error(`Collection "${selected.name}" is disabled`);
  vec(values, selected.dimensions);
  const key = await refKey(selected.name, ref);
  const saved = await db.transaction(async () => {
    let existing = await db.row`SELECT id FROM ai1_embed_entry WHERE ref = ${key}`;
    const data = { collection_id: selected.id, ref: key, table_name: ref.table, row_id: String(ref.id), part: ref.part ?? "", content, vector: JSON.stringify(values), updated_at: unixTime() };
    if (existing) await db.table("ai1_embed_entry").update(existing.id, data);
    else existing = { id: await db.table("ai1_embed_entry").insert(data) };
    await db.exec`UPDATE ai1_embed_collection SET revision = revision + 1 WHERE id = ${selected.id}`;
    return { id: Number(existing.id), revision: Number(await db.one`SELECT revision FROM ai1_embed_collection WHERE id = ${selected.id}`) };
  });
  await changed(app, { id: selected.id, dimensions: values.length, revision: saved.revision }, saved.id, values, ref.table).catch(() => {});
}

/** Embed text with the collection's pinned model, then store it against a database row. */
export async function indexText(app: App, ref: Ref, content: string, selection: Selection = {}): Promise<void> {
  if (!content.trim()) { await remove(app, ref, selection); return; }
  const selected = await group(app, selection, true);
  if (!selected) throw new Error("Create an embedding collection first");
  const key = await refKey(selected.name, ref);
  if ((await app.db.one`SELECT content FROM ai1_embed_entry WHERE ref = ${key}`) === content) return;
  const values = await embedding(app, selected, { texts: [content], purpose: "index" });
  await upsert(app, ref, values, { model: selected.model, dimensions: selected.dimensions, content });
}

/** Embed an image data URL or provider-readable URL with a multimodal embedding adapter. */
export async function indexImage(app: App, ref: Ref, image: string, selection: Selection & { content?: string } = {}): Promise<void> {
  const selected = await group(app, selection, true);
  if (!selected) throw new Error("Create an embedding collection first");
  const values = await embedding(app, selected, { images: [image], purpose: "index" });
  await upsert(app, ref, values, { ...selection, model: selected.model, dimensions: selected.dimensions });
}

/** Remove one part, or every part of a row when `part` is omitted. */
export async function remove(app: App, ref: Ref, selection: Selection = {}): Promise<void> {
  const selected = await group(app, selection);
  if (!selected) return;
  const where = ref.part === undefined ? sql`` : sql`AND part = ${ref.part}`;
  await app.db.transaction(async () => {
    const deleted = await app.db.exec`DELETE FROM ai1_embed_entry WHERE collection_id = ${selected.id} AND table_name = ${ref.table} AND row_id = ${String(ref.id)} ${where}`;
    if (deleted.affectedRows) await app.db.exec`UPDATE ai1_embed_collection SET revision = revision + 1 WHERE id = ${selected.id}`;
  });
}

/** Cosine search in the local sqlite-vec index; the SQL rows provide the source links. */
export async function search(app: App, query: number[] | string, { table, limit = 10, ...selection }: Selection & { table?: string; limit?: number } = {}): Promise<Hit[]> {
  let selected = await group(app, selection);
  if (!selected?.enabled) return [];
  if (typeof query === "string") {
    query = await embedding(app, selected, { texts: [query], purpose: "query" });
    selected = await app.db.row<Group>`SELECT * FROM ai1_embed_collection WHERE id = ${selected.id}`;
    if (!selected?.enabled) return [];
  }
  vec(query, selected.dimensions);
  limit = Math.min(Math.max(1, Math.floor(limit)), 100);
  if (!Math.hypot(...query)) throw new Error("A query embedding must be nonzero");
  const ranked = await matches(app, selected, query, limit, table);
  if (!ranked.length) return [];
  const rows = await app.db.query`SELECT id, table_name, row_id, part, content FROM ai1_embed_entry WHERE ${sql.in("id", ranked.map((hit) => hit.id))}`;
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ranked.flatMap(({ id, score }) => {
    const row = byId.get(id);
    return row ? [{ table: String(row.table_name), id: String(row.row_id), part: String(row.part), content: String(row.content ?? ""), collection: selected.name, score }] : [];
  });
}
