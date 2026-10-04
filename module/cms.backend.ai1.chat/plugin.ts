import { getCtx, html } from "@qino/qino";
import { candidates } from "@qino/qino/ai1";
import { backend } from "@qino/qino/cms.backend";
import { allowMarkdown } from "@qino/qino/cms.backend.ai1";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A chat with an agent, all through the api of ai1.agent: what a page in the browser can do, it does.

const { name } = manifest;
const { uniqueColor } = backend;
const WEIGHTS = ["quality", "cost", "speed"];
const SHORT = 80;

/** The first user message as a short table label. */
function firstMessage(value: unknown): string {
  if (!value) return "–";
  const content = JSON.parse(String(value)).content;
  const text = typeof content === "string" ? content : (content ?? []).map((part: { text?: string }) => part.text ?? "").join(" ");
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SHORT ? line.slice(0, SHORT) + " …" : line || "–";
}

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Chat", de: "Chat" });
}

async function render(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const url = await (await node.page()).url();
  allowMarkdown(); // answers render as markdown
  const agents = await db.query`SELECT id, system, prefer FROM ai1_agent ORDER BY id DESC`;
  const sessions = await db.query`SELECT s.id, s.agent_id, MAX(m.time) AS last_time,
      (SELECT first.message FROM ai1_session_message first
        WHERE first.session_id = s.id AND first.message LIKE ${'{"role":"user"%'} ORDER BY first.id LIMIT 1) AS first_message
    FROM ai1_session s LEFT JOIN ai1_session_message m ON m.session_id = s.id
    WHERE s.usr_id = ${getCtx().userId} GROUP BY s.id, s.agent_id, s.time
    ORDER BY COALESCE(MAX(m.time), s.time) DESC, s.id DESC`;
  return html.async`<div class=u2-flex>
    <div class="u2-card -agents" style="flex:0 1 25rem;">
      <div class=-head>${t`Chat`}</div>
      <div class="u2-flex -Col" style="flex-wrap:nowrap">
        <form data-start>
          <select name=agent aria-label="${t`Agent`}" required>${agents.map((agent) =>
            html`<option value="${agent.id}" data-prefer="${agent.prefer ?? ""}">#${agent.id} ${String(agent.system ?? "").split("\n")[0].slice(0, 80)}</option>`)}</select>
          <fieldset><legend>${t`Model choice for this session`}</legend>
            <div class=u2-table>
              <div>${WEIGHTS.map((key) =>
                html`<label>
                  <span>${key}</span>
                  <input type=range min=0 max=10 value=0 data-prefer data-key="${key}">
                  <output>0</output>
                </label>`)}
              </div>
            </div>
          </fieldset>
          <small>${t`Set to the agent's choice; moved, the session keeps its own.`}</small>
          <div style="margin-block:1rem">
            <small>${t`Who would answer`}</small>
            <ol data-preview></ol>
          </div>
          <button ${agents.length ? "" : "disabled"}>${t`Start session`}</button>
        </form>
        ${agents.length ? "" : html`<p>${t`No agents yet`}`}
      </div>
      <div class=-head>${t`Sessions`}</div>
      <div style="overflow:auto; max-height:30rem; padding:0">
        <table class=u2-table>
          <thead><tr>
            <th>${t`Session`}
            <th>${t`Agent`}
            <th>${t`First message`}
          <tbody data-sessions>${sessions.map((session) => html`<tr u2-href>
            <th><a href="${backend.toUrl(url, { session: session.id })}" data-session="${session.id}">#${session.id}</a>
            <td><span style="color:${uniqueColor(`#${session.agent_id}`)}">#${session.agent_id}</span>
            <td data-first>${firstMessage(session.first_message)}`)}</tbody>
        </table>
      </div>
    </div>
    <div class="u2-card -chat">
      <div class=-head data-title>${t`Chat`}</div>
      <div class="-body u2-flex -Col" style="flex-wrap:nowrap" data-log><small>${t`Start a session with an agent.`}</small></div>
      <form class=u2-flex data-ask hidden>
        <textarea name=content rows=3 required placeholder="${t`Enter sends, Shift + Enter makes a new line`}"></textarea>
        <button>${t`Send`}</button>
        <button type=button data-stop hidden>${t`Stop`}</button>
      </form>
    </div>
  </div>`;
}

/** Who would answer with `preview` as prefer, best first; an agent always has tools. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.preview || typeof vars.preview !== "object") return null;
  const prefer = Object.fromEntries(Object.entries(vars.preview).filter(([, weight]) => typeof weight === "number"));
  const stored = Object.keys(prefer).length ? prefer : JSON.parse(String(await node.app.db.one`SELECT prefer FROM ai1_agent WHERE id = ${Number(vars.agent) || 0}` || "{}"));
  const list = await candidates(node.app, "text", { messages: [], tools: [{}] }, { prefer: Object.keys(stored).length ? stored : undefined });
  return { ok: true, list: list.slice(0, 5).map((c) => ({ model: c.model, provider: c.provider, rank: Math.round(c.rank * 100) / 100 })) };
}

export const cms = { node: { js: ["pub/main.js"], css: ["pub/main.css"], render, api } };
