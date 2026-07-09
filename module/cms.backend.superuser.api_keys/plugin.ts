import type { Node } from "../cms/mod.ts";
import { hee, getCtx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name  = "cms.backend.superuser.api_keys";
export const needs = ["cms.backend", "api_key"];
export const cms   = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.api_keys", { en: "API Keys", de: "API-Schlüssel" });
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const db  = node.app.db;

  if (ctx.post?.csrfToken === ctx.csrfToken && "delete_key" in ctx.post) {
    const id = Number(ctx.post.delete_key ?? "0");
    if (id) await db.exec`DELETE FROM api_key WHERE id = ${id}`;
  }

  const rows = await db.query`
    SELECT k.id, k.name, k.prefix, k.created, k.expires,
           u.id AS usr_id, u.email, u.firstname, u.lastname
    FROM api_key k
    LEFT JOIN usr u ON u.id = k.usr_id
    ORDER BY k.created DESC LIMIT 500`;

  const fmt = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString("en") : "-";
  const tableRows = rows.map((r) => {
    const userName = [r.firstname, r.lastname].filter(Boolean).join(" ") || r.email || `#${r.usr_id}`;
    const delBtn   = `<form method=post style="display:inline"><input type=hidden name=csrfToken value="${hee(ctx.csrfToken)}"><input type=hidden name=delete_key value="${hee(String(r.id))}"><button class=u2-unstyle u2-confirm="${hee(`Really delete ${String(r.name ?? r.id)}?`)}"><u2-ico icon=delete>✕</u2-ico></button></form>`;
    return `<tr>
      <td>${hee(String(r.id))}
      <td>${hee(userName)}<br><small>${hee(String(r.email ?? ""))}</small>
      <td>${hee(String(r.name ?? ""))}
      <td><code>${hee(String(r.prefix ?? ""))}…</code>
      <td>${fmt(r.created)}
      <td>${r.expires ? fmt(r.expires) : "–"}
      <td>${delBtn}`;
  }).join("\n");

  const empty = rows.length === 0
    ? '<tr><td colspan="7" style="text-align:center;padding:1em">No API keys.'
    : "";

  return `<div class="u2-card">
  <div class="-head">API keys (${rows.length})</div>
  <div style="overflow:auto; padding:0">
    <table class="u2-table">
      <thead><tr>
        <th>ID
        <th>User
        <th>Name
        <th>Prefix
        <th>Created
        <th>Expires
        <th width=80>
      <tbody>${tableRows || empty}
    </table>
  </div>
</div>`;
}
