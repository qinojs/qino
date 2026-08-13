import { html, type HtmlString, schemaDiff, schemaFromDb, sql, type Db, type App } from "@qino/qino";
import { sortTableNames } from "../lib/analyze.ts";

export async function renderDiff(app: App, db: Db): Promise<HtmlString> {
  const t = app.t;
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
    const schemaFields = tableSchema.additionalProperties?.properties ?? {};
    const dbFields = table.fields ?? {};
    for (const f of Object.keys(schemaFields)) {
      if (!(f in dbFields)) rows.push({ table: tableName, field: f, status: "field-missing-db" });
    }
    for (const f of Object.keys(dbFields)) {
      if (!(f in schemaFields)) rows.push({ table: tableName, field: f, status: "field-missing-schema" });
    }
  }

  const badges: Record<Row["status"], HtmlString> = {
    "no-schema-table":      await html.async`<small class=u2-badge style="background:var(--red)">${t`table without schema`}</small>`,
    "field-missing-db":     await html.async`<small class=u2-badge style="background:var(--orange)">${t`missing in DB`}</small>`,
    "field-missing-schema": await html.async`<small class=u2-badge>${t`missing in schema`}</small>`,
  };

  const diffTable = rows.length
    ? html.async`<table class=u2-table>
        <thead>
          <tr>
            <th>${t`Table`}
            <th>${t`Field`}
            <th>${t`Status`}
        <tbody>${rows.map(({ table, field, status }) => html`<tr>
          <td>${table}
          <td>${field ? field : ""}
          <td>${badges[status]}`)}
      </table>`
    : html`<div class=-body>Schema and DB match.</div>`;

  // --- schema from db ---
  const fromDb = await schemaFromDb((text: string) => db.query`${sql.raw(text)}`);
  const current = db.schema ?? { properties: {} };
  const diffs = schemaDiff(fromDb, current);

  const missingTables = Object.fromEntries(
    Object.entries(fromDb.properties).filter(
      ([t]) => !(t in (current.properties ?? {}))
    )
  );
  const txtDescructive = await t`destructive`;

  const schemaRows = diffs.map((d: { path: string[]; prev?: unknown; next?: unknown; destructive?: unknown }) =>
    html`<tr>
      <td>${d.path.join(".")}
      <td>${d.prev ?? "–"}
      <td>${d.next ?? "–"}
      <td>${d.destructive ? html`<span class=u2-badge style="background:var(--red)">${txtDescructive}</span>` : ""}`
  );

  return html.async`
  <div class="u2-card -full">
    <div class=-head>Diff (${rows.length})</div>
    ${diffTable}
  </div>
  ${Object.keys(missingTables).length ? html.async`
  <div class="u2-card -full">
    <div class=-head>${t`Missing tables as schema JSON`}</div>
    <div class=-body><textarea style="width:100%;height:18.75rem;font-family:monospace;font-size:.85em" readonly>${JSON.stringify({ properties: missingTables }, null, 2)}</textarea></div>
  </div>` : ""}
  ${diffs.length ? html.async`
  <div class="u2-card -full">
    <div class=-head>${t`Schema deviations from DB`} (${diffs.length})</div>
    <table class=u2-table>
      <thead>
        <tr>
          <th>${t`Path`}
          <th>${t`current`}
          <th>${t`from DB`}
          <th>
      <tbody>${schemaRows}
    </table>
  </div>` : ""}`;
}
