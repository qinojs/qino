import { sql } from "@qino/qino";
import { candidates, embed } from "@qino/qino/ai1";

import { collection, embeddings } from "./lib/collection.ts";
import { encode, fit, json, nearest, stored, vector } from "./lib/vector.ts";

import type { App, Db, Sql } from "@qino/qino";
import type { EmbedInput } from "@qino/qino/ai1";
import type { Collection } from "./lib/collection.ts";

export { collection, collections, create, drop, embeddings } from "./lib/collection.ts";
export { indexFile, indexFiles } from "./sources/file.ts";

/** What is embedded, by the key columns of its table, e.g. `{ file_id: 7 }`. */
type Key = Record<string, string | number>;
/** Text (split into chunks) or an image URL; `hash` identifies the image, e.g. a file's md5. */
type Input = string | { image: string; hash?: string };
type Hit = { name: string; key: Key; chunk: number; content: string; score: number };
type Options = { collection?: number };

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toHex();

/** The table `embedding_<name>` and its key columns. */
function tableOf(db: Db, name: string) {
  const found = embeddings(db).find((e) => e.name === name);
  if (!found) throw new Error(`No table "embedding_${name}": declare it to embed "${name}"`);
  return found;
}

/** `col = value AND …` for the given key columns; `partial` allows a subset. */
function match(keys: string[], key: Key, partial = false): Sql {
  const cols = Object.keys(key);
  if (!cols.length || cols.some((col) => !keys.includes(col)) || !partial && cols.length !== keys.length) {
    throw new Error(`The key has the columns ${keys.join(", ")}, not ${cols.join(", ") || "none"}`);
  }
  return sql.join(cols.map((col) => sql`${sql.id(col)} = ${key[col]}`), " AND ");
}

/** Pieces of at most `max` characters, cut between paragraphs, else lines, else words where possible. */
function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + max, text.length);
    if (end < text.length) {
      const cut = ["\n\n", "\n", " "].map((s) => text.lastIndexOf(s, end)).find((i) => i > at + max / 2);
      if (cut !== undefined) end = cut;
    }
    out.push(text.slice(at, end).trim());
    at = end;
  }
  return out.filter(Boolean);
}

/** Vectors of the collection's own model: another model's vectors would not compare. */
async function vectors(app: App, c: Collection, input: EmbedInput): Promise<number[][]> {
  const [first] = await candidates(app, "embed", input, { model: c.model });
  if (first?.model !== c.model) throw new Error(`Embedding model "${c.model}" is unavailable`);
  const out = await embed(app, input, { model: c.model });
  if (out.some((v) => v.length !== c.dimensions || !v.every(Number.isFinite))) throw new Error(`"${c.model}" returned no vector of ${c.dimensions} dimensions`);
  return out;
}

/** Embed `input` in `embedding_<name>` under `key`. Unchanged chunks are skipped, content known from
 *  elsewhere in the table reuses its vector, chunks a shorter text no longer has are removed; empty
 *  text removes all. Resolves to the vectors it had to embed, e.g. to `search` with one of them. */
export async function index(app: App, name: string, key: Key, input: Input, options: Options = {}): Promise<number[][]> {
  const c = await collection(app, options.collection), db = app.db, { table, keys } = tableOf(db, name), t = sql.id(table);
  if (!c) throw new Error("No embedding collection");
  const text = typeof input === "string";
  if (!text && !c.vision) throw new Error(`"${c.model}" has no vision: it embeds no images`);
  const contents = text ? chunks(input, Number(await app.settings["ai1.embed"].chunkChars)) : [input.image];
  const hashes = text || !input.hash ? await Promise.all(contents.map(sha256)) : [input.hash];
  const where = sql`${match(keys, key)} AND collection_id = ${c.id}`;
  const old = new Map((await db.query`SELECT chunk, hash FROM ${t} WHERE ${where}`).map((row) => [Number(row.chunk), row.hash]));
  const changed = contents.flatMap((_, i) => old.get(i) === hashes[i] ? [] : [i]);
  if (!changed.length && old.size <= contents.length) return [];
  await fit(db, table, c);
  const known = new Map<string, unknown>((await db.query`SELECT hash, ${stored(db)} AS embedding FROM ${t} e
    WHERE collection_id = ${c.id} AND ${sql.in("hash", changed.map((i) => hashes[i]))}`).map((row) => [row.hash, row.embedding]));
  const missing = changed.filter((i) => !known.has(hashes[i]));
  const fresh = missing.length ? await vectors(app, c, text ? { texts: missing.map((i) => contents[i]), purpose: "index" } : { images: contents, purpose: "index" }) : [];
  for (const [n, i] of missing.entries()) known.set(hashes[i], await encode(db, table, fresh[n]));
  const cols = sql.join(keys.map((col) => sql.id(col)), ", "), values = sql.join(keys.map((col) => sql`${key[col]}`), ", ");
  await db.transaction(async () => {
    await db.exec`DELETE FROM ${t} WHERE ${where} AND (chunk >= ${contents.length} OR ${sql.in("chunk", changed)})`;
    for (const i of changed) {
      await db.exec`INSERT INTO ${t} (${cols}, chunk, collection_id, hash, content, embedding)
        VALUES (${values}, ${i}, ${c.id}, ${hashes[i]}, ${text ? contents[i] : ""}, ${vector(db, known.get(hashes[i]))})`;
    }
  });
  return fresh;
}

