// Public API of auth.totp. The qino plugin lives in ./plugin.ts.
import { ApiError, unixTime } from "@qino/qino";
import { drop, proof, store, stored } from "@qino/qino/auth";

import { secret, uri, valid } from "./lib/totp.ts";

import type { Ctx } from "@qino/qino";

const TYPE = "totp";

// The candidate secret is not a factor until a code proves the app holds it, so it waits in the
// session rather than in the table — an abandoned enrolment then needs no cleanup.
const pending = (ctx: Ctx) => ctx.sess.data["auth.totp"].pending;

/** Start setting one up. The secret is shown once, as text and as the `otpauth://` uri behind a QR. */
export function enrol(ctx: Ctx): { secret: string; uri: string } {
  const fresh = secret();
  pending(ctx)(fresh);
  return { secret: fresh, uri: uri(fresh, String(ctx.user?.email || ctx.userId), ctx.req.url.host) };
}

/** Finish setting one up — the code is what proves the app really holds the secret. */
export async function confirm(ctx: Ctx, code: string, label = ""): Promise<void> {
  const candidate = String(pending(ctx)() ?? "");
  if (!candidate) throw new ApiError(409, "Nothing to set up — start again");
  if (!await valid(candidate, code)) throw new ApiError(422, "That code does not match");
  await store(ctx.app, ctx.userId, TYPE, { secret: candidate }, label);
  pending(ctx)(undefined);
}

/** Prove the current user is present. Resolves with what the proof was worth. */
export async function verify(ctx: Ctx, code: string): Promise<boolean> {
  for (const row of await stored(ctx.app, ctx.userId, TYPE)) {
    if (!await valid(String(JSON.parse(String(row.data)).secret), code)) continue;
    ctx.app.db.table("usr_auth_factor").update(Number(row.id), { last_used: unixTime() }); // background write
    return await proof(ctx, TYPE, ctx.userId);
  }
  ctx.app.fire("suspicious", { ctx, reason: "totp verification failed" }).catch(() => {});
  throw new ApiError(422, "That code does not match");
}

/** Remove one of the user's authenticator apps. */
export async function forget(ctx: Ctx, id: number): Promise<void> {
  if (!await drop(ctx.app, ctx.userId, TYPE, id)) throw new ApiError(404, "Not found");
}
