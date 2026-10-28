// deno-lint-ignore-file no-explicit-any
import { errMsg, getCtx, html, sql } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { apply, sleep } from "@qino/qino/ai.agent.sleep";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const SHORT = 80; // characters of a role in a table
const NIGHTS = 50; // shown, the latest first

const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
const short = (text: string) => text.length > SHORT ? text.slice(0, SHORT) + " …" : text;
const pageUrl = async (node: Node) => (await node.page()).url();
const json = (value: unknown) => value ? JSON.parse(String(value)) : undefined;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Agent sleep", de: "Agenten-Schlaf" });
}

/** A night's stage, in words; a failed one with why. */
function stage(app: App, row: Record<string, unknown>) {
  const t = app.t;
  const words: Record<string, unknown> = { think: t`thinking`, merge: t`merging`, planned: t`plan ready`, applied: t`applied`, failed: t`failed` };
  return row.stage === "failed" ? html.async`<span style="color:var(--red)" title="${row.error}">${words.failed}</span>` : words[String(row.stage)] ?? row.stage;
}

/** What a plan does, counted. */
const summary = (plan: any) => ["add", "merge", "strengthen", "weaken", "forget"].map((k) => `${k} ${plan?.[k]?.length ?? 0}`).join(" · ");

/** The agents: what they keep, how their last night went, what was said since; each can sleep now. */
export async function agents(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const rows = await db.query`SELECT a.id, a.name, a.system,
      (SELECT COUNT(*) FROM ai_agent_memory m WHERE m.agent_id = a.id) AS memories,
      n.time AS night, n.stage, n.error,
      (SELECT COUNT(*) FROM ai_session_message m JOIN ai_session s ON s.id = m.session_id
        WHERE s.agent_id = a.id AND m.id > COALESCE((SELECT MAX(until) FROM ai_agent_sleep w WHERE w.agent_id = a.id AND w.stage <> ${"failed"}), 0)) AS new
    FROM ai_agent a LEFT JOIN ai_agent_sleep n ON n.id = (SELECT MAX(id) FROM ai_agent_sleep l WHERE l.agent_id = a.id)
    ORDER BY a.id`;
  return html.async`
    <thead><tr>
      <th>${t`Agent`}
      <th>${t`Memories`}
      <th title="${t`Messages since it last slept`}">${t`New`}
      <th>${t`Last night`}
      <th>
    <tbody>${rows.length ? rows.map((a) => html.async`<tr>
      <th>${colored(a.id)} ${a.name || short(String(a.system ?? ""))}
      <td>${Number(a.memories) || "–"}
      <td>${Number(a.new) || "–"}
      <td>${a.night ? html.async`${time(a.night)} ${stage(node.app, a)}` : "–"}
      <td><button type=button data-sleep=${a.id} ${Number(a.new) ? "" : "disabled"}>${t`Sleep now`}</button>`) : html.async`<tr><td colspan=5>${t`No agents yet`}`}</tbody>`;
}

