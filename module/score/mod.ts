// score — ranks rows by how often and how recently they are accessed, modelled on a
// fading memory: every access adds 1, the sum decays exponentially with a half-life.
//
// Stored is not the strength itself but its logarithm, shifted by time:
//   score = ln(strength) + rate * t        rate = ln2 / halfLife
// The decay term rate*now is identical for every row of a table, so it cancels out when
// rows are compared: ORDER BY score DESC already is the decayed ranking. That keeps exp()
// out of SQL (SQLite has no math functions) and lets an index do the sorting.

import { sql, unixTime, type Db, type Sql } from "../core/mod.ts";

/** Rows weaker than this many accesses are dropped by the prune job. */
const FORGET = 0.02;

const rate = (halfLife: number) => Math.LN2 / halfLife;

/** ln(exp(a) + exp(b)), without overflowing. */
const logAdd = (a: number, b: number) => Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));

const registry = new WeakMap<Db, Record<string, number>>();

/** Scored tables: name → half-life in seconds. `scored(app.db).file = 30 * 86400` */
export function scored(db: Db): Record<string, number> {
  return registry.getOrInsertComputed(db, () => ({}));
}

function halfLife(db: Db, tbl: string): number {
  const half = scored(db)[tbl];
  if (!half) throw new Error(`score: table "${tbl}" is not scored — register it via scored(db)`);
  // The name sits in the primary key and thus in every index of a table that grows with all others.
  if (tbl.length > 32) throw new Error(`score: table name "${tbl}" exceeds 32 characters`);
  return half;
}

/** Record an access; `weight` is how many accesses it counts for. Errors are logged, not thrown —
 *  call it without awaiting, the access time is taken now, not when the write lands. */
export function hit(db: Db, tbl: string, id: number, weight = 1): Promise<void> {
  if (weight <= 0) throw new Error("score: weight must be > 0 — use forget(…, keep) to weaken a row");
  const now = unixTime();
  return bump(db, tbl, id, rate(halfLife(db, tbl)) * now + Math.log(weight), now)
    .catch((e) => console.error("score hit: " + e.message));
}

async function bump(db: Db, tbl: string, id: number, term: number, now: number): Promise<void> {
  const row = await db.row<{ score: number }>`SELECT score FROM score WHERE tbl = ${tbl} AND id = ${id}`;
  const value = row ? logAdd(Number(row.score), term) : term;
  const update = () => db.exec`UPDATE score SET score = ${value}, time = ${now} WHERE tbl = ${tbl} AND id = ${id}`;
  if (row) await update();
  // A concurrent hit may have inserted the row meanwhile; that access is then lost, the ranking is not.
  else await db.exec`INSERT INTO score (tbl, id, score, time) VALUES (${tbl}, ${id}, ${value}, ${now})`.catch(update);
}

/** Forget a row's score, or `keep` a fraction of its strength: 0.5 halves it, 0 (default) drops the
 *  row — which also happens automatically when the entry itself is deleted. A strength can be scaled
 *  down but never pushed below zero, so this, not a negative hit, is the counter-signal. */
export async function forget(db: Db, tbl: string, id: number, keep = 0): Promise<void> {
  const q = keep > 0
    ? db.exec`UPDATE score SET score = score + ${Math.log(keep)} WHERE tbl = ${tbl} AND id = ${id}`
    : db.exec`DELETE FROM score WHERE tbl = ${tbl} AND id = ${id}`;
  await q.catch((e) => console.error("score forget: " + e.message));
}

/** The row's score as an ORDER BY fragment, 0 for never accessed rows (stored scores are always > 0):
 *  ``db.query`SELECT * FROM file f WHERE f.usr_id = ${33} ORDER BY ${sqlScore("file", "f.id")} DESC` ``
 *  `id` says where the primary key sits in the surrounding query, `<tbl>.id` by default. It must stay
 *  qualified — a bare `id` would bind to the subquery's own column and match every row. */
export function sqlScore(tbl: string, id: string | Sql = tbl + ".id"): Sql {
  const ref = typeof id === "string" ? sql.join(id.split(".").map(sql.id), ".") : id;
  return sql`COALESCE((SELECT _score.score FROM score _score WHERE _score.tbl = ${tbl} AND _score.id = ${ref}), 0)`;
}

/** Stored score → current strength in accesses, for display. */
export function strength(db: Db, tbl: string, score: number, now = unixTime()): number {
  return Math.exp(score - rate(halfLife(db, tbl)) * now);
}

/** Delete faded rows — the threshold is a plain number in the same log space, so no math in SQL. */
export async function prune(db: Db): Promise<void> {
  const now = unixTime();
  for (const [tbl, half] of Object.entries(scored(db)))
    await db.exec`DELETE FROM score WHERE tbl = ${tbl} AND score < ${rate(half) * now + Math.log(FORGET)}`;
}
