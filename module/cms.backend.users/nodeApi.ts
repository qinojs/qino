// deno-lint-ignore-file no-explicit-any

import { getCtx, login, pwHash } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export default async function (node: Node, vars:any): Promise<any> {
  const ctx = getCtx();
  if (await node.access() < 2) return false;

  const db = node.app.db;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const usrOk = async (usr: any) =>
    !!(await usr.exists()) && (!(await usr.get("superuser")) || isSuperuser);

  if ("email_used" in vars) {
    return db.one`SELECT id FROM usr WHERE email = ${vars.email_used}`;
  }

  if ("login_as" in vars) {
    const allowLoginAs = !!(node.settings.allow_login_as()) || isSuperuser;
    if (!allowLoginAs) return false;
    const targetUsr = db.table("usr").entry(vars.login_as);
    if (!(await usrOk(targetUsr))) return false;
    await login(ctx, vars.login_as);
    return 1;
  }

  if ("delete" in vars) {
    const targetUsr = db.table("usr").entry(vars.delete);
    if (!(await usrOk(targetUsr))) return false;
    await db.table("usr").delete(vars.delete);
    return 1;
  }

  if ("save" in vars) {
    const targetUsr = db.table("usr").entry(vars.save);
    if (!(await usrOk(targetUsr))) return false;
    const allowed: Record<string, boolean> = {
      active: true, email: true, firstname: true, lastname: true,
      company: true, superuser: true, pw: true,
    };
    const name = String(vars.name ?? "");
    if (!allowed[name]) return false;
    if (name === "superuser" && !isSuperuser) return false;
    if (name === "pw" && !String(vars.value ?? "")) return false;
    const value = name === "pw" ? await pwHash(String(vars.value)) : vars.value;
    await targetUsr.set(name, value);
    await targetUsr.save();
    return 1;
  }

  if ("set_grp" in vars) {
    const targetUsr = db.table("usr").entry(vars.set_grp);
    if (!(await usrOk(targetUsr))) return false;
    const grpId = Number(vars.grp_id);
    const usrId = Number(vars.set_grp);
    if (!grpId || !usrId) return false;
    const rel = { grp_id: grpId, usr_id: usrId };
    await (vars.add ? db.table("usr_grp").ensure(rel) : db.table("usr_grp").delete(rel));
    return 1;
  }

  return false;
}
