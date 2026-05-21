// deno-lint-ignore-file no-explicit-any
import { hee } from "../../core/lib/util.ts";
import { buildModuleTableIndex } from "../lib/analyze.ts";

export function renderModules(modules: Record<string, any>): string {
  const index = buildModuleTableIndex(modules);
  const rows = Object.keys(modules).sort().flatMap(modName => {
    const tables = index[modName];
    if (!tables) return [];

    const groups = Object.entries(tables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, fields]) =>
        `<span class="-tgroup"><span class="-tname">${hee(table)}</span>${
          fields.sort().map(f => `<span class="-field">${hee(f)}</span>`).join("")
        }</span>`
      ).join("");

    return [`<tr><td style="font-family:monospace">${hee(modName)}</td><td>${groups}</td></tr>`];
  });

  if (!rows.length) return `<div class=u2-card><div class="-body">Keine Module mit dbSchema.</div></div>`;

  return `<div class="u2-card -full">
    <div class="-head">Module mit DB-Schema</div>
    <table class=u2-table>
      <thead><tr><th>Modul<th>Felder</thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;
}
