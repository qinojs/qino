// deno-lint-ignore-file no-explicit-any
import { getCtx, login, pwHash } from "@qino/qino";

import type { Usr } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars:any): Promise<any> {
  const ctx = getCtx();
  if (await node.access() < 2) return false;

  const db = node.app.db;
  const isSuperuser = !!ctx.user?.superuser;
  // The target has to exist, and only a superuser may touch another superuser.
  const target = async (id: any) => {
    const usr = await db.table("usr").get<Usr>(id);
    return usr && (!usr.superuser || isSuperuser) ? usr : undefined;
  };

  if ("email_used" in vars) {
    return db.one`SELECT id FROM usr WHERE email = ${vars.email_used}`;
  }

  if ("login_as" in vars) {
    const allowLoginAs = !!(node.settings.allow_login_as()) || isSuperuser;
    if (!allowLoginAs) return false;
    if (!await target(vars.login_as)) return false;
    await login(ctx, vars.login_as);
    return 1;
  }

  if ("delete" in vars) {
    if (!await target(vars.delete)) return false;
    await db.table("usr").delete(vars.delete);
    return 1;
  }

  if ("save" in vars) {
    const targetUsr = await target(vars.save);
    if (!targetUsr) return false;
    const allowed: Record<string, boolean> = {
      active: true, email: true, firstname: true, lastname: true,
      company: true, superuser: true, pw: true,
    };
    const name = String(vars.name ?? "");
    if (!allowed[name] || (name === "superuser" && !isSuperuser)) return false;
    if (name === "pw" && !String(vars.value ?? "")) return false;
    const value = name === "pw" ? await pwHash(String(vars.value)) : vars.value;
    await targetUsr.$set({ [name]: value });
    return 1;
  }

  if ("set_grp" in vars) {
    if (!await target(vars.set_grp)) return false;
    const grpId = Number(vars.grp_id);
    const usrId = Number(vars.set_grp);
    if (!grpId || !usrId) return false;
    const rel = { grp_id: grpId, usr_id: usrId };
    await (vars.add ? db.table("usr_grp").ensure(rel) : db.table("usr_grp").delete(rel));
    return 1;
  }

  return false;
}
