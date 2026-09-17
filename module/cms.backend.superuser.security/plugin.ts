import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { BLOCK, HALF, release, reports, suspects } from "@qino/qino/security";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Security", de: "Sicherheit" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const all = suspects(app);
  const blocked = all.filter((s) => s.blocked).length;
  return html.async`<div class=-body>
    <b>${blocked}</b> ${app.t`blocked`} · ${all.length - blocked} ${app.t`delayed`}
  </div>`;
}

function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card">
    <div class=-head>
      <span>${t`Security`}</span>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <div cms-part=list>${list(node, { ctx })}</div>
  </div>`;
}

async function list(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  // IP → request log of that IP; plain text when the log page is not installed
  const logUrl = await (await (await node.cms.nodeByModule("cms.backend.superuser.requests.log"))?.page())?.url();
  const ip = (value: string) => {
    if (!logUrl) return html`<code>${value}</code>`;
    const url = new URL(logUrl, ctx.req.url.origin);
    url.searchParams.set("search", value);
    return html`<a href="${url.href}"><code>${value}</code></a>`;
  };
  const ips = await Promise.all(suspects(app).map((s) => html.async`<tr>
      <td>${ip(s.ip)}
      <td>${s.strength < 10 ? s.strength.toFixed(1) : Math.round(s.strength)}
      <td>${s.blocked ? html.async`<span class=u2-badge>${t`blocked`}</span> ${duration(s.blocked)}` : `${Math.round(s.delay)} ms`}
      <td>${time(s.time)}
      <td><button type=button data-release="${s.ip}">${t`Release`}</button>`));
  const recent = reports(app).map((r) => html`<tr>
      <td>${time(r.time)}
      <td>${ip(r.ip)}
      <td>${r.weight}
      <td>${r.reason}`);

  return html.async`<div class=-body>
    ${t`Each report adds its weight to the IP; the strength halves every`} ${duration(HALF)}.
    ${t`Answers wait strength² ms, from`} ${BLOCK} ${t`on they are refused.`}
  </div>
  ${ips.length ? html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>IP
      <th>${t`Strength`}
      <th>${t`Effect`}
      <th>${t`Last report`}
      <th>
    <tbody>${ips}
  </table>` : html.async`<div class=-body>${t`No suspicious IPs.`}</div>`}
  <div class=-body><b>${t`Recent reports`}</b> <small>${t`since the last restart`}</small></div>
  ${recent.length ? html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>${t`Time`}
      <th>IP
      <th>${t`Weight`}
      <th>${t`Reason`}
    <tbody>${recent}
  </table>` : html.async`<div class=-body>${t`No reports yet.`}</div>`}`;
}

async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (typeof vars.release !== "string") return false;
  await release(node.app, vars.release);
  return { ok: true, message: `${vars.release} ${await node.app.t`released`}` };
}

function time(value: number): HtmlString {
  return html`<u2-time datetime="${new Date(value * 1000).toISOString()}" second type=relative></u2-time>`;
}

function duration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 360) / 10} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds)} s`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { list },
  },
};
