import { sql } from "@qino/qino";
import { candidates, embed } from "@qino/qino/ai1";

import { collection, table } from "./lib/collection.ts";
import { nearest, stored, vector } from "./lib/vector.ts";
export { collection, collections, create, drop, table } from "./lib/collection.ts";

import type { App, Sql } from "@qino/qino";
import type { EmbedInput } from "@qino/qino/ai1";
import type { Collection } from "./lib/collection.ts";

/** What a vector belongs to: a row of `source` (usually its table), optionally one `part` of it. */
export type Ref = { source: string; id: number; part?: string };
/** Text (split into chunks) or an image URL; `hash` identifies the image, e.g. a file's md5. */
export type Input = string | { image: string; hash?: string };
type Hit = Required<Ref> & { chunk: number; content: string; score: number };
type Options = { collection?: number };

const hex = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toHex();

/** Pieces of at most `max` characters, cut at a space where possible. */
function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + max, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > at + max / 2) end = space;
    }
    out.push(text.slice(at, end).trim());
    at = end;
  }
  return out.filter(Boolean);
}

/** Vectors of the collection's own model: another model's vectors would not compare. */
async function vectors(app: App, collection: Collection, input: EmbedInput): Promise<string[]> {
  const [first] = await candidates(app, "embed", input, { model: collection.model });
  if (first?.model !== collection.model) throw new Error(`Embedding model "${collection.model}" is unavailable`);
  return (await embed(app, input, { model: collection.model })).map((values) => {
    if (values.length !== collection.dimensions || !values.every(Number.isFinite)) throw new Error(`"${collection.model}" returned no vector of ${collection.dimensions} dimensions`);
    return JSON.stringify(values);
  });
}

const collectionOf = async (app: App, id?: number): Promise<Collection> =>
  await collection(app, id) ?? Promise.reject(new Error(id ? `Unknown embedding collection ${id}` : "Create an embedding collection first"));

/** Embed `input` for `ref`. Unchanged chunks are skipped, content known from elsewhere reuses its
 *  vector, and chunks a shorter text no longer has are removed; empty text removes them all. */
export async function index(app: App, ref: Ref, input: Input, options: Options = {}): Promise<void> {
  const c = await collectionOf(app, options.collection), db = app.db, t = sql.id(table(c)), part = ref.part ?? "";
  const text = typeof input === "string";
  const contents = text ? chunks(input, Number(await app.settings["ai1.embed"].chunkChars) || 4000) : [input.image];
  const hashes = text || !input.hash ? await Promise.all(contents.map(hex)) : [input.hash];
  const key = sql`source = ${ref.source} AND source_id = ${ref.id} AND part = ${part}`;
  const old = new Map((await db.query`SELECT chunk, hash FROM ${t} WHERE ${key}`).map((row) => [Number(row.chunk), row.hash]));
  const changed = contents.flatMap((_, i) => old.get(i) === hashes[i] ? [] : [i]);
  if (!changed.length && old.size <= contents.length) return;
  const known = new Map<string, unknown>(changed.length
    ? (await db.query`SELECT hash, ${stored(db)} AS embedding FROM ${t} e WHERE ${sql.in("hash", changed.map((i) => hashes[i]))}`).map((row) => [row.hash, row.embedding])
    : []);
  const missing = changed.filter((i) => !known.has(hashes[i]));
  if (missing.length) {
    const values = await vectors(app, c, text ? { texts: missing.map((i) => contents[i]), purpose: "index" } : { images: contents, purpose: "index" });
    missing.forEach((i, n) => known.set(hashes[i], values[n]));
  }
  await db.transaction(async () => {
    await db.exec`DELETE FROM ${t} WHERE ${key} AND (chunk >= ${contents.length} OR ${sql.in("chunk", changed)})`;
    for (const i of changed) {
      await db.exec`INSERT INTO ${t} (source, source_id, part, chunk, hash, content, embedding)
        VALUES (${ref.source}, ${ref.id}, ${part}, ${i}, ${hashes[i]}, ${text ? contents[i] : ""}, ${vector(db, known.get(hashes[i]))})`;
    }
  });
}

/** Remove the vectors of a row, or of one part of it, from every collection. */
export async function remove(app: App, ref: Ref): Promise<void> {
  for (const id of await app.db.col<number>`SELECT id FROM ai1_embed_collection`) {
    await app.db.exec`DELETE FROM ${sql.id(table({ id }))}
      WHERE source = ${ref.source} AND source_id = ${ref.id} ${ref.part === undefined ? sql`` : sql`AND part = ${ref.part}`}`;
  }
}

/** The chunks nearest to `query`, most similar first. `where` filters the collection's rows (alias
 *  `e`) before the limit applies, e.g. sql`e.source = ${"text"}`. Check access before showing hits. */
export async function search(app: App, query: Input, { where, limit = 10, ...options }: Options & { where?: Sql; limit?: number } = {}): Promise<Hit[]> {
  const c = await collection(app, options.collection);
  if (!c) return [];
  const [value] = await vectors(app, c, typeof query === "string" ? { texts: [query], purpose: "query" } : { images: [query.image], purpose: "query" });
  const rows = await nearest(app.db, table(c), value, where, Math.max(1, Math.trunc(limit) || 10));
  return rows.map((row) => ({
    source: String(row.source), id: Number(row.source_id), part: String(row.part), chunk: Number(row.chunk),
    content: String(row.content ?? ""), score: 1 - Number(row.distance),
  }));
}
