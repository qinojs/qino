import { html, type HtmlString, sqlSearch, sql, type Ctx } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

export async function allowLoginAs(node: Node | null, ctx: Ctx): Promise<boolean> {
  return !!(await ctx.user?.get("superuser")) || !!(node?.settings.allow_login_as());
}

export async function list(node: Node | null, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const db = ctx.app.db;

  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const canLoginAs = await allowLoginAs(node, ctx);

  const search = String(vars?.search ?? "");
  const grpId = Number(vars?.grp_id ?? ctx.req.query.grp_id) || null;

  const sh = sqlSearch(search, ["lastname", "firstname", "company", "email"]);
  const grpFilter = grpId ? sql` AND id IN(SELECT usr_id FROM usr_grp WHERE grp_id = ${grpId})` : sql.raw("");
  const superFilter = isSuperuser ? sql.raw("") : sql` AND superuser = ${false}`;

  const rows = await db.query`SELECT usr.*,
    (SELECT count(*) FROM sess WHERE usr_id = usr.id) AS num_sess,
    (SELECT max(time) FROM log WHERE sess_id = (SELECT max(id) FROM sess WHERE usr_id = usr.id)) AS last_online
    FROM usr WHERE ${sh.where}${grpFilter}${superFilter} ORDER BY ${sh.order}, id LIMIT 200`;

  const pageUrl = node ? await (await node.page()).url() : "";

  const parts: Array<HtmlString | Promise<HtmlString>> = [];
  for (const vs of rows) {
    const lastOnlineIso = vs.last_online ? new Date(Number(vs.last_online) * 1000).toISOString() : "";

    const detailUrl = pageUrl + (pageUrl.includes("?") ? "&" : "?") + "id=" + vs.id;
    const isEmail = vs.email && /@/.test(vs.email);
    const emailCell = isEmail
      ? html`<a href="mailto:${vs.email}">${vs.email}</a>`
      : vs.email ?? "";

    const loginAsTd = canLoginAs
      ? html.raw('<td class=-loginAs><u2-ico icon=switch_account aria-label="Login as user">⇄</u2-ico>')
      : "";

    parts.push(html`
<tr itemid=${String(vs.id)} data-c1-href="${detailUrl}">
  <td> ${String(vs.id)}
  <td>
    <a href="${detailUrl}">${(vs.firstname ?? "") + " " + (vs.lastname ?? "")}</a>
  <td> ${emailCell}
  <td> ${vs.company ?? ""}
  <td> ${vs.active ? "yes" : "no"}
  <td> ${String(vs.num_sess ?? 0)}
  <td> <u2-time datetime="${lastOnlineIso}" type=relative>${lastOnlineIso.slice(0, 16).replace("T", " ")}</u2-time>
    ${loginAsTd}
  <td>
    <a href="${detailUrl}">
      <u2-ico icon=edit>🖉</u2-ico>
    </a>
  <td class=-delete>
    <button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  }

  if (rows.length === 200) parts.push(html.async`\n<tr><td colspan=10>${ctx.app.t`Only the first 200 results are shown.`}`);

  return html.join(await Promise.all(parts));
}
