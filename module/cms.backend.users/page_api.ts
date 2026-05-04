// Port of cms.backend.users/page_api.php
// deno-lint-ignore-file no-explicit-any

import { getCtx } from "../core/lib/context.ts";
import { Auth } from "../core/lib/Auth.ts";
import { Usr } from "../core/lib/qgEntries.ts";
import type { Node } from "../cms/lib/Node.ts";

export default async function (node: Node, vars:any): Promise<any> {
  const ctx = getCtx();
  if (await node.access() < 2) return false;

  const db = node.app.db;
  const isSuperuser = !!(await ctx.user?.get("superuser"));

  if ("email_used" in vars) {
    return db.one("SELECT id FROM usr WHERE email = ?", [vars.email_used]) ?? false;
  }

  if ("login_as" in vars) {
    const allowLoginAs = !!(await node.settings.allow_login_as) || isSuperuser;
    if (!allowLoginAs) return false;
    const TargetUsr = db.table("usr").Entry(vars.login_as);
    if (!await TargetUsr.is()) return false;
    if (await TargetUsr.get("superuser") && !isSuperuser) return false;
    await Auth.login(vars.login_as);
    return 1;
  }

  if ("delete" in vars) {
    const TargetUsr = Usr(vars.delete);
    if (!await TargetUsr.is()) return false;
    if (await TargetUsr.get("superuser") && !isSuperuser) return false;
    await db.table("usr").delete(vars.delete);
    return 1;
  }

  if ("save" in vars) {
    const TargetUsr = Usr(vars.save);
    if (!await TargetUsr.is()) return false;
    if (await TargetUsr.get("superuser") && !isSuperuser) return false;
    const allowed: Record<string, boolean> = {
      active: true, email: true, firstname: true, lastname: true,
      company: true, superuser: true, pw: true,
    };
    const name = String(vars.name ?? "");
    if (!allowed[name]) return false;
    if (name === "superuser" && !isSuperuser) return false;
    let value = vars.value;
    if (name === "pw") value = await Auth.pw_hash(String(value));
    await TargetUsr.set(name, value);
    await TargetUsr.save();
    return 1;
  }

  if ("set_grp" in vars) {
    const TargetUsr = Usr(vars.set_grp);
    if (!await TargetUsr.is()) return false;
    if (await TargetUsr.get("superuser") && !isSuperuser) return false;
    const grpId = parseInt(String(vars.grp_id));
    const usrId = parseInt(String(vars.set_grp));
    if (!grpId || !usrId) return false;
    if (vars.add) {
      await db.query("REPLACE INTO usr_grp SET grp_id = ?, usr_id = ?", [grpId, usrId]);
    } else {
      await db.query("DELETE FROM usr_grp WHERE grp_id = ? AND usr_id = ?", [grpId, usrId]);
    }
    return 1;
  }

  return false;
}
