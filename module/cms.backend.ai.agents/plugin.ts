// deno-lint-ignore-file no-explicit-any
import { getCtx, html, sql, toTools, unixTime, walk } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { candidates } from "@qino/qino/ai";
import { backend } from "@qino/qino/cms.backend";
import { allowMarkdown } from "@qino/qino/cms.backend.ai";
import { sqlScore, strength } from "@qino/qino/score";
import { Agent, called, IN_MIND, Session } from "@qino/qino/ai.agent";

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

/** The tools an agent may use, as a tree of their names: the path, then the method. */
function toolTree(tree: ApiTree) {
  const root: Branch = { count: 0, below: new Map() };
  for (const { name } of walk(tree)) {
    let at = root;
    for (const part of name.split("_")) {
      at = at.below.getOrInsertComputed(part, () => ({ count: 0, below: new Map() }));
      at.count++;
    }
  }
  return root;
}

/** A branch stands for all below it (`cms_node_*`), a leaf for one tool. */
const branches = (branch: Branch, chosen: string[], above = ""): HtmlString[] =>
  [...branch.below].sort(([a], [b]) => a.localeCompare(b)).map(([part, sub]) => {
    const name = above + part, value = sub.below.size ? name + "_*" : name;
    const checked = chosen.some((c) => c === value || c.endsWith("_*") && (name + "_").startsWith(c.slice(0, -1)));
    return html`<u2-tree${above ? "" : " tristate"}><input type=checkbox slot=icon name=tools value="${value}" ${checked ? "checked" : ""}> ${part}${
      sub.below.size ? html` <small>(${sub.count})</small>` : ""}${branches(sub, chosen, name + "_")}</u2-tree>`;
  });

/** Create or edit an agent; sessions are started in Chat. One a module declares (`name`) its file sets, shown locked. */
function form(node: Node, agent: { id?: number; name?: string; system?: string; tools?: string[]; prefer?: Record<string, number> } = {}) {
  const t = node.app.t;
  return html.async`<form class="u2-flex -Col" style="flex-wrap:nowrap" data-agent="${agent.id}">
    ${agent.name ? html.async`<small>${t`Declared by a module: its file sets role, tools and model choice on every start.`}</small>` : ""}
    <fieldset ${agent.name ? "disabled" : ""} style="display:contents">
    <textarea name=system rows=6 style="width:100%" placeholder="${t`Role`}">${agent.system}</textarea>
    <fieldset><legend>${t`Tools`}</legend><div style="overflow:auto;max-height:15rem">${branches(toolTree(node.app.apiTree), agent.tools ?? [])}</div></fieldset>
    <fieldset><legend>${t`Model choice`}</legend>
      <div class=u2-table><div>${WEIGHTS.map((key) => html`<label>
        <span>${key}</span>
        <input type=range min=0 max=10 value="${agent.prefer?.[key] ?? 0}" data-prefer data-key="${key}">
        <output>${agent.prefer?.[key] ?? 0}</output>
      </label>`)}</div></div>
    </fieldset>
    <small>${t`All at 0: the default.`}</small>
    <div><small>${t`Who would answer`}</small><ol data-preview></ol></div>
    ${agent.id ? "" : html.async`<button>${t`Create`}</button>`}
    </fieldset>
  </form>`;
}

