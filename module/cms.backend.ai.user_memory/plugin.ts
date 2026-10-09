// deno-lint-ignore-file no-explicit-any
import { errMsg, getCtx, html, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { IN_MIND, personal } from "@qino/qino/ai1.user_memory";
import { sqlScore, strength } from "@qino/qino/score";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const LIMIT = 200;

/** In its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const count = (value: unknown) => Number(value) || "–";
const pageUrl = async (node: Node) => (await node.page()).url();
/** The link to a user's page: their id and name. */
const userLink = (url: string, id: unknown, username: unknown) => html`<a href="${backend.toUrl(url, { usr: id })}">${id}</a> ${colored(username)}`;
const remove = (id: unknown) => html`<button type=button class=u2-unstyle data-remove="${id}" title=remove><u2-ico icon=delete>✕</u2-ico></button>`;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "User memories", de: "Benutzer-Memories" });
}

/** The users agents keep something about or talk with, the most recently active first; a click opens their page. */
export async function users(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node);
  const rows = await db.query`
    SELECT u.id, u.username,
      (SELECT COUNT(*) FROM ai1_user_memory WHERE usr_id = u.id) AS memories,
      (SELECT MAX(time) FROM ai1_user_memory WHERE usr_id = u.id) AS memory_time,
      (SELECT COUNT(*) FROM ai1_session WHERE usr_id = u.id) AS sessions,
      (SELECT COUNT(DISTINCT agent_id) FROM ai1_session WHERE usr_id = u.id) AS agents,
      (SELECT MAX(m.time) FROM ai1_session_message m JOIN ai1_session s ON s.id = m.session_id WHERE s.usr_id = u.id) AS last_time
    FROM usr u WHERE u.id IN (SELECT usr_id FROM ai1_user_memory UNION SELECT usr_id FROM ai1_session)
    ORDER BY last_time DESC, memory_time DESC, u.id DESC LIMIT ${LIMIT}`;
  return html.async`
    <thead><tr>
      <th>${t`User`}
      <th>${t`Memories`}
      <th>${t`Last memory`}
      <th>${t`Sessions`}
      <th>${t`Agents`}
      <th>${t`Last active`}
    <tbody>${rows.length ? rows.map((u) => html`<tr u2-href>
      <th>${userLink(url, u.id, u.username)}
      <td>${count(u.memories)}
      <td>${time(u.memory_time)}
      <td>${count(u.sessions)}
      <td>${count(u.agents)}
      <td>${time(u.last_time)}`) : html.async`<tr><td colspan=6>${t`No users yet`}`}</tbody>`;
}

/** What agents keep about users, the newest first. */
export async function list(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node);
  const rows = await db.query`SELECT m.id, m.usr_id, m.content, m.time, u.username
    FROM ai1_user_memory m LEFT JOIN usr u ON u.id = m.usr_id ORDER BY m.id DESC LIMIT ${LIMIT}`;
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`User`}
      <th>${t`Memory`}
      <th>${t`When`}
      <th>
    <tbody>${rows.length ? rows.map((m) => html`<tr>
      <td>${m.id}
      <td>${userLink(url, m.usr_id, m.username)}
      <td>${m.content}
      <td>${time(m.time)}
      <td>${remove(m.id)}`) : html.async`<tr><td colspan=5>${t`No memories yet`}`}</tbody>`;
}

/** The memories of user `vars.usr`, the strongest first: which are in an agent's context, which search finds. */
export async function memories(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, usr = Number(vars.usr) || 0, now = unixTime();
  const rows = await db.query`SELECT m.id, m.content, m.time, ${sqlScore(db, "ai1_user_memory", "m.id")} AS score,
      EXISTS (SELECT 1 FROM embedding_ai1_user_memory e WHERE e.memory_id = m.id) AS findable
    FROM ai1_user_memory m WHERE m.usr_id = ${usr} ORDER BY score DESC, m.id`;
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Memory`}
      <th title="${t`As stored (score); kept again or recalled it grows`}">${t`Score`}
      <th title="${t`The score now: unused it fades`}">${t`Strength`}
      <th title="${t`The strongest are in the context of every session, the others only come to mind when close to what is said`}">${t`In context`}
      <th title="${t`Embedded: what the user says brings it to mind`}">${t`Findable`}
      <th>${t`When`}
      <th>
    <tbody>${rows.length ? rows.map((m, i) => html`<tr>
      <td>${m.id}
      <td>${m.content}
      <td>${m.score}
      <td>${strength(db, "ai1_user_memory", Number(m.score), now).toFixed(2)}
      <td>${i < IN_MIND ? "✓" : "–"}
      <td>${Number(m.findable) ? "✓" : "–"}
      <td>${time(m.time)}
      <td>${remove(m.id)}`) : html.async`<tr><td colspan=8>${t`No memories yet`}`}</tbody>`;
}

/** The sessions of user `vars.usr`, the latest first; linked to their page in the agents backend. */
export async function sessions(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, usr = Number(vars.usr) || 0;
  const agents = await backend.toModuleUrl(node, "cms.backend.ai1.agents");
  const rows = await db.query`SELECT s.id, s.agent_id, s.time, COUNT(m.id) AS messages, MAX(m.time) AS last_time
    FROM ai1_session s LEFT JOIN ai1_session_message m ON m.session_id = s.id
    WHERE s.usr_id = ${usr} GROUP BY s.id, s.agent_id, s.time ORDER BY last_time DESC, s.id DESC LIMIT ${LIMIT}`;
  const link = (params: Record<string, unknown>, text: unknown) => agents(params) ? html`<a href="${agents(params)}">${text}</a>` : text;
  return html.async`
    <thead><tr>
      <th>${t`Session`}
      <th>${t`Agent`}
      <th>${t`Messages`}
      <th>${t`Last active`}
      <th>${t`Started`}
    <tbody>${rows.length ? rows.map((s) => html`<tr u2-href>
      <th>${link({ session: s.id }, s.id)}
      <td>${link({ agent: s.agent_id }, colored(s.agent_id))}
      <td>${count(s.messages)}
      <td>${time(s.last_time)}
      <td>${time(s.time)}`) : html.async`<tr><td colspan=5>${t`No sessions yet`}`}</tbody>`;
}

/** The users and the latest memories; with `?usr=` a user's page. */
async function render(node: Node) {
  const { db, t } = node.app, usr = Number(getCtx().req.query.usr) || 0;
  if (usr) {
    const vars = { usr }, username = await db.one`SELECT username FROM usr WHERE id = ${usr}`;
    return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head><a href="${pageUrl(node)}">${t`User memories`}</a> › ${t`User`} ${usr} ${colored(username)}</div>
      <table class=u2-table cms-part=memories>${memories(node, { vars })}</table>
    </div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Sessions`}</div><table class=u2-table cms-part=sessions>${sessions(node, { vars })}</table></div>
  </div>`;
  }
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Users`}</div><table class=u2-table cms-part=users>${users(node)}</table></div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Latest memories`}</div><table class=u2-table cms-part=list>${list(node)}</table></div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Try decide`}</div>
      <form class=u2-flex data-try>
        <input name=content required placeholder="${t`A memory, e.g. always answer in German`}">
        <button>${t`Decide`}</button>
      </form>
      <output></output>
    </div>
  </div>`;
}

/** Remove a memory; or how decide() sorts `decide`. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    if (vars.remove) return (await node.app.db.table("ai1_user_memory").delete(Number(vars.remove)), { ok: true });
    if (vars.decide) return { ok: true, result: await personal(node.app, String(vars.decide)) };
    return null;
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { users, list, memories, sessions } } };
