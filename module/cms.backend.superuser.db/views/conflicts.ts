// deno-lint-ignore-file no-explicit-any
import { hee } from "../../core/lib/util.ts";
import { collectConflicts } from "../lib/analyze.ts";

export function renderConflicts(modules: Record<string, any>): string {
  const conflicts = collectConflicts(modules);

  if (!conflicts.length) {
    return `<div class=u2-card><div class=-body>Keine Schema-Konflikte gefunden.</div></div>`;
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
    <div class="-head">Schema-Konflikte (${conflicts.length})</div>
    <table class="u2-table -conflicts">
      <thead><tr><th>Tabelle<th>Feld<th>Property<th>Werte je Modul</thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
