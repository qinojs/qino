// deno-lint-ignore-file no-explicit-any

import { getCtx, html, type HtmlString, sql, sqlSearch, type App, type Ctx } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.ai.sessions";
export const needs = ["cms.backend", "ai"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai.sessions", { en: "AI Sessions", de: "KI-Sitzungen" });
}

type Row = Record<string, any>;
const iso = (sec: unknown) => sec ? new Date(Number(sec) * 1000).toISOString() : "";

function roleBadge(role: string): HtmlString {
  const color: Record<string, string> = { user: "#2563eb", assistant: "#16794d", tool: "#9a6700", system: "#666", error: "#b42318" };
  return html`<span class=ai-role style="background:${color[role] ?? "#888"}">${role}</span>`;
}

function messageHtml(m: Row): HtmlString {
  const time = iso(m.created_at);
  let body = String(m.content ?? "");
  if (m.tool_calls) {
    try {
      const calls = JSON.parse(m.tool_calls).map((c: Row) => `🔧 ${c.function?.name}(${c.function?.arguments ?? ""})`).join("\n");
      body = body ? `${body}\n${calls}` : calls;
    } catch { /* keep raw */ }
  }
  const head = html.join([
    roleBadge(m.role),
    m.name ? html` <small>${m.name}</small>` : "",
    m.model ? html` <small class=ai-dim>${m.model}</small>` : "",
    m.tool_call_id ? html` <small class=ai-dim>${m.tool_call_id}</small>` : "",
    time ? html` <u2-time datetime="${time}" type=relative class=ai-dim></u2-time>` : "",
  ]);
  return html`<div class=ai-msg><div class=ai-msg-head>${head}</div><div class=ai-msg-body>${body}</div></div>`;
}

async function sessionDetail(app: App, id: number): Promise<HtmlString> {
  const s = await app.db.row`SELECT * FROM ai_session WHERE id = ${id}`;
  if (!s) return html`<div class=u2-card><div class=-body>Session not found.</div></div>`;
  const messages: Row[] = await app.db.query`SELECT * FROM ai_message WHERE session_id = ${id} ORDER BY id`;
  return html`<div class=u2-card style="flex:1 1 40rem;">
    <div class=-head>Session #${id} · bot ${s.bot} · user ${s.user_id}</div>
    <div class=-body>${messages.length ? html.join(messages.map(messageHtml)) : html`<em>No messages.</em>`}</div>
  </div>`;
}

// List part — re-rendered live on search via cms.reloadPart(nid, "list", { search }).
async function list(node: Node | null, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = ctx.app;
  const search = String(vars?.search ?? "").trim();
  const bot = sqlSearch(search, ["bot"]).where;
  const msg = sqlSearch(search, ["content"]).where;
  const where = search
    ? sql`WHERE ${bot} OR id IN (SELECT session_id FROM ai_message WHERE ${msg})`
    : sql.raw("");
  const sessions: Row[] = await app.db.query`SELECT * FROM ai_session ${where} ORDER BY updated_at DESC LIMIT 200`;
  const counts = await app.db.indexCol`SELECT session_id, COUNT(*) FROM ai_message GROUP BY session_id`;
  const base = node ? await sessionLinkBase(node) : "?s=";

  const rows: HtmlString[] = [];
  for (const s of sessions) {
    const time = iso(s.updated_at);
    rows.push(html`<tr>
      <td>${s.id}
      <td><a href="${base + s.id}">${s.bot}</a>
      <td>${s.user_id}
      <td>${Number(counts[s.id] ?? 0)}
      <td><u2-time datetime="${time}" type=relative>${time.slice(0, 16).replace("T", " ")}</u2-time>`);
  }
  return rows.length ? html.join(rows) : html`<tr><td colspan=5><em>No sessions.</em>`;
}

async function sessionLinkBase(node: Node): Promise<string> {
  const url = new URL(await (await node.page()).url(), "http://x");
  url.searchParams.delete("s");
  const qs = url.searchParams.toString();
  return url.pathname + (qs ? "?" + qs + "&" : "?") + "s=";
}

function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const selected = ctx.req.query.s ? Number(ctx.req.query.s) : 0;

  return html.async`
<div class="u2-flex">
  <style>
    .ai-role { display:inline-block; color:#fff; padding:1px 6px; border-radius:3px; font-size:.8em; }
    .ai-msg { margin:0 0 12px; }
    .ai-msg-head { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
    .ai-dim { color:#999; font-size:.8em; }
    .ai-msg-body { white-space:pre-wrap; word-break:break-word; }
  </style>

  <div class=u2-card style="flex:0 0 auto;">
    <div class=-head>Sessions</div>
    <div>
      <input type=search id=aiSessionSearch placeholder="${app.t`Search bot or message content`}…" style="width:300px;max-width:100%">
    </div>
    <div class=-body style="padding:0;overflow:auto">
      <table class="u2-table">
        <thead><tr><th>ID<th>Bot<th>User<th>Msgs<th>Updated
        <tbody cms-part=list>${list(node, { ctx, vars: {} })}</tbody>
      </table>
    </div>
  </div>

  ${selected ? sessionDetail(app, selected) : ""}

</div>`;
}

export const cms = { node: { js: ["pub/main.js"], render, parts: { list } } };