/** A message of this role, as ai.agent keeps it ({"role":"user",…}); a failed turn is of role error. */
const role = (name: string) => sql`m.message LIKE ${`{"role":"${name}"%`}`;
const tally = (condition: Sql) => sql`SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
/** What happened in `ai_session_message m`: asked, answered, tools called, failed, and when. */
const COUNTS = sql`COUNT(m.id) AS messages, ${tally(role("user"))} AS questions, ${tally(role("assistant"))} AS answers,
  ${tally(sql`m.message LIKE ${'%"toolCalls":[{%'}`)} AS calls, ${tally(role("error"))} AS errors,
  MAX(m.id) AS last, MIN(m.time) AS first_time, MAX(m.time) AS last_time`;

/** In its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
/** The model at its provider that gave a message's answer: joined to `ai_session_message m`. */
const answeredBy = sql`
  LEFT JOIN ai_model_provider mp ON mp.id = m.model_provider_id
  LEFT JOIN ai_model am ON am.id = mp.model_id
  LEFT JOIN ai_provider p ON p.id = mp.provider_id`;
/** Who answered: the model, and the provider it answered through. */
const by = ({ model, provider }: { model?: unknown; provider?: unknown }) =>
  html`${colored(model)}${provider ? html` <small>@ ${colored(provider)}</small>` : ""}`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const short = (text: string) => text.length > SHORT ? text.slice(0, SHORT) + " …" : text;
const count = (value: unknown, danger = false) => Number(value) ? html`<span style="${danger ? "color:var(--red)" : ""}">${Number(value)}</span>` : "–";
/** A stored `prefer`, "–" when empty: then the agent's or ai's own. */
const choice = (json: unknown) => json ? html`<small>${json}</small>` : "–";
const kilo = (tokens: number) => tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`;
const firstLine = (text: unknown) => short(String(text ?? "").split("\n", 1)[0]);
/** The link to an agent's page: in its own color. */
const agentLink = (url: string, id: unknown) => html`<a href="${backend.toUrl(url, { agent: id })}">${colored(id)}</a>`;
/** The link to a session's page. */
const sessionLink = (url: string, id: unknown) => html`<a href="${backend.toUrl(url, { session: id })}">${id}</a>`;
/** What the model has in its context, by key (memories `5`, the user's `u5`, tools by name), each in its color. */
const keys = (known: Iterable<string>) => [...known].map((key) => html`${colored(key)} `);
const pageUrl = async (node: Node) => (await node.page()).url();

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Agents", de: "Agents" });
}

const textOf = (content: any): string => typeof content === "string" ? content : (content ?? []).map((p: any) => p.text ?? `[${p.type}]`).join(" ");

/** A message in one line: who, and what it said, called or got. */
function said(json: string): { role: string; text: string } {
  const m = JSON.parse(json), text = textOf(m.content);
  const calls = (m.toolCalls ?? []).map(called).map((c: any) => `→ ${c.name}(${JSON.stringify(c.args)})`).join("\n");
  return { role: m.role, text: [text, calls].filter(Boolean).join("\n") };
}

/** The messages with these ids, by id. */
const messages = async (db: Db, ids: unknown[]) =>
  new Map((await db.query`SELECT id, message FROM ai_session_message WHERE ${sql.in("id", ids.filter(Boolean))}`).map((m) => [String(m.id), said(String(m.message))]));

/** The agents with what happened in their sessions, the most recently active first; only `agent` if given. */
const agentRows = (db: Db, agent = 0) => db.query`
  SELECT a.id, a.name, a.system, a.tools, a.prefer, a.time,
    (SELECT COUNT(*) FROM ai_agent_memory WHERE agent_id = a.id) AS memories,
    (SELECT COUNT(DISTINCT x.session_id) FROM ai_session_message x JOIN ai_session y ON y.id = x.session_id
      WHERE y.agent_id = a.id AND x.time > ${unixTime() - ACTIVE}) AS active,
    COUNT(DISTINCT s.id) AS sessions, COUNT(DISTINCT s.usr_id) AS users, ${COUNTS}
  FROM ai_agent a LEFT JOIN ai_session s ON s.agent_id = a.id LEFT JOIN ai_session_message m ON m.session_id = s.id
  ${agent ? sql`WHERE a.id = ${agent}` : sql``}
  GROUP BY a.id, a.name, a.system, a.tools, a.prefer, a.time ORDER BY last_time DESC, a.id DESC`;

