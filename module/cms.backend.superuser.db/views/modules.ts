// deno-lint-ignore-file no-explicit-any
import { hee, type App } from "../../core/mod.ts";
import { buildModuleTableIndex } from "../lib/analyze.ts";

type FieldOrigins = Record<string, Record<string, string[]>>;
type TableOrigins = Record<string, string[]>;

function tableOrigins(index: ReturnType<typeof buildModuleTableIndex>): TableOrigins {
  const origins: Record<string, Set<string>> = {};
  for (const [modName, tables] of Object.entries(index)) {
    for (const table of Object.keys(tables)) (origins[table] ??= new Set()).add(modName);
  }
  return Object.fromEntries(Object.entries(origins).map(([table, mods]) => [table, [...mods].sort()]));
}

function fieldOrigins(index: ReturnType<typeof buildModuleTableIndex>): FieldOrigins {
  const origins: FieldOrigins = {};
  for (const [modName, tables] of Object.entries(index)) {
    for (const [table, fields] of Object.entries(tables)) {
      for (const field of fields) ((origins[table] ??= {})[field] ??= []).push(modName);
    }
  }
  return origins;
}

function chip(kind: "table" | "field", name: string, mods: string[], definedByLabel: string): string {
  const cls = `-${kind}-chip`;
  if (mods.length < 2) return `<span class="${cls}">${hee(name)}</span>`;
  const title = `${definedByLabel}: ${[...mods].sort().join(", ")}`;
  return `<span class="${cls} -shared" data-modules="${hee(title)}" title="${hee(title)}">${hee(name)}</span>`;
}

export async function renderModules(app: App, modules: Record<string, any>): Promise<string> {
  const index = buildModuleTableIndex(modules);
  const tableMods = tableOrigins(index);
  const origins = fieldOrigins(index);
  const tablesLabel = await app.t`tables`;
  const fieldsLabel = await app.t`fields`;
  const definedByLabel = await app.t`defined by`;
  const moduleRows = Object.keys(modules).sort().flatMap(modName => {
    const tables = index[modName];
    if (!tables) return [];

    const entries = Object.entries(tables).sort(([a], [b]) => a.localeCompare(b));
    const fieldCount = entries.reduce((sum, [, fields]) => sum + fields.length, 0);

    return entries.map(([table, fields], i) => `<tr>
      ${i ? "" : `<td rowspan="${entries.length}" style="font-family:monospace;vertical-align:top">${hee(modName)}<br><small>${entries.length} ${tablesLabel} &middot; ${fieldCount} ${fieldsLabel}</small>`}
      <td style="font-family:monospace">${chip("table", table, tableMods[table] ?? [], definedByLabel)}
      <td style="text-align:right">${fields.length}
      <td style="font-family:monospace;font-size:.9em">${
        [...fields].sort().map(field => chip("field", field, origins[table]?.[field] ?? [], definedByLabel)).join("")
      }`);
  });

  if (!moduleRows.length) return `<div class=u2-card><div class="-body">${await app.t`No modules with dbSchema.`}</div></div>`;

  const moduleCount = Object.keys(index).length;
  const tableCount = Object.values(index).reduce((sum, tables) => sum + Object.keys(tables).length, 0);
  const fieldCount = Object.values(index).reduce((sum, tables) =>
    sum + Object.values(tables).reduce((s, fields) => s + fields.length, 0), 0);

  return `<div class="u2-card -full">
    <div class="-head">${await app.t`Modules with DB schema`} <small>${moduleCount} ${await app.t`modules`} &middot; ${tableCount} ${tablesLabel} &middot; ${fieldCount} ${fieldsLabel}</small></div>
    <table class=u2-table>
      <thead>
        <tr>
          <th>${await app.t`Module`}
          <th>${await app.t`Table`}
          <th style="text-align:right">${await app.t`Fields`}
          <th>${await app.t`Field names`}
      <tbody>${moduleRows.join("")}
    </table>
  </div>`;
}
