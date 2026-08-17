// Public API of auth.backup_codes. The qino plugin lives in ./plugin.ts.
import { ApiError, pwHash, pwVerify } from "@qino/qino";
import { drop, proof, store, stored } from "@qino/qino/auth";

import type { App, Ctx } from "@qino/qino";

const TYPE = "backup_codes";
const COUNT = 10;
const LENGTH = 12;
// Crockford base32: 32 characters, so a random byte masked to 5 bits picks one without bias, and
// none of them is an I, L, O or U that someone could read back as something else.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(LENGTH)), (b) => ALPHABET[b & 31]).join("");

const grouped = (code: string) => code.replace(/(.{4})(?=.)/g, "$1-");

/** What the user types back, however they spaced or cased it. */
const normalize = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Replace the set with a fresh one. The plain codes exist only in what this resolves with.
 *
 * They are kept as bcrypt, not as a plain digest. 60 bits would not survive a stolen database
 * against a fast hash, and a keyed one would not help — the key lives in the settings table and
 * would be stolen along with it. bcrypt needs no key and costs the attacker milliseconds a guess.
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

/** Spend one to prove the current user is present. Resolves with what the proof was worth. */
export async function spend(ctx: Ctx, code: string): Promise<boolean> {
  const typed = normalize(code);
  const rows = await stored(ctx.app, ctx.userId, TYPE);
  let match;
  // Tried one by one: bcrypt makes that a second at worst, and only for the account's own owner
  for (const row of rows) {
    if (await pwVerify(typed, JSON.parse(String(row.data)).hash)) { match = row; break; }
  }
  // The delete decides the race: of two parallel attempts with the same code only one removes a row
  if (!match || !await drop(ctx.app, ctx.userId, TYPE, Number(match.id))) {
    ctx.app.fire("suspicious", { ctx, reason: "backup code rejected" }).catch(() => {});
    throw new ApiError(422, "That code does not match");
  }
  return await proof(ctx, TYPE, ctx.userId);
}
