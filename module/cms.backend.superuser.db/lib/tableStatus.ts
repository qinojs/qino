import { sql, type Db } from "../../core/mod.ts";

export interface TableStatus { rows: number | null; bytes: number | null; engine: string; }

/** Per-dialect table stats for the db inspector (rows/size/engine); null where a backend can't report it cheaply. */
export function tableStatus(db: Db, table: string): Promise<TableStatus> {
  if (db.dialect === "mysql") return mysqlStatus(db, table);
  if (db.dialect === "postgres") return pgStatus(db, table);
  return sqliteStatus(db, table);
}

async function mysqlStatus(db: Db, table: string): Promise<TableStatus> {
  const s = await db.row`SHOW TABLE STATUS LIKE ${table}`;
  return {
    rows: s?.Rows != null ? Number(s.Rows) : null,
    bytes: s?.Data_length != null ? Number(s.Data_length) : null,
    engine: s?.Engine ?? "",
  };
}

async function pgStatus(db: Db, table: string): Promise<TableStatus> {
  const s = await db.row`
    SELECT c.reltuples::bigint AS rows, pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${table} AND n.nspname = current_schema()`;
  // reltuples is an estimate and -1 until the table is analyzed → fall back to an exact count.
  let rows = s?.rows != null ? Number(s.rows) : null;
  if (rows == null || rows < 0) rows = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table)}`);
  return { rows, bytes: s?.bytes != null ? Number(s.bytes) : null, engine: "postgres" };
}

async function sqliteStatus(db: Db, table: string): Promise<TableStatus> {
  const rows = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table)}`);
  // dbstat sums the page sizes of a table; null if this SQLite build lacks the dbstat vtab.
  const bytes = await db.one`SELECT SUM(pgsize) FROM dbstat WHERE name = ${table}`.catch(() => null);
  return { rows, bytes: bytes != null ? Number(bytes) : null, engine: "sqlite" };
}
