// Duplicate rows of a table, and merging one into another: the references move over, empty fields
// take the other row's values, the other row goes. Dialect-neutral; references are what the schema
// declares (`x-qg-parent`), unique keys what the database reports.
import { sql } from "@qino/qino";

import type { Db, Row, Sql } from "@qino/qino";

type DbField = NonNullable<ReturnType<ReturnType<Db["table"]>["field"]>>;

const empty = (v: unknown) => v == null || v === "";
const is = (column: string, value: unknown): Sql => value == null ? sql`${sql.id(column)} IS NULL` : sql`${sql.id(column)} = ${value}`;

/** The table's single key column; tables keyed by several columns cannot be merged. */
export function keyOf(db: Db, table: string): string | undefined {
  const keys = db.table(table).primaries;
  return keys.length === 1 ? String(keys[0]) : undefined;
}

/** Groups of rows equal in `same` — empty values never make rows equal — within `where`, a trusted
 *  SQL condition only the superuser writes. The oldest row of a group comes first. */
export async function duplicates(db: Db, table: string, same: string[], where = "", limit = 50): Promise<Row[][]> {
  const key = keyOf(db, table);
  if (!key || !same.length) return [];
  const t = sql.id(table), cols = sql.join(same.map((c) => sql.id(c)));
  // '' only where a column holds text: Postgres refuses to compare a number with it
  const text = (c: string) => /char|text|string/.test(db.table(table).field(c)?.type ?? "");
  const filled = same.map((c) => text(c) ? sql`${sql.id(c)} IS NOT NULL AND ${sql.id(c)} <> ''` : sql`${sql.id(c)} IS NOT NULL`);
  const scope = where.trim() ? [sql.raw(`(${where})`)] : [];
  const groups = await db.query`SELECT ${cols} FROM ${t} WHERE ${sql.join([...filled, ...scope], " AND ")}
    GROUP BY ${cols} HAVING COUNT(*) > 1 LIMIT ${sql.raw(String(Math.max(1, Math.floor(limit))))}`;
  const out = [];
  for (const group of groups) {
    const match = same.map((c) => is(c, group[c]));
    out.push(await db.query`SELECT * FROM ${t} WHERE ${sql.join([...match, ...scope], " AND ")} ORDER BY ${sql.id(key)}`);
  }
  return out;
}

/** The columns pointing at this table, with how many rows point at the row with `id`. */
export async function references(db: Db, table: string, id: unknown): Promise<{ field: DbField; count: number }[]> {
  const out = [];
  for (const field of db.table(table).children) {
    const count = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(field.table)} WHERE ${sql.id(field)} = ${id}`);
    out.push({ field, count });
  }
  return out;
}

/** The unique keys of a table that contain `column`, as lists of columns. */
function uniqueKeys(field: DbField): string[][] {
  const keys = [];
  if (field.key === "UNI") keys.push([String(field)]);
  const primaries = field.table.primaries.map(String);
  if (primaries.includes(String(field))) keys.push(primaries);
  return keys;
}

export type MergeResult = { moved: Record<string, number>; dropped: number; filled: string[] };

/** Merge row `from` into row `into`: every reference to `from` moves to `into` — one repeating a
 *  unique key `into` already holds is dropped —, `from` goes, and the empty fields of `into` take
 *  `from`'s values. All or nothing. */
export function merge(db: Db, table: string, into: unknown, from: unknown): Promise<MergeResult> {
  return db.transaction(async () => {
    const key = keyOf(db, table);
    if (!key) throw new Error(`${table} has no single key column`);
    if (String(into) === String(from)) throw new Error("A row cannot be merged into itself");
    const t = sql.id(table);
    const [keep, gone] = [await db.row`SELECT * FROM ${t} WHERE ${sql.id(key)} = ${into}`, await db.row`SELECT * FROM ${t} WHERE ${sql.id(key)} = ${from}`];
    if (!keep || !gone) throw new Error("Both rows must exist");

    const result: MergeResult = { moved: {}, dropped: 0, filled: [] };
    for (const field of db.table(table).children) {
      const ref = sql.id(field), child = sql.id(field.table);
      const keys = uniqueKeys(field);
      let moved = 0;
      if (!keys.length) {
        moved = Number((await db.exec`UPDATE ${child} SET ${ref} = ${into} WHERE ${ref} = ${from}`)?.affectedRows ?? 0);
      } else {
        // row by row: one that would repeat a unique key `into` already holds is a duplicate — it goes
        for (const row of await db.query`SELECT * FROM ${child} WHERE ${ref} = ${from}`) {
          let taken = false;
          for (const unique of keys) {
            const match = unique.map((c) => is(c, c === String(field) ? into : row[c]));
            if (await db.one`SELECT 1 FROM ${child} WHERE ${sql.join(match, " AND ")}`) taken = true;
          }
          if (taken) {
            await field.table.delete(row);
            result.dropped++;
            continue;
          }
          const at = field.table.primaries.map((c) => is(String(c), row[String(c)]));
          await db.exec`UPDATE ${child} SET ${ref} = ${into} WHERE ${sql.join(at.length ? at : [is(String(field), from)], " AND ")}`;
          moved++;
        }
      }
      if (moved) result.moved[`${field.table}.${field}`] = moved;
    }

    await db.table(table).delete(from);
    // after the delete: a unique value of `from` is free now
    // the row's own history (references to the log) is not data to take over
    const history = (column: string) => db.table(table).field(column)?.schema["x-qg-parent"] === "log";
    const fill: Row = {};
    for (const [column, value] of Object.entries(gone)) {
      if (column !== key && !history(column) && empty(keep[column]) && !empty(value)) fill[column] = value;
    }
    if (Object.keys(fill).length) await db.table(table).update(into, fill);
    result.filled = Object.keys(fill);
    return result;
  });
}