/** The latest nights of all agents; a click opens one. */
export async function nights(node: Node): Promise<HtmlString> {
  const { db, t } = node.app, url = await pageUrl(node);
  const rows = await db.query`SELECT n.id, n.agent_id, n.time, n.stage, n.expected, n.plan, n.error,
      (SELECT COUNT(*) FROM ai_agent_sleep_thought h WHERE h.sleep_id = n.id) AS thoughts
    FROM ai_agent_sleep n ORDER BY n.id DESC LIMIT ${NIGHTS}`;
  return html.async`
    <thead><tr>
      <th>${t`Night`}
      <th>${t`Agent`}
      <th>${t`Asleep`}
      <th>${t`Stage`}
      <th title="${t`Thinkers' answers, of all expected`}">${t`Thoughts`}
      <th>${t`Plan`}
    <tbody>${rows.length ? rows.map((n) => html.async`<tr u2-href>
      <th><a href="${backend.toUrl(url, { night: n.id })}">${n.id}</a>
      <td>${colored(n.agent_id)}
      <td>${time(n.time)}
      <td>${stage(node.app, n)}
      <td>${Number(n.thoughts)} / ${Number(n.expected)}
      <td>${n.plan ? html`<small>${summary(json(n.plan))}</small>` : "–"}`) : html.async`<tr><td colspan=6>${t`Not slept yet`}`}</tbody>`;
}

/** Night `vars.night`: how far it got, its plan in words, and what each thinker thought, per session. */
export async function night(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app, id = Number(vars.night) || 0, url = await pageUrl(node);
  const head = html.async`<div class=-head><a href="${url}">${t`Agent sleep`}</a> › ${t`Night`} ${id}</div>`;
  const n = await db.row`SELECT id, agent_id, time, until, stage, expected, plan, error FROM ai_agent_sleep WHERE id = ${id}`;
  if (!n) return html.async`<div class=u2-card style="flex:0 1 auto">${head}<div>${t`No such night`}</div></div>`;
  const plan = json(n.plan) ?? {};
  const thoughts = await db.query`SELECT item, output FROM ai_agent_sleep_thought WHERE sleep_id = ${id} ORDER BY item`;
  // the memories the plan and the thoughts name, as they are now (gone once forgotten or merged)
  const ids = [...plan.merge?.flatMap((m: any) => m.ids) ?? [], ...plan.strengthen ?? [], ...plan.weaken ?? [], ...plan.forget ?? [],
    ...thoughts.flatMap((r) => { const o = json(r.output); return [...o.confirmed ?? [], ...o.outdated ?? []].map((c: any) => c.id); })].map(Number);
  const known = new Map((await db.query`SELECT id, content FROM ai_agent_memory WHERE ${sql.in("id", [0, ...ids])}`).map((m) => [Number(m.id), String(m.content)]));
  const memory = (mid: unknown) => html`<li><code>${mid}</code> ${known.get(Number(mid)) ?? html`<i>${"–"}</i>`}`;
  const list = (title: unknown, items: unknown[]) => items.length ? html.async`<b>${title}</b><ul>${items}</ul>` : "";
  return html.async`<div class=u2-card style="flex:0 1 auto">
    ${head}
    <table class=u2-table>
      <tr>
        <th>${t`Agent`}
        <td>${colored(n.agent_id)}
      <tr>
        <th>${t`Asleep`}
        <td>${time(n.time)}
      <tr>
        <th>${t`Stage`}
        <td>${stage(node.app, n)} ${n.error ? html`<small>${n.error}</small>` : ""}
      <tr>
        <th>${t`Thoughts`}
        <td>${thoughts.length} / ${Number(n.expected)}
    </table>
    ${n.stage === "planned" ? html.async`<div><button type=button data-apply=${id}>${t`Apply the plan`}</button></div>` : ""}
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Plan`}</div>
      ${n.plan ? html.async`
        ${list(t`Add`, (plan.add ?? []).map((a: any) => html`<li>${a.content} <small>session ${a.session}</small>`))}
        ${list(t`Merge`, (plan.merge ?? []).map((m: any) => html`<li>${m.content}<ul>${m.ids.map(memory)}</ul>`))}
        ${list(t`Strengthen`, (plan.strengthen ?? []).map(memory))}
        ${list(t`Weaken`, (plan.weaken ?? []).map(memory))}
        ${list(t`Forget`, (plan.forget ?? []).map(memory))}` : html.async`<div>${t`No plan yet`}</div>`}
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Thoughts`}</div>
      ${thoughts.length ? thoughts.map((r) => {
        const [, , session, thinker] = String(r.item).split(":"), o = json(r.output);
        const cited = (list: any[] = []) => list.map((c: any) => html`<li>${c.content ?? html`<code>${c.id}</code> ${known.get(Number(c.id)) ?? ""}`} <small>#${(c.evidence ?? []).join(", #")}</small>`);
        return html.async`<details>
          <summary>${t`Session`} ${session} · ${t`thinker`} ${Number(thinker) + 1} ${o.error ? html`<span style="color:var(--red)">${o.error}</span>` : html`<small>${o.missed?.length ?? 0} / ${o.confirmed?.length ?? 0} / ${o.outdated?.length ?? 0}</small>`}</summary>
          ${o.error ? "" : html.async`${list(t`Missed`, cited(o.missed))}${list(t`Confirmed`, cited(o.confirmed))}${list(t`Outdated`, cited(o.outdated))}`}
        </details>`;
      }) : html.async`<div>${t`No thoughts yet`}</div>`}
    </div>`;
}

/** The agents and the latest nights; with `?night=` one night. */
async function render(node: Node) {
  const t = node.app.t, id = Number(getCtx().req.query.night) || 0;
  if (id) return html.async`<div class=u2-flex cms-part=night>${night(node, { vars: { night: id } })}</div>`;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Agents`}</div><table class=u2-table cms-part=agents>${agents(node)}</table></div>
    <div class=u2-card style="flex:0 1 auto"><div class=-head>${t`Nights`}</div><table class=u2-table cms-part=nights>${nights(node)}</table></div>
  </div>`;
}

/** Let agent `sleep` sleep now, as who asks; carry out night `apply`'s plan. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    if (vars.sleep) return { ok: true, asleep: await sleep(node.app, Number(vars.sleep)) };
    if (vars.apply) return (await apply(node.app, Number(vars.apply)), { ok: true });
    return null;
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { agents, nights, night } } };
