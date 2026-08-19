// Public API of auth.otp. The qino plugin lives in ./plugin.ts.
import { ApiError, identified } from "@qino/qino";
import { proof } from "@qino/qino/auth";
import { channel, redeemCode, requestCode } from "@qino/qino/messaging";

import type { Ctx } from "@qino/qino";

// The claim is keyed by the user, not by an address: the contact is verified already, so what the
// code proves is presence, not ownership. Prefixed, or it would collide with a pending claim on
// the same address in the same table.
const claim = (name: string) => "otp:" + name;

/** Send a fresh code over `name`. The code exists in the message and in a hash, nowhere else. */
export async function send(ctx: Ctx, name: string): Promise<void> {
  const usrId = identified(ctx);
  const target = channel(ctx.app, name);
  if (!target || !await target.reach(ctx.app, usrId)) throw new ApiError(404, "No such way to reach you");
  const code = await requestCode(ctx.app, claim(name), usrId, String(usrId));
  // WebOTP: Android fills the field by itself, but only from an sms whose last line is exactly
  // `@host #code` — the host being the origin that asks for it. Noise anywhere else, so sms only.
  const webOtp = name === "sms" ? `\n\n@${ctx.req.url.host} #${code}` : "";
  await target.send(ctx.app, { usr: usrId }, {
    title: await ctx.app.t`Your confirmation code`,
    text: await ctx.app.t`${code} confirms it is you. It is valid for ten minutes.` + webOtp,
  });
}

/** Redeem it. `redeemCode` charges a wrong one to the account's wait and throws. */
export async function verify(ctx: Ctx, name: string, code: string): Promise<boolean> {
  const usrId = identified(ctx);
  await redeemCode(ctx.app, claim(name), usrId, String(usrId), code);
  return !await proof(ctx, name, usrId); // nothing missing = it counted
}
