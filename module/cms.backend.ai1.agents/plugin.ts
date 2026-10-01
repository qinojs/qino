// deno-lint-ignore-file no-explicit-any
import { getCtx, html, sql, unixTime, walk } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { candidates } from "@qino/qino/ai1";
import { backend } from "@qino/qino/cms.backend";
import { allowMarkdown } from "@qino/qino/cms.backend.ai1";
import { sqlScore, strength } from "@qino/qino/score";
import { Agent, IN_MIND } from "@qino/qino/ai1.agent";

import manifest from "./manifest.json" with { type: "json" };

import type { ApiTree, App, Db, HtmlString, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const SESSIONS = 100; // shown, the latest first
const SHORT = 80; // characters of a role or a message in a table
const ACTIVE = 60; // seconds since its last message, a session counts as active
const WEIGHTS = ["quality", "cost", "speed"];

type Branch = { count: number; below: Map<string, Branch> };

/** The paths an agent may use as tools, down to the first parameter. */
function paths(tree: ApiTree): Branch {
  const root: Branch = { count: 0, below: new Map() };
  for (const { segments } of walk(tree)) {
    let at = root;
    for (const segment of segments) {
      if (segment.startsWith(":")) break;
      at = at.below.getOrInsertComputed(segment, () => ({ count: 0, below: new Map() }));
      at.count++;
    }
  }
  return root;
}

const branches = (branch: Branch, chosen: string[], above = ""): HtmlString[] =>
  [...branch.below].sort(([a], [b]) => a.localeCompare(b)).map(([segment, sub]) => {
    const path = above + segment, checked = chosen.some((c) => path === c || path.startsWith(c + "/"));
    return html`<u2-tree${above ? "" : " tristate"}><input type=checkbox slot=icon name=tools value="${path}" ${checked ? "checked" : ""}> ${segment} <small>(${sub.count})</small>${
      branches(sub, chosen, path + "/")}</u2-tree>`;
  });

/** Create or edit an agent; sessions are started in Chat. */
function form(node: Node, agent: { id?: number; system?: string; tools?: string[]; prefer?: Record<string, number> } = {}): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<form class="u2-flex -Col" style="flex-wrap:nowrap" data-agent="${agent.id ?? ""}">
    <textarea name=system rows=6 style="width:100%" placeholder="${t`Role`}">${agent.system ?? ""}</textarea>
    <details><summary>${t`Tools`}: <small>${agent.tools?.join(", ") || "–"}</small></summary><div style="overflow:auto;max-height:15rem">${branches(paths(node.app.apiTree), agent.tools ?? [])}</div></details>
    <fieldset><legend>${t`Model`}</legend><div class=u2-flex>${WEIGHTS.map((key) =>
      html`<label>${key} <input type=range min=0 max=10 value="${agent.prefer?.[key] ?? 0}" data-prefer data-key="${key}"> <output>${agent.prefer?.[key] ?? 0}</output></label>`)}</div></fieldset>
    <small>${t`All at 0: the default.`}</small>
    <div><small>${t`Who would answer`}</small><ol data-preview></ol></div>
    <button>${agent.id ? t`Save` : t`Create`}</button>
  </form>`;
}

/** A message of this role, as ai1.agent keeps it ({"role":"user",…}); a failed turn is of role error. */
const role = (name: string) => sql`m.message LIKE ${`{"role":"${name}"%`}`;
const tally = (condition: Sql) => sql`SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
/** What happened in `ai1_session_message m`: asked, answered, tools called, failed, and when. */
const COUNTS = sql`COUNT(m.id) AS messages, ${tally(role("user"))} AS questions, ${tally(role("assistant"))} AS answers,
  ${tally(sql`m.message LIKE ${'%"toolCalls":[{%'}`)} AS calls, ${tally(role("error"))} AS errors,
  MAX(m.id) AS last, MIN(m.time) AS first_time, MAX(m.time) AS last_time`;

/** In its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
/** The model at its provider that gave a message's answer: joined to `ai1_session_message m`. */
const answeredBy = sql`
  LEFT JOIN ai1_model_provider mp ON mp.id = m.model_provider_id
  LEFT JOIN ai1_model am ON am.id = mp.model_id
  LEFT JOIN ai1_provider p ON p.id = mp.provider_id`;
/** Who answered: the model, and the provider it answered through. */
const by = ({ model, provider }: { model?: unknown; provider?: unknown }) =>
  html`${colored(model)}${provider ? html` <small>@ ${colored(provider)}</small>` : ""}`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const short = (text: string) => text.length > SHORT ? text.slice(0, SHORT) + " …" : text;
const count = (value: unknown, danger = false) => Number(value) ? html`<span style="${danger ? "color:var(--red)" : ""}">${Number(value)}</span>` : "–";
/** A stored `prefer`, "–" when empty: then the agent's or ai1's own. */
const choice = (json: unknown) => json ? html`<small>${json}</small>` : "–";
const firstLine = (text: unknown) => short(String(text ?? "").split("\n")[0]);
/** The link to an agent's page: in its own color. */
const agentLink = (url: string, id: unknown) => html`<a href="${backend.toUrl(url, { agent: id })}">${colored(id)}</a>`;
/** The link to a session's page. */
const sessionLink = (url: string, id: unknown) => html`<a href="${backend.toUrl(url, { session: id })}">${id}</a>`;
const pageUrl = async (node: Node) => (await node.page()).url();

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

/** The agents with what happened in their sessions, the most recently active first; only `agent` if given. */
const agentRows = (db: Db, agent = 0) => db.query`
  SELECT a.id, a.system, a.tools, a.prefer, a.time,
    (SELECT COUNT(*) FROM ai1_agent_memory WHERE agent_id = a.id) AS memories,
    (SELECT COUNT(DISTINCT x.session_id) FROM ai1_session_message x JOIN ai1_session y ON y.id = x.session_id
      WHERE y.agent_id = a.id AND x.time > ${unixTime() - ACTIVE}) AS active,
    COUNT(DISTINCT s.id) AS sessions, COUNT(DISTINCT s.usr_id) AS users, ${COUNTS}
  FROM ai1_agent a LEFT JOIN ai1_session s ON s.agent_id = a.id LEFT JOIN ai1_session_message m ON m.session_id = s.id
  ${agent ? sql`WHERE a.id = ${agent}` : sql``}
  GROUP BY a.id, a.system, a.tools, a.prefer, a.time ORDER BY last_time DESC, a.id DESC`;

/** Every agent with the most important, the most recently active first; a click opens its page. */
export async function agents(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node);
  const rows = await agentRows(db);
  const last = await messages(db, rows.map((r) => r.last));
  return html.async`
    <thead><tr>
      <th>${t`Agent`}
      <th>${t`Role`}
      <th>${t`Tools`}
      <th title="${t`prefer: ai1's weights; – is ai1's default`}">${t`Model choice`}
      <th>${t`Memories`}
      <th>${t`Sessions`}
      <th>${t`Users`}
      <th>${t`Messages`}
      <th>${t`Errors`}
      <th>${t`Last message`}
      <th>${t`Last active`}
      <th>${t`Created`}
    <tbody>${rows.length ? rows.map((a) => html`<tr u2-href>
      <th>${agentLink(url, a.id)}${Number(a.active) ? html` <small class=u2-badge>active</small>` : ""}
      <td>${firstLine(a.system)}
      <td><small>${a.tools || "–"}</small>
      <td>${choice(a.prefer)}
      <td>${count(a.memories)}
      <td>${count(a.sessions)}
      <td>${count(a.users)}
      <td>${count(a.messages)}
      <td>${count(a.errors, true)}
      <td><small>${short(last.get(String(a.last))?.text ?? "")}</small>
      <td>${time(a.last_time)}
      <td>${time(a.time)}`) : html.async`<tr><td colspan=12>${t`No agents yet`}`}</tbody>`;
}

