import { sql } from "@qino/qino";

import type { Db, Row, Sql } from "@qino/qino";
import type { Collection } from "./collection.ts";

// Vectors are stored at length 1, so the default distance of every dialect (euclidean) ranks like
// cosine: cos = 1 - d² / 2. Values travel as JSON text; a stored vector copies over as it is.
const dialects = {
  // sqlite-vec scans exactly; its blob holds any length
  sqlite: {
    in: (value: unknown) => sql`vec_f32(${value})`,
    out: sql`e.embedding`,
    distance: (value: string) => sql`vec_distance_l2(e.embedding, vec_f32(${value}))`,
  },
  // one column length for all collections: shorter vectors are padded with zeros, which keeps distances
  mysql: {
    in: (value: unknown) => sql`VEC_FromText(${value})`,
    out: sql`VEC_ToText(e.embedding)`,
    distance: (value: string) => sql`VEC_DISTANCE_EUCLIDEAN(e.embedding, VEC_FromText(${value}))`,
  },
  // any length per row; each collection gets its own hnsw index over its fixed length
  postgres: {
    in: (value: unknown) => sql`CAST(${value} AS vector)`,
    out: sql`e.embedding::text`,
    distance: (value: string, dimensions: number) => sql`(e.embedding::vector(${sql.raw(String(dimensions))})) <-> CAST(${value} AS vector)`,
  },
};

/** MariaDB's column length, the length every stored vector has there. */
async function width(db: Db, table: string): Promise<number> {
  const type = (await db.columns(table)).find((c) => c.Field === "embedding")?.Type;
  return Number(/\((\d+)\)/.exec(String(type))?.[1] ?? 0);
}

const indexed = new WeakMap<Db, Set<string>>(); // pg indexes known to exist, per database

/** Make room for `collection` in `table`: MariaDB widens the column, pg adds the collection's index. */
export async function fit(db: Db, table: string, c: Collection): Promise<void> {
  if (db.dialect === "mysql" && await width(db, table) < c.dimensions) {
    await db.exec`ALTER TABLE ${sql.id(table)} MODIFY embedding VECTOR(${sql.raw(String(c.dimensions))}) NOT NULL`;
  }
  const name = `${table}_collection_${c.id}`, known = indexed.get(db) ?? indexed.set(db, new Set()).get(db)!;
  if (db.dialect !== "postgres" || c.dimensions > 2000 || known.has(name)) return; // hnsw indexes up to 2000
  await db.exec`CREATE INDEX IF NOT EXISTS ${sql.id(name)} ON ${sql.id(table)}
    USING hnsw ((embedding::vector(${sql.raw(String(c.dimensions))})) vector_l2_ops) WHERE collection_id = ${sql.raw(String(c.id))}`;
  known.add(name);
}

/** Drop what `fit` added for a collection. */
export async function unfit(db: Db, table: string, c: Collection): Promise<void> {
  if (db.dialect === "postgres") await db.exec`DROP INDEX IF EXISTS ${sql.id(`${table}_collection_${c.id}`)}`;
}

/** JSON text of `values` at length 1, padded to MariaDB's column length; undefined if that is too
 *  short, i.e. `fit` never ran and nothing of this length is stored. */
export async function encode(db: Db, table: string, values: number[]): Promise<string | undefined> {
  const norm = Math.hypot(...values);
  if (!norm) throw new Error("A zero vector has no direction");
  const out = values.map((v) => v / norm);
  if (db.dialect === "mysql") {
    const length = await width(db, table);
    if (length < out.length) return;
    out.length = length;
  }
  return JSON.stringify(Array.from(out, (v) => v ?? 0));
}

/** A vector for INSERT, from `encode` or a value selected with `stored`. */
export const vector = (db: Db, value: unknown): Sql => dialects[db.dialect].in(value);

/** The column `e.embedding` in a form `vector()` takes back. */
export const stored = (db: Db): Sql => dialects[db.dialect].out;

/** The collection's rows of `table` (alias `e`) nearest to `value`; `where` applies before the limit. */
export function nearest(db: Db, table: string, keys: string[], c: Collection, value: string, where: Sql | undefined, limit: number): Promise<Row[]> {
  const cols = sql.join(keys.map((col) => sql`e.${sql.id(col)}`), ", ");
  const run = () => db.query`SELECT ${cols}, e.chunk, e.content, ${dialects[db.dialect].distance(value, c.dimensions)} AS distance
    FROM ${sql.id(table)} e WHERE e.collection_id = ${sql.raw(String(c.id))} ${where ? sql`AND (${where})` : sql``}
    ORDER BY distance LIMIT ${limit}`;
  if (db.dialect !== "postgres") return run(); // MariaDB keeps walking its index until the filter is met
  // pgvector otherwise stops after ef_search candidates, and a filter could leave fewer than `limit`
  return db.transaction(async () => {
    await db.exec`SET LOCAL hnsw.iterative_scan = strict_order`;
    return run();
  });
}
