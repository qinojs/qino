// deno-lint-ignore-file no-explicit-any
import { hee, type App } from "../../core/mod.ts";
import { buildModuleTableIndex } from "../lib/analyze.ts";

export async function renderModules(app: App, modules: Record<string, any>): Promise<string> {
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

    return [`<tr>
      <td style="font-family:monospace">${hee(modName)}
      <td>${groups}`];
  });

  if (!rows.length) return `<div class=u2-card><div class="-body">${await app.t`No modules with dbSchema.`}</div></div>`;

  return `<div class="u2-card -full">
    <div class="-head">${await app.t`Modules with DB schema`}</div>
    <table class=u2-table>
      <thead>
        <tr>
          <th>${await app.t`Module`}
          <th>${await app.t`Fields`}
      <tbody>${rows.join("")}
    </table>
  </div>`;
}
