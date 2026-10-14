// score — ranks entries by how often and how recently they are accessed: every access adds 1, and
// the sum decays with a half-life.
//
// Stored is the logarithm of the strength, shifted by time:
//   score = ln(strength) + rate * t        rate = ln2 / halfLife
// rate*now is the same for all rows, so ORDER BY score DESC is the decayed ranking — no exp() in
// SQL (SQLite has none), and an index can sort.
//
// What is scored is a table `score_<name>`, declared by the module that scores, with only its key
// columns; score adds the rest (plugin.ts).
import { sql, unixTime } from "@qino/qino";

import type { Db, Sql } from "@qino/qino";

/** Rows weaker than this many accesses are dropped by the prune job. */
const FORGET = 0.02;

/** Half-life in seconds, unless set with `halfLife()`. */
const HALF_LIFE = 30 * 86400;

/** What is scored, by the key columns of its table, e.g. `{ usr_id: 3, page_id: 7 }`. */
type Key = Record<string, number | string | Sql>;

/** A table `score_<name>`, its key columns and half-life. */
export type Score = { name: string; table: string; keys: string[]; half: number };

const rate = (half: number) => Math.LN2 / half;

/** ln(exp(a) + exp(b)), without overflowing. */
const logAdd = (a: number, b: number) => Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));

const halves = new WeakMap<Db, Map<string, number>>();

/** Set the half-life of `score_<name>` in seconds (default 30 days), before its first hit. */
export function halfLife(db: Db, name: string, seconds: number): void {
  halves.getOrInsertComputed(db, () => new Map()).set(name, seconds);
}

/** All score tables of the database. */
export const scores = (db: Db): Score[] => Object.keys(db.tables).flatMap((table) => {
  const props = db.schema.properties[table]?.additionalProperties?.properties;
  if (!table.startsWith("score_") || !props) return [];
  const name = table.slice("score_".length);
  const keys = Object.keys(props).filter((col) => props[col]["x-index"] === "primary");
  return [{ name, table, keys, half: halves.get(db)?.get(name) ?? HALF_LIFE }];
});

function scoreOf(db: Db, name: string) {
  const found = scores(db).find((s) => s.name === name);
  if (!found) throw new Error(`No table "score_${name}": declare it to score "${name}"`);
  return found;
}

/** `col = value AND …` for the given key columns; `partial` allows a subset. */
function match(keys: string[], key: Key, partial = false) {
  const cols = Object.keys(key);
  if (!cols.length || cols.some((col) => !keys.includes(col)) || !partial && cols.length !== keys.length) {
    throw new Error(`The key has the columns ${keys.join(", ")}, not ${cols.join(", ") || "none"}`);
  }
  return sql.join(cols.map((col) => sql`${sql.id(col)} = ${key[col]}`), " AND ");
}

/** Record an access; `weight` = number of accesses. Errors are logged, not thrown — don't await;
 *  the time is taken now. */
export function hit(db: Db, name: string, key: Key, weight = 1): Promise<void> {
  if (weight <= 0) throw new Error("score: weight must be > 0 — use forget(…, keep) to weaken a row");
  const { table, keys, half } = scoreOf(db, name), where = match(keys, key), now = unixTime();
  return bump(db, sql.id(table), key, where, rate(half) * now + Math.log(weight), now)
    .catch((e) => console.error("score hit: " + e.message));
}

async function bump(db: Db, t: Sql, key: Key, where: Sql, term: number, now: number) {
  const row = await db.row<{ score: number }>`SELECT score FROM ${t} WHERE ${where}`;
  const value = row ? logAdd(Number(row.score), term) : term;
  const update = () => db.exec`UPDATE ${t} SET score = ${value}, time = ${now} WHERE ${where}`;
  const cols = sql.join(Object.keys(key).map(sql.id), ", "), values = sql.join(Object.values(key).map((v) => sql`${v}`), ", ");
  if (row) await update();
  // A parallel hit may have inserted the row; then this access is lost, which is fine.
  else await db.exec`INSERT INTO ${t} (${cols}, score, time) VALUES (${values}, ${value}, ${now})`.catch(update);
}

/** Forget a score, or `keep` a fraction: 0.5 halves it, 0 (default) deletes the row. Use this
 *  instead of a negative hit. A part of the key covers all its rows (`{ usr_id: 3 }`). Rows go along
 *  with the entry of a key column that has `x-qg-parent`. */
export async function forget(db: Db, name: string, key: Key, keep = 0): Promise<void> {
  const { table, keys } = scoreOf(db, name), t = sql.id(table), where = match(keys, key, true);
  const q = keep > 0
    ? db.exec`UPDATE ${t} SET score = score + ${Math.log(keep)} WHERE ${where}`
    : db.exec`DELETE FROM ${t} WHERE ${where}`;
  await q.catch((e) => console.error("score forget: " + e.message));
}

/** The score as ORDER BY fragment, 0 if never accessed (stored scores are > 0); the key refers to
 *  the outer query by qualified columns:
 *  ``db.query`SELECT * FROM page p ORDER BY ${sqlScore(db, "page_view", { page_id: sql`p.id` })} DESC` `` */
export function sqlScore(db: Db, name: string, key: Key): Sql {
  const { table, keys } = scoreOf(db, name);
  return sql`COALESCE((SELECT score FROM ${sql.id(table)} WHERE ${match(keys, key)}), 0)`;
}

/** Stored score → current strength in accesses, for display. */
export function strength(db: Db, name: string, score: number, now: number = unixTime()): number {
  return Math.exp(score - rate(scoreOf(db, name).half) * now);
}

/** Scores below this are faded and go at the next prune — a plain number in the same log space. */
export function fadeLimit(db: Db, name: string, now: number = unixTime()): number {
  return rate(scoreOf(db, name).half) * now + Math.log(FORGET);
}

/** Delete faded rows — the threshold is a plain number, so no math in SQL. */
export async function prune(db: Db): Promise<void> {
  const now = unixTime();
  for (const { name, table } of scores(db)) await db.exec`DELETE FROM ${sql.id(table)} WHERE score < ${fadeLimit(db, name, now)}`;
}
