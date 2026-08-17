// Public API of auth.otp. The qino plugin lives in ./plugin.ts.
import { ApiError } from "@qino/qino";
import { proof } from "@qino/qino/auth";
import { channel, redeemCode, requestCode } from "@qino/qino/messaging";

import type { Ctx } from "@qino/qino";

// The claim is keyed by the user, not by an address: the contact is verified already, so what the
// code proves is presence, not ownership. Prefixed, or it would collide with a pending claim on
// the same address in the same table.
const claim = (name: string) => "otp:" + name;

/** Send a fresh code over `name`. The code exists in the message and in a hash, nowhere else. */
export async function send(ctx: Ctx, name: string): Promise<void> {
  const target = channel(ctx.app, name);
  if (!target || !await target.reach(ctx.app, ctx.userId)) throw new ApiError(404, "No such way to reach you");
  const code = await requestCode(ctx.app, claim(name), ctx.userId, String(ctx.userId));
  // WebOTP: Android fills the field by itself, but only from an sms whose last line is exactly
  // `@host #code` — the host being the origin that asks for it. Noise anywhere else, so sms only.
  const webOtp = name === "sms" ? `\n\n@${ctx.req.url.host} #${code}` : "";
  await target.send(ctx.app, { usr: ctx.userId }, {
    title: await ctx.app.t`Your confirmation code`,
    text: await ctx.app.t`${code} confirms it is you. It is valid for ten minutes.` + webOtp,
  });
}

/** Redeem it. `redeemCode` counts the attempts and throws; what is left is what the proof is worth. */
export async function verify(ctx: Ctx, name: string, code: string): Promise<boolean> {
  await redeemCode(ctx.app, claim(name), ctx.userId, String(ctx.userId), code);
  return proof(ctx, name, ctx.userId);
}
