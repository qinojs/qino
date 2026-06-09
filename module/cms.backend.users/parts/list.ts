import { hee, sqlSearchHelper, getCtx, type RequestContext } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

export async function list(_node: Node | null, { ctx, vars }: { ctx?: RequestContext; vars?: Record<string, unknown> }): Promise<string> {
  ctx ??= getCtx();
  const db = ctx.app.db;

  const node: Node | null = _node;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const allowLoginAs = isSuperuser || !!(node && node.settings.allow_login_as());

  const search = String(vars?.search ?? "");
  const grpId = ctx.get.grp_id ? Number(ctx.get.grp_id) : null;

  const sh = sqlSearchHelper(search, ["lastname", "firstname", "company", "email"]);

  let grpFilter = "";
  const grpParams: unknown[] = [];
  if (grpId) {
    grpFilter = " AND id IN(SELECT usr_id FROM usr_grp WHERE grp_id = ?)";
    grpParams.push(grpId);
  }

  const sql =
    " SELECT * FROM usr  WHERE " + sh.where +
    grpFilter +
    " ORDER BY " + sh.order +
    " LIMIT 200";

  const rows = await db.all(sql, [...sh.whereParams, ...grpParams, ...sh.orderParams]);

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
    const lastOnlineIso = time ? new Date(Number(time) * 1000).toISOString() : "";

    const detailUrl = pageUrl + (pageUrl.includes("?") ? "&" : "?") + "id=" + vs.id;
    const isEmail = vs.email && /@/.test(vs.email);
    const emailCell = isEmail
      ? `<a href="mailto:${hee(vs.email)}">${hee(vs.email)}</a>`
      : hee(vs.email ?? "");

    const loginAsTd = allowLoginAs
      ? `<td class=-loginAs><u2-ico icon="switch_account" aria-label="Login as user">⇄</u2-ico>`
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
    <a href="${hee(detailUrl)}">
      <u2-ico icon="edit">Edit</u2-ico>
    </a>
  <td class=-delete>
    <button class=u2-unstyle><u2-ico icon="delete">x</u2-ico></button>`;
  }

  return html;
}
