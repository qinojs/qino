import { hee, type Db, type App } from "../../core/mod.ts";
import { schemaFromDb, schemaDiff } from "../../../deps.ts";
import { sortTableNames } from "../lib/analyze.ts";

export async function renderDiff(app: App, db: Db): Promise<string> {
  const mergedSchema = db.schema?.properties ?? {};
  const tables = db.tables ?? {};

  // --- diff table vs schema ---
  type Row = { table: string; field?: string; status: "no-schema-table" | "field-missing-db" | "field-missing-schema" };
  const rows: Row[] = [];

  for (const tableName of sortTableNames(Object.keys(tables))) {
    if (!(tableName in mergedSchema)) rows.push({ table: tableName, status: "no-schema-table" });
  }
  for (const tableName of sortTableNames(Object.keys(mergedSchema))) {
    const tableSchema = mergedSchema[tableName];
    const table = tables[tableName];
    if (!table) continue;
    const schemaFields: Record<string, unknown> = tableSchema.additionalProperties?.properties ?? {};
    const dbFields = table.fields ?? {};
    for (const f of Object.keys(schemaFields)) {
      if (!(f in dbFields)) rows.push({ table: tableName, field: f, status: "field-missing-db" });
    }
    for (const f of Object.keys(dbFields)) {
      if (!(f in schemaFields)) rows.push({ table: tableName, field: f, status: "field-missing-schema" });
    }
  }

  const badges: Record<Row["status"], string> = {
    "no-schema-table":      `<small class=u2-badge style="background:var(--red)">${await app.t`table without schema`}</small>`,
    "field-missing-db":     `<small class=u2-badge style="background:var(--orange)">${await app.t`missing in DB`}</small>`,
    "field-missing-schema": `<small class=u2-badge>${await app.t`missing in schema`}</small>`,
  };

  const diffTable = rows.length
    ? `<table class=u2-table>
        <thead><tr><th>${await app.t`Table`}<th>${await app.t`Field`}<th>${await app.t`Status`}</thead>
        <tbody>${rows.map(({ table, field, status }) => `<tr>
          <td>${hee(table)}</td>
          <td>${field ? hee(field) : ""}</td>
          <td>${badges[status]}</td>
        </tr>`).join("")}</tbody>
      </table>`
    : `<div class="-body">Schema and DB match.</div>`;

  // --- schema from db ---
  const fromDb = await schemaFromDb((sql: string) => db.query(sql));
  const current = db.schema ?? { properties: {} };
  const diffs = schemaDiff(fromDb, current);

  const missingTables = Object.fromEntries(
    Object.entries(fromDb.properties as Record<string, unknown>).filter(
      ([t]) => !(t in (current.properties ?? {}))
    )
  );
  const txtDescructive = await app.t`destructive`;

  const schemaRows = diffs.map((d: { path: string[]; prev?: unknown; next?: unknown; destructive?: unknown }) =>
    `<tr>
      <td>${hee(d.path.join("."))}</td>
      <td>${hee(String(d.prev ?? "–"))}</td>
      <td>${hee(String(d.next ?? "–"))}</td>
      <td>${d.destructive ? `<span class=u2-badge style="background:var(--red)">${txtDescructive}</span>` : ""}</td>
    </tr>`
  ).join("");

  return `
  <div class="u2-card -full">
    <div class="-head">Diff (${rows.length})</div>
    ${diffTable}
  </div>
  ${Object.keys(missingTables).length ? `
  <div class="u2-card -full">
    <div class="-head">${await app.t`Missing tables as schema JSON`}</div>
    <div class="-body"><textarea style="width:100%;height:300px;font-family:monospace;font-size:.85em" readonly>${hee(JSON.stringify({ properties: missingTables }, null, 2))}</textarea></div>
  </div>` : ""}
  ${diffs.length ? `
  <div class="u2-card -full">
    <div class="-head">${await app.t`Schema deviations from DB`} (${diffs.length})</div>
    <table class=u2-table>
      <thead><tr><th>${await app.t`Path`}<th>${await app.t`current`}<th>${await app.t`from DB`}<th></thead>
      <tbody>${schemaRows}</tbody>
    </table>
  </div>` : ""}`;
}
