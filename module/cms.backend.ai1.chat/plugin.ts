import { getCtx, html, walk } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { ApiTree, App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A chat with an agent, all through the api of ai1.agent: what a page in the browser can do, it does.

const { name } = manifest;

/** What pub/main.js renders answers with: markdown, then sanitized. */
const LIBS = ["https://cdn.jsdelivr.net/npm/marked@18/+esm", "https://cdn.jsdelivr.net/npm/dompurify@3/+esm"];

/** The paths of the api an agent may use as tools, down to the second level, with how many tools each gives. */
function paths(tree: ApiTree): [string, number][] {
  const count = new Map<string, number>();
  for (const { segments } of walk(tree)) {
    const path: string[] = [];
    for (const segment of segments.slice(0, 2)) {
      if (segment.startsWith(":")) break;
      path.push(segment);
      count.set(path.join("/"), (count.get(path.join("/")) ?? 0) + 1);
    }
  }
  return [...count].sort(([a], [b]) => a.localeCompare(b));
}

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Chat", de: "Chat" });
}

async function render(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  for (const url of LIBS) getCtx().res.csp["script-src"][url] = true;
  const agents = await db.query`SELECT id, system FROM ai1_agent ORDER BY id DESC`;
  return html.async`<div class=u2-card>
    <form class=u2-flex data-start>
      <select name=agent><option value="">${t`New agent`}${agents.map((a) => html`<option value="${a.id}">#${a.id} ${String(a.system ?? "").split("\n")[0].slice(0, 60)}`)}</select>
      <textarea name=system rows=2 placeholder="${t`Role`}"></textarea>
      <details><summary>${t`Tools`}</summary><div style="overflow:auto;max-height:15rem">${paths(node.app.apiTree).map(([path, tools]) =>
        html`<label><input type=checkbox name=tools value="${path}"> ${path} <small>(${tools})</small></label><br>`)}</div></details>
      <button>${t`Start session`}</button>
    </form>
    <div data-log style="overflow:auto"></div>
    <form class=u2-flex data-ask hidden>
      <textarea name=content rows=3 required placeholder="${t`Ctrl/⌘ + Enter sends`}"></textarea>
      <button>${t`Send`}</button>
    </form>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render } };
