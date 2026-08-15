import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms         = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.webauthn", { en: "WebAuthn", de: "WebAuthn" });
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const db  = node.app.db;

  if (ctx.req.body?.csrfToken === ctx.csrfToken && "delete_cred" in ctx.req.body) {
    const id = Number(ctx.req.body.delete_cred);
    if (id) await db.table("webauthn_credential").delete(id);
  }

  const rows = await db.query`
    SELECT wac.id, wac.name, wac.aaguid, wac.sign_count, wac.created, wac.last_used, wac.credential_id,
           u.id AS usr_id, u.email, u.firstname, u.lastname
    FROM webauthn_credential wac
    LEFT JOIN usr u ON u.id = wac.usr_id
    ORDER BY wac.last_used DESC LIMIT 500`;

  const fmt = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString("en") : "-";
  const trs = rows.map((r) => {
    const userName = [r.firstname, r.lastname].filter(Boolean).join(" ") || r.email || `#${r.usr_id}`;
    return html`<tr>
      <td>${r.id}
      <td>${userName}<br><small style="color:#888">${r.email}</small>
      <td>${r.name}
      <td title="${r.credential_id}">${r.credential_id?.slice(0, 20)}…
      <td>${r.aaguid}
      <td>${r.sign_count ?? "0"}
      <td>${fmt(r.created)}
      <td>${fmt(r.last_used)}
      <td><form method=post style="display:inline">
        <input type=hidden name=csrfToken value="${ctx.csrfToken}">
        <input type=hidden name=delete_cred value="${r.id}">
        <button class=u2-unstyle u2-confirm="${`Really delete ${r.name ?? r.id}?`}"><u2-ico icon=delete>✕</u2-ico></button>
      </form>`;
  });

  const empty = rows.length === 0
    ? html`<tr><td colspan=9 style="text-align:center;color:#888;padding:1em">No credentials registered.`
    : "";

  const rpId   = String(await node.app.settings.webauthn.rpId   ?? "") || "(not configured)";
  const rpName = String(await node.app.settings.webauthn.rpName ?? "") || "(not configured)";

  return html.async`<div class=u2-flex>
<div class=u2-card style="flex:0 1 24rem">
  <div class=-head>Configuration</div>
  <table class=u2-table>
    <tr><th style="width:8em">Relying Party ID<td>${rpId}
    <tr><th>RP Name<td>${rpName}
  </table>
  <div class=-body>
    <p style="font-size:.85em;color:#888;margin-top:.5em">Settings under <code>Settings → webauthn</code>.</p>
  </div>
</div>
<div class=u2-card style="flex:1">
  <div class=-head>Registered passkeys (${rows.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>ID
        <th>User
        <th>Name
        <th>Credential ID
        <th>AAGUID
        <th>Sign Count
        <th>Registered
        <th>Last used
        <th width=80>
      <tbody>${trs.length ? html.join(trs, "\n") : empty}
    </table>
  </div>
</div>
</div>`;
}
