import { ApiError, identified } from "@qino/qino";
import { proof } from "@qino/qino/auth";
import { channel, redeemCode, requestCode } from "@qino/qino/messaging";

import type { Ctx } from "@qino/qino";

// Keyed by user, not address: the contact is already verified, the code proves presence. Prefixed
// so it doesn't collide with a pending verification of the same address.
const claim = (name: string) => "otp:" + name;

/** Send a fresh code over `name`. The code exists in the message and in a hash, nowhere else. */
export async function send(ctx: Ctx, name: string): Promise<void> {
  const usrId = identified(ctx);
  const target = channel(ctx.app, name);
  // Not to the asking device — that proves nothing new. Only webpush can be that device.
  const notClient = ctx.clientId ?? undefined;
  if (!target || !await target.reach(ctx.app, usrId, notClient)) throw new ApiError(404, "No such way to reach you");
  const code = await requestCode(ctx.app, claim(name), usrId, String(usrId));
  // WebOTP: Android autofills the field from an sms ending with `@host #code`. Only for sms.
  const webOtp = name === "sms" ? `\n\n@${ctx.req.url.host} #${code}` : "";
  await target.send(ctx.app, { usr: usrId, notClient }, {
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
