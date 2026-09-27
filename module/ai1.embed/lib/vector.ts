import { sql } from "@qino/qino";

import type { Db, Row, Sql } from "@qino/qino";

/** The native vector type of each dialect: sqlite-vec, MariaDB ≥ 11.7 and pgvector. Values travel as
 *  JSON text (`[0.1,0.2]`); a stored vector copies over without that detour. */
const dialects = {
  // sqlite-vec scans exactly; its approximate index is not stable yet.
  sqlite: {
    column: (t: Sql) => [sql`ALTER TABLE ${t} ADD COLUMN embedding BLOB`],
    in: (value: unknown) => sql`vec_f32(${value})`,
    out: sql`e.embedding`,
    distance: (value: string) => sql`vec_distance_cosine(e.embedding, vec_f32(${value}))`,
  },
  mysql: {
    column: (t: Sql, n: number) => [sql`ALTER TABLE ${t} ADD embedding VECTOR(${sql.raw(String(n))}) NOT NULL, ADD VECTOR INDEX (embedding) DISTANCE=cosine`],
    in: (value: unknown) => sql`VEC_FromText(${value})`,
    out: sql`VEC_ToText(e.embedding)`,
    distance: (value: string) => sql`VEC_DISTANCE_COSINE(e.embedding, VEC_FromText(${value}))`,
  },
  postgres: {
    column: (t: Sql, n: number, name: string) => [
      sql`CREATE EXTENSION IF NOT EXISTS vector`,
      sql`ALTER TABLE ${t} ADD embedding vector(${sql.raw(String(n))}) NOT NULL`,
      // hnsw indexes up to 2000 dimensions; longer vectors are searched exactly.
      ...n <= 2000 ? [sql`CREATE INDEX ${sql.id(name + "_embedding")} ON ${t} USING hnsw (embedding vector_cosine_ops)`] : [],
    ],
    in: (value: unknown) => sql`CAST(${value} AS vector)`,
    out: sql`e.embedding::text`,
    distance: (value: string) => sql`e.embedding <=> CAST(${value} AS vector)`,
  },
};

/** Add the vector column (and its index) to a new collection table. */
export async function addColumn(db: Db, table: string, dimensions: number): Promise<void> {
  for (const stmt of dialects[db.dialect].column(sql.id(table), dimensions, table)) await db.exec(stmt);
}

/** A vector for INSERT, from JSON text or a value selected with `stored`. */
export const vector = (db: Db, value: unknown): Sql => dialects[db.dialect].in(value);

/** The column `e.embedding` in a form `vector()` takes back. */
export const stored = (db: Db): Sql => dialects[db.dialect].out;

/** Rows of `table` (alias `e`) nearest to `value`; `where` applies before the limit. */
export function nearest(db: Db, table: string, value: string, where: Sql | undefined, limit: number): Promise<Row[]> {
  const run = () => db.query`SELECT e.source, e.source_id, e.part, e.chunk, e.content, ${dialects[db.dialect].distance(value)} AS distance
    FROM ${sql.id(table)} e ${where ? sql`WHERE ${where}` : sql``} ORDER BY distance LIMIT ${limit}`;
  if (db.dialect !== "postgres") return run(); // MariaDB keeps walking its index until the filter is met
  // pgvector otherwise stops after ef_search candidates, and a filter could leave fewer than `limit`.
  return db.transaction(async () => {
    await db.exec`SET LOCAL hnsw.iterative_scan = strict_order`;
    return run();
  });
}
