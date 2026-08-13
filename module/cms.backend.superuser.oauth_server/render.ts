import * as u2 from "@qino/qino/u2";
import type { Node } from "@qino/qino/cms";
import { html, type App, type Ctx, type HtmlString, type Row } from "@qino/qino";

/** Discovery hint plus the two live regions the client script re-renders. */
export function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const base = ctx.req.url.origin + ctx.req.appUrl.replace(/\/$/, "");
  return html.async`<div>
  <div class=u2-card>
    <div class=-head>${t`Discovery`}</div>
    <div class=-body>
      <p>${t`Clients that support it discover everything from this URL:`}
      <p><code>${base}/.well-known/oauth-authorization-server</code>
      <p><small>${t`Such clients register themselves. Clients with a fixed client_id are added below.`}</small>
    </div>
  </div>

  <div class=u2-flex cms-part=clients>${clients(node)}</div>

  <div class=u2-card cms-part=grants>${grants(node)}</div>
</div>`;
}

export async function clients(node: Node): Promise<HtmlString> {
  const rows = await node.app.db.query`SELECT c.*,
      (SELECT COUNT(*) FROM oauth_token t WHERE t.client_id = c.id AND t.kind = ${"access"}) AS tokens
    FROM oauth_client c ORDER BY c.created DESC`;
  const cards = await Promise.all([...rows.map((r) => card(node.app, r)), card(node.app)]);
  return html.join(cards);
}

/** One editable card per client; a blank `client` renders the add form. */
async function card(app: App, client: Partial<Row> = {}): Promise<HtmlString> {
  const t = app.t;
  const isNew = !client.id;
  return html.async`<form class=u2-card>
  <div class=-head>${isNew ? t`Add client` : client.name}</div>
  <div class=-body>
    <u2-fields>
      ${t`client_id`} <input name=id value="${client.id ?? ""}" ${isNew ? "required" : "readonly"}>
      ${t`Name`} <input name=name value="${client.name ?? ""}">
      ${t`Redirect URIs`} <textarea name=redirect_uris rows=3 required>${client.redirect_uris ?? ""}</textarea>
    </u2-fields>
    <small>${t`One per line, compared exactly. https, or http on localhost.`}</small>
    ${isNew ? "" : html`<div><small>${await t`Registered`} ${u2.el.time(client.created)} · ${client.tokens} ${await t`active tokens`}</small></div>`}
    <div>
      <button type=button data-save>${isNew ? t`Add` : t`Save`}</button>
      ${isNew ? "" : html`<button type=button data-delete="${client.id}" class=u2-unstyle
        u2-confirm="${await t`Delete ${client.name} and all its tokens?`}"><u2-ico icon=delete>✕</u2-ico></button>`}
    </div>
  </div>
</form>`;
}

export async function grants(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const rows = await node.app.db.query`SELECT t.client_id, c.name, t.usr_id, u.email,
      MIN(t.created) AS since, MAX(t.expires) AS until
    FROM oauth_token t
    LEFT JOIN oauth_client c ON c.id = t.client_id
    LEFT JOIN usr u ON u.id = t.usr_id
    WHERE t.kind <> ${"code"}
    GROUP BY t.client_id, c.name, t.usr_id, u.email ORDER BY since DESC`;
  const body = rows.length
    ? html.join(await Promise.all(rows.map((r) => grantRow(node.app, r))))
    : html`<tr><td colspan=5>${await t`Nobody has authorized a client yet.`}`;

  return html.async`<div class=-head>${t`Granted access`} (${rows.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`Client`}
      <th>${t`User`}
      <th>${t`Since`}
      <th>${t`Expires`}
      <th>
    <tbody>${body}
  </table>`;
}

async function grantRow(app: App, g: Row): Promise<HtmlString> {
  return html.async`<tr>
    <td>${g.name ?? g.client_id}
    <td>${g.email ?? "#" + g.usr_id}
    <td>${u2.el.time(g.since)}
    <td>${u2.el.time(g.until)}
    <td><button type=button class=u2-unstyle data-revoke="${g.client_id}" data-usr="${g.usr_id}"
      u2-confirm="${await app.t`Revoke this access?`}"><u2-ico icon=delete>✕</u2-ico></button>`;
}
