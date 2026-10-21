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
  const socket = String(await app.settings[manifest.name].socket);
  return call(socket, "list").then(
    (data) => renderList(app, data as List),
    (e) => html.async`<div class=u2-card>
      <div class=-head><span>${app.t`Projects`}</span></div>
      <div>${app.t`The hosting helper does not answer`} (<code>${socket}</code>): ${errMsg(e)}</div>
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
  return html.async`<div class=u2-card>
    <div class=-head>
      <span>${app.t`Projects`}</span>
      <button type=button data-refresh>${app.t`Refresh`}</button>
    </div>
    <form class=-create>
      <input name=domain required placeholder="example.com" aria-label="${app.t`Domain`}">
      <select name=template aria-label="${app.t`Template`}">${server.templates.map((t) => html`<option>${t}</option>`)}</select>
      <button>${app.t`Create project`}</button>
    </form>
    <u2-table><table class="u2-table -projects -Sticky">
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
        <th>
      <tbody>${projects.map((p) => renderRow(app, p, p.name === server.self, server.preview ?? ""))}
      <tfoot><tr>
        <th colspan=4>${projects.length} ${app.t`projects`}
        <td class=-num>${bytes(sum(projects, "memory"))}
        <td class=-num>${sum(projects, "cpu")} %
        <td class=-num>${sum(projects, "tasks")}
        <td class=-num>${bytes(sum(projects, "disk"))}
        <td colspan=3>
    </table></u2-table>
  </div>
  <div class=u2-card>
    <div class=-head><span>${app.t`Overview`}</span></div>
    <u2-table><table class="u2-table -server">
      <thead><tr>
        <th>
        <th>
        <th class=-num>${app.t`Projects`}
        <th class=-num>${app.t`Used`}
        <th class=-num>${app.t`Free`}
        <th class=-num>${app.t`Total`}
      <tbody>
        <tr>
          <th>${app.t`Memory`}
          <td>${meter(memory.total - memory.available, memory.total)}
          <td class=-num>${bytes(sum(projects, "memory"))}
          <td class=-num>${bytes(memory.total - memory.available)}
          <td class=-num>${bytes(memory.available)}
          <td class=-num>${bytes(memory.total)}
        <tr>
          <th>${app.t`Disk`}
          <td>${meter(disk.total - disk.available, disk.total)}
          <td class=-num>${bytes(sum(projects, "disk"))}
          <td class=-num>${bytes(disk.total - disk.available)}
          <td class=-num>${bytes(disk.available)}
          <td class=-num>${bytes(disk.total)}
        <tr>
          <th>${app.t`CPU`}
          <td>${meter(Math.min(server.load[0], server.cpus), server.cpus)}
          <td class=-num>${sum(projects, "cpu")} %
          <td class=-num>${server.load.map((l) => l.toFixed(2)).join(" ")}
          <td>
          <td class=-num>${server.cpus} ${app.t`cores`}
    </table></u2-table>
  </div>`;
}

const STATE_COLOR: Record<string, string> = { active: "var(--green)", failed: "var(--red)", activating: "var(--orange)" };

/** Each domain as a link; its preview address, if served, as an icon beside it. */
function domains(app: App, all: string[], preview: string) {
  const isPreview = (d: string) => !!preview && d.endsWith(`.${preview}`);
  return all.filter((d) => !isPreview(d)).map((d) => {
    const alias = `${d}.${preview}`;
    const link = preview && all.includes(alias)
      ? html.async` <a href="https://${alias}/" target=_blank rel=noopener title="${app.t`Preview Link`}"><u2-ico icon=visibility>👁</u2-ico></a>`
      : "";
    return html.async`<span><a href="https://${d}/" target=_blank rel=noopener>${d}</a>${link}</span>`;
  });
}

function renderRow(app: App, p: Project, self: boolean, preview: string) {
  // anything but loopback bypasses the proxy
  const listen = p.listen.map((s) => /^(127\.|\[::1\])/.test(s)
    ? html`<code>${s}</code>`
    : html.async`<span class=u2-badge style="background:var(--red)" title="${app.t`Reachable without the proxy`}">${s}</span>`);
  const button = (verb: string, label: Promise<string>, confirm?: Promise<string>) =>
    html.async`<button type=button data-verb=${verb} data-name="${p.name}" ${confirm ? html.async`u2-confirm="${confirm}"` : ""}>${label}</button>`;
  const running = p.state === "active" || p.state === "activating";
  const actions = self ? [] : running
    ? [button("restart", app.t`Restart`, app.t`Restart this project?`), button("stop", app.t`Stop`, app.t`Stop this project?`)]
    : [button("start", app.t`Start`)];
  return html.async`<tr>
    <td><b>${p.name}</b>
    <td><small class=u2-badge style="background:${STATE_COLOR[p.state] ?? "var(--gray)"}">${p.sub}</small>
    <td>${domains(app, p.domains, preview)}
    <td>${listen}
    <td class=-num>${bytes(p.memory)}
    <td class=-num>${p.cpu == null ? "–" : html`${p.cpu} %`}
    <td class=-num>${p.tasks ?? "–"}
    <td class=-num>${bytes(p.disk)}
    <td class=-num>${p.restarts ?? "–"}
    <td>${p.since ? u2.el.time(p.since) : "–"}
    <td class=-actions>${actions}${button("log", app.t`Log`)}${self ? "" : button("delete", app.t`Delete`,
      app.t`Stop the project and move it into the archive? Its domain goes offline.`)}`;
}
