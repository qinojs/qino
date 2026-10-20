import { errMsg, html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { call } from "./lib/helper.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Project } from "./host/helper.ts";

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card">
    <div class=-head>
      <span>${t`Projects`}</span>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <u2-table cms-part=list>${list(node)}</u2-table>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const app = node.app;
  const socket = String(await app.settings[manifest.name].socket);
  return call(socket, "list").then(
    (projects) => renderProjects(app, projects as Project[]),
    (e) => html.async`<div>${app.t`The hosting helper does not answer`} (<code>${socket}</code>): ${errMsg(e)}</div>`,
  );
}

export function renderProjects(app: App, projects: Project[]): Promise<HtmlString> {
  return html.async`<table class="u2-table -projects -Sticky">
    <thead><tr>
      <th>${app.t`Project`}
      <th>${app.t`State`}
      <th>${app.t`Domains`}
      <th>${app.t`Listens on`}
      <th class=-num>${app.t`Memory`}
      <th class=-num>${app.t`CPU`}
      <th class=-num>${app.t`Tasks`}
      <th class=-num>${app.t`Disk`}
      <th class=-num>${app.t`Restarts`}
      <th>${app.t`Since`}
    <tbody>${projects.map((p) => renderRow(app, p))}
  </table>`;
}

const STATE_COLOR: Record<string, string> = { active: "var(--green)", failed: "var(--red)", activating: "var(--orange)" };

function renderRow(app: App, p: Project) {
  const bytes = (n: number | null) => n == null ? "–" : html`<u2-bytes>${n}</u2-bytes>`;
  // anything but loopback bypasses the proxy
  const listen = p.listen.map((s) => /^(127\.|\[::1\])/.test(s)
    ? html`<code>${s}</code>`
    : html.async`<span class=u2-badge style="background:var(--red)" title="${app.t`Reachable without the proxy`}">${s}</span>`);
  return html.async`<tr>
    <td><b>${p.name}</b>
    <td><span class=u2-badge style="background:${STATE_COLOR[p.state] ?? "var(--gray)"}">${p.state}</span> <small>${p.sub}</small>
    <td>${p.domains.map((d) => html`<a href="https://${d}/" target=_blank rel=noopener>${d}</a>`)}
    <td>${listen}
    <td class=-num>${bytes(p.memory)}
    <td class=-num>${p.cpu == null ? "–" : html`${p.cpu} %`}
    <td class=-num>${p.tasks ?? "–"}
    <td class=-num>${bytes(p.disk)}
    <td class=-num>${p.restarts ?? "–"}
    <td>${p.since ? u2.el.time(p.since) : "–"}`;
}
