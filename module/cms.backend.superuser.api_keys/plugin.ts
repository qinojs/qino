import type { Node } from "../cms/mod.ts";
import { hee, type App, type Ctx } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name  = "cms.backend.superuser.api_keys";
export const needs = ["cms.backend", "api_key"];
export const cms   = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.api_keys", { en: "API Keys", de: "API-Schlüssel" });
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const db  = node.app.db;

  if (ctx.req.body?.csrfToken === ctx.csrfToken && "delete_key" in ctx.req.body) {
    const id = Number(ctx.req.body.delete_key);
    if (id) await db.table("api_key").delete(id);
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
    return `<tr>
      <td>${hee(r.id)}
      <td>${hee(userName)}<br><small>${hee(r.email)}</small>
      <td>${hee(r.name)}
      <td><code>${hee(r.prefix)}…</code>
      <td>${fmt(r.created)}
      <td>${r.expires ? fmt(r.expires) : "–"}
      <td><form method=post style="display:inline">
        <input type=hidden name=csrfToken value="${hee(ctx.csrfToken)}">
        <input type=hidden name=delete_key value="${hee(r.id)}">
        <button class=u2-unstyle u2-confirm="${hee(`Really delete ${r.name ?? r.id}?`)}"><u2-ico icon=delete>✕</u2-ico></button>
      </form>`;
  }).join("\n");

  const empty = rows.length === 0
    ? '<tr><td colspan=7 style="text-align:center;padding:1em">No API keys.'
    : "";

  return `<div class=u2-card>
  <div class=-head>API keys (${rows.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
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
