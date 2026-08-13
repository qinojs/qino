import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { listProcesses, supportsProcesses, type Process } from "./lib/processlist.ts";

const REFRESH_MS = 500;

export async function render(node: Node): Promise<HtmlString> {
  const { app } = node, t = app.t;

  if (!supportsProcesses(app.db))
    return html.async`<div class=u2-card>
      <div class=-head>${t`Processes`}</div>
      <div class=-body><u2-alert open>${t`Not available for the`} ${app.db.dialect} ${t`backend`}.</u2-alert></div>
    </div>`;

  return html.async`<div class="u2-card -full">
    <div class=-head>${t`Processes`}</div>
    <div class=-body>
      <label><input type=checkbox data-live checked> ${t`Live`}</label>
      <label><input type=checkbox data-keep> ${t`Keep old`}</label>
    </div>
    <u2-table style="padding:0" data-refresh="${REFRESH_MS}" cms-part=list>${await list(node)}</u2-table>
  </div>`;
}

/** The auto-refreshing part: the current process snapshot. The client merges it into the table. */
export async function list(node: Node): Promise<HtmlString> {
  const { app } = node, t = app.t;
  const rows = await listProcesses(app.db);
  // labels resolved here (plain html`` in row() doesn't await app.t)
  const [lKill, lProcesses] = await Promise.all([t`Kill`, t`processes`]);

  return html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>Id
      <th>${t`User`}
      <th>${t`Host`}
      <th>DB
      <th>${t`Command`}
      <th>${t`Time`}
      <th>${t`State`}
      <th>${t`Query`}
      <th width=10>
    <tbody>${rows.map((p) => row(p, lKill))}
    <tfoot><tr><td colspan=9>${rows.length} ${lProcesses}
  </table>`;
}

function row(p: Process, killLabel: string): HtmlString {
  return html`<tr data-key="${p.key}" data-command="${p.command}">
    <td>${p.id}
    <td>${p.user}
    <td>${p.host}
    <td>${p.db}
    <td>${p.command}
    <td class=-time>${p.time}s
    <td>${p.state}
    <td><div class=-info title="${p.info}">${p.info}</div>
    <td><button class=u2-unstyle data-kill="${p.id}" title="${killLabel}"><u2-ico icon=delete>✕</u2-ico></button>
  `;
}
