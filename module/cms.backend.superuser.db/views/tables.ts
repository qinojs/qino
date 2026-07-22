// deno-lint-ignore-file no-explicit-any
import { html, type HtmlString, getCtx, type App } from "../../core/mod.ts";
import { fieldOriginsByTable } from "../lib/analyze.ts";
import { tableStatus } from "../lib/tableStatus.ts";

function keyBadge(key: string): HtmlString {
  if (key === "PRI") return html.raw(' <small class=u2-badge style="background:var(--yellow)">PRI</small>');
  if (key === "UNI") return html.raw(' <small class=u2-badge style="background:var(--blue)">UNI</small>');
  if (key === "MUL") return html.raw(' <small class=u2-badge style="background:var(--green)">IDX</small>');
  return html.raw("");
}

function statusBadge(app: App, inSchema: boolean, uncovered: number): Promise<HtmlString> | HtmlString {
  if (!inSchema)   return html.async`<small class=u2-badge style="background:var(--red)">${app.t`no schema`}</small>`;
  if (uncovered)   return html.async`<small class=u2-badge style="background:var(--orange)">${uncovered} ${app.t`without schema`}</small>`;
  return html`<u2-ico inline icon=check_circle aria-label="ok" style="color:var(--green)">✓</u2-ico>`;
}

export function renderTables(app: App, db: any, modules: Record<string, any>, table: string): Promise<HtmlString> {
  return table ? tableDetail(app, db, modules, table) : tableOverview(app, db);
}

async function tableOverview(app: App, db: any): Promise<HtmlString> {
  const t = app.t;
  const tables = Object.values(db.tables ?? {});
  const schemaProps = db.schema?.properties ?? {};

  const u = getCtx().req.url.toURL(); u.searchParams.set("view", "tables");
  const rows = await Promise.all(
    [...tables].sort((a, b) => {
      const [sa, sb] = [a.name.startsWith("_"), b.name.startsWith("_")];
      return (sa ? 1 : 0) - (sb ? 1 : 0) || a.name.localeCompare(b.name);
    }).map(async (table: any) => {
      const fields = await table.init();
      const schemaFields: Record<string, any> = schemaProps[table.name]?.additionalProperties?.properties ?? {};
      const status = await tableStatus(db, table.name).catch(() => null);
      const uncovered = Object.keys(fields).filter(f => !(f in schemaFields)).length;

      const bytes = status?.bytes != null ? html`<u2-bytes>${status.bytes}</u2-bytes>` : "?";
      const primaries = Object.values(fields).filter((f: any) => f.isPrimary());
      const primaryBadge = primaries.length === 0
        ? html.async`<small class=u2-badge style="background:var(--red)">${t`none`}</small>`
        : primaries.length === 1
        ? html`<small class=u2-badge style="background:var(--yellow)">${primaries[0]}</small>`
        : html.join(primaries.map((f: any) => html`<small class=u2-badge>${f}</small>`), " ");
      u.searchParams.set("table", table.name);
      return html.async`<tr data-table-name="${table.name}">
        <td><a href="${u.search}">${table.name}</a>
        <td style="text-align:right">${status?.rows ?? "?"}
        <td style="text-align:right">${bytes}
        <td style="text-align:right">${Object.keys(fields).length}
        <td data-value="${primaries.length}">${primaryBadge}
        <td>${statusBadge(app, table.name in schemaProps, uncovered)}`;
    })
  );

  return html.async`<div class="u2-card -full">
    <div class="-head">${t`Tables`} (${tables.length})</div>
    <div class="-body"><input type=search data-table-search placeholder="${t`Search`}..." style="width:300px;max-width:100%"></div>
    <u2-table style="padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th data-sort-handler>${t`Table`}
            <th data-sort-handler>${t`Rows`}
            <th data-sort-handler>${t`Size`}
            <th data-sort-handler>${t`Fields`}
            <th data-sort-handler>${t`Primary`}
            <th data-sort-handler>${t`Status`}
        <tbody>${html.join(rows)}
      </table>
    </u2-table>
  </div>`;
}

async function tableDetail(app: App, db: any, modules: Record<string, any>, tableName: string): Promise<HtmlString> {
  const t = app.t;
  const table = db.tables?.[tableName];
  if (!table) return html.async`<div class=u2-card><div class="-body">${t`Table`} <b>${tableName}</b> ${t`not found.`}</div></div>`;

  const fields = await table.init();
  const schemaFields: Record<string, any> = table.schema?.additionalProperties?.properties ?? {};
  const origins = fieldOriginsByTable(modules, tableName);
  const status = await tableStatus(db, tableName).catch(() => null);

  const rows = Object.entries(fields as Record<string, any>).map(([fname, field]) => {
    const props = schemaFields[fname];
    const schemaCell = props
      ? html.join(Object.entries(props).map(([k, v]) =>
          html`<span${k.startsWith("x-") ? html.raw(' style="opacity:.5"') : ""}>${k}: <code>${JSON.stringify(v)}</code></span>`
        ), " ")
      : "–";

    const originsCell = html.join((origins[fname] ?? []).map(m => html`<small class=u2-badge>${m}</small>`), " ");

    return html`<tr${props ? "" : html.raw(" class=-no-schema-row")}>
      <td style="font-family:monospace">${fname}${keyBadge(field.vs?.Key ?? "")}
      <td style="font-family:monospace;font-size:.9em">${field.vs?.Type}
      <td>${field.vs?.Null === "YES" ? "NULL" : ""}
      <td><code>${field.vs?.Default ?? ""}</code>
      <td style="font-size:.82em">${schemaCell}
      <td>${originsCell}`;
  });

  const meta = status
    ? html.async`<span style="font-size:.85em;opacity:.6;margin-left:12px">${status.rows ?? "?"} ${
      t`rows`
    } · ${status.engine} · <u2-bytes>${status.bytes ?? 0}</u2-bytes></span>`
    : "";

  const u = getCtx().req.url.toURL(); u.searchParams.set("view", "tables"); u.searchParams.delete("table");
  return html.async`<div class="u2-card -full">
    <div class="-head"><a href="${u.search}">← ${t`Tables`}</a> &nbsp; ${tableName} ${meta}</div>
    <table class=u2-table>
      <thead>
        <tr>
          <th>${t`Field`}
          <th>${t`Type`}
          <th>NULL
          <th>${t`Default`}
          <th>${t`Schema`}
          <th>${t`Module`}
      <tbody>${html.join(rows)}
    </table>
  </div>`;
}
