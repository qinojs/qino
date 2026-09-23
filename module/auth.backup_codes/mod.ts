import { ApiError, attempt, identified, pwHash, pwVerify } from "@qino/qino";
import { drop, proof, store, stored } from "@qino/qino/auth";

import type { App, Ctx } from "@qino/qino";

const TYPE = "backup_codes";
const COUNT = 10;
const LENGTH = 12;
// Crockford base32: 32 characters (5 bits of a random byte, no bias), without I, L, O, U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(LENGTH)), (b) => ALPHABET[b & 31]).join("");

const grouped = (code: string) => code.replace(/(.{4})(?=.)/g, "$1-");

/** What the user types back, however they spaced or cased it. */
const normalize = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Replace the set with new codes. The plain codes are only in the return value.
 *
 * Stored as bcrypt: a fast hash of 60 bits would not survive a stolen database, and a key would be
 * stolen with it (it's in the settings). bcrypt costs milliseconds per guess.
 */
export async function generate(ctx: Ctx): Promise<string[]> {
  await drop(ctx.app, ctx.userId, TYPE);
  const codes = Array.from({ length: COUNT }, fresh);
  for (const code of codes) await store(ctx.app, ctx.userId, TYPE, { hash: await pwHash(code) });
  return codes.map(grouped);
}

/** How many are still unspent. */
export async function left(app: App, usrId: number): Promise<number> {
  return (await stored(app, usrId, TYPE)).length;
}

/** Spend one to prove the user is present — signed in, or a login under way. */
export async function spend(ctx: Ctx, code: string): Promise<boolean> {
  const usrId = identified(ctx);
  const typed = normalize(code);
  const spent = await attempt(ctx.app, usrId, async () => {
    // Tried one by one: bcrypt makes that a second at worst, and only for the account's own owner
    for (const row of await stored(ctx.app, usrId, TYPE)) {
      // the delete settles races: only one of two parallel attempts removes the row
      if (await pwVerify(typed, JSON.parse(String(row.data)).hash)) return !!await drop(ctx.app, usrId, TYPE, Number(row.id));
    }
    return false;
  });
  if (!spent) {
    ctx.app.fire("suspicious", { ctx, weight: 2, reason: "backup code rejected" }).catch(() => {});
    throw new ApiError(422, "That code does not match");
  }
  return !await proof(ctx, TYPE, usrId); // nothing missing = it counted
}
