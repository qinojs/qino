import { html, walk } from "@qino/qino";
import { candidates } from "@qino/qino/ai1";
import { backend } from "@qino/qino/cms.backend";
import { allowMarkdown } from "@qino/qino/cms.backend.ai1";

import manifest from "./manifest.json" with { type: "json" };

import type { ApiTree, App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A chat with an agent, all through the api of ai1.agent: what a page in the browser can do, it does.

const { name } = manifest;
const { uniqueColor } = backend;

const WEIGHTS = ["quality", "cost", "speed"];

type Agent = { id?: number; system?: string; tools?: string[]; prefer?: Record<string, number> };

type Branch = { count: number; below: Map<string, Branch> };

/** The paths of the api an agent may use as tools, as a tree down to the first param, with how many tools each gives. */
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

/** A path with all below it, checked when it or a path above is among `chosen` (u2-tree tristate). */
const branches = (branch: Branch, chosen: string[], above = ""): HtmlString[] =>
  [...branch.below].sort(([a], [b]) => a.localeCompare(b)).map(([segment, sub]) => {
    const path = above + segment, checked = chosen.some((c) => path === c || path.startsWith(c + "/"));
    return html`<u2-tree${above ? "" : " tristate"}><input type=checkbox slot=icon name=tools value="${path}" ${checked ? "checked" : ""}> ${segment} <small>(${sub.count})</small>${
      branches(sub, chosen, path + "/")}</u2-tree>`;
  });

const sliders = (scope: string, values: Record<string, number> = {}) => html`<div class=u2-flex>${WEIGHTS.map((key) =>
  html`<label>${key} <input type=range min=0 max=10 value="${values[key] ?? 0}" data-prefer="${scope}" data-key="${key}"> <output>${values[key] ?? 0}</output></label>`)}</div>`;

/** One agent to change and start a session with, or a new one. */
function form(node: Node, tools: Branch, agent: Agent = {}): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<form class="u2-flex -Col" style="flex-wrap:nowrap" data-agent="${agent.id ?? ""}">
    <textarea name=system rows=6 placeholder="${t`Role`}">${agent.system ?? ""}</textarea>
    <details><summary>${t`Tools`}: <small>${agent.tools?.join(", ") || "–"}</small></summary><div style="overflow:auto;max-height:15rem">${branches(tools, agent.tools ?? [])}</div></details>
    <fieldset><legend>${t`Model`}</legend>${sliders("agent", agent.prefer)}</fieldset>
    <fieldset><legend>${t`This session`}</legend>${sliders("session")}</fieldset>
    <small>${t`All at 0: the agent's choice, for the agent the default.`}</small>
    <div><small>${t`Who would answer`}</small><ol data-preview></ol></div>
    <div class=u2-flex>
      <button name=save>${agent.id ? t`Save` : t`Create`}</button>
      <button name=start>${t`Start session`}</button>
    </div>
  </form>`;
}

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Chat", de: "Chat" });
}

async function render(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  allowMarkdown(); // answers render as markdown
  const tools = paths(node.app.apiTree);
  const agents = (await db.query`SELECT id, system, tools, prefer FROM ai1_agent ORDER BY id DESC`).map((a) => ({
    id: Number(a.id), system: String(a.system ?? ""), tools: JSON.parse(String(a.tools || "[]")), prefer: JSON.parse(String(a.prefer || "{}")),
  }));
  return html.async`<div class=u2-flex>
    <div class="u2-card -agents">
      <div class=-head>${t`Agents`}</div>
      <div class="-body u2-flex -Col" style="flex-wrap:nowrap">
        ${agents.length ? agents.map((agent) => html.async`<details>
          <summary><span style="color:${uniqueColor(`#${agent.id}`)}">#${agent.id}</span> ${agent.system.split("\n")[0].slice(0, 80)}</summary>${form(node, tools, agent)}</details>`) : html.async`<p>${t`No agents yet`}`}
        <details><summary>+ ${t`New agent`}</summary>${form(node, tools)}</details>
      </div>
    </div>
    <div class="u2-card -chat">
      <div class=-head data-title>${t`Chat`}</div>
      <div class="-body u2-flex -Col" style="flex-wrap:nowrap" data-log><small>${t`Start a session with an agent.`}</small></div>
      <form class=u2-flex data-ask hidden>
        <textarea name=content rows=3 required placeholder="${t`Ctrl/⌘ + Enter sends`}"></textarea>
        <button>${t`Send`}</button>
      </form>
    </div>
  </div>`;
}

/** Who would answer with `preview` as prefer, best first; an agent always has tools. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.preview || typeof vars.preview !== "object") return null;
  const prefer = Object.fromEntries(Object.entries(vars.preview).filter(([, weight]) => typeof weight === "number"));
  const list = await candidates(node.app, "text", { messages: [], tools: [{}] }, { prefer: Object.keys(prefer).length ? prefer : undefined });
  return { ok: true, list: list.slice(0, 5).map((c) => ({ model: c.model, provider: c.provider, rank: Math.round(c.rank * 100) / 100 })) };
}

export const cms = { node: { js: ["pub/main.js"], css: ["pub/main.css"], render, api } };
