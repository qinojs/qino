// Port of cms.backend.users/parts/list.php
// deno-lint-ignore-file no-explicit-any

import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/RequestContext.ts";
import { sqlSearchHelper } from "../../core/lib/util.ts";
import type { Node } from "../../cms/lib/Node.ts";

export async function list(_node: Node | null, { ctx, vars }: any): Promise<string> {
  ctx ??= getCtx();
  const db = ctx.app.db;

  const node: Node | null = _node;
  const allowLoginAs = node
    ? (!!(await node.settings.allow_login_as) || !!(await ctx.user?.get("superuser")))
    : !!(await ctx.user?.get("superuser"));

  const search = String(vars?.search ?? "");
  const grpId = ctx.get.grp_id ? parseInt(ctx.get.grp_id) : null;

  const sh = sqlSearchHelper(search, ["lastname", "firstname", "company", "email"]);

  let grpFilter = "";
  const grpParams: any[] = [];
  if (grpId) {
    grpFilter = " AND id IN(SELECT usr_id FROM usr_grp WHERE grp_id = ?)";
    grpParams.push(grpId);
  }

  const sql =
    "SELECT * FROM usr" +
    " WHERE " + sh.where +
    grpFilter +
    " ORDER BY " + sh.order +
    " LIMIT 200";

  const rows = await db.all(sql, [...sh.whereParams, ...grpParams, ...sh.orderParams]);

  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const pageUrl = node ? await (await node.page()).url() : "";

  let html = "";
  for (const vs of rows) {
    if (vs.superuser && !isSuperuser) continue;

    const numSess = await db.one(
      "SELECT count(distinct sess.id) FROM sess WHERE usr_id = ? GROUP BY usr_id",
      [vs.id]
    ) ?? 0;

    const sessId = await db.one("SELECT max(id) FROM sess WHERE usr_id = ?", [vs.id]);
    const time = sessId ? await db.one("SELECT max(time) FROM log WHERE log.sess_id = ?", [sessId]) : null;
    const lastOnlineIso = time ? new Date(time * 1000).toISOString() : "";

    const detailUrl = pageUrl + (pageUrl.includes("?") ? "&" : "?") + "id=" + vs.id;
    const isEmail = vs.email && /@/.test(vs.email);
    const emailCell = isEmail
      ? `<a href="mailto:${hee(vs.email)}">${hee(vs.email)}</a>`
      : hee(vs.email ?? "");

    const loginAsTd = allowLoginAs
      ? `<td class=-loginAs><img src="${hee(ctx.sysURL)}cms.backend.users/pub/change-user.svg" alt="Login als user">`
      : "";

    html += `
<tr itemid=${hee(String(vs.id))} data-c1-href="${hee(detailUrl)}">
  <td> ${hee(String(vs.id))}
  <td>
    <a href="${hee(detailUrl)}">${hee((vs.firstname ?? "") + " " + (vs.lastname ?? ""))}</a>
  <td> ${emailCell}
  <td> ${hee(vs.company ?? "")}
  <td> ${vs.active ? "yes" : "no"}
  <td> ${hee(String(numSess))}
  <td> <u2-time datetime="${lastOnlineIso}" type=relative>${lastOnlineIso.slice(0, 16).replace("T", " ")}</u2-time>
  ${loginAsTd}
  <td>
    <a href="${hee(detailUrl)}"><img src="${hee(ctx.sysURL)}cms.frontend.1/pub/img/pencil.svg" alt="Bearbeiten"></a>
  <td class=-delete>
    <img src="${hee(ctx.sysURL)}cms.frontend.1/pub/img/delete.svg" alt="Löschen">`;
  }

  return html;
}