/** Every agent with the most important, the most recently active first; a click opens its page. */
export async function agents(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node);
  const rows = await agentRows(db);
  const last = await messages(db, rows.map((r) => r.last));
  return html.async`
    <thead><tr>
      <th>#
      <th title="${t`Declared by a module, which sets its role, tools and model choice on every start`}">${t`Name`}
      <th>${t`Role`}
      <th>${t`Tools`}
      <th title="${t`prefer: ai's weights; – is ai's default`}">${t`Model choice`}
      <th style="writing-mode:sideways-lr;vertical-align:bottom">${t`Memories`}
      <th style="writing-mode:sideways-lr;vertical-align:bottom">${t`Sessions`}
      <th style="writing-mode:sideways-lr;vertical-align:bottom">${t`Users`}
      <th style="writing-mode:sideways-lr;vertical-align:bottom">${t`Messages`}
      <th style="writing-mode:sideways-lr;vertical-align:bottom">${t`Errors`}
      <th>${t`Last message`}
      <th>${t`Last active`}
      <th>${t`Created`}
    <tbody>${rows.length ? rows.map((a) => html`<tr u2-href>
      <th>${agentLink(url, a.id)}${Number(a.active) ? html` <small class=u2-badge>active</small>` : ""}
      <td>${a.name || "–"}
      <td>${firstLine(a.system)}
      <td><small style="display:block;max-width:15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${a.tools || "–"}">${a.tools || "–"}</small>
      <td>${choice(a.prefer)}
      <td>${count(a.memories)}
      <td>${count(a.sessions)}
      <td>${count(a.users)}
      <td>${count(a.messages)}
      <td>${count(a.errors, true)}
      <td><small>${short(last.get(String(a.last))?.text ?? "")}</small>
      <td>${time(a.last_time)}
      <td>${time(a.time)}`) : html.async`<tr><td colspan=13>${t`No agents yet`}`}</tbody>`;
}

