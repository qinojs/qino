/** Wait after failed identity proofs. Counted per account, not per method — otherwise guesses could
 *  be spread over password, totp and backup codes.
 *
 *  A delay, not a lockout: anyone knowing an e-mail address could trigger a lockout, while a wait of
 *  minutes stops guessing just as well without locking the owner out. */
import { ApiError } from "../api/errors.ts";
import { unixTime } from "../util.ts";

import type { App } from "../App.ts";

const FREE = 3; // a typo is not an attack
const STEP = 5; // seconds, doubling per try — longer than retyping a password
const MAX = 300;
const FORGET = 3600; // reset after an hour without a wrong try

const wait = (fails: number) => fails <= FREE ? 0 : Math.min(MAX, STEP * 2 ** (fails - FREE - 1));

/** Seconds to wait before the next try; 0 = none. */
export async function proofWait(app: App, usrId: number): Promise<number> {
  const row = await app.db.row`SELECT fails, last FROM usr_auth_attempt WHERE usr_id = ${usrId}`;
  if (!row) return 0;
  const now = unixTime(), last = Number(row.last);
  if (now - last > FORGET) return 0;
  return Math.max(0, last + wait(Number(row.fails)) - now);
}

const turns = new WeakMap<App, Map<number, Promise<unknown>>>();

/** Attempts per account run one after another, so parallel guesses can't all read the same count. */
export function inTurn<T>(app: App, usrId: number, fn: () => Promise<T>): Promise<T> {
  const queue = turns.getOrInsertComputed(app, () => new Map());
  const run = (queue.get(usrId) ?? Promise.resolve()).then(fn, fn);
  const done = run.catch(() => {}).finally(() => queue.get(usrId) === done && queue.delete(usrId));
  queue.set(usrId, done);
  return run;
}

/** One guess for `usrId`: queued, after the wait, counted if `check` returns falsy (a throwing
 *  `check` counts nothing). Throws while the wait runs. */
export function attempt<T>(app: App, usrId: number, check: () => Promise<T>): Promise<T> {
  return inTurn(app, usrId, async () => {
    await beforeProof(app, usrId);
    const result = await check();
    if (!result) await proofFailed(app, usrId);
    return result;
  });
}

/** Call before checking anything guessable. Throws while the wait runs. */
export async function beforeProof(app: App, usrId: number): Promise<void> {
  const left = await proofWait(app, usrId);
  if (left) throw new ApiError(429, `Too many attempts — try again in ${left} seconds`, { code: "too_many_attempts", data: { retryAfter: left } });
}

/** Count a wrong try — in SQL, so parallel guesses don't read the same number. */
export async function proofFailed(app: App, usrId: number): Promise<void> {
  const now = unixTime();
  await app.db.exec`DELETE FROM usr_auth_attempt WHERE last < ${now - FORGET}`; // cleanup, no cron needed
  const bumped = await app.db.exec`UPDATE usr_auth_attempt SET fails = fails + 1, last = ${now} WHERE usr_id = ${usrId}`;
  // a parallel first try may have inserted the row meanwhile
  if (!bumped?.affectedRows) await app.db.table("usr_auth_attempt").insert({ usr_id: usrId, fails: 1, last: now }).catch(() => {});
}

/** A correct proof resets the count. */
export async function proofPassed(app: App, usrId: number): Promise<void> {
  await app.db.exec`DELETE FROM usr_auth_attempt WHERE usr_id = ${usrId}`;
}
