import { getCtx, html } from "@qino/qino";
import { candidates } from "@qino/qino/ai";
import { backend } from "@qino/qino/cms.backend";
import { allowMarkdown } from "@qino/qino/cms.backend.ai";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A chat with an agent, all through the api of ai.agent: what a page in the browser can do, it does.

const { name } = manifest;
const { uniqueColor } = backend;
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

async function render(node: Node) {
  const { db, t } = node.app;
  const url = await (await node.page()).url();
  allowMarkdown(); // answers render as markdown
  const agents = await db.query`SELECT id, name, system FROM ai_agent ORDER BY id DESC`;
  const live = (await candidates(node.app, "live", {})).length > 0; // talking needs a live model
  const sessions = await db.query`SELECT s.id, s.agent_id, MAX(m.time) AS last_time,
      (SELECT first.message FROM ai_session_message first
        WHERE first.session_id = s.id AND first.message LIKE ${'{"role":"user"%'} ORDER BY first.id LIMIT 1) AS first_message
    FROM ai_session s LEFT JOIN ai_session_message m ON m.session_id = s.id
    WHERE s.usr_id = ${getCtx().userId} GROUP BY s.id, s.agent_id, s.time
    ORDER BY COALESCE(MAX(m.time), s.time) DESC, s.id DESC`;
  return html.async`<div class=u2-flex>
    <div class="u2-card -agents" style="flex:0 1 25rem;">
      <div class=-head>${t`Chat`}</div>
      <div class="u2-flex -Col" style="flex-wrap:nowrap">
        <form data-start>
          <select name=agent aria-label="${t`Agent`}" required>${agents.map((agent) =>
            html`<option value="${agent.id}">#${agent.id} ${agent.name || String(agent.system ?? "").split("\n", 1)[0].slice(0, 80)}</option>`)}</select>
          <button ${agents.length ? "" : "disabled"}>${t`Start session`}</button>
        </form>
        ${agents.length ? "" : html.async`<p>${t`No agents yet`}`}
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
        <button data-stop="${t`Stop`}">${t`Send`}</button>
        ${live ? html.async`<button type=button data-talk data-end="${t`Hang up`}">${t`Talk`}</button>` : ""}
      </form>
    </div>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], css: ["pub/main.css"], render } };
