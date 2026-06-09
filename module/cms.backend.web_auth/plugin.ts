import type { Node } from "../cms/mod.ts";
import { hee, getCtx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name  = "cms.backend.web_auth";
export const needs = ["cms.backend", "web_auth"];
export const cms   = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.web_auth", { en: "WebAuthn", de: "WebAuthn" });
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const db  = node.app.db;

  if ("delete_cred" in ctx.post && ctx.post.token === ctx.token) {
    const id = Number(ctx.post.delete_cred ?? "0");
    if (id) await db.exec("DELETE FROM web_auth_credential WHERE id = ?", [id]);
  }

  const rows = await db.all(`
    SELECT wac.id, wac.name, wac.aaguid, wac.sign_count, wac.created, wac.last_used, wac.credential_id,
           u.id AS usr_id, u.email, u.firstname, u.lastname
    FROM web_auth_credential wac
    LEFT JOIN usr u ON u.id = wac.usr_id
    ORDER BY wac.last_used DESC LIMIT 500
  `);

  const fmt = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString("en") : "-";
  const tableRows = rows.map((r) => {
    const userName = [r.firstname, r.lastname].filter(Boolean).join(" ") || r.email || `#${r.usr_id}`;
    const delBtn   = `<form method=post style="display:inline"><input type=hidden name=token value="${hee(ctx.token)}"><input type=hidden name=delete_cred value="${hee(String(r.id))}"><button class=u2-unstyle u2-confirm="${hee(`Really delete ${String(r.name ?? r.id)}?`)}"><u2-ico icon="delete">✕</u2-ico></button></form>`;
    return `<tr><td>${hee(String(r.id))}<td>${hee(userName)}<br><small style="color:#888">${hee(String(r.email ?? ""))}</small><td>${hee(String(r.name ?? ""))}<td title="${hee(String(r.credential_id ?? ""))}">${hee(String(r.credential_id ?? "").slice(0, 20))}…<td>${hee(String(r.aaguid ?? ""))}<td>${hee(String(r.sign_count ?? "0"))}<td>${fmt(r.created)}<td>${fmt(r.last_used)}<td>${delBtn}`;
  }).join("\n");

  const empty = rows.length === 0
    ? '<tr><td colspan="9" style="text-align:center;color:#888;padding:1em">No credentials registered.</td></tr>'
    : "";

  const rpId   = String(await node.app.settings.web_auth.rpId   ?? "") || "(not configured)";
  const rpName = String(await node.app.settings.web_auth.rpName ?? "") || "(not configured)";

  return `<div class="u2-flex">
<div class="u2-card" style="flex:0 1 24rem">
  <div class="-head">Configuration</div>
  <table class="u2-table">
    <tr><th style="width:8em">Relying Party ID<td>${hee(rpId)}
    <tr><th>RP Name<td>${hee(rpName)}
  </table>
  <div class="-body">
    <p style="font-size:.85em;color:#888;margin-top:.5em">Settings under <code>Settings → web_auth</code>.</p>
  </div>
</div>
<div class="u2-card" style="flex:1">
  <div class="-head">Registered passkeys (${rows.length})</div>
  <div style="overflow:auto; padding:0">
    <table class="u2-table">
      <thead><tr><th>ID<th>User<th>Name<th>Credential ID<th>AAGUID<th>Sign Count<th>Registered<th>Last used<th width=80>
      <tbody>${tableRows || empty}
    </table>
  </div>
</div>
</div>`;
}
