import { html, sqlSearch, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import type { HtmlString, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function allowLoginAs(node: Node | null, ctx: Ctx): boolean {
  return !!ctx.user?.superuser || !!(node?.settings.allow_login_as());
}

/** Part of an address finds whom it belongs to, even when their login handle says something else; a
 *  number also as written at home (`079 123 45 67` finds `+41791234567`). */
function contactSearch(search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return sql``;
  const digits = term.replace(/[\s()./-]/g, "");
  const number = /^\+?\d{4,}$/.test(digits) ? digits.replace(/^(\+|00|0)/, "") : "";
  return sql` OR id IN (SELECT usr_id FROM usr_contact WHERE address LIKE ${`%${term}%`}${
    number ? sql` OR address LIKE ${`%${number}%`}` : sql``})`;
}

export async function list(node: Node | null, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const db = ctx.app.db;

  const isSuperuser = !!ctx.user?.superuser;
  const canLoginAs = allowLoginAs(node, ctx);

  const search = String(vars?.search ?? "");
  const grpId = Number(vars?.grp_id ?? ctx.req.query.grp_id) || null;

  const sh = sqlSearch(search, ["family_name", "given_name", "organization", "username"]);
  const byContact = contactSearch(search);
  const grpFilter = grpId ? sql` AND id IN(SELECT usr_id FROM usr_grp WHERE grp_id = ${grpId})` : sql``;
  const superFilter = isSuperuser ? sql`` : sql` AND superuser = ${false}`;

  const rows = await db.query`SELECT usr.*,
    (SELECT count(*) FROM sess WHERE usr_id = usr.id) AS num_sess,
    (SELECT max(access) FROM sess WHERE usr_id = usr.id) AS last_online,
    (SELECT address FROM usr_contact WHERE usr_id = usr.id AND type = 'email' ORDER BY main DESC, created LIMIT 1) AS email
    FROM usr WHERE (${sh.where}${byContact})${grpFilter}${superFilter} ORDER BY ${sh.order}, id LIMIT 200`;

  const pageUrl = node ? await (await node.page()).url() : "";

  const parts: (HtmlString | Promise<HtmlString>)[] = [];
  for (const vs of rows) {
    const detailUrl = backend.toUrl(pageUrl, { id: vs.id });

    const loginAsTd = canLoginAs
      ? html.raw('<td class=-loginAs><button class=u2-unstyle aria-label="Login as user"><u2-ico icon=switch_account>⇄</u2-ico></button>')
      : "";

    parts.push(html`
<tr itemid=${vs.id} u2-href>
  <td> ${vs.id}
  <td>
    <a href="${detailUrl}">${(vs.given_name ?? "") + " " + (vs.family_name ?? "")}</a>
  <td> ${vs.username}
  <td> ${vs.email ? html`<a href="mailto:${vs.email}">${vs.email}</a>` : ""}
  <td> ${vs.organization}
  <td> ${vs.active ? "yes" : "no"}
  <td> ${vs.num_sess ?? 0}
  <td> ${u2.el.time(vs.last_online)}
    ${loginAsTd}
  <td>
    <a href="${detailUrl}">
      <u2-ico icon=edit>🖉</u2-ico>
    </a>
  <td class=-delete>
    <button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  }

  if (rows.length === 200) parts.push(html.async`\n<tr><td colspan=11>${ctx.app.t`Only the first 200 results are shown.`}`);

  return html.join(await Promise.all(parts));
}
