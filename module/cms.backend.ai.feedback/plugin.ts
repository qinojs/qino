// deno-lint-ignore-file no-explicit-any
import { errMsg, getCtx, html, sql } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const LIMIT = 200;
/** The latest messages searched for failed tool calls. */
const RECENT = 2000;

/** In its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const count = (value: unknown) => Number(value) || "–";
const pageUrl = async (node: Node) => (await node.page()).url();
/** What it is about; empty: the whole system. */
const topic = (about: unknown) => about ? colored(about) : html`<i>system</i>`;
const button = (action: string, id: unknown, icon: string, title: string) =>
  html`<button type=button class=u2-unstyle data-${action}="${id}" title="${title}"><u2-ico icon=${icon}>${icon}</u2-ico></button>`;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI feedback", de: "KI-Feedback" });
}

/** What reports are about, by kind (only `vars.kind`'s with it), the most open first; a click shows only those. */
export async function topics(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node), only = vars.kind ? sql`kind = ${vars.kind}` : sql`1 = 1`;
  const rows = await db.query`SELECT kind, about, SUM(CASE WHEN done THEN 0 ELSE 1 END) AS open, COUNT(*) AS reports,
      COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT model) AS models, MAX(time) AS last_time
    FROM ai_agent_feedback WHERE ${only} GROUP BY kind, about ORDER BY open DESC, last_time DESC LIMIT ${LIMIT}`;
  return html.async`
    <thead><tr>
      <th>kind
      <th>about
      <th title="${t`Not dealt with yet`}">${t`Open`}
      <th>${t`Reports`}
      <th>${t`Sessions`}
      <th title="${t`Different models reporting it: the more, the less it is the model`}">${t`Models`}
      <th>${t`Last`}
    <tbody>${rows.length ? rows.map((r) => html`<tr u2-href>
      <td>${colored(r.kind)}
      <th><a href="${backend.toUrl(url, { kind: r.kind, about: r.about || "-" })}">${topic(r.about)}</a>
      <td>${count(r.open)}
      <td>${count(r.reports)}
      <td>${count(r.sessions)}
      <td>${count(r.models)}
      <td>${time(r.last_time)}`) : html.async`<tr><td colspan=7>${t`No feedback yet`}`}</tbody>`;
}

/** The reports, the newest first: the open ones, with `vars.done` all; with `vars.kind` and `vars.about` only those
 *  (`-`: about the whole system). */
export async function reports(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, about = vars.about === "-" ? "" : vars.about;
  const agents = await backend.toModuleUrl(node, "cms.backend.ai.agents");
  const link = (params: Record<string, unknown>, text: unknown) => agents(params) ? html`<a href="${agents(params)}">${text}</a>` : text;
  const rows = await db.query`SELECT f.id, f.time, f.kind, f.model, f.about, f.content, f.done, f.agent_id, f.session_id, u.username
    FROM ai_agent_feedback f LEFT JOIN usr u ON u.id = f.usr_id
    WHERE ${about == null ? sql`1 = 1` : sql`f.about = ${about}`} ${vars.kind ? sql`AND f.kind = ${vars.kind}` : sql``}
      ${vars.done ? sql`` : sql`AND f.done = ${false}`}
    ORDER BY f.id DESC LIMIT ${LIMIT}`;
  return html.async`
    <thead><tr>
      <th>#
      <th>kind
      <th>about
      <th>content
      <th>model
      <th>${t`From`}
      <th>${t`When`}
      <th>
    <tbody>${rows.length ? rows.map((r) => html`<tr style="${r.done ? "opacity:.5" : ""}">
      <td>${r.id}
      <td>${colored(r.kind)}
      <td>${topic(r.about)}
      <td style="white-space:pre-wrap">${r.content}
      <td>${r.model ? colored(r.model) : "–"}
      <td>${r.session_id ? link({ session: r.session_id }, `session ${r.session_id}`) : ""}${r.agent_id ? html` · ${link({ agent: r.agent_id }, colored(r.agent_id))}` : ""}${r.username ? html` · ${colored(r.username)}` : ""}
      <td>${time(r.time)}
      <td style="white-space:nowrap">${r.done ? button("open", r.id, "undo", "open again") : button("done", r.id, "done", "done")}${button("remove", r.id, "delete", "remove")}`)
      : html.async`<tr><td colspan=8>${t`Nothing open`}`}</tbody>`;
}

