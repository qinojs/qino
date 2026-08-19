/** What a wrong proof of identity costs the next one. The account is the subject, never the method:
 *  otherwise guesses spread over password, totp and backup codes and each counter stays low.
 *
 *  A delay, not a lockout — a lockout is a weapon anyone who knows an e-mail address can fire, and
 *  a wait that grows to minutes ends guessing just as well without ever shutting the owner out. */
import { ApiError } from "./api/errors.ts";
import { unixTime } from "./util.ts";

import type { App } from "./App.ts";

const FREE = 3; // a typo is not an attack
const STEP = 2; // seconds the first paid try costs; every further one doubles it
const MAX = 300;
const FORGET = 3600; // an hour without a wrong try and it never happened

const wait = (fails: number) => fails <= FREE ? 0 : Math.min(MAX, STEP * 2 ** (fails - FREE - 1));

/** Stand in front of every check of something guessable. Throws while the wait is still running. */
export async function beforeProof(app: App, usrId: number): Promise<void> {
  const row = await app.db.row`SELECT fails, last FROM usr_auth_attempt WHERE usr_id = ${usrId}`;
  if (!row) return;
  const last = Number(row.last);
  const left = last + wait(Number(row.fails)) - unixTime();
  if (left > 0 && unixTime() - last <= FORGET) {
    throw new ApiError(429, `Too many attempts — try again in ${left} seconds`, { code: "too_many_attempts", data: { retryAfter: left } });
  }
}

/** One more wrong one. */
export async function proofFailed(app: App, usrId: number): Promise<void> {
  const now = unixTime();
  await app.db.exec`DELETE FROM usr_auth_attempt WHERE last < ${now - FORGET}`; // no cron needed for this
  const row = await app.db.row`SELECT fails FROM usr_auth_attempt WHERE usr_id = ${usrId}`;
  await app.db.table("usr_auth_attempt").ensure({ usr_id: usrId, fails: (Number(row?.fails) || 0) + 1, last: now });
}

/** A right one wipes the slate: whoever got in was not the one being kept out. */
export async function proofPassed(app: App, usrId: number): Promise<void> {
  await app.db.exec`DELETE FROM usr_auth_attempt WHERE usr_id = ${usrId}`;
}
