import { getCtx, html } from "@qino/qino";
import { approvalStats, approvals } from "@qino/qino/auth";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Authentication", de: "Authentifizierung" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const stats = await approvalStats(app);
  return html.async`<div class=-body><b>${stats.pending ?? 0}</b> ${app.t`pending action approvals`}</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "core/pub/js/SettingsEditor.mjs");
  const [stats, recent] = await Promise.all([approvalStats(app), approvals(app, 100)]);

  return html.async`<div class=u2-flex>
    <div class=u2-card>
      <div class=-head>${t`Action approvals`}</div>
      <div class=-body>
        <b>${stats.pending ?? 0}</b> ${t`pending`} ·
        <b>${stats.approved ?? 0}</b> ${t`approved`} ·
        <b>${stats.consumed ?? 0}</b> ${t`consumed`} ·
        <b>${stats.denied ?? 0}</b> ${t`denied`}
      </div>
    </div>
    <div class=u2-card>
      <div class=-head>${t`Configuration`}</div>
      <settings-editor source="/api/core/settings/auth"></settings-editor>
    </div>
    <div class=u2-card style="flex-basis:100%">
      <div class=-head>${t`Recent action approvals`} (${recent.length})</div>
      <div class=-body style="overflow:auto">${recent.length
        ? html`<table class=u2-table>
          <thead><tr>
            <th>${t`Requested`}
            <th>${t`User`}
            <th>${t`Requester`}
            <th>${t`Action`}
            <th>${t`Summary`}
            <th>${t`Channel`}
            <th>${t`State`}
          <tbody>${recent.map((item) => html`<tr>
            <td>${time(item.requested)}
            <td>${[item.firstname, item.lastname].filter(Boolean).join(" ") || item.email || "#" + item.usrId}
            <td>${item.requester}
            <td><code>${item.action}</code>
            <td>${item.summary}
            <td>${item.channel || "–"}
            <td><span class=u2-badge>${item.status}</span>`)}
        </table>`
        : t`No action approvals yet.`}</div>
    </div>
  </div>`;
}

function time(value: number): HtmlString {
  return html`<u2-time datetime="${new Date(value * 1000).toISOString()}"></u2-time>`;
}

export const cms = { node: { render } };