/** The vectors stored under `key`, one per chunk in order; none where nothing is embedded. With them,
 *  `search` finds what is near a text kept, without embedding it again. */
export async function embedded(app: App, name: string, key: Key, options: Options = {}): Promise<number[][]> {
  const c = await collection(app, options.collection), db = app.db, { table, keys } = tableOf(db, name);
  if (!c) return [];
  const rows = await db.query`SELECT ${json(db)} AS embedding FROM ${sql.id(table)} e
    WHERE ${match(keys, key)} AND e.collection_id = ${c.id} ORDER BY e.chunk`;
  // MariaDB pads to its column length: the collection's own length is what compares
  return rows.map((row) => (JSON.parse(String(row.embedding)) as number[]).slice(0, c.dimensions));
}

/** Remove the vectors under `key` from every collection; a part of the key removes all it covers. */
export async function remove(app: App, name: string, key: Key): Promise<void> {
  const { table, keys } = tableOf(app.db, name);
  await app.db.exec`DELETE FROM ${sql.id(table)} WHERE ${match(keys, key, true)}`;
}

/** How many query vectors are kept per app, the latest used. */
const QUERIES = 1000;
const queries = new WeakMap<App, Map<string, number[]>>();

/** The vector of a text to search for, embedded once per collection: the same query (an agent's role)
 *  is not embedded again. Not the stored ones of equal text: a model embeds a query apart from what it
 *  finds (`purpose`). */
async function queryVector(app: App, c: Collection, text: string): Promise<number[]> {
  const cache = queries.get(app) ?? queries.set(app, new Map()).get(app)!, key = `${c.id} ${await sha256(text)}`;
  const kept = cache.get(key);
  if (kept) return cache.delete(key), cache.set(key, kept), kept; // the latest used last
  const [values] = await vectors(app, c, { texts: [text], purpose: "query" });
  cache.set(key, values);
  if (cache.size > QUERIES) cache.delete(cache.keys().next().value!);
  return values;
}

/** The chunks nearest to `query`, most similar first. `names` are the tables to search, or map each
 *  to a filter on its rows (alias `e`; `true` for none) that applies before the limit. The query is
 *  embedded once, or is a vector of the collection's model already, as `index` gives them. Check
 *  access before showing hits. */
export async function search(app: App, names: string | Record<string, Sql | true>, query: Input | number[], { limit = 10, collection: id }: Options & { limit?: number } = {}): Promise<Hit[]> {
  const c = await collection(app, id), db = app.db;
  const filters = Object.entries(typeof names === "string" ? { [names]: true as const } : names).map(([name, where]) => ({ ...tableOf(db, name), where }));
  if (!c) return [];
  const values = Array.isArray(query) ? query : typeof query === "string" ? await queryVector(app, c, query)
    : (await vectors(app, c, { images: [query.image], purpose: "query" }))[0];
  const hits: Hit[] = [];
  for (const { name, table, keys, where } of filters) {
    const value = await encode(db, table, values);
    if (!value) continue; // nothing of this collection stored there yet
    for (const row of await nearest(db, table, keys, c, value, where, limit)) {
      hits.push({
        name, key: Object.fromEntries(keys.map((col) => [col, row[col]])), chunk: Number(row.chunk),
        content: String(row.content ?? ""), score: 1 - Number(row.distance) ** 2 / 2,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
