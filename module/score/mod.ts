// score — ranks rows by how often and how recently they are accessed: every access adds 1, and
// the sum decays with a half-life.
//
// Stored is the logarithm of the strength, shifted by time:
//   score = ln(strength) + rate * t        rate = ln2 / halfLife
// rate*now is the same for all rows, so ORDER BY score DESC is the decayed ranking — no exp() in
// SQL (SQLite has none), and an index can sort.
//
// `scored()` maps the table name to a small scope_id, so keys and index hold no strings.
import { sql, unixTime } from "@qino/qino";

import type { Db, Sql } from "@qino/qino";

/** Rows weaker than this many accesses are dropped by the prune job. */
const FORGET = 0.02;

const rate = (halfLife: number) => Math.LN2 / halfLife;

/** ln(exp(a) + exp(b)), without overflowing. */
const logAdd = (a: number, b: number) => Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));

export type ScoreScope = { id: number; half: number };

const registry = new WeakMap<Db, Map<string, ScoreScope>>();

/** The registered scopes, table name → scope id and half-life. Treat it as read-only. */
export const scopes = (db: Db): Map<string, ScoreScope> => registry.getOrInsertComputed(db, () => new Map<string, ScoreScope>());

function scope(db: Db, tbl: string): ScoreScope {
  const found = scopes(db).get(tbl);
  if (!found) throw new Error(`score: table "${tbl}" is not scored — register it via scored(db, "${tbl}", halfLife)`);
  return found;
}

/** Register a table for scoring, `halfLife` in seconds. Loads and caches its scope_id, so the rest
 *  is synchronous: `await scored(app.db, "file", 30 * 86400)` */
export async function scored(db: Db, tbl: string, halfLife: number): Promise<void> {
  const id = await db.one<number>`SELECT id FROM score_scope WHERE tbl = ${tbl}`;
  scopes(db).set(tbl, {
    id: id ?? (await db.exec(sql`INSERT INTO score_scope (tbl) VALUES (${tbl})`, "id")).insertId,
    half: halfLife,
  });
}

/** Record an access; `weight` = number of accesses. Errors are logged, not thrown — don't await;
 *  the time is taken now. */
export function hit(db: Db, tbl: string, id: number, weight = 1): Promise<void> {
  if (weight <= 0) throw new Error("score: weight must be > 0 — use forget(…, keep) to weaken a row");
  const { id: sid, half } = scope(db, tbl);
  const now = unixTime();
  return bump(db, sid, id, rate(half) * now + Math.log(weight), now)
    .catch((e) => console.error("score hit: " + e.message));
}

async function bump(db: Db, sid: number, id: number, term: number, now: number): Promise<void> {
  const row = await db.row<{ score: number }>`SELECT score FROM score WHERE scope_id = ${sid} AND id = ${id}`;
  const value = row ? logAdd(Number(row.score), term) : term;
  const update = () => db.exec`UPDATE score SET score = ${value}, time = ${now} WHERE scope_id = ${sid} AND id = ${id}`;
  if (row) await update();
  // A parallel hit may have inserted the row; then this access is lost, which is fine.
  else await db.exec`INSERT INTO score (scope_id, id, score, time) VALUES (${sid}, ${id}, ${value}, ${now})`.catch(update);
}

/** Forget a row's score, or `keep` a fraction: 0.5 halves it, 0 (default) deletes the row (also
 *  done automatically when the entry is deleted). Use this instead of a negative hit. No-op for
 *  unscored tables. */
export async function forget(db: Db, tbl: string, id: number, keep = 0): Promise<void> {
  const found = scopes(db).get(tbl);
  if (!found) return;
  const q = keep > 0
    ? db.exec`UPDATE score SET score = score + ${Math.log(keep)} WHERE scope_id = ${found.id} AND id = ${id}`
    : db.exec`DELETE FROM score WHERE scope_id = ${found.id} AND id = ${id}`;
  await q.catch((e) => console.error("score forget: " + e.message));
}

/** The row's score as ORDER BY fragment, 0 if never accessed (stored scores are > 0):
 *  ``db.query`SELECT * FROM file f WHERE f.usr_id = ${33} ORDER BY ${sqlScore(db, "file", "f.id")} DESC` ``
 *  `id`: the primary key in the outer query, default `<tbl>.id`. Keep it qualified — a bare `id`
 *  would match the subquery's own column. */
export function sqlScore(db: Db, tbl: string, id: string | Sql = tbl + ".id"): Sql {
  const ref = typeof id === "string" ? sql.join(id.split(".").map(sql.id), ".") : id;
  return sql`COALESCE((SELECT _score.score FROM score _score WHERE _score.scope_id = ${scope(db, tbl).id} AND _score.id = ${ref}), 0)`;
}

/** Stored score → current strength in accesses, for display. */
export function strength(db: Db, tbl: string, score: number, now: number = unixTime()): number {
  return Math.exp(score - rate(scope(db, tbl).half) * now);
}

/** Scores below this are faded and go at the next prune — a plain number in the same log space. */
export function fadeLimit(db: Db, tbl: string, now: number = unixTime()): number {
  return rate(scope(db, tbl).half) * now + Math.log(FORGET);
}

/** Delete faded rows — the threshold is a plain number, so no math in SQL. */
export async function prune(db: Db): Promise<void> {
  const now = unixTime();
  for (const [tbl, { id }] of scopes(db))
    await db.exec`DELETE FROM score WHERE scope_id = ${id} AND score < ${fadeLimit(db, tbl, now)}`;
}