/** The tool calls that failed in the latest messages of all sessions, by tool: what agents did not report too. */
export async function failed(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const rows = (await db.query`SELECT session_id, time, message FROM ai_session_message
    WHERE message LIKE ${'{"role":"tool"%'} OR message LIKE ${'%"toolCalls":[{%'} ORDER BY id DESC LIMIT ${RECENT}`).reverse();
  const called = new Map<string, string>(), tools = new Map<string, { calls: number; failed: number; last?: number; error?: string }>();
  for (const row of rows) {
    const m = JSON.parse(String(row.message)), key = (id: unknown) => `${row.session_id} ${id}`;
    if (m.role !== "tool") {
      for (const call of m.toolCalls ?? []) {
        called.set(key(call.id), call.name);
        const tool = tools.get(call.name) ?? tools.set(call.name, { calls: 0, failed: 0 }).get(call.name)!;
        tool.calls++;
      }
      continue;
    }
    const name = called.get(key(m.id)), error = (() => { try { return JSON.parse(m.content)?.error; } catch { return; } })();
    if (!name || !error) continue;
    const tool = tools.get(name)!;
    tool.failed++, tool.last = Number(row.time), tool.error = String(error);
  }
  const list = [...tools].filter(([, tool]) => tool.failed).sort((a, b) => b[1].failed - a[1].failed);
  return html.async`
    <thead><tr>
      <th>${t`Tool`}
      <th>${t`Failed`}
      <th>${t`Calls`}
      <th>${t`Last error`}
      <th>${t`Last`}
    <tbody>${list.length ? list.map(([tool, r]) => html`<tr>
      <td>${colored(tool)}
      <td>${r.failed}
      <td>${r.calls}
      <td><small title="${r.error}">${r.error!.length > 120 ? r.error!.slice(0, 120) + " …" : r.error}</small>
      <td>${time(r.last)}`) : html.async`<tr><td colspan=5>${t`No tool call failed`}`}</tbody>`;
}

/** The topics, the open reports and the failed tool calls; with `?kind=` only those of a kind (config: for the
 *  site's operator, the others for Qino), with `?about=` the reports about one, `?done=1` also those dealt with. */
async function render(node: Node) {
  const { db, t } = node.app, query = getCtx().req.query, url = await pageUrl(node);
  const only = { ...query.kind && { kind: String(query.kind) }, ...query.about != null && { about: String(query.about) } };
  const vars = { ...only, ...query.done && { done: 1 } }, toggle = backend.toUrl(url, { ...only, ...!query.done && { done: 1 } });
  // the kinds there are, to show only one
  const kinds = (await db.col`SELECT DISTINCT kind FROM ai_agent_feedback ORDER BY kind`).filter(Boolean).map(String);
  const filter = (kind: string, text: unknown) =>
    html`<a href="${backend.toUrl(url, kind ? { kind } : {})}" ${(query.kind ?? "") === kind ? "aria-current=true" : ""}>${text}</a>`;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Topics`} <small>${filter("", "all")}${kinds.map((kind) => html` · ${filter(kind, kind)}`)}</small></div>
      <table class=u2-table cms-part=topics>${topics(node, { vars: only.kind ? { kind: only.kind } : {} })}</table>
    </div>
    <div class=u2-card style="flex:1 1 30rem; min-width:0">
      <div class=-head>
        ${query.about != null ? html.async`<a href="${url}">${t`Feedback`}</a> › ${query.kind ? html`${colored(query.kind)} ` : ""}${topic(query.about === "-" ? "" : query.about)}` : t`Feedback`}
        <a href="${toggle}"><small>${query.done ? t`only open` : t`with done`}</small></a>
      </div>
      <table class=u2-table cms-part=reports>${reports(node, { vars })}</table>
    </div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head title="${t`In the latest messages of all sessions`}">${t`Failed tool calls`}</div><table class=u2-table cms-part=failed>${failed(node)}</table></div>
  </div>`;
}

/** Mark a report done or open again, or remove it. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const table = node.app.db.table("ai_agent_feedback");
  try {
    if (vars.done) return (await table.update(Number(vars.done), { done: true }), { ok: true });
    if (vars.open) return (await table.update(Number(vars.open), { done: false }), { ok: true });
    if (vars.remove) return (await table.delete(Number(vars.remove)), { ok: true });
    return null;
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { topics, reports, failed } } };
