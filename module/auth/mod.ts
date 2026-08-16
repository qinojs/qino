// Public API of auth. The qino plugin lives in ./plugin.ts.
import { login, unixTime } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";

/** A way of showing who you are, declared by a module as `export const authFactor`.
 *  Starting a session and refreshing one are different permissions — a factor may have either. */
export type Factor = {
  name: string;
  label: string;
  login?: boolean;
  stepUp?: boolean;
};

/** Every factor a linked module declares. */
export function factors(app: App): Factor[] {
  return app.modules.linked().filter((mod) => mod.plugin.authFactor).map((mod) => mod.plugin.authFactor as Factor);
}

/** A factor established that this is user `usrId`; where the request stands decides what that is
 *  worth. Signed in as them it is a fresh proof kept in the session, otherwise it is a login. */
export async function proof(ctx: Ctx, factor: string, usrId: number): Promise<boolean> {
  const declared = factors(ctx.app).find((f) => f.name === factor);
  if (!declared) throw new Error(`auth: no factor "${factor}" — declare it in a module's authFactor export`);
  if (ctx.userId === usrId) {
    // A stateless credential identifies a request, not a session — the session a proof would be
    // written to is whoever's holds the cookie, so there is nothing here to refresh.
    if (ctx.statelessAuth || !declared.stepUp) return false;
    ctx.sess.data.core.via[factor](unixTime());
    return true;
  }
  return declared.login ? await login(ctx, usrId, factor) : false;
}
