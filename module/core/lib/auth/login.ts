/** Signing in: the form, the password, the session. What may prove an identity is factors.ts. */
import { proofFailed, proofPassed, proofWait } from "./attempts.ts";
import { bcrypt } from "../../deps.ts";
import { authFactors, loginNeeds, parkLogin } from "./factors.ts";
import { safeEqual } from "../crypto.ts";
import { unixTime } from "../util.ts";

import type { App } from "../App.ts";
import type { Ctx } from "../ctx/Ctx.ts";
import type { AuthFactor, Offer } from "./factors.ts";
import type { Usr } from "../rows.ts";

/** Why a request is not signed in. `pending` is no failure: right credentials, second factor owed. */
export type LoginError = "username" | "inactive" | "password" | "pending" | "throttled";

// Valid cost-10 bcrypt hash, compared against when the user is missing/inactive so
// response timing can't reveal whether an e-mail is registered (user enumeration).
const DUMMY_HASH = "$2b$10$mNCtEIOBxmrxZ9o/YRr0UuW5LOGc.CCei3F1s/CpKt.6Fd0iJsJEi";

/** Act on the login/logout form in the request, or on a client that may come back without typing.
 *  Part of the per-request boot, before any route runs. */
export async function loginFromRequest(ctx: Ctx): Promise<void> {
  const body = ctx.req.method === "POST" ? ctx.req.body : null;
  if (body?.core_login != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return;
    const saveLogin = !!body.save_login;
    ctx.loginError = await tryLogin(ctx, String(body.email ?? ""), String(body.pw ?? "")) || undefined;
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
      if (row?.email) await tryLogin(ctx, row.email);
    }
  }
}

/** Log in whoever holds this e-mail — by what the client remembers, else by password.
 *  Resolves with why no session was opened, or "" when one was. */
export async function tryLogin(ctx: Ctx, email: string, pw = ""): Promise<LoginError | ""> {
  const user = await ctx.app.db.row`SELECT * FROM usr WHERE LOWER(TRIM(email)) = LOWER(${email.trim()})`;
  if (!user || !user.active) { await pwVerify(pw, DUMMY_HASH); return user ? "inactive" : "username"; }
  const usr = ctx.app.db.table("usr").row<Usr>(user.id).$receive(user); // the SELECT above is the load
  const usrId = Number(user.id);
  const rehash = pwNeedsRehash(usr.pw);
  if (!rehash) {
    const clientUsrs = await ctx.client.users();
    // remember-me: the password is never asked here, so this is how access was had, not what proved it
    if (clientUsrs[String(usrId)]?.save_login) return await login(ctx, usrId, "remember") ? "" : "username";
  }
  // Only a typed password is a guess — the pass above comes through without one on every request of
  // a client whose session lapsed, and that must neither cost the account nor make it wait.
  if (!pw) return "password";
  // The wait is the account's, so the user has to be known before we can ask for it. A wait
  // therefore tells an outsider that this address exists; it costs them four wrong guesses to learn
  // that, and the alternative is lying to the owner about why they cannot get in.
  const wait = await proofWait(ctx.app, usrId);
  if (wait) {
    ctx.loginRetryAfter = wait; // the form says how long, so nobody has to guess that too
    return "throttled";
  }
  if (!await pwVerify(pw, usr.pw ?? "")) {
    await proofFailed(ctx.app, usrId);
    return "password";
  }
  if (rehash) await usr.$set({ pw: await pwHash(pw) });
  // The same route every other factor takes: core declares `password` and claims no shortcut.
  const missing = await loginProof(ctx, passwordFactor(ctx.app), usrId);
  if (!missing) return "";
  return missing.length ? "pending" : "username";
}

/** Core's own declaration, read back from the plugin so it is stated once. */
const passwordFactor = (app: App): AuthFactor =>
  authFactors(app).find((f) => f.name === "password") ?? { name: "password", label: "Password" };

/** A factor established `usrId` at login: park it, and open the session once the set is enough.
 *  Nothing = signed in, otherwise what is missing (empty = nothing here helps). */
export async function loginProof(ctx: Ctx, factor: AuthFactor, usrId: number): Promise<Offer[] | undefined> {
  const via = parkLogin(ctx, factor, usrId);
  if (!via) return [];
  const missing = await loginNeeds(ctx, usrId, via);
  // Only a finished login wipes the wait. Clearing it per factor would hand whoever knows the
  // password a fresh budget for every guess at the second one, which is the very attack it is for.
  if (missing.length) return missing;
  if (!await login(ctx, usrId, via)) return [];
  await proofPassed(ctx.app, usrId);
}

/** Make `id` the session's user; the caller has established who that is. `via` records how and when
 *  — a record, not a permission, so `remember` and `login_as` belong there too. A set keeps each moment. */
export async function login(ctx: Ctx, id: number | string, via?: string | Record<string, number>): Promise<boolean> {
  id = Number(id);
  if (!await ctx.app.db.one`SELECT id FROM usr WHERE id = ${id} AND active = ${true}`) return false;
  // The values, not the item: logout() empties it, and the listeners run after that.
  const oldSession = ctx.sess.data() as Record<string, unknown>;
  await logout(ctx);
  // new session id after logout prevents session fixation
  const session = await ctx.app.sessions.regenerateId(ctx.sess.token);
  ctx.sess = session;
  ctx.sess.data.core.userId(id);
  const record = typeof via === "string" ? { [via]: unixTime() } : via ?? {};
  for (const [name, at] of Object.entries(record)) ctx.sess.data.core.via[name](at);
  ctx.app.sessions.setCookieIfNew(ctx); // login owns the cookie, independent of request timing
  await ctx.client.addUsr(id);
  await ctx.client.$set({ usr_id: id });
  await ctx.app.fire("auth:login", { oldSession, usrId: id });
  return true;
}

export async function logout(ctx: Ctx): Promise<void> {
  await rememberLogin(ctx, false);
  await ctx.client.$set({ usr_id: 0 });
  ctx.sess.data({});
}

/** Whether this client may come back as this user without typing anything. */
async function rememberLogin(ctx: Ctx, doSave: boolean): Promise<void> {
  const usr = ctx.userId ? await ctx.app.db.table("usr").get(ctx.userId) : undefined;
  if (!usr) return;
  const link = ctx.app.db.table("client_usr").row({ usr_id: String(usr), client_id: String(ctx.client) });
  await link.$set({ save_login: doSave });
}

// ─── Passwords and constant-time compares ─────────────────────────────────────

export function pwHash(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function pwVerify(pw: string, hash: string) {
  if (!pw || !hash) return false;
  return bcrypt.compare(pw, hash.replace(/^\$2y\$/, "$2b$")); // PHP uses $2y$, bcryptjs uses $2b$ — functionally identical
}

function pwNeedsRehash(hash: string) {
  return !/^\$2[aby]\$/.test(hash);
}
