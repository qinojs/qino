// deno-lint-ignore-file no-explicit-any
import { addContact, errMsg, getCtx, login, pwHash, removeContact, setMainContact } from "@qino/qino";
import { channel } from "@qino/qino/messaging";

import { adoptUsername } from "./plugin.ts";

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
    return db.one`SELECT id FROM usr WHERE LOWER(TRIM(email)) = LOWER(${String(vars.email_used ?? "").trim()})`;
  }

  if ("login_as" in vars) {
    const allowLoginAs = !!(node.settings.allow_login_as()) || isSuperuser;
    if (!allowLoginAs) return false;
    if (!await target(vars.login_as)) return false;
    await login(ctx, vars.login_as, "login_as");
    return 1;
  }

  if ("delete" in vars) {
    if (!await target(vars.delete)) return false;
    await db.table("usr").delete(vars.delete);
    return 1;
  }

  // contacts of one user: the address is the identity, so channel and address address it
  if ("contact_add" in vars) {
    const usr = await target(vars.contact_add);
    if (!usr) return false;
    const name = String(vars.channel ?? "");
    try {
      const address = channel(node.app, name)?.normalize?.(String(vars.address ?? "").trim());
      if (!address) return { ok: false, message: await node.app.t`Choose a channel whose address can be entered.` };
      await addContact(db, Number(usr.$id), name, address); // the first one on a channel becomes main
      return { ok: true };
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
  }

  if ("contact_delete" in vars) {
    const usr = await target(vars.contact_delete);
    if (!usr) return false;
    await removeContact(db, Number(usr.$id), String(vars.channel ?? ""), String(vars.address ?? ""));
    return { ok: true };
  }

  if ("contact_main" in vars) {
    const usr = await target(vars.contact_main);
    if (!usr) return false;
    await setMainContact(db, Number(usr.$id), String(vars.channel ?? ""), String(vars.address ?? ""));
    return { ok: true };
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
    const value = name === "pw" ? await pwHash(String(vars.value)) : name === "email" ? String(vars.value ?? "").trim() : vars.value;
    await targetUsr.$set({ [name]: value });
    if (name === "email") await adoptUsername(node.app, Number(targetUsr.$id), String(value ?? ""));
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
