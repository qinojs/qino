import { html, sqlSearch, sql } from "@qino/qino";

import type { HtmlString, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function allowLoginAs(node: Node | null, ctx: Ctx): Promise<boolean> {
  return !!ctx.user?.superuser || !!(node?.settings.allow_login_as());
}

export async function list(node: Node | null, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const db = ctx.app.db;

  const isSuperuser = !!ctx.user?.superuser;
  const canLoginAs = await allowLoginAs(node, ctx);

  const search = String(vars?.search ?? "");
  const grpId = Number(vars?.grp_id ?? ctx.req.query.grp_id) || null;

  const sh = sqlSearch(search, ["family_name", "given_name", "organization", "username"]);
  // an address someone verified finds them too, even when their login handle says something else
  const byContact = search.trim()
    ? sql` OR id IN (SELECT usr_id FROM usr_contact WHERE address = ${search.trim().toLowerCase()})`
    : sql.raw("");
  const grpFilter = grpId ? sql` AND id IN(SELECT usr_id FROM usr_grp WHERE grp_id = ${grpId})` : sql.raw("");
  const superFilter = isSuperuser ? sql.raw("") : sql` AND superuser = ${false}`;

  const rows = await db.query`SELECT usr.*,
    (SELECT count(*) FROM sess WHERE usr_id = usr.id) AS num_sess,
    (SELECT max(access) FROM sess WHERE usr_id = usr.id) AS last_online
    FROM usr WHERE (${sh.where}${byContact})${grpFilter}${superFilter} ORDER BY ${sh.order}, id LIMIT 200`;

  const pageUrl = node ? await (await node.page()).url() : "";

  const parts: Array<HtmlString | Promise<HtmlString>> = [];
  for (const vs of rows) {
    const lastOnlineIso = vs.last_online ? new Date(Number(vs.last_online) * 1000).toISOString() : "";

    const detailUrl = pageUrl + (pageUrl.includes("?") ? "&" : "?") + "id=" + vs.id;
    const isEmail = vs.username && /@/.test(vs.username);
    const emailCell = isEmail
      ? html`<a href="mailto:${vs.username}">${vs.username}</a>`
      : vs.username;

    const loginAsTd = canLoginAs
      ? html.raw('<td class=-loginAs><u2-ico icon=switch_account aria-label="Login as user">⇄</u2-ico>')
      : "";

    parts.push(html`
<tr itemid=${vs.id} u2-href>
  <td> ${vs.id}
  <td>
    <a href="${detailUrl}">${(vs.given_name ?? "") + " " + (vs.family_name ?? "")}</a>
  <td> ${emailCell}
  <td> ${vs.organization}
  <td> ${vs.active ? "yes" : "no"}
  <td> ${vs.num_sess ?? 0}
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
