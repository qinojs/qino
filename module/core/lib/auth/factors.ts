/** Which identity proofs exist and whether a set is enough. Opening a session: login.ts. */
import { StepUpError } from "../api/errors.ts";
import { isOn, unixTime } from "../util.ts";

import type { App } from "../App.ts";
import type { Ctx } from "../ctx/Ctx.ts";

/** A way to prove identity, declared by a module as `authFactors` (a list, or a function of the
 *  app). Every factor can log in; the flags add to that. */
export type AuthFactor = {
  name: string;
  label: string;
  /** Only as second factor of a login, never the first (backup codes, sent codes). */
  second?: boolean;
  /** Can also refresh an open session, not just open one. */
  stepUp?: boolean;
  /** Sort order when several are offered, lowest first. Presentation only. */
  order?: number;
  /** Whether this user has set it up. Without it, the factor counts as set up for everyone. */
  has?(app: App, usrId: number): Promise<boolean>;
};

/** A factor plus its module (where the browser loads `pub/stepup.js` from). */
type Declared = AuthFactor & { module: string };

/** All factors of linked modules. */
export const authFactors = (app: App): Declared[] =>
  app.modules.linked().flatMap((m) => {
    const declared = m.plugin.authFactors as AuthFactor[] | ((app: App) => AuthFactor[]) | undefined;
    const list = typeof declared === "function" ? declared(app) : declared ?? [];
    return list.map((f) => ({ ...f, module: m.name }));
  });

/** Those of `factors` this user has set up. No `has()` counts as set up. */
async function setUpBy<T extends AuthFactor>(app: App, usrId: number, factors: T[]): Promise<T[]> {
  const has = await Promise.all(factors.map((f) => f.has?.(app, usrId).catch(() => false) ?? true));
  return factors.filter((_, i) => has[i]);
}

/** All factors this user has set up. */
export const userFactors = (app: App, usrId: number): Promise<Declared[]> => setUpBy(app, usrId, authFactors(app));

/** What is offered for a step-up: the factor and its module. */
export type Offer = { name: string; label: string; module: string };

const MIDDLE = 50; // default order

/** Best first, so the dialog opens it. */
const offer = (factors: Declared[]): Offer[] =>
  factors.sort((a, b) => (a.order ?? MIDDLE) - (b.order ?? MIDDLE))
    .map(({ name, label, module }) => ({ name, label, module }));

// ─── Is this session fresh enough? ────────────────────────────────────────────

/**
 * Require a proof no older than `maxAge` seconds, else throw `StepUpError` listing usable factors.
 * Resolves `true`, so it fits in a guard: `guard: (_p, ctx) => requireStepUp(ctx)`.
 *
 * Only declared factors count; `via` also holds `remember` and `login_as`, which prove nothing.
 */
export async function requireStepUp(ctx: Ctx, { maxAge = 300 }: { maxAge?: number } = {}): Promise<true> {
  if (ctx.statelessAuth) throw new StepUpError([], maxAge); // a token proves no person is present
  const factors = authFactors(ctx.app).filter((f) => f.stepUp);
  const via = (ctx.sess.data.core.via() ?? {}) as Record<string, number>;
  const newest = Math.max(0, ...factors.map((f) => Number(via[f.name] ?? 0)));
  if (newest && unixTime() - newest <= maxAge) return true;
  const usable = await setUpBy(ctx.app, ctx.userId, factors);
  // no factor set up: requiring one would only lock the user out
  if (!usable.length) return true;
  throw new StepUpError(offer(usable), maxAge);
}

// ─── Is this enough to sign in? ───────────────────────────────────────────────

const PENDING_MAX_AGE = 10 * 60; // unfinished logins expire

/** The pending login: identity known, proofs not yet enough. Stored in the anonymous session,
 *  which `login()` replaces — nothing else to clean up. */
export function pendingLogin(ctx: Ctx): { usrId: number; via: Record<string, number> } | undefined {
  const p = ctx.sess?.data.core.pending() as { usrId?: number; via?: Record<string, number>; time?: number } | undefined;
  if (!p?.usrId || unixTime() - Number(p.time ?? 0) > PENDING_MAX_AGE) return;
  return { usrId: Number(p.usrId), via: p.via ?? {} };
}

/** The signed-in user, or the one of a pending login. 0 = nobody. */
export const identified = (ctx: Ctx): number => ctx.userId || pendingLogin(ctx)?.usrId || 0;

/** Add `factor` to the pending login, or start one for `usrId`; returns its proofs. A `second`
 *  factor can't start a login and returns nothing then. */
export function parkLogin(ctx: Ctx, factor: AuthFactor, usrId: number): Record<string, number> | undefined {
  const open = pendingLogin(ctx);
  const same = open?.usrId === usrId; // another user starts a new login
  if (!same && factor.second) return;
  const now = unixTime();
  const via = { ...(same ? open!.via : {}), [factor.name]: now };
  ctx.sess.data.core.pending({ usrId, via, time: now });
  return via;
}

/**
 * What a login still needs; empty = the session can open. The only place deciding login strength.
 *
 * One non-`second` factor is enough, unless `core.loginTwoFactor` requires a second. Users without
 * a second factor get in anyway, otherwise they'd be locked out.
 */
export async function loginNeeds(ctx: Ctx, usrId: number, via: Record<string, number>): Promise<Offer[]> {
  const factors = authFactors(ctx.app);
  const given = factors.filter((f) => via[f.name]);
  const enough = given.some((f) => !f.second) &&
    (given.length > 1 || !isOn(await ctx.app.settings.core.loginTwoFactor));
  if (enough) return [];
  return offer(await setUpBy(ctx.app, usrId, factors.filter((f) => !via[f.name])));
}
