/** Signing in: form, password, session. Which proofs count: factors.ts. */
import { inTurn, proofFailed, proofPassed, proofWait } from "./attempts.ts";
import { bcrypt } from "../../deps.ts";
import { authFactors, loginNeeds, parkLogin } from "./factors.ts";
import { safeEqual } from "../crypto.ts";
import { unixTime } from "../util.ts";

import type { App } from "../App.ts";
import type { Ctx } from "../ctx/Ctx.ts";
import type { AuthFactor, Offer } from "./factors.ts";
import type { Usr } from "../rows.ts";

/** Why a request is not signed in. `pending` is no failure: credentials ok, second factor missing. */
export type LoginError = "username" | "inactive" | "password" | "pending" | "throttled";

// Valid cost-10 bcrypt hash, checked when the user is missing/inactive, so timing doesn't reveal
// whether an e-mail is registered.
const DUMMY_HASH = "$2b$10$mNCtEIOBxmrxZ9o/YRr0UuW5LOGc.CCei3F1s/CpKt.6Fd0iJsJEi";

/** Handle the login/logout form, or a remembered client. Runs per request before any route. */
export async function loginFromRequest(ctx: Ctx): Promise<void> {
  const body = ctx.req.method === "POST" ? ctx.req.body : null;
  if (body?.core_login != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return;
    const saveLogin = !!body.save_login;
    ctx.loginError = await tryLogin(ctx, String(body.email ?? ""), String(body.pw ?? "")) || undefined;
    if (!ctx.loginError) await rememberLogin(ctx, saveLogin);
    // attempts.ts slows down the account, this the client trying many accounts. Every failure
    // weighs the same, otherwise the delay would reveal whether an address exists.
    if (ctx.loginError && ctx.loginError !== "pending") {
      ctx.app.fire("suspicious", { ctx, weight: 2, reason: "login failed: " + ctx.loginError }).catch(() => {});
    }
  }
  if (body?.core_logout != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return;
    await logout(ctx);
  }
  if (!ctx.userId && ctx.clientId) {
    const uid = Number(ctx.client.usr_id) || 0;
    if (uid) {
      const row = await ctx.app.db.row`SELECT username FROM usr WHERE id = ${uid}`;
      if (row?.username) await tryLogin(ctx, row.username);
    }
  }
}

/** Log in the user with this e-mail — via remembered client, else password.
 *  Resolves with the reason if no session was opened, "" on success. */
export async function tryLogin(ctx: Ctx, email: string, pw = ""): Promise<LoginError | ""> {
  const user = await ctx.app.db.row`SELECT * FROM usr WHERE LOWER(TRIM(username)) = LOWER(${email.trim()})`;
  if (!user || !user.active) { await pwVerify(pw, DUMMY_HASH); return user ? "inactive" : "username"; }
  const usr = ctx.app.db.table("usr").row<Usr>(user.id).$receive(user); // loaded by the SELECT above
  const usrId = Number(user.id);
  const rehash = pwNeedsRehash(usr.pw);
  const known = (await ctx.client.users())[String(usrId)];
  // remember-me: no password asked, so this records the way in, not a proof
  if (!rehash && known?.save_login) return await login(ctx, usrId, "remember") ? "" : "username";
  // Only a typed password is a guess; remembered clients must not count as attempts.
  if (!pw) return "password";
  // The wait belongs to the account, so it reveals that the address exists (after four wrong
  // tries) — accepted, so the owner learns why they can't get in.
  // Known clients of this user never wait, so nobody can lock the owner out; wrong tries still count.
  const failed = await inTurn(ctx.app, usrId, async () => {
    const wait = known ? 0 : await proofWait(ctx.app, usrId);
    if (wait) {
      ctx.loginRetryAfter = wait; // shown in the form
      return "throttled";
    }
    if (await pwVerify(pw, usr.pw ?? "")) return;
    await proofFailed(ctx.app, usrId);
    return "password";
  });
  if (failed) return failed;
  if (rehash) await usr.$set({ pw: await pwHash(pw) });
  // Same path as every other factor: core declares `password`.
  const missing = await loginProof(ctx, passwordFactor(ctx.app), usrId);
  if (!missing) return "";
  return missing.length ? "pending" : "username";
}

/** Core's factor declaration, from the plugin. */
const passwordFactor = (app: App): AuthFactor =>
  authFactors(app).find((f) => f.name === "password") ?? { name: "password", label: "Password" };

/** A factor identified `usrId` at login: store it as pending, open the session once enough.
 *  Returns nothing when signed in, else what is missing (empty = nothing helps). */
export async function loginProof(ctx: Ctx, factor: AuthFactor, usrId: number): Promise<Offer[] | undefined> {
  const via = parkLogin(ctx, factor, usrId);
  if (!via) return [];
  const missing = await loginNeeds(ctx, usrId, via);
  // Only a finished login resets the wait; resetting per factor would give a password holder new
  // guesses for the second factor.
  if (missing.length) return missing;
  if (!await login(ctx, usrId, via)) return [];
  await proofPassed(ctx.app, usrId);
}

/** Make `id` the session's user (the caller verified it). `via` records how and when — a log, not
 *  a permission, so `remember` and `login_as` are included. */
export async function login(ctx: Ctx, id: number | string, via?: string | Record<string, number>): Promise<boolean> {
  id = Number(id);
  if (!await ctx.app.db.one`SELECT id FROM usr WHERE id = ${id} AND active = ${true}`) return false;
  // Copy the values: logout() empties the item before the listeners run.
  const oldSession = ctx.sess.data() as Record<string, unknown>;
  await logout(ctx);
  // new session id after logout prevents session fixation
  const session = await ctx.app.sessions.regenerateId(ctx.sess.token);
  ctx.sess = session;
  ctx.sess.data.core.userId(id);
  const record = typeof via === "string" ? { [via]: unixTime() } : via ?? {};
  for (const [name, at] of Object.entries(record)) ctx.sess.data.core.via[name](at);
  ctx.app.sessions.setCookieIfNew(ctx); // set the cookie now, independent of the request flow
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

/** Whether this client may sign in as this user without password. */
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
  return bcrypt.compare(pw, hash.replace(/^\$2y\$/, "$2b$")); // PHP writes $2y$, bcryptjs $2b$ — identical
}

function pwNeedsRehash(hash: string) {
  return !/^\$2[aby]\$/.test(hash);
}
