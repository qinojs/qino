// deno-lint-ignore-file no-explicit-any
import { html, sql, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { sqlScore, strength } from "@qino/qino/score";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Db, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const SESSIONS = 100; // shown, the latest first
const SHORT = 80; // characters of a role or a message in a table
const ACTIVE = 60; // seconds since its last message, a session counts as active
// a failed turn is kept as {"role":"error",…} (ai1.agent)
const ERROR = sql`m.message LIKE ${'{"role":"error"%'}`;

/** In its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const short = (text: string) => text.length > SHORT ? text.slice(0, SHORT) + " …" : text;
const count = (value: unknown, danger = false) => Number(value) ? html`<span style="${danger ? "color:var(--red)" : ""}">${Number(value)}</span>` : "–";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Agents", de: "Agents" });
}

const textOf = (content: any): string => typeof content === "string" ? content : (content ?? []).map((p: any) => p.text ?? `[${p.type}]`).join(" ");

/** A message in one line: who, and what it said, called or got. */
function said(json: string): { role: string; text: string } {
  const m = JSON.parse(json), text = textOf(m.content);
  const calls = (m.toolCalls ?? []).map((c: any) => `→ ${c.name}(${JSON.stringify(c.args)})`).join("\n");
  return { role: m.role, text: [text, calls].filter(Boolean).join("\n") };
}

/** The messages with these ids, by id. */
const messages = async (db: Db, ids: unknown[]) =>
  new Map((await db.query`SELECT id, message FROM ai1_session_message WHERE ${sql.in("id", ids.filter(Boolean))}`).map((m) => [String(m.id), said(String(m.message))]));

/** Every agent, the most recently active first; a click shows only its sessions. */
export async function agents(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const rows = await db.query`
    SELECT a.id, a.system, a.tools, a.prefer,
      (SELECT COUNT(*) FROM ai1_agent_memory WHERE agent_id = a.id) AS memories,
      COUNT(DISTINCT s.id) AS sessions, COUNT(m.id) AS messages, SUM(CASE WHEN ${ERROR} THEN 1 ELSE 0 END) AS errors,
      MAX(m.id) AS last, MAX(m.time) AS last_time
    FROM ai1_agent a LEFT JOIN ai1_session s ON s.agent_id = a.id LEFT JOIN ai1_session_message m ON m.session_id = s.id
    GROUP BY a.id, a.system, a.tools, a.prefer ORDER BY last_time DESC, a.id DESC`;
  const last = await messages(db, rows.map((r) => r.last));
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Role`}
      <th>${t`Tools`}
      <th>${t`Memories`}
      <th>${t`Sessions`}
      <th>${t`Messages`}
      <th>${t`Errors`}
      <th>${t`Last message`}
      <th>${t`When`}
    <tbody>${rows.length ? rows.map((a) => html`<tr data-agent="${a.id}" style="cursor:pointer">
      <th>${colored(`#${a.id}`)}
      <td>${short(String(a.system ?? "").split("\n")[0])}${a.prefer && a.prefer !== "{}" ? html`<br><small>${a.prefer}</small>` : ""}
      <td><small>${JSON.parse(String(a.tools || "[]")).join(", ") || "–"}</small>
      <td>${count(a.memories)}
      <td>${count(a.sessions)}
      <td>${count(a.messages)}
      <td>${count(a.errors, true)}
      <td><small>${short(last.get(String(a.last))?.text ?? "")}</small>
      <td>${time(a.last_time)}`) : html.async`<tr><td colspan=9>${t`No agents yet`}`}</tbody>`;
}

/** The sessions, the latest first, of one agent if `vars.agent`; a click opens the conversation. */
export async function sessions(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime();
  const rows = await db.query`
    SELECT s.id, s.agent_id, s.prefer, s.time, u.username, COUNT(m.id) AS messages, SUM(CASE WHEN ${ERROR} THEN 1 ELSE 0 END) AS errors,
      MAX(m.id) AS last, MAX(m.time) AS last_time
    FROM ai1_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai1_session_message m ON m.session_id = s.id
    ${agent ? sql`WHERE s.agent_id = ${agent}` : sql``}
    GROUP BY s.id, s.agent_id, s.prefer, s.time, u.username ORDER BY last_time DESC, s.id DESC LIMIT ${SESSIONS}`;
  const last = await messages(db, rows.map((r) => r.last));
  const models = Map.groupBy(await db.query`SELECT DISTINCT session_id, model FROM ai1_session_message
    WHERE model <> '' AND ${sql.in("session_id", rows.map((r) => r.id))}`, (r) => String(r.session_id));
  return html.async`
      <thead><tr>
        <th>${t`Session`}
        <th>${t`Agent`}
        <th>${t`User`}
        <th>${t`Messages`}
        <th>${t`Errors`}
        <th>${t`Models`}
        <th>${t`Last message`}
        <th>${t`When`}
        <th>${t`Started`}
      <tbody>${rows.length ? rows.map((s) => html`<tr data-session="${s.id}" style="cursor:pointer">
        <th>${s.id}${now - Number(s.last_time) < ACTIVE ? html` <small class=u2-badge>active</small>` : ""}
        <td>${colored(`#${s.agent_id}`)}
        <td>${colored(s.username)}${s.prefer && s.prefer !== "{}" ? html`<br><small>${s.prefer}</small>` : ""}
        <td>${count(s.messages)}
        <td>${count(s.errors, true)}
        <td><small>${(models.get(String(s.id)) ?? []).map((r) => html`${colored(r.model)} `)}</small>
        <td><small>${last.get(String(s.last))?.role ?? ""}: ${short(last.get(String(s.last))?.text ?? "")}</small>
        <td>${time(s.last_time)}
        <td>${time(s.time)}`) : html.async`<tr><td colspan=9>${t`No sessions yet`}`}</tbody>`;
}

/** The memories of agent `vars.agent`, the strongest first, with their strength. */
export async function memories(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime();
  if (!agent) return html.async`<tr><td>${t`Choose an agent`}`;
  const rows = await db.query`SELECT m.id, m.content, m.time, ${sqlScore(db, "ai1_agent_memory", "m.id")} AS score
    FROM ai1_agent_memory m WHERE m.agent_id = ${agent} ORDER BY score DESC, m.id`;
  return html.async`
    <thead><tr>
      <th>${colored(`#${agent}`)}
      <th>${t`Memory`}
      <th>${t`Strength`}
      <th>${t`When`}
    <tbody>${rows.length ? rows.map((m) => html`<tr>
      <td>[${m.id}]
      <td>${m.content}
      <td>${strength(db, "ai1_agent_memory", Number(m.score), now).toFixed(2)}
      <td>${time(m.time)}`) : html.async`<tr><td colspan=4>${t`No memories yet`}`}</tbody>`;
}

/** Small and cut, all of it when opened. */
const folded = (summary: string, all: string) =>
  html`<details><summary><small>${short(summary)}</small></summary><pre style="white-space:pre-wrap;overflow:auto;max-height:20rem"><small>${all}</small></pre></details>`;

/** JSON text indented, other text as it is. */
const pretty = (value: unknown): string => {
  if (typeof value === "string") try { value = JSON.parse(value); } catch { return value as string; }
  return JSON.stringify(value, null, 2);
};

/** One session's conversation, everything it kept: the user on the right, the agent on the left, its
 *  tool calls and their results folded. */
export async function conversation(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const rows = await node.app.db.query`SELECT time, message, model FROM ai1_session_message WHERE session_id = ${Number(vars.session)} ORDER BY id`;
  return html`<div class="u2-flex -Col">${rows.map((row) => { // one message below the other: then align-self puts them left and right
    const m = JSON.parse(String(row.message)), text = textOf(m.content);
    const head = html`<small>${time(row.time)} · ${m.role}${row.model ? html` · ${colored(row.model)}` : ""}</small>`;
    // what the model was given from here on: its role with memories, its tools, prefer
    if (m.role === "system") return html`<div>${head}${m.prefer ? html` <small>prefer ${JSON.stringify(m.prefer)}</small>` : ""}
      ${folded(text, text)}
      ${folded(`${m.tools?.length ?? 0} tools: ${(m.tools ?? []).map((t: any) => t.name).join(", ")}`, pretty(m.tools ?? []))}</div>`;
    if (m.role === "tool") return html`<div style="align-self:flex-start; max-width:80%">${folded(`← ${text}`, pretty(text))}</div>`;
    return html`<div style="align-self:${m.role === "user" ? "flex-end" : "flex-start"}; max-width:80%">
      ${head}
      ${text ? html`<div style="white-space:pre-wrap; ${m.role === "error" ? "color:var(--red)" : ""}">${text}</div>` : ""}
      ${(m.toolCalls ?? []).map((c: any) => folded(`→ ${c.name}(${JSON.stringify(c.args)})`, pretty(c.args)))}
    </div>`;
  })}</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-flex">
    <div class=u2-card><div class=-head>${t`Agents`}</div><table class=u2-table cms-part=agents>${agents(node)}</table></div>
    <div class=u2-card><div class=-head>${t`Sessions`} <a href="" data-agent="" data-all hidden>${t`all agents`}</a></div><table class=u2-table cms-part=sessions>${sessions(node)}</table></div>
    <div class=u2-card style="flex:0 0 auto"><div class=-head>${t`Memories`}</div><table class=u2-table cms-part=memories>${memories(node)}</table></div>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render, parts: { agents, sessions, memories, conversation } } };
