// deno-lint-ignore-file no-explicit-any
import { html, type App, type HtmlString } from "@qino/qino";
import { collectConflicts } from "../lib/analyze.ts";

export function renderConflicts(app: App, modules: Record<string, any>): Promise<HtmlString> {
  const t = app.t;
  const conflicts = collectConflicts(modules);

  if (!conflicts.length) {
    return html.async`<div class=u2-card><div class=-body>${t`No schema conflicts found.`}</div></div>`;
  }

  const rows = conflicts.map(({ table, field, prop, values }) => {
    const valCells = values.map(({ module: m, value }) =>
      html`<div><b>${m}</b>: <code>${JSON.stringify(value)}</code></div>`
    );
    return html`<tr>
      <td>${table}
      <td>${field}
      <td><code>${prop}</code>
      <td>${valCells}`;
  });

  return html.async`<div class="u2-card -full">
    <div class=-head>${t`Schema conflicts`} (${conflicts.length})</div>
    <table class="u2-table -conflicts">
      <thead>
        <tr>
          <th>${t`Table`}
          <th>${t`Field`}
          <th>${t`Property`}
          <th>${t`Values per module`}
      <tbody>${rows}
    </table>
  </div>`;
}
