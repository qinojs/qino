import { sql } from "@qino/qino";
import { tableIndexes } from "@qino/qino/cms.backend.superuser.db";

import type { Db, Row, Sql } from "@qino/qino";

const TEXT_TYPES = new Set(["char", "varchar", "text", "tinytext", "mediumtext", "longtext", "enum", "set", "character varying", "citext", "uuid", "json", "jsonb"]);
const NUM_TYPES = new Set(["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "float", "double", "real", "numeric"]);
const SMALL_ROWS = 300; // below this a full scan is cheap enough to search every field for substrings
const LIMIT = 50;
const WORDS = 4;
const MIN_TOKEN = 3; // shorter words are not in a MySQL fulltext index (innodb_ft_min_token_size)

/** How a group of fields is searched. Only `scan` finds substrings — and only where a scan is cheap. */
export type Part = { mode: "fulltext" | "prefix" | "exact" | "scan"; fields: string[] };

export type TableSearch = {
  table: string;
  parts: Part[];
  rows: Row[];
  more: boolean;
  ms: number;
  error?: string;
};

export const words = (term: string): string[] => term.toLowerCase().split(/\s+/).slice(0, WORDS).filter(Boolean);

/** Search plan for one table: index-backed groups, or a full scan while the table is small. */
async function plan(db: Db, table: string, numeric: boolean): Promise<Part[]> {
  const fields = [...await db.tables[table].init()].map(([, field]) => field);
  const text = fields.filter((field) => TEXT_TYPES.has(field.type)).map(String);
  const num = fields.filter((field) => NUM_TYPES.has(field.type)).map(String);
  const indexes = await tableIndexes(db, table).catch(() => []);

  const parts: Part[] = [];
  const covered = new Set<string>();
  const add = (mode: Part["mode"], fields: string[]) => {
    if (!fields.length) return;
    fields.forEach((field) => covered.add(field));
    parts.push({ mode, fields });
  };
  const free = (fields: string[], pool: string[]) => fields.filter((field) => pool.includes(field) && !covered.has(field));

  // The primary key is always indexed — SQLite's rowid alias does not even show up in index_list.
  const primaries = db.tables[table].primaries.map(String);
  if (numeric) add("exact", free(primaries, num));
  add("prefix", free(primaries, text));
  for (const index of indexes) {
    // A fulltext index answers all of its columns at once; a b-tree only its leading one.
    const group = index.type === "fulltext" ? index.fields : index.fields.slice(0, 1);
    add(index.type === "fulltext" ? "fulltext" : "prefix", free(group, text));
    if (numeric) add("exact", free(index.fields.slice(0, 1), num));
  }
  // Whatever no index answers is still worth a scan as long as the table stays small.
  const restText = text.filter((field) => !covered.has(field));
  const restNum = numeric ? num.filter((field) => !covered.has(field)) : [];
  if ((restText.length || restNum.length) && await isSmall(db, table)) {
    add("scan", restText);
    add("exact", restNum);
  }
  return parts;
}

/** Cheap in every dialect: stop counting at SMALL_ROWS instead of scanning the whole table. */
async function isSmall(db: Db, table: string): Promise<boolean> {
  const rows = await db.one`SELECT COUNT(*) FROM (SELECT 1 FROM ${sql.id(table)} LIMIT ${sql.raw(String(SMALL_ROWS))}) small`
    .catch(() => SMALL_ROWS);
  return Number(rows) < SMALL_ROWS;
}

// '!' is a neutral escape char in every dialect's string literals.
const esc = (s: string) => s.replace(/[!%_]/g, "!$&");

function condition(db: Db, part: Part, terms: string[], term: string): Sql | undefined {
  const ids = part.fields.map(sql.id);
  if (part.mode === "exact") return sql.join(ids.map((id) => sql`${id} = ${term}`), " OR ");
  if (part.mode === "fulltext") {
    // Boolean mode: every word required, each as a prefix. Operators would be syntax, so they go.
    const query = terms.map((word) => word.replace(/[+\-><()~*"@]/g, "")).filter((word) => word.length >= MIN_TOKEN).map((word) => `+${word}*`).join(" ");
    if (!query) return;
    return sql`MATCH(${sql.join(ids)}) AGAINST (${query} IN BOOLEAN MODE)`;
  }
  // Postgres needs ILIKE to stay case-insensitive (its index would only serve LIKE with text_pattern_ops).
  const like = sql.raw(db.dialect === "postgres" ? "ILIKE" : "LIKE");
  const pattern = (word: string) => part.mode === "prefix" ? esc(word) + "%" : "%" + esc(word) + "%";
  return sql.join(terms.map((word) => sql`(${sql.join(ids.map((id) => sql`${id} ${like} ${pattern(word)} ESCAPE '!'`), " OR ")})`), " AND ");
}

/** Search one table; undefined when it has nothing searchable or no hit. */
export async function searchTable(db: Db, table: string, input: string): Promise<TableSearch | undefined> {
  const term = input.trim();
  const terms = words(term);
  if (!terms.length) return;
  const parts = await plan(db, table, /^-?\d+$/.test(term));
  const conditions = parts.map((part) => [part, condition(db, part, terms, term)] as const).filter(([, cond]) => cond);
  if (!conditions.length) return;
  const where = sql.join(conditions.map(([, cond]) => sql`(${cond!})`), " OR ");

  const t0 = performance.now();
  const rows = await db.query`SELECT * FROM ${sql.id(table)} WHERE ${where} LIMIT ${sql.raw(String(LIMIT + 1))}`
    .catch((e) => e as Error);
  const ms = performance.now() - t0;
  const used = conditions.map(([part]) => part);
  if (rows instanceof Error) return { table, parts: used, rows: [], more: false, ms, error: rows.message };
  if (!rows.length) return;
  return { table, parts: used, rows: rows.slice(0, LIMIT), more: rows.length > LIMIT, ms };
}

/** Every searchable table; tables without a hit are left out. */
export async function search(db: Db, term: string): Promise<TableSearch[]> {
  const tables = Object.keys(db.tables).filter((table) => !table.startsWith("_")).sort();
  const results = await Promise.all(tables.map((table) => searchTable(db, table, term)));
  return results.filter((result) => result != null);
}

export { LIMIT, SMALL_ROWS };
