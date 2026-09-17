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

function render(node: Node, opts: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card">
    <div class=-head>${t`Security`}</div>
    <div class=-body>
      <button type=button data-refresh>${t`Refresh`}</button>
      ${t`Each report adds its weight to the IP; the strength halves every`} ${duration(HALF)}.
      ${t`Answers wait strength² ms, from`} ${BLOCK} ${t`on they are refused.`}
    </div>
    <table class="u2-table -Sticky" style="padding:0" cms-part=suspects>${suspectRows(node, opts)}</table>
    <div class=-body><b>${t`Recent reports`}</b> <small>${t`since the last restart`}</small></div>
    <table class="u2-table -Sticky" cms-part=recent>${recentRows(node, opts)}</table>
  </div>`;
}

async function suspectRows(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const ip = await ipLink(node, ctx);
  const rows = suspects(node.app).map((s) => html.async`<tr>
      <td>${ip(s.key)}
      <td>${s.strength < 10 ? s.strength.toFixed(1) : Math.round(s.strength)}
      <td>${s.blocked ? html.async`<span class=u2-badge>${t`blocked`}</span> ${duration(s.blocked)}` : `${Math.round(s.delay)} ms`}
      <td>${time(s.time)}
      <td><button type=button data-release="${s.key}">${t`Release`}</button>`);
  return html.async`<thead><tr>
      <th>IP
      <th>${t`Strength`}
      <th>${t`Effect`}
      <th>${t`Last report`}
      <th>
    <tbody>${rows.length ? rows : html.async`<tr><td colspan=5>${t`No suspicious IPs.`}`}`;
}

async function recentRows(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const ip = await ipLink(node, ctx);
  const rows = reports(node.app).map((r) => html`<tr>
      <td>${time(r.time)}
      <td>${ip(r.ip)}
      <td>${r.weight}
      <td>${r.reason}`);
  return html.async`<thead><tr>
      <th>${t`Time`}
      <th>IP
      <th>${t`Weight`}
      <th>${t`Reason`}
    <tbody>${rows.length ? rows : html.async`<tr><td colspan=4>${t`No reports yet.`}`}`;
}

/** IP → request log of that IP; plain text for an IPv6 network or without the log page. */
async function ipLink(node: Node, ctx: Ctx): Promise<(value: string) => HtmlString> {
  const url = await (await (await node.cms.nodeByModule("cms.backend.superuser.requests.log"))?.page())?.url();
  const log = url && new URL(url, ctx.req.url.origin);
  return (value) => {
    if (!log || value.includes("/")) return html`<code>${value}</code>`;
    const href = new URL(log);
    href.searchParams.set("search", value);
    return html`<a href="${href.href}"><code>${value}</code></a>`;
  };
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
    parts: { suspects: suspectRows, recent: recentRows },
  },
};
