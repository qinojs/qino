import { timingSafeEqual } from "node:crypto";

import { bcrypt } from "../deps.ts";
import { StepUpError } from "./api/errors.ts";
import { unixTime } from "./util.ts";

import type { App } from "./App.ts";
import type { Ctx } from "./ctx/Ctx.ts";
import type { Usr } from "./rows.ts";

// Valid cost-10 bcrypt hash, compared against when the user is missing/inactive so
// response timing can't reveal whether an e-mail is registered (user enumeration).
const DUMMY_HASH = "$2b$10$mNCtEIOBxmrxZ9o/YRr0UuW5LOGc.CCei3F1s/CpKt.6Fd0iJsJEi";

export type LoginError = "username" | "inactive" | "password";

export async function authListen(ctx: Ctx): Promise<void> {
  const body = ctx.req.method === "POST" ? ctx.req.body : null;
  if (body?.core_login != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return;
    const saveLogin = !!body.save_login;
    ctx.loginError = await auth(ctx, String(body.email ?? ""), String(body.pw ?? "")) || undefined;
    await rememberLogin(ctx, saveLogin);
  }
  if (body?.core_logout != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return;
    await logout(ctx);
  }
  if (!ctx.userId && ctx.clientId) {
    const uid = Number(ctx.client.usr_id) || 0;
    if (uid) {
      const row = await ctx.app.db.row`SELECT email FROM usr WHERE id = ${uid}`;
      if (row?.email) await auth(ctx, row.email);
    }
  }
}

export async function auth(ctx: Ctx, email: string, pw = ""): Promise<LoginError | ""> {
  const user = await ctx.app.db.row`SELECT * FROM usr WHERE LOWER(TRIM(email)) = LOWER(${email.trim()})`;
  if (!user || !user.active) { await pwVerify(pw, DUMMY_HASH); return user ? "inactive" : "username"; }
  const usr = ctx.app.db.table("usr").row<Usr>(user.id).$receive(user); // the SELECT above is the load
  const rehash = pwNeedsRehash(usr.pw);
  if (!rehash) {
    const clientUsrs = await ctx.client.users();
    // remember-me: the password is never asked here, so this is how access was had, not what proved it
    if (clientUsrs[String(usr.id)]?.save_login) return await login(ctx, user.id, "remember") ? "" : "username";
  }
  if (!await pwVerify(pw, usr.pw ?? "")) return "password";
  if (rehash) await usr.$set({ pw: await pwHash(pw) });
  return await login(ctx, user.id, "password") ? "" : "username";
}

/** Make `id` the session's user — the caller has already established who that is. `via` records how,
 *  timestamped; a record, not a permission, so `remember` and `login_as` belong there too. */
export async function login(ctx: Ctx, id: number | string, via?: string): Promise<boolean> {
  id = Number(id);
  if (!await ctx.app.db.one`SELECT id FROM usr WHERE id = ${id} AND active = ${true}`) return false;
  // The values, not the item: logout() empties it, and the listeners run after that.
  const oldSession = ctx.sess.data() as Record<string, unknown>;
  await logout(ctx);
  // new session id after logout prevents session fixation
  const session = await ctx.app.sessions.regenerateId(ctx.sess.token);
  ctx.sess = session;
  ctx.sess.data.core.userId(id);
  if (via) ctx.sess.data.core.via[via](unixTime());
  ctx.app.sessions.setCookieIfNew(ctx); // login owns the cookie, independent of request timing
  await ctx.client.addUsr(id);
  await ctx.client.$set({ usr_id: id });
  await ctx.app.fire("auth:login", { oldSession, usrId: id });
  return true;
}

const MIDDLE = 50; // where a factor lands that does not say where it belongs

/** What a module declares as `plugin.authFactors` — a list, or a function of the app for a module
 *  whose factors depend on what else is installed. Core reads the fields a policy needs; what else
 *  a factor is, only the `auth` module cares about. */
type Declared = { name: string; label: string; stepUp?: boolean; order?: number; has?(app: App, usrId: number): Promise<boolean> };
type Declaration = Declared[] | ((app: App) => Declared[]);

/** The declaring module travels with each factor: it is where the browser finds `pub/stepup.js`,
 *  and only this list knows it — a factor's name says nothing about who declared it. */
const stepUpFactors = (app: App): (Declared & { module: string })[] =>
  app.modules.linked().flatMap((m) => {
    const declared = m.plugin.authFactors as Declaration | undefined;
    const list = typeof declared === "function" ? declared(app) : declared ?? [];
    return list.filter((f) => f.stepUp).map((f) => ({ ...f, module: m.name }));
  });

/**
 * Demand a proof of identity no older than `maxAge` seconds, else throw `StepUpError` with the
 * factors that would satisfy it. Resolves with `true`, so a verb can say it in one line:
 * `guard: (_p, ctx) => requireStepUp(ctx, { maxAge: 300 })`.
 *
 * Only declared factors count. `via` also records `remember` and `login_as` — how access was had,
 * not what proved it.
 */
export async function requireStepUp(ctx: Ctx, { maxAge = 300 }: { maxAge?: number } = {}): Promise<true> {
  const factors = stepUpFactors(ctx.app);
  const via = (ctx.sess.data.core.via() ?? {}) as Record<string, number>;
  const newest = Math.max(0, ...factors.map((f) => Number(via[f.name] ?? 0)));
  if (newest && unixTime() - newest <= maxAge) return true;
  // A stateless credential has no session to prove anything into, so it is offered nothing.
  if (ctx.statelessAuth) throw new StepUpError([], maxAge);
  const usable = await withFactor(ctx, factors);
  // Nothing to prove with: demanding it would only lock this user out of setting up their first
  // factor — and a demand no one can meet protects nothing.
  if (!usable.length) return true;
  usable.sort((a, b) => (a.order ?? MIDDLE) - (b.order ?? MIDDLE));
  throw new StepUpError(usable.map(({ name, label, module }) => ({ name, label, module })), maxAge);
}

/** Of the factors, those this user has set up. One that cannot answer per user is offered anyway. */
async function withFactor<T extends Declared>(ctx: Ctx, factors: T[]): Promise<T[]> {
  const has = await Promise.all(factors.map((f) => f.has?.(ctx.app, ctx.userId).catch(() => false) ?? true));
  return factors.filter((_, i) => has[i]);
}

export async function logout(ctx: Ctx): Promise<void> {
  await rememberLogin(ctx, false);
  await ctx.client.$set({ usr_id: 0 });
  ctx.sess.data({});
}

export function pwHash(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function pwVerify(pw: string, hash: string) {
  if (!pw || !hash) return false;
  return bcrypt.compare(pw, hash.replace(/^\$2y\$/, "$2b$")); // PHP uses $2y$, bcryptjs uses $2b$ — functionally identical
}

async function rememberLogin(ctx: Ctx, doSave: boolean): Promise<void> {
  const usr = ctx.userId ? await ctx.app.db.table("usr").get(ctx.userId) : undefined;
  if (!usr) return;
  const link = ctx.app.db.table("client_usr").row({ usr_id: String(usr), client_id: String(ctx.client) });
  await link.$set({ save_login: doSave });
}

function pwNeedsRehash(hash: string) {
  return !/^\$2[aby]\$/.test(hash);
}

const enc = new TextEncoder();
/** Constant-time token compare (CSRF etc.); coerces untrusted input to string. */
export function safeEqual(a: unknown, b: string): boolean {
  const ab = enc.encode(String(a ?? "")), bb = enc.encode(b);
  return ab.byteLength === bb.byteLength && timingSafeEqual(ab, bb);
}