/** The sessions, the latest first, of one agent if `vars.agent`; a click opens the session's page. */
export async function sessions(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime(), url = await pageUrl(node);
  const where = agent ? sql`WHERE s.agent_id = ${agent}` : sql``;
  const [rows, all] = await Promise.all([
    db.query`
      SELECT s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username, ${COUNTS}
      FROM ai_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai_session_message m ON m.session_id = s.id
      ${where} GROUP BY s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username ORDER BY last_time DESC, s.id DESC LIMIT ${SESSIONS}`,
    db.one`SELECT COUNT(*) FROM ai_session s ${where}`,
  ]);
  const last = await messages(db, rows.map((r) => r.last));
  const models = Map.groupBy(await db.query`SELECT DISTINCT m.session_id, am.name AS model, p.name AS provider
    FROM ai_session_message m ${answeredBy}
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
        <td><small>${last.get(String(s.last))?.role}: ${short(last.get(String(s.last))?.text ?? "")}</small>
        <td>${time(s.last_time)}
        <td>${time(s.time)}`) : html.async`<tr><td colspan=12>${t`No sessions yet`}`}</tbody>`;
}

/** The memories of agent `vars.agent`, the strongest first, with their strength and whether search finds them. */
export async function memories(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, agent = Number(vars.agent) || 0, now = unixTime();
  if (!agent) return html.async`<tr><td>${t`Choose an agent`}`;
  const rows = await db.query`SELECT m.id, m.content, m.time, ${sqlScore(db, "ai_agent_memory_use", { memory_id: sql`m.id` })} AS score,
      EXISTS (SELECT 1 FROM embedding_ai_agent_memory e WHERE e.memory_id = m.id) AS findable
    FROM ai_agent_memory m WHERE m.agent_id = ${agent} ORDER BY score DESC, m.id`;
  // in context: the strongest within IN_MIND characters, as a session takes them
  let used = 0;
  const inMind = rows.map((m) => (used += String(m.content).length) <= IN_MIND);
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Memory`}
      <th title="${t`Current strength; unused memories fade`}">${t`Strength`}
      <th title="${t`The strongest are in the context of a new session, the others only found by search`}">${t`In context`}
      <th title="${t`Embedded: the tool search finds it`}">${t`Findable`}
      <th>${t`When`}
    <tbody>${rows.length ? rows.map((m, i) => html.async`<tr>
      <td>${m.id}
      <td><button type=button class=u2-unstyle data-memory=${m.id} data-content="${m.content}" title="${t`Edit memory`}">${short(String(m.content))}</button>
      <td>${strength(db, "ai_agent_memory_use", Number(m.score), now).toFixed(2)}
      <td>${inMind[i] ? html.async`<u2-ico icon=push_pin title="${t`Included when a session starts`}">📌</u2-ico>` : "–"}
      <td>${Number(m.findable) ? "✓" : "–"}
      <td>${time(m.time)}`) : html.async`<tr><td colspan=6>${t`No memories yet`}`}</tbody>`;
}

/** The tools of agent `vars.agent`, the nearest to its role first, and which a session starts with. */
export async function tools(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const t = node.app.t, list = await new Agent(node.app, Number(vars.agent) || 0).tools().catch(() => []);
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Tool`}
      <th title="${t`How near its description is to the role, by meaning: 1 the same`}">${t`Score`}
      <th title="${t`A session starts with it; the others it finds itself`}">${t`In context`}
      <th>${t`Description`}
    <tbody>${list.length ? list.map(({ tool, score, given, always }, i) => html.async`<tr>
      <td>${always ? "" : i + 1 - list.findIndex((r) => !r.always)}
      <td>${always ? html.async`<small class=u2-badge title="${t`Not of its api paths: every session has it`}">${t`always`}</small> ` : ""}${tool.name}
      <td>${score == null ? "–" : score.toFixed(3)}
      <td>${given ? html.async`<u2-ico icon=push_pin title="${t`Included when a session starts`}">📌</u2-ico>` : "–"}
      <td><small>${short(tool.description)}</small>`) : html.async`<tr><td colspan=5>${t`No tools`}`}</tbody>`;
}

/** All about agent `vars.agent`: what it is, what happened, which models answered for whom. */
export async function agent(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, id = Number(vars.agent) || 0;
  const [[a], models, users] = await Promise.all([
    agentRows(db, id),
    db.query`SELECT am.name AS model, p.name AS provider, COUNT(*) AS answers, MAX(m.time) AS last_time
      FROM ai_session_message m JOIN ai_session s ON s.id = m.session_id ${answeredBy}
      WHERE s.agent_id = ${id} AND mp.id IS NOT NULL GROUP BY am.name, p.name ORDER BY answers DESC`,
    db.query`SELECT s.usr_id, u.username, COUNT(DISTINCT s.id) AS sessions, ${COUNTS}
      FROM ai_session s LEFT JOIN usr u ON u.id = s.usr_id LEFT JOIN ai_session_message m ON m.session_id = s.id
      WHERE s.agent_id = ${id} GROUP BY s.usr_id, u.username ORDER BY last_time DESC`,
  ]);
  if (!a) return html.async`<div>${t`No such agent`}</div>`;
  return html.async`<div>
    <table class=u2-table>
      <tr>
        <th>${t`Created`}
        <td>${time(a.time)}
      <tr>
        <th>${t`Active`}
        <td>${time(a.first_time)} – ${time(a.last_time)}
      <tr>
        <th>${t`Messages`}
        <td>${count(a.messages)}: ${count(a.questions)} ${t`questions`}, ${count(a.answers)} ${t`answers`},
          ${count(a.calls)} ${t`with tool calls`}, ${count(a.errors, true)} ${t`errors`}
      <tr>
        <th>${t`Memories`}
        <td>${count(a.memories)}
    </table>
  </div>
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
  </table>`;
}

/** All about session `vars.session`: who, with which agent, what it was given, which models answered,
 *  all its tools: called, and known (in its model's context). */
export async function session(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, id = Number(vars.session) || 0, url = await pageUrl(node);
  const [s, models, calls, known, given, last, size] = await Promise.all([
    db.row`SELECT s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username, MAX(m.time) AS last_time
      FROM ai_session s LEFT JOIN usr u ON u.id = s.usr_id
      LEFT JOIN ai_session_message m ON m.session_id = s.id
      WHERE s.id = ${id} GROUP BY s.id, s.agent_id, s.usr_id, s.prefer, s.time, u.username`,
    db.query`SELECT am.name AS model, p.name AS provider, COUNT(*) AS answers, MAX(m.time) AS last_time
      FROM ai_session_message m ${answeredBy}
      WHERE m.session_id = ${id} AND mp.id IS NOT NULL GROUP BY am.name, p.name ORDER BY answers DESC`,
    db.col`SELECT message FROM ai_session_message m WHERE m.session_id = ${id} AND m.message LIKE ${'%"toolCalls":[{%'}`,
    new Session(node.app, id).known().catch(() => new Set<string>()),
    db.one`SELECT message FROM ai_session_message m WHERE m.session_id = ${id} AND ${role("start")} ORDER BY m.id DESC LIMIT 1`,
    db.row`SELECT am.name AS model, am.context_length FROM ai_session_message m ${answeredBy} WHERE m.session_id = ${id} AND mp.id IS NOT NULL ORDER BY m.id DESC LIMIT 1`,
    raw(node.app, id).then((sent) => sent.messages.length ? Math.ceil(JSON.stringify(sent).length / 4) : 0).catch(() => 0), // tokens, roughly as ai estimates them
  ]);
  if (!s) return html.async`<div>${t`No such session`}</div>`;
  const used = Map.groupBy(calls.flatMap((json) => JSON.parse(String(json)).toolCalls?.map(called) ?? []), (c: any) => String(c.name));
  // the keys of tools: given as it started, or of its api paths (recalled); the others are memories
  const names = new Set([...JSON.parse(String(given ?? "{}")).tools?.map((tool: any) => tool.name) ?? [],
    ...(await new Agent(node.app, Number(s.agent_id)).allowed()).map((tool) => tool.name)]);
  const tools = [...new Set([...used.keys(), ...names])] // the called first, then the known
    .sort((a, b) => (used.get(b)?.length ?? 0) - (used.get(a)?.length ?? 0) || +known.has(b) - +known.has(a) || a.localeCompare(b));
  return html.async`<div>
    <table class=u2-table>
      <tr>
        <th>${t`Agent`}
        <td>${agentLink(url, s.agent_id)}
      <tr>
        <th title="${t`It acts with this user's rights`}">${t`User`}
        <td>${colored(s.username)} (${s.usr_id})
      <tr>
        <th title="${t`prefer of the session; – is the agent's`}">${t`Model choice`}
        <td>${choice(s.prefer)}
      <tr>
        <th>${t`Started`}
        <td>${time(s.time)}
      <tr>
        <th title="${t`What its model is sent at the next turn, in tokens roughly; of the context of the model that answered last`}">context
        <td>${size ? html`<span style="${last?.context_length && size > Number(last.context_length) ? "color:var(--red)" : ""}">~${kilo(size)}</span>` : "–"}${last?.context_length ? html` / ${kilo(Number(last.context_length))} (${colored(last.model)})` : ""}
      <tr>
        <th>${t`Last active`}
        <td>${time(s.last_time)}${unixTime() - Number(s.last_time) < ACTIVE ? html` <small class=u2-badge>active</small>` : ""}
    </table>
  </div>
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
  <div data-tools><table class="u2-table -Sticky">
    <thead><tr>
      <th>${t`Tools`}
      <th title="${t`How often its model called it`}">called
      <th title="${t`In its model's context now: given as it started, or recalled`}">known
    <tbody>${tools.length ? tools.map((tool) => html`<tr>
      <td>${colored(tool)}
      <td>${count(used.get(tool)?.length)}
      <td>${known.has(tool) ? "✓" : "–"}`) : html.async`<tr><td colspan=3>${t`No tools`}`}</tbody>
  </table></div>
  `;
}

/** One session's conversation, everything it kept: the user on the right, the agent on the left, its
 *  tool calls as buttons which open them with their results. With `after` (a message id) only the messages since;
 *  `data-running` while an answer is on its way. */
export async function conversation(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const rows = await node.app.db.query`SELECT m.id, m.time, m.message, am.name AS model, p.name AS provider
    FROM ai_session_message m ${answeredBy}
    WHERE m.session_id = ${Number(vars.session)} AND m.id > ${Number(vars.after) || 0} ORDER BY m.id`;
  const session = new Session(node.app, Number(vars.session)), running = session.running;
  // what its model is no longer sent (compacted, failures) is faded; what follows along is always sent
  const sent = vars.after ? undefined : await session.sent().catch(() => undefined);
  const unsent = (id: unknown) => sent?.size && !sent.has(Number(id)) ? "data-unsent" : "";
  return html`<div class="u2-flex -Col" ${running ? "data-running" : ""}>${rows.map((row) => { // one message below the other: then align-self puts them left and right
    const m = JSON.parse(String(row.message)), text = textOf(m.content);
    const head = html`<small>${time(row.time)} · ${row.model ? by(row) : m.role}${unsent(row.id) ? " · not sent" : ""}</small>`;
    const box = html`data-message=${row.id} data-role=${m.role} ${unsent(row.id)}`;
    // what the model was given as it started (its role with memories, its tools, prefer), or a note
    const known = [...m.tools?.map((tool: { name: string }) => tool.name) ?? [], ...m.known ?? []];
    if (m.role === "start" || m.role === "system") return html`<div ${box}>${head}${m.prefer ? html` <small>prefer ${JSON.stringify(m.prefer)}</small>` : ""}
      <div data-text><small>${text}</small></div>
      ${known.length ? html`<div><small>known: ${keys(known)}</small></div>` : ""}</div>`;
    if (m.role === "tool") return ""; // shown with its call, in the dialog of the calls
    return html`<div ${box}>
      ${head}
      ${!text ? "" : m.role === "assistant" ? html`<div data-md>${text}</div>` // markdown, rendered by pub/main.js
        : html`<div data-text>${text}</div>`}
      ${m.toolCalls?.length ? html`<div>${m.toolCalls.map(called).map((c: any) => html`<button type=button class=u2-unstyle data-call=${c.id}><small class=u2-badge style="background-color:${uniqueColor(c.name)};color:white">${c.name}</small></button> `)}</div>` : ""}
    </div>`;
  })}</div>`;
}

/** The list of agents and all sessions; with `?agent=` an agent's page, with `?session=` a session's. */
async function render(node: Node) {
  const t = node.app.t, query = getCtx().req.query, url = await pageUrl(node);
  const id = Number(query.agent) || 0, sessionId = Number(query.session) || 0;
  allowMarkdown(); // the answers in a conversation
  if (sessionId) {
    const s = await node.app.db.row`SELECT agent_id, usr_id FROM ai_session WHERE id = ${sessionId}`, agentId = s?.agent_id;
    const vars = { session: sessionId };
    return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>
        <a href="${url}">${t`Agents`}</a> › ${agentId ? html.async`<a href="${backend.toUrl(url, { agent: agentId })}" style="color:${uniqueColor(agentId)}">${t`Agent`} ${agentId}</a> › ` : ""}${t`Session`} ${sessionId}
      </div>
      <div cms-part=session style="display:contents">${session(node, { vars })}</div>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Conversation`} <button type=button data-raw title="${t`What the model is given at the next turn`}">${t`Raw`}</button></div>
      <div cms-part=conversation>${conversation(node, { vars })}</div>
      ${s && Number(s.usr_id) === getCtx().userId ? html.async`<form class=u2-flex data-ask>
        <textarea name=content rows=3 required style="flex:1" placeholder="${t`Enter sends, Shift + Enter makes a new line`}"></textarea>
        <button data-stop="${t`Stop`}">${t`Send`}</button>
      </form>` : ""}
    </div>
  </div>`;
  }
  if (!id) return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`New agent`}</div>${form(node)}</div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Agents`}</div><table class=u2-table cms-part=agents>${agents(node)}</table></div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Sessions`}</div><div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=sessions>${sessions(node)}</table></div></div>
  </div>`;
  const vars = { agent: id };
  const row = await node.app.db.row`SELECT id, name, system, tools, prefer FROM ai_agent WHERE id = ${id}`;
  const edit = row ? {
    id, name: String(row.name ?? ""), system: String(row.system ?? ""), tools: JSON.parse(String(row.tools || "[]")), prefer: JSON.parse(String(row.prefer || "{}")),
  } : undefined;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto; max-width:50rem">
      <div class=-head><a href="${url}">${t`Agents`}</a> › <span style="color:${uniqueColor(id)}">${t`Agent`} ${id}</span> ${row?.name}</div>
      ${edit ? form(node, edit) : ""}
      <div cms-part=agent>${agent(node, { vars })}</div>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Sessions`} <button type=button data-new-session>${t`New session`}</button></div>
      <div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=sessions>${sessions(node, { vars })}</table></div>
    </div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Memories`}</div><div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=memories>${memories(node, { vars })}</table></div></div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Tools`}</div>
      <div style="max-height:60vh; overflow:auto; padding:0">
        <table class=u2-table cms-part=tools>${tools(node, { vars })}</table>
      </div>
      <div style="width:0; min-width:100%; overflow-wrap:anywhere">${t`API paths`}: <small>${node.app.db.one`SELECT tools FROM ai_agent WHERE id = ${id}`.then((tools) => tools || "–")}</small></div>
    </div>
  </div>`;
}

