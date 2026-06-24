// deno-lint-ignore-file no-explicit-any

import { getCtx, login, pwHash } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export default async function (node: Node, vars:any): Promise<any> {
  const ctx = getCtx();
  if (await node.access() < 2) return false;

  const db = node.app.db;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const usrOk = async (U: any) =>
    !!(await U.is()) && (!(await U.get("superuser")) || isSuperuser);

  if ("email_used" in vars) {
    return db.one`SELECT id FROM usr WHERE email = ${vars.email_used}` ?? false;
  }

  if ("login_as" in vars) {
    const allowLoginAs = !!(node.settings.allow_login_as()) || isSuperuser;
    if (!allowLoginAs) return false;
    const TargetUsr = db.table("usr").entry(vars.login_as);
    if (!(await usrOk(TargetUsr))) return false;
    await login(ctx, vars.login_as);
    return 1;
  }

  if ("delete" in vars) {
    const TargetUsr = db.table("usr").entry(vars.delete);
    if (!(await usrOk(TargetUsr))) return false;
    await db.table("usr").delete(vars.delete);
    return 1;
  }

  if ("save" in vars) {
    const TargetUsr = db.table("usr").entry(vars.save);
    if (!(await usrOk(TargetUsr))) return false;
    const allowed: Record<string, boolean> = {
      active: true, email: true, firstname: true, lastname: true,
      company: true, superuser: true, pw: true,
    };
    const name = String(vars.name ?? "");
    if (!allowed[name]) return false;
    if (name === "superuser" && !isSuperuser) return false;
    const value = name === "pw" ? await pwHash(String(vars.value)) : vars.value;
    await TargetUsr.set(name, value);
    await TargetUsr.save();
    return 1;
  }

  if ("set_grp" in vars) {
    const TargetUsr = db.table("usr").entry(vars.set_grp);
    if (!(await usrOk(TargetUsr))) return false;
    const grpId = Number(vars.grp_id);
    const usrId = Number(vars.set_grp);
    if (!grpId || !usrId) return false;
    if (vars.add) {
      await db.query`REPLACE INTO usr_grp (grp_id, usr_id) VALUES (${grpId}, ${usrId})`;
    } else {
      await db.query`DELETE FROM usr_grp WHERE grp_id = ${grpId} AND usr_id = ${usrId}`;
    }
    return 1;
  }

  return false;
}
