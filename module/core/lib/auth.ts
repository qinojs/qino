import type { RequestContext } from "./RequestContext.ts";
import { bcrypt } from "../../../deps.ts";

export async function authListen(ctx: RequestContext): Promise<void> {
  if ("liveUser_login" in ctx.post) {
    const saveLogin = !!ctx.post["save_login"];
    const error = await auth(ctx, String(ctx.post["email"] ?? ""), String(ctx.post["pw"] ?? ""));
    const errorMap: Record<string, string> = { "0": "password", "-1": "username", "-2": "inactive", "1": "" };
    ctx.loginError = errorMap[String(error)];
    await rememberLogin(ctx, saveLogin);
  }
  if (ctx.post["liveUser_logout"]) {
    if (ctx.post["token"] !== ctx.token) return;
    await logout(ctx);
  }
  if (!ctx.userId && ctx.clientId) {
    const uidVal = await ctx.client.get("usr_id");
    const uid = uidVal ? parseInt(String(uidVal)) : 0;
    if (uid) {
      const row = await ctx.app.db.row("SELECT email FROM usr WHERE id = ?", [uid]);
      if (row?.email) await auth(ctx, row.email);
    }
  }
}

export async function auth(ctx: RequestContext, email: string, pw = ""): Promise<number | boolean> {
  await ctx.app.fire("auth-before", { email, pw });
  const user = await ctx.app.db.row("SELECT * FROM usr WHERE LOWER(TRIM(email)) = LOWER(?)", [email.trim()]);
  if (!user) return -1;
  if (!user.active) return -2;
  const UsrEntry = ctx.app.db.table("usr").Entry(user.id);
  const rehash = pwNeedsRehash(await UsrEntry.get("pw"));
  if (!rehash) {
    const clientUsrs = await ctx.client.users?.() ?? {};
    const usrId = String(await UsrEntry.get("id") ?? "");
    if (clientUsrs[usrId] && await clientUsrs[usrId].get?.("save_login")) return login(ctx, user.id);
  }
  if (!await pwVerify(pw, await UsrEntry.get("pw") ?? "")) return 0;
  if (rehash) {
    await UsrEntry.set("pw", await pwHash(pw));
    await UsrEntry.save();
  }
  return login(ctx, user.id);
}

export async function login(ctx: RequestContext, id: number | string): Promise<boolean> {
  id = parseInt(String(id));
  if (!await ctx.app.db.one("SELECT id FROM usr WHERE id = ?", [id])) return false;
  const oldSession = ctx.session;
  await logout(ctx);
  // neue Session-ID nach Logout verhindert Session-Fixation
  const { sessionToken, sessId, session } = await ctx.app.sessions.regenerateId(ctx.sessionToken);
  ctx.sessionToken = sessionToken;
  ctx.sessId = sessId;
  ctx.session = session;
  ctx.session.liveUser(id);
  await ctx.client.addUsr(id);
  await ctx.client.set("usr_id", id);
  await ctx.app.fire("login", { session_old: oldSession, id });
  return true;
}

export async function logout(ctx: RequestContext): Promise<void> {
  await rememberLogin(ctx, false);
  await ctx.client.set?.("usr_id", 0);
  ctx.session({});
  await ctx.app.fire("logout");
}

export async function rememberLogin(ctx: RequestContext, doSave: boolean): Promise<void> {
  const usr = ctx.user;
  if (!(await usr?.is())) return;
  const E = ctx.app.db.table("client_usr").Entry({ usr_id: String(usr), client_id: String(ctx.client) });
  await E.set("save_login", doSave ? 1 : 0);
}

export async function pwHash(pw: string): Promise<string> {
  return await bcrypt.hash(pw, 10);
}

export async function pwVerify(pw: string, hash: string): Promise<boolean> {
  if (!pw || !hash) return false;
  // PHP uses $2y$, bcryptjs uses $2b$ — functionally identical
  return await bcrypt.compare(pw, hash.replace(/^\$2y\$/, "$2b$"));
}

export function pwNeedsRehash(hash: string): boolean {
  return !hash?.match(/^\$2[aby]\$/);
}
