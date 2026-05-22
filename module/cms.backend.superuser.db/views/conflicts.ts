// deno-lint-ignore-file no-explicit-any
import { hee } from "../../core/lib/util.ts";
import { collectConflicts } from "../lib/analyze.ts";
import type { App } from "../../core/server.ts";

export async function renderConflicts(app: App, modules: Record<string, any>): Promise<string> {
  const conflicts = collectConflicts(modules);

  if (!conflicts.length) {
    return `<div class=u2-card><div class=-body>${await app.t`No schema conflicts found.`}</div></div>`;
  }

  const rows = conflicts.map(({ table, field, prop, values }) => {
    const valCells = values.map(({ module: m, value }) =>
      `<div><b>${hee(m)}</b>: <code>${hee(JSON.stringify(value))}</code></div>`
    ).join("");
    return `<tr>
      <td>${hee(table)}</td>
      <td>${hee(field)}</td>
      <td><code>${hee(prop)}</code></td>
      <td>${valCells}</td>
    </tr>`;
  }).join("");

  return `<div class="u2-card -full">
    <div class="-head">${await app.t`Schema conflicts`} (${conflicts.length})</div>
    <table class="u2-table -conflicts">
      <thead><tr><th>${await app.t`Table`}<th>${await app.t`Field`}<th>${await app.t`Property`}<th>${await app.t`Values per module`}</thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
