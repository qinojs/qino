// deno-lint-ignore-file no-explicit-any
import { hee, getCtx, type App } from "../../core/mod.ts";
import { fieldOriginsByTable } from "../lib/analyze.ts";

function keyBadge(key: string): string {
  if (key === "PRI") return ' <small class=u2-badge style="background:var(--yellow)">PRI</small>';
  if (key === "UNI") return ' <small class=u2-badge style="background:var(--blue)">UNI</small>';
  if (key === "MUL") return ' <small class=u2-badge style="background:var(--green)">IDX</small>';
  return "";
}

async function statusBadge(app: App, inSchema: boolean, uncovered: number): Promise<string> {
  if (!inSchema)   return `<small class=u2-badge style="background:var(--red)">${await app.t`no schema`}</small>`;
  if (uncovered)   return `<small class=u2-badge style="background:var(--orange)">${uncovered} ${await app.t`without schema`}</small>`;
  return `<u2-ico inline icon=check_circle aria-label="ok" style="color:var(--green)">✓</u2-ico>`;
}

export function renderTables(app: App, db: any, modules: Record<string, any>, table: string): Promise<string> {
  return table ? tableDetail(app, db, modules, table) : tableOverview(app, db);
}

async function tableOverview(app: App, db: any): Promise<string> {
  const tables = Object.values(db.tables ?? {}) as any[];
  const schemaProps = db.schema?.properties ?? {};

  const u = getCtx().url; u.searchParams.set("view", "tables");
  const rows = await Promise.all(
    [...tables].sort((a, b) => {
      const [sa, sb] = [a.name.startsWith("_"), b.name.startsWith("_")];
      return (sa ? 1 : 0) - (sb ? 1 : 0) || a.name.localeCompare(b.name);
    }).map(async (table: any) => {
      const fields = await table.init();
      const schemaFields: Record<string, any> = schemaProps[table.name]?.additionalProperties?.properties ?? {};
      const status = await table.getStatus().catch(() => null);
      const uncovered = Object.keys(fields).filter(f => !(f in schemaFields)).length;

      const bytes = status?.Data_length != null ? `<u2-bytes>${status.Data_length}</u2-bytes>` : "?";
      const primaries = Object.values(fields).filter((f: any) => f.isPrimary());
      const primaryBadge = primaries.length === 0 ? `<small class=u2-badge style="background:var(--red)">${await app.t`none`}</small>`
        : primaries.length === 1 ? `<small class=u2-badge style="background:var(--yellow)">${hee(String(primaries[0]))}</small>`
        : primaries.map((f: any) => `<small class=u2-badge>${hee(String(f))}</small>`).join(" ");
      u.searchParams.set("table", table.name);
      return `<tr>
        <td><a href="${hee(u.search)}">${hee(table.name)}</a></td>
        <td style="text-align:right">${hee(String(status?.Rows ?? "?"))}</td>
        <td style="text-align:right">${bytes}</td>
        <td style="text-align:right">${Object.keys(fields).length}</td>
        <td data-value="${primaries.length}">${primaryBadge}</td>
        <td>${await statusBadge(app, table.name in schemaProps, uncovered)}</td>
      </tr>`;
    })
  );

  return `<div class="u2-card -full">
    <div class="-head">${await app.t`Tables`} (${tables.length})</div>
    <u2-table style="padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th data-sort-handler>${await app.t`Table`}
            <th data-sort-handler>${await app.t`Rows`}
            <th data-sort-handler>${await app.t`Size`}
            <th data-sort-handler>${await app.t`Fields`}
            <th data-sort-handler>${await app.t`Primary`}
            <th data-sort-handler>${await app.t`Status`}
        <tbody>${rows.join("")}</tbody>
      </table>
    </u2-table>
  </div>`;
}

async function tableDetail(app: App, db: any, modules: Record<string, any>, tableName: string): Promise<string> {
  const table = db.tables?.[tableName];
  if (!table) return `<div class=u2-card><div class="-body">${await app.t`Table`} <b>${hee(tableName)}</b> ${await app.t`not found.`}</div></div>`;

  const fields = await table.init();
  const schemaFields: Record<string, any> = table.schema?.additionalProperties?.properties ?? {};
  const origins = fieldOriginsByTable(modules, tableName);
  const status = await table.getStatus().catch(() => null);

  const rows = Object.entries(fields as Record<string, any>).map(([fname, field]) => {
    const props = schemaFields[fname];
    const schemaCell = props
      ? Object.entries(props).map(([k, v]) =>
          `<span${k.startsWith("x-") ? ' style="opacity:.5"' : ""}>${hee(k)}: <code>${hee(JSON.stringify(v))}</code></span>`
        ).join(" ")
      : "–";

    const originsCell = (origins[fname] ?? []).map(m => `<small class=u2-badge>${hee(m)}</small>`).join(" ");

    return `<tr${props ? "" : ' class=-no-schema-row'}>
      <td style="font-family:monospace">${hee(fname)}${keyBadge(field.vs?.Key ?? "")}</td>
      <td style="font-family:monospace;font-size:.9em">${hee(field.vs?.Type ?? "")}</td>
      <td>${field.vs?.Null === "YES" ? "NULL" : ""}</td>
      <td><code>${field.vs?.Default != null ? hee(String(field.vs.Default)) : ""}</code></td>
      <td style="font-size:.82em">${schemaCell}</td>
      <td>${originsCell}</td>
    </tr>`;
  });

  const meta = status
    ? `<span style="font-size:.85em;opacity:.6;margin-left:12px">${hee(String(status.Rows ?? "?"))} ${await app.t`rows`} · ${hee(status.Engine ?? "")} · <u2-bytes>${status["Data_length"] ?? 0}</u2-bytes></span>`
    : "";

  const u = getCtx().url; u.searchParams.set("view", "tables"); u.searchParams.delete("table");
  return `<div class="u2-card -full">
    <div class="-head"><a href="${hee(u.search)}">← ${await app.t`Tables`}</a> &nbsp; ${hee(tableName)} ${meta}</div>
    <table class=u2-table>
      <thead>
        <tr>
          <th>${await app.t`Field`}
          <th>${await app.t`Type`}
          <th>NULL
          <th>${await app.t`Default`}
          <th>${await app.t`Schema`}
          <th>${await app.t`Module`}
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;
}
