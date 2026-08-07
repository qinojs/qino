import { createHmac, timingSafeEqual } from "node:crypto";
import { uid, unixTime, type Ctx } from "../../core/mod.ts";

// The capability lives in the URL, not in a list of granted paths: a rendered
// file list would otherwise write hundreds of paths into the session forever.
// The key is per session — an app-wide one would, once leaked, hand out write
// access to every file of every visitor, with nothing to expire it.

const TTL = 4 * 3600; // a working session; the link is re-rendered with the page

function key(ctx: Ctx): string {
  const item = ctx.sess.data.fileEditor.key;
  let k = String(item() ?? "");
  if (!k) item(k = uid());
  return k;
}

const mac = (ctx: Ctx, file: string, exp: number): string =>
  createHmac("sha256", key(ctx)).update(`${file}\n${exp}`).digest("base64url").slice(0, 22);

/** Capability params for one file, bound to this session and valid for TTL. */
export function sign(ctx: Ctx, file: string): { exp: string; sig: string } {
  const exp = unixTime() + TTL;
  return { exp: String(exp), sig: mac(ctx, file, exp) };
}

/** "expired" is a stale link someone kept; "forged" means the mac never matched
 *  this session's key — nobody produces that by waiting or bookmarking. */
export type Check = "ok" | "expired" | "forged" | "unsigned";

export function check(ctx: Ctx, file: string, exp: unknown, sig: unknown): Check {
  const raw = String(exp ?? ""), given = String(sig ?? "");
  if (!raw && !given) return "unsigned";
  if (!/^\d{1,12}$/.test(raw)) return "forged";
  if (!equal(mac(ctx, file, Number(raw)), given)) return "forged";
  return Number(raw) < unixTime() ? "expired" : "ok";
}

function equal(expected: string, given: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
