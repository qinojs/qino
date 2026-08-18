/** Which proofs of identity exist, and whether a set of them is enough. Opening a session is auth.ts. */
import { StepUpError } from "./api/errors.ts";
import { isOn, unixTime } from "./util.ts";

import type { App } from "./App.ts";
import type { Ctx } from "./ctx/Ctx.ts";

/** A way of proving who you are, declared by a module as `authFactors` — a list, or a function of
 *  the app when it depends on what else is installed. Every factor can log in; the flags add to that. */
export type AuthFactor = {
  name: string;
  label: string;
  /** Can only be the second factor of a login, never the first (backup codes, a code sent out). */
  second?: boolean;
  /** Can also refresh an open session, not just open one. */
  stepUp?: boolean;
  /** Sort order when several are offered, lowest first. Presentation only. */
  order?: number;
  /** Whether this user has it set up. Left out where a factor cannot tell (oauth), and then counts
   *  as set up for everyone. */
  has?(app: App, usrId: number): Promise<boolean>;
};

/** A factor plus the module that declared it: where the browser loads `pub/stepup.js` from. */
type Declared = AuthFactor & { module: string };

/** Every factor linked modules declare. */
export const authFactors = (app: App): Declared[] =>
  app.modules.linked().flatMap((m) => {
    const declared = m.plugin.authFactors as AuthFactor[] | ((app: App) => AuthFactor[]) | undefined;
    const list = typeof declared === "function" ? declared(app) : declared ?? [];
    return list.map((f) => ({ ...f, module: m.name }));
  });

/** Of `factors`, those this user has set up. No `has()` counts as set up. */
async function setUpBy<T extends AuthFactor>(app: App, usrId: number, factors: T[]): Promise<T[]> {
  const has = await Promise.all(factors.map((f) => f.has?.(app, usrId).catch(() => false) ?? true));
  return factors.filter((_, i) => has[i]);
}

/** Every factor this user has set up. */
export const userFactors = (app: App, usrId: number): Promise<Declared[]> => setUpBy(app, usrId, authFactors(app));

/** What is offered to answer a demand: the factor, and the module to load it from. */
export type Offer = { name: string; label: string; module: string };

const MIDDLE = 50; // order of a factor that gives none

/** Strongest first, so a dialog opens the best one. */
const offer = (factors: Declared[]): Offer[] =>
  factors.sort((a, b) => (a.order ?? MIDDLE) - (b.order ?? MIDDLE))
    .map(({ name, label, module }) => ({ name, label, module }));

// ─── Is this session fresh enough? ────────────────────────────────────────────

/**
 * Demand a proof no older than `maxAge` seconds, else throw `StepUpError` with what would satisfy it.
 * Resolves `true`, so a guard fits on one line: `guard: (_p, ctx) => requireStepUp(ctx)`.
 *
 * Only declared factors count: `via` also holds `remember` and `login_as`, which prove nothing.
 */
export async function requireStepUp(ctx: Ctx, { maxAge = 300 }: { maxAge?: number } = {}): Promise<true> {
  const factors = authFactors(ctx.app).filter((f) => f.stepUp);
  const via = (ctx.sess.data.core.via() ?? {}) as Record<string, number>;
  const newest = Math.max(0, ...factors.map((f) => Number(via[f.name] ?? 0)));
  if (newest && unixTime() - newest <= maxAge) return true;
  if (ctx.statelessAuth) throw new StepUpError([], maxAge); // no session to prove into
  const usable = await setUpBy(ctx.app, ctx.userId, factors);
  // nothing to prove with: a demand nobody can meet protects nothing, it only locks them out
  if (!usable.length) return true;
  throw new StepUpError(offer(usable), maxAge);
}

// ─── Is this enough to sign in? ───────────────────────────────────────────────

const PENDING_MAX_AGE = 10 * 60; // half-given logins are abandoned more often than finished

/** The login under way: identity established, proofs not enough yet. Lives in the anonymous session,
 *  which `login()` rotates away — nothing to expire elsewhere. */
export function pendingLogin(ctx: Ctx): { usrId: number; via: Record<string, number> } | undefined {
  const p = ctx.sess?.data.core.pending() as { usrId?: number; via?: Record<string, number>; time?: number } | undefined;
  if (!p?.usrId || unixTime() - Number(p.time ?? 0) > PENDING_MAX_AGE) return;
  return { usrId: Number(p.usrId), via: p.via ?? {} };
}

/** Who the request established: whoever is signed in, or the login under way. 0 = nobody. */
export const identified = (ctx: Ctx): number => ctx.userId || pendingLogin(ctx)?.usrId || 0;

/** Add `factor` to the login under way, or begin one for `usrId`; returns the proofs it holds then.
 *  A `second` factor cannot begin one, so it returns nothing there. */
export function parkLogin(ctx: Ctx, factor: AuthFactor, usrId: number): Record<string, number> | undefined {
  const open = pendingLogin(ctx);
  const same = open?.usrId === usrId; // another identity starts its own login
  if (!same && factor.second) return;
  const now = unixTime();
  const via = { ...(same ? open!.via : {}), [factor.name]: now };
  ctx.sess.data.core.pending({ usrId, via, time: now });
  return via;
}

/**
 * What a login still needs; empty = this set opens a session. The one place login strength is decided.
 *
 * One non-`second` factor is enough, unless `core.loginTwoFactor` asks for a second. Whoever has none
 * is let in anyway — a demand nobody can meet only locks them out.
 */
export async function loginNeeds(ctx: Ctx, usrId: number, via: Record<string, number>): Promise<Offer[]> {
  const factors = authFactors(ctx.app);
  const given = factors.filter((f) => via[f.name]);
  const enough = given.some((f) => !f.second) &&
    (given.length > 1 || !isOn(await ctx.app.settings.core.loginTwoFactor));
  if (enough) return [];
  return offer(await setUpBy(ctx.app, usrId, factors.filter((f) => !via[f.name])));
}
