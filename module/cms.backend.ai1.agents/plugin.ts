// deno-lint-ignore-file no-explicit-any
import { html, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { sqlScore, strength } from "@qino/qino/score";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const RECENT = 30; // messages in the feed
const ACTIVE = 60; // seconds since its last message, a session counts as active

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Agents", de: "Agents" });
}

/** A message in one line: who, and what it said, called or got. */
function said(json: string): { role: string; text: string } {
  const m = JSON.parse(json);
  const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((p: any) => p.text ?? `[${p.type}]`).join(" ");
  const calls = (m.toolCalls ?? []).map((c: any) => `→ ${c.name}(${JSON.stringify(c.args)})`).join("\n");
  return { role: m.role, text: [text, calls].filter(Boolean).join("\n") };
}

const line = (row: any) => {
  const { role, text } = said(String(row.message));
  return html`<tr>
    <td>${u2.el.time(row.time)}
    <td>${role}${row.model ? html`<br><small>${row.model}</small>` : ""}
    <td><pre style="white-space:pre-wrap;overflow:auto">${text.length > 600 ? text.slice(0, 600) + " …" : text}</pre>`;
};

/** The newest messages of all sessions: what is going on. */
export async function recent(node: Node): Promise<HtmlString> {
  const rows = await node.app.db.query`
    SELECT m.time, m.message, m.model, s.id AS session, s.agent_id, u.username
    FROM ai1_session_message m JOIN ai1_session s ON s.id = m.session_id LEFT JOIN usr u ON u.id = s.usr_id
    ORDER BY m.id DESC LIMIT ${RECENT}`;
  if (!rows.length) return html.async`<p>${node.app.t`Nothing said yet`}`;
  return html`<table class=u2-table>${rows.map((row) => html`<tr>
    <td>${u2.el.time(row.time)}
    <td>#${row.agent_id} · ${row.session}<br><small>${row.username}</small>
    <td>${said(String(row.message)).role}${row.model ? html`<br><small>${row.model}</small>` : ""}
    <td><pre style="white-space:pre-wrap;overflow:auto">${said(String(row.message)).text.slice(0, 300)}</pre>`)}</table>`;
}

/** Every agent: its role and tools, its memories with their strength, its sessions with all they kept. */
export async function agents(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, now = unixTime();
  const list = await db.query`SELECT id, system, tools, time FROM ai1_agent ORDER BY id DESC`;
  if (!list.length) return html.async`<p>${t`No agents yet`}`;
  return html.async`${list.map(async (agent) => {
    const memories = await db.query`SELECT m.id, m.content, m.time, ${sqlScore(db, "ai1_agent_memory", "m.id")} AS score
      FROM ai1_agent_memory m WHERE m.agent_id = ${agent.id} ORDER BY score DESC, m.id`;
    const sessions = await db.query`SELECT s.id, s.time, u.username, COUNT(m.id) AS n, MAX(m.time) AS last
      FROM ai1_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai1_session_message m ON m.session_id = s.id
      WHERE s.agent_id = ${agent.id} GROUP BY s.id, s.time, u.username ORDER BY last DESC`;
    return html.async`<div class=u2-card>
      <div class=-head>#${agent.id} · ${t`tools`}: ${JSON.parse(String(agent.tools || "[]")).join(", ") || "–"}</div>
      <pre style="white-space:pre-wrap;overflow:auto">${agent.system}</pre>
      <details><summary>${memories.length} ${t`memories`}</summary><table class=u2-table>${memories.map((m) => html`<tr>
        <td>[${m.id}]
        <td>${m.content}
        <td>${strength(db, "ai1_agent_memory", Number(m.score), now).toFixed(2)}
        <td>${u2.el.time(m.time)}`)}</table></details>
      <details><summary>${sessions.length} ${t`sessions`}</summary>${sessions.map(async (s) => html.async`<details>
        <summary>${s.id} · ${s.username} · ${s.n} ${t`messages`} ${s.last ? u2.el.time(s.last) : ""} ${now - Number(s.last) < ACTIVE ? html.async`<span class=u2-badge>${t`active`}</span>` : ""}</summary>
        <table class=u2-table>${(await db.query`SELECT time, message, model FROM ai1_session_message WHERE session_id = ${s.id} ORDER BY id`).map(line)}</table>
      </details>`)}</details>
    </div>`;
  })}`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-flex -Col">
    <div class=u2-card><div class=-head>${t`Recent`}</div><div cms-part=recent>${recent(node)}</div></div>
    <div cms-part=agents>${agents(node)}</div>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render, parts: { recent, agents } } };