/** The sessions, the latest first, of one agent if `vars.agent`; a click opens the session's page. */
export async function sessions(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime(), url = await pageUrl(node);
  const where = agent ? sql`WHERE s.agent_id = ${agent}` : sql``;
  const [rows, all] = await Promise.all([
    db.query`
      SELECT s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username, ${COUNTS}
      FROM ai1_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai1_session_message m ON m.session_id = s.id
      ${where} GROUP BY s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username ORDER BY last_time DESC, s.id DESC LIMIT ${SESSIONS}`,
    db.one`SELECT COUNT(*) FROM ai1_session s ${where}`,
  ]);
  const last = await messages(db, rows.map((r) => r.last));
  const models = Map.groupBy(await db.query`SELECT DISTINCT m.session_id, am.name AS model, p.name AS provider
    FROM ai1_session_message m ${answeredBy}
    WHERE mp.id IS NOT NULL AND ${sql.in("m.session_id", rows.map((r) => r.id))}`, (r) => String(r.session_id));
  return html.async`
      <thead><tr>
        <th>${t`Session`}${Number(all) > rows.length ? html.async` <small>(${t`the latest`} ${rows.length} / ${all})</small>` : ""}
        <th>${t`Agent`}
        <th>${t`User`}
        <th title="${t`prefer of the session; – is the agent's`}">${t`Model choice`}
        <th>${t`Questions`}
        <th>${t`Answers`}
        <th title="${t`Answers that called tools`}">${t`Tool calls`}
        <th>${t`Errors`}
        <th>${t`Models`}
        <th>${t`Last message`}
        <th>${t`Last active`}
        <th>${t`Started`}
      <tbody>${rows.length ? rows.map((s) => html`<tr u2-href>
        <th>${sessionLink(url, s.id)}${now - Number(s.last_time) < ACTIVE ? html` <small class=u2-badge>active</small>` : ""}
        <td>${agentLink(url, s.agent_id)}
        <td>${s.usr_id} ${colored(s.username)}
        <td>${choice(s.prefer)}
        <td>${count(s.questions)}
        <td>${count(s.answers)}
        <td>${count(s.calls)}
        <td>${count(s.errors, true)}
        <td><small>${(models.get(String(s.id)) ?? []).map((r) => html`${by(r)} `)}</small>
        <td><small>${last.get(String(s.last))?.role ?? ""}: ${short(last.get(String(s.last))?.text ?? "")}</small>
        <td>${time(s.last_time)}
        <td>${time(s.time)}`) : html.async`<tr><td colspan=12>${t`No sessions yet`}`}</tbody>`;
}

/** The memories of agent `vars.agent`, the strongest first, with their strength and whether search finds them. */
export async function memories(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime();
  if (!agent) return html.async`<tr><td>${t`Choose an agent`}`;
  const rows = await db.query`SELECT m.id, m.content, m.time, ${sqlScore(db, "ai1_agent_memory", "m.id")} AS score,
      EXISTS (SELECT 1 FROM embedding_ai1_agent_memory e WHERE e.memory_id = m.id) AS findable
    FROM ai1_agent_memory m WHERE m.agent_id = ${agent} ORDER BY score DESC, m.id`;
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Memory`}
      <th title="${t`As stored (score); renewed and recalled it grows`}">${t`Score`}
      <th title="${t`The score now: unused it fades`}">${t`Strength`}
      <th title="${t`The strongest are in the context of a new session, the others only found by search`}">${t`In context`}
      <th title="${t`Embedded: the tool search finds it`}">${t`Findable`}
      <th>${t`When`}
    <tbody>${rows.length ? rows.map((m, i) => html`<tr>
      <td>${m.id}
      <td>${m.content}
      <td>${m.score}
      <td>${strength(db, "ai1_agent_memory", Number(m.score), now).toFixed(2)}
      <td>${i < IN_MIND ? "✓" : "–"}
      <td>${Number(m.findable) ? "✓" : "–"}
      <td>${time(m.time)}`) : html.async`<tr><td colspan=7>${t`No memories yet`}`}</tbody>`;
}

/** The tools of agent `vars.agent`, the nearest to its role first, and which a session starts with. */
export async function tools(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const t = node.app.t, list = await new Agent(node.app, Number(vars.agent) || 0).tools().catch(() => []);
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Tool`}
      <th title="${t`How near its description is to the role, by meaning: 1 the same`}">${t`Score`}
      <th title="${t`A session starts with it; the others it finds itself`}">${t`Given`}
      <th>${t`Description`}
    <tbody>${list.length ? list.map(({ tool, score, given, always }, i) => html.async`<tr>
      <td>${always ? "" : i + 1 - list.findIndex((r) => !r.always)}
      <td>${always ? html.async`<small class=u2-badge title="${t`Not of its api paths: every session has it`}">${t`always`}</small> ` : ""}${tool.name}
      <td>${score == null ? "–" : score.toFixed(3)}
      <td>${given ? html.async`<u2-ico icon=push_pin title="${t`A session starts with it`}">📌</u2-ico>` : ""}
      <td><small>${short(tool.description)}</small>`) : html.async`<tr><td colspan=5>${t`No tools`}`}</tbody>`;
}

/** All about agent `vars.agent`: what it is, what happened, which models answered for whom. */
export async function agent(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, id = Number(vars.agent) || 0;
  const [[a], models, users, findable] = await Promise.all([
    agentRows(db, id),
    db.query`SELECT am.name AS model, p.name AS provider, COUNT(*) AS answers, MAX(m.time) AS last_time
      FROM ai1_session_message m JOIN ai1_session s ON s.id = m.session_id ${answeredBy}
      WHERE s.agent_id = ${id} AND mp.id IS NOT NULL GROUP BY am.name, p.name ORDER BY answers DESC`,
    db.query`SELECT s.usr_id, u.username, COUNT(DISTINCT s.id) AS sessions, ${COUNTS}
      FROM ai1_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai1_session_message m ON m.session_id = s.id
      WHERE s.agent_id = ${id} GROUP BY s.usr_id, u.username ORDER BY last_time DESC`,
    db.row`SELECT (SELECT COUNT(DISTINCT memory_id) FROM embedding_ai1_agent_memory WHERE agent_id = ${id}) AS memories,
      (SELECT COUNT(DISTINCT message_id) FROM embedding_ai1_session_message WHERE agent_id = ${id}) AS messages`,
  ]);
  if (!a) return html.async`<div>${t`No such agent`}</div>`;
  return html.async`<div>
    <table class=u2-table>
      <tr>
        <th title="${t`prefer: ai1's weights; – is ai1's default`}">${t`Model choice`}
        <td>${choice(a.prefer)}
      <tr>
        <th>${t`Created`}
        <td>${time(a.time)}
      <tr>
        <th>${t`Active`}
        <td>${time(a.first_time)} – ${time(a.last_time)}
      <tr>
        <th>${t`Sessions`}
        <td>${count(a.sessions)}, ${t`active now`}: ${count(a.active)}, ${t`users`}: ${count(a.users)}
      <tr>
        <th>${t`Messages`}
        <td>${count(a.messages)}: ${count(a.questions)} ${t`questions`}, ${count(a.answers)} ${t`answers`},
          ${count(a.calls)} ${t`with tool calls`}, ${count(a.errors, true)} ${t`errors`}
      <tr>
        <th>${t`Memories`}
        <td>${count(a.memories)}
      <tr>
        <th title="${t`Embedded: the tool search finds them`}">${t`Findable`}
        <td>${t`memories`}: ${count(findable?.memories)} / ${count(a.memories)},
          ${t`questions and answers`}: ${count(findable?.messages)} / ${count(Number(a.questions) + Number(a.answers))}
    </table>
    <table class=u2-table style="width:auto">
      <thead><tr>
        <th>${t`Models that answered`}
        <th>${t`Answers`}
        <th>${t`Last`}
      <tbody>${models.length ? models.map((r) => html`<tr>
        <td>${by(r)}
        <td>${count(r.answers)}
        <td>${time(r.last_time)}`) : html.async`<tr><td colspan=3>${t`No answers yet`}`}</tbody>
    </table>
    <table class=u2-table style="width:auto">
      <thead><tr>
        <th>${t`Who talked with it`}
        <th>${t`Sessions`}
        <th>${t`Questions`}
        <th>${t`Errors`}
        <th>${t`Last active`}
      <tbody>${users.length ? users.map((u) => html`<tr>
        <td>${u.usr_id} ${colored(u.username)}
        <td>${count(u.sessions)}
        <td>${count(u.questions)}
        <td>${count(u.errors, true)}
        <td>${time(u.last_time)}`) : html.async`<tr><td colspan=5>${t`No users yet`}`}</tbody>
    </table>
  </div>`;
}

/** All about session `vars.session`: who, with which agent, what it was given, which models answered,
 *  which tools it called. */
export async function session(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, id = Number(vars.session) || 0, url = await pageUrl(node);
  const [s, models, system, calls] = await Promise.all([
    db.row`SELECT s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username, MAX(m.time) AS last_time
      FROM ai1_session s LEFT JOIN usr u ON u.id = s.usr_id
      LEFT JOIN ai1_session_message m ON m.session_id = s.id
      WHERE s.id = ${id} GROUP BY s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username`,
    db.query`SELECT am.name AS model, p.name AS provider, COUNT(*) AS answers, MAX(m.time) AS last_time
      FROM ai1_session_message m ${answeredBy}
      WHERE m.session_id = ${id} AND mp.id IS NOT NULL GROUP BY am.name, p.name ORDER BY answers DESC`,
    db.col`SELECT message FROM ai1_session_message m WHERE m.session_id = ${id} AND ${role("system")} ORDER BY m.id`,
    db.col`SELECT message FROM ai1_session_message m WHERE m.session_id = ${id} AND m.message LIKE ${'%"toolCalls":[{%'}`,
  ]);
  if (!s) return html.async`<div>${t`No such session`}</div>`;
  // what the model was given as the session started; the other system messages are notes
  const given = system.map((json) => JSON.parse(String(json))).find((m) => m.tools);
  const used = Map.groupBy(calls.flatMap((json) => JSON.parse(String(json)).toolCalls ?? []), (c: any) => String(c.name));
  return html.async`<div class=u2-flex>
    <table class=u2-table>
      <tr>
        <th>${t`Agent`}
        <td>${agentLink(url, s.agent_id)}
      <tr>
        <th title="${t`It acts with this user's rights`}">${t`User`}
        <td>${s.usr_id} ${colored(s.username)}
      <tr>
        <th title="${t`prefer of the session; – is the agent's`}">${t`Model choice`}
        <td>${choice(s.prefer)}
      <tr>
        <th>${t`Started`}
        <td>${time(s.time)}
      <tr>
        <th>${t`Last active`}
        <td>${time(s.last_time)}${unixTime() - Number(s.last_time) < ACTIVE ? html` <small class=u2-badge>active</small>` : ""}
      <tr>
        <th title="${t`As the session started: its role with the memories and what other modules added`}">${t`Given`}
        <td>${given ? folded(textOf(given.content), textOf(given.content)) : "–"}
      <tr>
        <th title="${t`Given as the session started; later changes come with the next session`}">${t`Tools given`}
        <td>${given?.tools ? folded(`${given.tools.length}: ${given.tools.map((tool: any) => tool.name).join(", ")}`, pretty(given.tools)) : "–"}
    </table>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Models that answered`}
        <th>${t`Answers`}
        <th>${t`Last`}
      <tbody>${models.length ? models.map((r) => html`<tr>
        <td>${by(r)}
        <td>${count(r.answers)}
        <td>${time(r.last_time)}`) : html.async`<tr><td colspan=3>${t`No answers yet`}`}</tbody>
    </table>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Tools called`}
        <th>${t`Calls`}
      <tbody>${used.size ? [...used].sort((a, b) => b[1].length - a[1].length).map(([tool, list]) => html`<tr>
        <td>${colored(tool)}
        <td>${count(list.length)}`) : html.async`<tr><td colspan=2>${t`No tools called yet`}`}</tbody>
    </table>
  </div>`;
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
 *  tool calls and their results folded. With `after` (a message id) only the messages since. */
export async function conversation(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const rows = await node.app.db.query`SELECT m.id, m.time, m.message, am.name AS model, p.name AS provider
    FROM ai1_session_message m ${answeredBy}
    WHERE m.session_id = ${Number(vars.session)} AND m.id > ${Number(vars.after) || 0} ORDER BY m.id`;
  return html`<div class="u2-flex -Col" style="flex-wrap:nowrap">${rows.map((row) => { // one message below the other: then align-self puts them left and right
    const m = JSON.parse(String(row.message)), text = textOf(m.content);
    const head = html`<small>${time(row.time)} · ${m.role}${row.model ? html` · ${by(row)}` : ""}</small>`;
    // what the model was given as the session started (its role with memories, its tools, prefer), or a note
    if (m.role === "system") return html`<div data-message=${row.id}>${head}${m.prefer ? html` <small>prefer ${JSON.stringify(m.prefer)}</small>` : ""}
      ${folded(text, text)}
      ${m.tools ? folded(`${m.tools.length} tools: ${m.tools.map((t: any) => t.name).join(", ")}`, pretty(m.tools)) : ""}</div>`;
    if (m.role === "tool") {
      return html`<div data-message=${row.id} style="align-self:flex-start; max-width:80%">
        ${folded(`← ${text}`, pretty(text))}</div>`;
    }
    const side = m.role === "user" ? "flex-end" : "flex-start";
    return html`<div data-message=${row.id} style="align-self:${side}; max-width:80%">
      ${head}
      ${!text ? "" : m.role === "assistant" ? html`<div data-md>${text}</div>` // markdown, rendered by pub/main.js
        : html`<div style="white-space:pre-wrap; ${m.role === "error" ? "color:var(--red)" : ""}">${text}</div>`}
      ${(m.toolCalls ?? []).map((c: any) => folded(`→ ${c.name}(${JSON.stringify(c.args)})`, pretty(c.args)))}
    </div>`;
  })}</div>`;
}

/** The list of agents and all sessions; with `?agent=` an agent's page, with `?session=` a session's. */
async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t, query = getCtx().req.query, url = await pageUrl(node);
  const id = Number(query.agent) || 0, sessionId = Number(query.session) || 0;
  allowMarkdown(); // the answers in a conversation
  if (sessionId) {
    const agentId = await node.app.db.one`SELECT agent_id FROM ai1_session WHERE id = ${sessionId}`;
    const vars = { session: sessionId };
    return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>
        <a href="${url}">${t`Agents`}</a> › ${agentId ? html.async`${t`Agent`} ${agentLink(url, agentId)} › ` : ""}${t`Session`} ${sessionId}
      </div>
      <div cms-part=session>${session(node, { vars })}</div>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Conversation`}</div>
      <div cms-part=conversation style="max-height:80vh; overflow:auto">${conversation(node, { vars })}</div>
    </div>
  </div>`;
  }
  if (!id) return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`New agent`}</div>${form(node)}</div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Agents`}</div><table class=u2-table cms-part=agents>${agents(node)}</table></div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Sessions`}</div><div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=sessions>${sessions(node)}</table></div></div>
  </div>`;
  const vars = { agent: id };
  const row = await node.app.db.row`SELECT id, system, tools, prefer FROM ai1_agent WHERE id = ${id}`;
  const edit = row ? {
    id, system: String(row.system ?? ""), tools: JSON.parse(String(row.tools || "[]")), prefer: JSON.parse(String(row.prefer || "{}")),
  } : undefined;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto; max-width:50rem">
      <div class=-head><a href="${url}">${t`Agents`}</a> › ${t`Agent`} ${colored(id)}</div>
      <div cms-part=agent>${agent(node, { vars })}</div>
    </div>
    ${edit ? html.async`<div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Edit agent`}</div>${form(node, edit)}</div>` : ""}
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Sessions`}</div><div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=sessions>${sessions(node, { vars })}</table></div></div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Memories`}</div><table class=u2-table cms-part=memories>${memories(node, { vars })}</table></div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Tools`} <small>${await node.app.db.one`SELECT tools FROM ai1_agent WHERE id = ${id}` || "–"}</small></div>
      <div><small>${t`Ranked by how near each tool's description is to the agent's role, by meaning; a session starts with the 📌 ones and finds the others itself.`}</small></div>
      <div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=tools>${tools(node, { vars })}</table></div>
    </div>
  </div>`;
}

async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.preview || typeof vars.preview !== "object") return null;
  const prefer = Object.fromEntries(Object.entries(vars.preview).filter(([, weight]) => typeof weight === "number"));
  const list = await candidates(node.app, "text", { messages: [], tools: [{}] }, { prefer: Object.keys(prefer).length ? prefer : undefined });
  return { ok: true, list: list.slice(0, 5).map((c) => ({ model: c.model, provider: c.provider, rank: Math.round(c.rank * 100) / 100 })) };
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { agents, agent, sessions, session, memories, tools, conversation } } };
