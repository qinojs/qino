import { createHash } from "node:crypto";
import { getCtx, html, NotFoundError, randB64, requireStepUp, safeEqual, sql, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms         = { node: { js: ["pub/main.js"], render, api, parts: { list } } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.auth.api_keys", { en: "API Keys", de: "API-Schlüssel" });
}

async function api(node: Node, vars: Record<string, unknown>) {
  if (!vars.create) return null;
  await requireStepUp(getCtx());
  const db = node.app.db;
  const data = vars.create as Record<string, unknown>;
  const usrId = Number(data.usr_id);
  if (!Number.isSafeInteger(usrId) || !await db.one`SELECT id FROM usr WHERE id = ${usrId}`) {
    throw new NotFoundError("User not found");
  }
  const token = "qk_" + randB64(32);
  await db.table("api_key").insert({
    usr_id: usrId,
    name: String(data.name || "API Key"),
    prefix: token.slice(0, 9),
    hash: createHash("sha256").update(token).digest("hex"),
    created: unixTime(),
    expires: null,
  });
  return { token };
}

async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const db  = node.app.db;
  const usrId = Number(vars.usr_id ?? ctx.req.body?.usr_id) || null;

  if (safeEqual(ctx.req.body?.csrfToken, ctx.csrfToken) && "delete_key" in ctx.req.body) {
    const id = Number(ctx.req.body.delete_key);
    if (id) await db.table("api_key").delete(id);
  }

  const users = await db.query`SELECT id, username, given_name, family_name FROM usr ORDER BY username, id`;

  return html`<div class=u2-card>
  <div class=-head>API-Keys</div>
  <div>
    <form data-create class=u2-flex style="align-items:end">
      <label>User<br><select name=usr_id required>
        <option value="">All users</option>
        ${users.map((u) => html`<option value="${u.id}" ${Number(u.id) === usrId ? "selected" : ""}>${[u.given_name, u.family_name].filter(Boolean).join(" ") || u.username || `#${u.id}`} (${u.username || `#${u.id}`})</option>`)}
      </select></label>
      <label>Name<br><input name=name></label>
      <button ${usrId ? "" : "disabled"}>Create key</button>
    </form>
    <p data-token hidden>Copy now — shown only once:<br><code></code></p>
    <output data-message role=status></output>
  </div>
  <table class=u2-table cms-part=list>${await list(node, { ctx, vars: { usr_id: usrId } })}</table>
</div>`;
}

async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const db = node.app.db;
  const usrId = Number(vars.usr_id) || null;
  const rows = await db.query`
    SELECT k.id, k.name, k.prefix, k.created, k.expires,
           u.id AS usr_id, u.username, u.given_name, u.family_name
    FROM api_key k
    LEFT JOIN usr u ON u.id = k.usr_id
    ${usrId ? sql`WHERE k.usr_id = ${usrId}` : sql``}
    ORDER BY k.created DESC LIMIT 500`;

  const fmt = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString("en") : "-";
  const trs = rows.map((r) => {
    const userName = [r.given_name, r.family_name].filter(Boolean).join(" ") || r.username || `#${r.usr_id}`;
    return html`<tr>
      <td>${r.id}
      <td>${userName}<br><small>${r.username}</small>
      <td>${r.name}
      <td><code>${r.prefix}…</code>
      <td>${u2.el.time(r.created)}
      <td>${r.expires ? fmt(r.expires) : "–"}
      <td><form method=post style="display:inline">
        <input type=hidden name=csrfToken value="${ctx.csrfToken}">
        <input type=hidden name=usr_id value="${usrId ?? ""}">
        <input type=hidden name=delete_key value="${r.id}">
        <button class=u2-unstyle u2-confirm="${`Really delete ${r.name ?? r.id}?`}"><u2-ico icon=delete>✕</u2-ico></button>
      </form>`;
  });

  const empty = html`<tr><td colspan=7 style="text-align:center;padding:1em">No API keys.`;

  return html`<thead><tr>
      <th>ID
      <th>User
      <th>Name
      <th>Prefix
      <th>Created
      <th>Expires
      <th width=80>
    <tbody>${trs.length ? html.join(trs, "\n") : empty}`;
}