/** The tool calls of the request (everything after a user message) of call `call` in session `id`, in
 *  the order they were made, each with its result. */
async function calls(db: Db, id: number, call: string) {
  const rows = await db.query`SELECT m.id, m.time, m.message FROM ai_session_message m
    WHERE m.session_id = ${id} AND (m.message LIKE ${'%"toolCalls":[{%'} OR ${role("tool")} OR ${role("user")}) ORDER BY m.id`;
  const requests: any[][] = [[]], byId = new Map<string, any>();
  for (const row of rows) {
    const m = JSON.parse(String(row.message));
    if (m.role === "user") requests.push([]);
    else if (m.role === "tool") {
      const call = byId.get(m.id);
      if (call) call.result = JSON.parse(m.content), call.failed = !!call.result?.error;
    } else for (const c of m.toolCalls.map(called)) {
      const call = { id: c.id, step: row.id, time: row.time, name: c.name, color: uniqueColor(c.name), args: c.args };
      byId.set(c.id, call);
      requests.at(-1)!.push(call);
    }
  }
  return requests.find((list) => list.some((c) => c.id === call)) ?? [];
}

/** What the model of session `id` is given at the next turn; none before it was asked, as reading it
 *  would keep what it is given from now on. */
async function raw(app: App, id: number) {
  if (!await app.db.one`SELECT id FROM ai_session_message WHERE session_id = ${id} LIMIT 1`) return { messages: [], tools: [] };
  return new Session(app, id).context();
}

async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (vars.raw) return { ok: true, ...await raw(node.app, Number(vars.raw)) };
  if (vars.calls) return { ok: true, calls: await calls(node.app.db, Number(vars.calls), String(vars.call)) };
  if (vars.run) return { ok: true, result: await toTools(node.app.apiTree).find((t) => t.name === vars.run)?.execute(vars.args ?? {}, getCtx()) };
  if (!vars.preview || typeof vars.preview !== "object") return null;
  const prefer = Object.fromEntries(Object.entries(vars.preview).filter(([, weight]) => typeof weight === "number"));
  const list = await candidates(node.app, "text", { messages: [], tools: [{}] }, { prefer: Object.keys(prefer).length ? prefer : undefined });
  return { ok: true, list: list.slice(0, 5).map((c) => ({ model: c.model, provider: c.provider, rank: Math.round(c.rank * 100) / 100 })) };
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api, parts: { agents, agent, sessions, session, memories, tools, conversation } } };
