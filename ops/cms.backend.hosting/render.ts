import { errMsg, html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { call } from "./lib/helper.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { List, Project } from "./host/helper.ts";

/** Both cards come from one call of the helper, so they are one part. */
export function render(node: Node): Promise<HtmlString> {
  return html.async`<div><div class=u2-flex cms-part=list>${list(node)}</div></div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const socket = String(await app.settings[manifest.name].socket);
  return call(socket, "list").then(
    (data) => renderList(app, data as List),
    (e) => html.async`<div class=u2-card>
      <div class=-head><span>${t`Projects`}</span></div>
      <div>${t`The hosting helper does not answer`} (<code>${socket}</code>): ${errMsg(e)}</div>
    </div>`,
  );
}

const bytes = (n: number | null | undefined) => n == null ? "–" : html`<u2-bytes>${n}</u2-bytes>`;
/** How full: turns to the warning colour above 80 %. */
const meter = (used: number, total: number) =>
  html`<meter min=0 max="${total}" value="${used}" high="${total * .8}" optimum=0 title="${Math.round(used / total * 100)} %"></meter>`;
const sum = (projects: Project[], key: "memory" | "cpu" | "tasks" | "disk") =>
  projects.reduce((all, p) => all + (p[key] ?? 0), 0);

export function renderList(app: App, { server, projects }: List): Promise<HtmlString> {
  const { memory, disk } = server;
  const t = app.t;
  return html.async`<div class=u2-card>
    <div class=-head>
      <span>${t`Projects`}</span>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <form class=-create>
      <input name=domain required placeholder="example.com" aria-label="${t`Domain`}">
      <select name=template aria-label="${t`Template`}">${server.templates.map((name) => html`<option>${name}</option>`)}</select>
      <button>${t`Create project`}</button>
    </form>
    <u2-table><table class="u2-table -projects -Sticky">
      <thead><tr>
        <th>${t`Project`}
        <th>${t`Program`}
        <th>${t`State`}
        <th>${t`Domains`}
        <th>${t`Listens on`}
        <th class=-num>${t`Memory`}
        <th class=-num>${t`CPU`}
        <th class=-num>${t`Tasks`}
        <th class=-num>${t`Disk`}
        <th class=-num>${t`Restarts`}
        <th>${t`Since`}
        <th>
      <tbody>${projects.map((p) => renderRow(app, p, p.name === server.self, server.preview ?? ""))}
      <tfoot><tr>
        <th colspan=5>${projects.length} ${t`projects`}
        <td class=-num>${bytes(sum(projects, "memory"))}
        <td class=-num>${sum(projects, "cpu")} %
        <td class=-num>${sum(projects, "tasks")}
        <td class=-num>${bytes(sum(projects, "disk"))}
        <td colspan=3>
    </table></u2-table>
  </div>
  <div class=u2-card>
    <div class=-head><span>${t`Overview`}</span></div>
    <u2-table><table class="u2-table -server">
      <thead><tr>
        <th>
        <th>
        <th class=-num>${t`Projects`}
        <th class=-num>${t`Used`}
        <th class=-num>${t`Free`}
        <th class=-num>${t`Total`}
      <tbody>
        <tr>
          <th>${t`Memory`}
          <td>${meter(memory.total - memory.available, memory.total)}
          <td class=-num>${bytes(sum(projects, "memory"))}
          <td class=-num>${bytes(memory.total - memory.available)}
          <td class=-num>${bytes(memory.available)}
          <td class=-num>${bytes(memory.total)}
        <tr>
          <th>${t`Disk`}
          <td>${meter(disk.total - disk.available, disk.total)}
          <td class=-num>${bytes(sum(projects, "disk"))}
          <td class=-num>${bytes(disk.total - disk.available)}
          <td class=-num>${bytes(disk.available)}
          <td class=-num>${bytes(disk.total)}
        <tr>
          <th>${t`CPU`}
          <td>${meter(Math.min(server.load[0], server.cpus), server.cpus)}
          <td class=-num>${sum(projects, "cpu")} %
          <td class=-num>${server.load.map((l) => l.toFixed(2)).join(" ")}
          <td>
          <td class=-num>${server.cpus} ${t`cores`}
    </table></u2-table>
  </div>`;
}

const STATE_COLOR: Record<string, string> = { active: "var(--green)", failed: "var(--red)", activating: "var(--orange)" };

/** Each domain as a link; its preview address, if served, as an icon beside it. */
function domains(app: App, all: string[], preview: string) {
  const t = app.t;
  const isPreview = (d: string) => !!preview && d.endsWith(`.${preview}`);
  return all.filter((d) => !isPreview(d)).map((d) => {
    const alias = `${d}.${preview}`;
    const link = preview && all.includes(alias)
      ? html.async` <a href="https://${alias}/" target=_blank rel=noopener title="${t`Preview Link`}"><u2-ico icon=visibility>👁</u2-ico></a>`
      : "";
    return html.async`<span><a href="https://${d}/" target=_blank rel=noopener>${d}</a>${link}</span>`;
  });
}

function renderRow(app: App, p: Project, self: boolean, preview: string) {
  const t = app.t;
  // anything but loopback bypasses the proxy
  const listen = p.listen.map((s) => /^(127\.|\[::1\])/.test(s)
    ? html`<code>${s}</code>`
    : html.async`<span class=u2-badge style="background:var(--red)" title="${t`Reachable without the proxy`}">${s}</span>`);
  const button = (verb: string, label: Promise<string>, confirm?: Promise<string>) =>
    html.async`<button type=button data-verb=${verb} data-name="${p.name}" ${confirm ? html.async`u2-confirm="${confirm}"` : ""}>${label}</button>`;
  const running = p.state === "active" || p.state === "activating";
  const actions = self ? [] : running
    ? [button("restart", t`Restart`, t`Restart this project?`), button("stop", t`Stop`, t`Stop this project?`)]
    : [button("start", t`Start`)];
  return html.async`<tr>
    <td><b>${p.name}</b>
    <td>${p.program ?? "–"}
    <td><small class=u2-badge style="background:${STATE_COLOR[p.state] ?? "var(--gray)"}">${p.sub}</small>
    <td>${domains(app, p.domains, preview)}
    <td>${listen}
    <td class=-num>${bytes(p.memory)}
    <td class=-num>${p.cpu == null ? "–" : html`${p.cpu} %`}
    <td class=-num>${p.tasks ?? "–"}
    <td class=-num>${bytes(p.disk)}
    <td class=-num>${p.restarts ?? "–"}
    <td>${p.since ? u2.el.time(p.since) : "–"}
    <td class=-actions>${actions}${button("log", t`Log`)}${self ? "" : button("delete", t`Delete`,
      t`Stop the project and move it into the archive? Its domain goes offline.`)}`;
}
