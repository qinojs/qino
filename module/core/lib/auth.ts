import type { Ctx } from "./ctx/Ctx.ts";
import { bcrypt } from "../deps.ts";
import { timingSafeEqual } from "node:crypto";

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
    const uidVal = await ctx.client.get("usr_id");
    const uid = uidVal ? Number(uidVal) : 0;
    if (uid) {
      const row = await ctx.app.db.row`SELECT email FROM usr WHERE id = ${uid}`;
      if (row?.email) await auth(ctx, row.email);
    }
  }
}

export async function auth(ctx: Ctx, email: string, pw = ""): Promise<LoginError | ""> {
  const user = await ctx.app.db.row`SELECT * FROM usr WHERE LOWER(TRIM(email)) = LOWER(${email.trim()})`;
  if (!user || !user.active) { await pwVerify(pw, DUMMY_HASH); return user ? "inactive" : "username"; }
  const usrEntry = ctx.app.db.table("usr").entry(user.id);
  const rehash = pwNeedsRehash(await usrEntry.get("pw"));
  if (!rehash) {
    const clientUsrs = await ctx.client.users();
    const usrId = String(await usrEntry.get("id") ?? "");
    if (clientUsrs[usrId] && Number(await clientUsrs[usrId].get("save_login")) === 1) return await login(ctx, user.id) ? "" : "username";
  }
  if (!await pwVerify(pw, await usrEntry.get("pw") ?? "")) return "password";
  if (rehash) {
    await usrEntry.set("pw", await pwHash(pw));
    await usrEntry.save();
  }
  return await login(ctx, user.id) ? "" : "username";
}

export async function login(ctx: Ctx, id: number | string): Promise<boolean> {
  id = Number(id);
  if (!await ctx.app.db.one`SELECT id FROM usr WHERE id = ${id} AND active = ${true}`) return false;
  // The values, not the item: logout() empties it, and the listeners run after that.
  const oldSession = ctx.sess.data() as Record<string, unknown>;
  await logout(ctx);
  // new session id after logout prevents session fixation
  const session = await ctx.app.sessions.regenerateId(ctx.sess.token);
  ctx.sess = session;
  ctx.sess.data.core.userId(id);
  ctx.app.sessions.setCookieIfNew(ctx); // login owns the cookie, independent of request timing
  await ctx.client.addUsr(id);
  await ctx.client.set("usr_id", id);
  await ctx.app.fire("auth:login", { oldSession, usrId: id });
  return true;
}

export async function logout(ctx: Ctx): Promise<void> {
  await rememberLogin(ctx, false);
  await ctx.client.set("usr_id", 0);
  ctx.sess.data({});
}

export function pwHash(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function pwVerify(pw: string, hash: string) {
  if (!pw || !hash) return false;
  return await bcrypt.compare(pw, hash.replace(/^\$2y\$/, "$2b$")); // PHP uses $2y$, bcryptjs uses $2b$ — functionally identical
}

async function rememberLogin(ctx: Ctx, doSave: boolean): Promise<void> {
  const usr = ctx.user;
  if (!(await usr?.exists())) return;
  const entry = ctx.app.db.table("client_usr").entry({ usr_id: String(usr), client_id: String(ctx.client) });
  await entry.set("save_login", doSave ? 1 : 0);
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
