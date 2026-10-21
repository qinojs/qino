import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Without a heartbeat for this long, an instance counts as silent. */
const SILENT = 3 * 60 * 60;

/** Stored times are UTC without zone. */
const at = (v: unknown) => u2.el.time(v ? String(v).replace(" ", "T") + "Z" : "");

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
    <div class="u2-card">
      <div class=-head>
        <span>${t`Instances`}</span>
        <button type=button data-refresh>${t`Refresh`}</button>
      </div>
      <u2-table cms-part=instances>${instances(node)}</u2-table>
    </div>
    <div class="u2-card">
      <div class=-head><span>${t`Errors of all instances`}</span></div>
      <u2-table cms-part=errors>${errors(node)}</u2-table>
    </div>
  </div>`;
}

export async function instances(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const rows = await app.db.query`
    SELECT i.*, (SELECT COUNT(*) FROM reporting_error e WHERE e.instance = i.id) AS errors
    FROM reporting_instance i ORDER BY i.last_seen DESC`;
  return html.async`<table class="u2-table -instances -Sticky">
    <thead><tr>
      <th>${t`Instance`}
      <th>${t`Qino`}
      <th>${t`Runtime`}
      <th>${t`Modules`}
      <th>${t`Errors`}
      <th>${t`Last report`}
      <th>${t`First report`}
      <th>
    <tbody>${rows.map((r) => instanceRow(app, r))}
  </table>`;
}

function instanceRow(app: App, r: Record<string, unknown>) {
  const modules = String(r.modules ?? "").split(",").filter(Boolean);
  const silent = Date.parse(String(r.last_seen).replace(" ", "T") + "Z") < Date.now() - SILENT * 1000;
  return html.async`<tr>
    <td>${r.url ? html`<a href="${r.url}" target=_blank rel=noopener>${r.url}</a>` : html`<code>${r.id}</code>`}
    <td>${r.qino} <small>${String(r.commit ?? "").slice(0, 8)}</small>
    <td>${r.runtime}
    <td title="${modules.join(", ")}">${modules.length}
    <td>${r.errors}
    <td>${at(r.last_seen)}${silent ? html.async` <span class=u2-badge style="background:var(--orange)">${app.t`silent`}</span>` : ""}
    <td>${at(r.first_seen)}
    <td><button type=button data-delete-instance="${r.id}" u2-confirm="${app.t`Forget this instance and its errors?`}">${app.t`Delete`}</button>`;
}

/** The same error on several instances is one row. */
export async function errors(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const rows = await app.db.query`
    SELECT fp, MAX(source) AS source, MAX(file) AS file, MAX(line) AS line, MAX(col) AS col, MAX(prio) AS prio,
      MAX(message) AS message, COUNT(*) AS instances, SUM(hits) AS hits, MAX(last_seen) AS last_seen
    FROM reporting_error GROUP BY fp ORDER BY MAX(last_seen) DESC LIMIT 500`;
  return html.async`<table class="u2-table -errors -Sticky">
    <thead><tr>
      <th>${t`Message`}
      <th>${t`Where`}
      <th>${t`Instances`}
      <th>${t`Hits`}
      <th>${t`Last seen`}
      <th>
    <tbody>${rows.map((r) => html.async`<tr>
      <td class=-message>${r.prio === "error" ? "" : html`<small>${r.prio}</small> `}${r.message}
      <td><small>${r.source}</small> <code>${r.file}${r.line ? `:${r.line}` : ""}${r.col ? `:${r.col}` : ""}</code>
      <td>${r.instances}
      <td>${r.hits}
      <td>${at(r.last_seen)}
      <td><button type=button data-delete-error="${r.fp}">${t`Done`}</button>`)}
  </table>`;
}
