import { ApiError, attempt, identified } from "@qino/qino";
import { drop, proof, store, stored } from "@qino/qino/auth";

import { secret, uri, valid } from "./lib/totp.ts";

import type { Ctx } from "@qino/qino";

const TYPE = "totp";

// The new secret waits in the session until a code confirms it, so abandoned setups need no cleanup.
const pending = (ctx: Ctx) => ctx.sess.data["auth.totp"].pending;

/** Start a setup. The secret is shown once, as text and as `otpauth://` uri for a QR code. */
export function enrol(ctx: Ctx): { secret: string; uri: string } {
  const fresh = secret();
  pending(ctx)(fresh);
  return { secret: fresh, uri: uri(fresh, String(ctx.user?.username || ctx.userId), ctx.req.url.host) };
}

/** Finish setting one up — the code is what proves the app really holds the secret. */
export async function confirm(ctx: Ctx, code: string, label = ""): Promise<void> {
  const candidate = String(pending(ctx)() ?? "");
  if (!candidate) throw new ApiError(409, "Nothing to set up — start again");
  if (!await valid(candidate, code)) throw new ApiError(422, "That code does not match");
  await store(ctx.app, ctx.userId, TYPE, { secret: candidate }, label);
  pending(ctx)(undefined);
}

/** Prove the user the request established is present — signed in, or half way into a login. */
export async function verify(ctx: Ctx, code: string): Promise<boolean> {
  const usrId = identified(ctx);
  // six digits are guessable; the wait is what makes them not
  const hit = await attempt(ctx.app, usrId, async () => {
    for (const row of await stored(ctx.app, usrId, TYPE)) {
      const used = await valid(String(JSON.parse(String(row.data)).secret), code);
      if (used && used > Number(row.last_used ?? 0)) return { row, used }; // RFC 6238 §5.2: a code is good once
    }
  });
  if (!hit) {
    ctx.app.fire("suspicious", { ctx, weight: 2, reason: "totp verification failed" }).catch(() => {});
    throw new ApiError(422, "That code does not match");
  }
  ctx.app.db.table("usr_auth_factor").update(Number(hit.row.id), { last_used: hit.used }); // background write
  return !await proof(ctx, TYPE, usrId); // nothing missing = it counted
}

/** Remove one of the user's authenticator apps. */
export async function forget(ctx: Ctx, id: number): Promise<void> {
  if (!await drop(ctx.app, ctx.userId, TYPE, id)) throw new ApiError(404, "Not found");
}
