/**
 * Auth.ts - Authentication
 * Port of core/lib/Auth.class.php
 */

import { getCtx } from "qg";
import { RedirectException } from "./util.ts";
import { Usr } from "./qgEntries.ts";
import type { RequestContext } from "./context.ts";
import bcrypt from "bcryptjs";

export const Auth = {
  async listen(ctx: RequestContext): Promise<void> {

    if ("liveUser_login" in ctx.post) {
      const saveLogin = ctx.post["save_login"] ? 1 : 0;
      const error = await Auth.auth(String(ctx.post["email"] ?? ""), String(ctx.post["pw"] ?? ""));
      const translateError: Record<string, string> = {
        "0":  "password",
        "-1": "username",
        "-2": "inactive",
        "1":  "",
      };
      ctx.loginError = translateError[String(error)];
      await Auth.rememberLogin(saveLogin);
    }
    if (ctx.post["liveUser_logout"]) {
      await Auth.logout();
    }
    if (ctx.get["liveUser_logout"]) {
      if (ctx.get["token"] !== ctx.token) {
        console.warn("todo: Logout attempt with invalid token");
      }
      await Auth.logout();
      ctx.responseHeaders.set("Location", ctx.get["liveUser_logout"]);
      ctx.responseStatus = 302;
      throw new RedirectException();
    }
    if (!ctx.userId && ctx.clientId) {
      const uidVal = await ctx.client.get("usr_id");
      const uid = uidVal ? parseInt(String(uidVal)) : 0;
      if (uid) await Auth.auth(await _getUsrEmail(uid));
    }
  },

  async auth(email: string, pw = ""): Promise<number | boolean> {
    const ctx = getCtx();
    await ctx.app.fire("auth-before", { email, pw });
    const user = await ctx.app.db.row("SELECT * FROM usr WHERE LOWER(TRIM(email)) = LOWER(?)", [email.trim()]);
    if (!user) return -1;
    if (!user.active) return -2;
    //const UsrEntry = Usr(user.id);
    const UsrEntry = ctx.app.db.table("usr").Entry(user.id);
    const rehash = Auth.pw_needs_rehash(await UsrEntry.get("pw"));
    if (!rehash) {
      const clientUsrs = await ctx.client.Usrs?.() ?? {};
      const usrId = String(await UsrEntry.get("id") ?? "");
      if (clientUsrs[usrId] && await clientUsrs[usrId].get?.("save_login")) {
        return Auth.login(user.id);
      }
    }
    if (!await Auth.pw_verify(pw, await UsrEntry.get("pw") ?? "")) return 0;
    if (rehash) {
      await UsrEntry.set("pw", await Auth.pw_hash(pw));
      await UsrEntry.save();
    }
    return Auth.login(user.id);
  },

  async pw_hash(pw: string): Promise<string> {
    return await bcrypt.hash(pw, 10);
  },

  async pw_verify(pw: string, hash: string): Promise<boolean> {
    if (!pw || !hash) return false;
    // bcrypt: PHP uses $2y$, bcryptjs uses $2b$ — functionally identical
    const normalizedHash = hash.replace(/^\$2y\$/, "$2b$");
    return await bcrypt.compare(pw, normalizedHash);
  },

  pw_needs_rehash(hash: string): boolean {
    // Needs rehash if not a bcrypt hash
    return !hash?.match(/^\$2[aby]\$/);
  },

  async login(id: number | string): Promise<boolean> {
    id = parseInt(String(id));
    const ctx = getCtx();
    if (!await ctx.app.db.one("SELECT id FROM usr WHERE id = ?", [id])) return false;
    const oldSession = ctx.session;
    await Auth.logout();
    // Session-Fixation verhindern: neue Session-ID nach Logout
    const { sessionToken, sessId, session } = await ctx.app.sessions.regenerateId(ctx.sessionToken);
    ctx.sessionToken = sessionToken;
    ctx.sessId = sessId;
    ctx.session = session;
    ctx.responseHeaders.append("Set-Cookie", ctx.app.sessions.cookieHeader(ctx, sessionToken));
    ctx.session.liveUser(id);
    await ctx.client.addUsr(id);
    await ctx.client.set("usr_id", id);
    await ctx.app.fire("login", { session_old: oldSession, id });
    return true;
  },

  async logout(): Promise<void> {
    await Auth.rememberLogin(0);
    const ctx = getCtx();
    await ctx.client.set?.("usr_id", 0);
    ctx.session({});
    // Clear-Site-Data-Header?
    await ctx.app.fire("logout");
  },

  async rememberLogin(doSave: number): Promise<void> {
    const ctx = getCtx();
    const usr = ctx.user;
    if (!(await usr?.is())) return;
    const E = ctx.app.db.table("client_usr").Entry({
      usr_id: String(usr),
      client_id: String(ctx.client),
    });
    await E.set("save_login", doSave);
  },
};

async function _getUsrEmail(uid: number): Promise<string> {
  const ctx = getCtx();
  const row = await ctx.app.db.row("SELECT email FROM usr WHERE id = ?", [uid]);
  return row?.email ?? "";
}
