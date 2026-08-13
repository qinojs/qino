// deno-lint-ignore-file no-explicit-any

import { getCtx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Members can only be managed by superusers or members of the group itself. */
export async function canManageMembers(grpId: number): Promise<boolean> {
  const ctx = getCtx();
  if (ctx.user?.superuser) return true;
  return !!(await ctx.user?.grps())?.includes(grpId);
}

async function requireMemberToManageMembers(grpId: number): Promise<{ error: string } | null> {
  if (await canManageMembers(grpId)) return null;
  return { error: String(getCtx().app.t`You are not a member of this group and cannot manage its members.`) };
}

export default async function (node: Node, vars: any): Promise<any> {
  if (await node.access() < 2) return false;
  const db = node.app.db;

  if ("delete" in vars) {
    await db.table("grp").delete(vars.delete);
    return 1;
  }

  if ("save" in vars) {
    const allowed: Record<string, boolean> = { name: true, type: true };
    const name = String(vars.name ?? "");
    if (!allowed[name]) return false;
    const grp = await db.table("grp").get(vars.save);
    if (!grp) return false;
    await grp.$set({ [name]: vars.value });
    return 1;
  }

  if ("set_usr" in vars) {
    const grpId = Number(vars.set_usr);
    const usrId = Number(vars.usr_id);
    if (!grpId || !usrId) return false;
    const denied = await requireMemberToManageMembers(grpId);
    if (denied) return denied;
    if (vars.add) await db.table("usr_grp").ensure({ grp_id: grpId, usr_id: usrId });
    else await db.table("usr_grp").delete({ grp_id: grpId, usr_id: usrId });
    return 1;
  }

  if ("add_email" in vars) {
    const grpId = Number(vars.add_email);
    if (!grpId) return false;
    const denied = await requireMemberToManageMembers(grpId);
    if (denied) return denied;
    const usrId = Number(await db.one`SELECT id FROM usr WHERE email = ${String(vars.email ?? "")}` ?? "0");
    if (!usrId) return { error: String(getCtx().app.t`No user found with this email address.`) };
    await db.table("usr_grp").ensure({ grp_id: grpId, usr_id: usrId });
    return 1;
  }

  return false;
}
