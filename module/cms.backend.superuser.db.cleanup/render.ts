import { html, type HtmlString, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { tableStatus } from "../cms.backend.superuser.db/mod.ts";
import { findOrphans, maintenanceActions, schemaExtras } from "./lib/cleanup.ts";
import { indexIssues } from "./lib/indexes.ts";
import { sequenceIssue } from "./lib/sequences.ts";
import { isEmptyField, isEmptyTable, sqliteFreeBytes } from "./lib/validate.ts";
import { isLarge } from "./nodeApi.ts";

export function backendDashboardWidget(app: App): HtmlString {
  const count = schemaExtras(app.db).length;
  return html`<div class=-body>${count ? html`<small class=u2-badge>${count} schema leftovers</small><br>` : ""}<small>Integrity, schema leftovers and database maintenance</small></div>`;
}

function issueBadge(name: string, label: string, count: number, body: HtmlString): HtmlString {
  if (!count) return html``;
  return html`<button class=u2-unstyle data-inspect="${name}"><small class=u2-badge>${label} ${count}</small></button>
    <template data-inspect-body="${name}">${body}</template>`;
}

export async function renderRow(
  node: Node,
  table: string,
  orphans?: Awaited<ReturnType<typeof findOrphans>>,
  extras = schemaExtras(node.app.db),
): Promise<HtmlString> {
  const db = node.app.db;
  orphans ??= await findOrphans(db, table);
  const status = await tableStatus(db, table).catch(() => null);
  if (!status) return html``;
  const tableOrphans = orphans.filter((issue) => issue.table === table);
  const orphanRows = tableOrphans.map((issue) => {
    const operation = issue.onDelete === "cascade" ? "delete" : issue.onDelete === "setnull" ? "set null" : "unresolved";
    const action = issue.actionable
      ? html`<button type=button data-action=clean-orphans data-table="${table}" data-field="${issue.field}" u2-confirm="${operation} up to 1000 orphan references in ${table}.${issue.field}?">${operation}</button>`
      : html`<button type=button disabled title="${issue.blocked}">${operation}</button>`;
    return html`<tr>
      <td><code>${issue.table}.${issue.field}</code> → <code>${issue.parent}.${issue.parentField}</code>
      <td>${issue.parentEmpty ? "yes" : "no"}
      <td style="text-align:right" title="Examples: ${issue.samples.join(", ")}">${issue.count}
      <td>${action}`;
  });
  const orphanCount = tableOrphans.reduce((sum, issue) => sum + issue.count, 0);
  const orphanBody = html`<h3>Orphans in ${table}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>Relation
        <th>Parent empty
        <th>Rows
        <th>Action
      <tbody>${html.join(orphanRows)}
    </table>`;

  const tableExtra = extras.find((issue) => issue.table === table && issue.status === "no-schema-table");
  let schemaRows: HtmlString[];
  if (tableExtra) {
    const empty = await isEmptyTable(db, table);
    schemaRows = [html`<tr>
      <td>Table
      <td><code>${table}</code>
      <td>${empty ? "yes" : "no"}
      <td><button type=button data-action=drop-table data-table="${table}" u2-confirm="Delete table ${table} and all of its data? This cannot be undone.">delete</button>`];
  } else {
    const fields = extras.filter((issue) => issue.table === table && issue.field);
    schemaRows = await Promise.all(fields.map(async (issue) => {
      const field = issue.field!;
      const empty = isLarge(status) ? null : await isEmptyField(db, table, field);
      return html`<tr>
        <td>Field
        <td><code>${field}</code>
        <td>${empty == null ? "not checked" : empty ? "yes" : "no"}
        <td><button type=button data-action=drop-field data-table="${table}" data-field="${field}" u2-confirm="Delete field ${table}.${field} and all of its data? This cannot be undone.">delete</button>`;
    }));
  }
  const schemaBody = html`<h3>Outside schema in ${table}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>Kind
        <th>Name
        <th>Empty
        <th>Action
      <tbody>${html.join(schemaRows)}
    </table>`;

  const indexes = await indexIssues(db, table);
  const indexRows = indexes.map((issue) => {
    let action: HtmlString | string = "review";
    if (issue.actionable && issue.kind === "invalid") {
      action = html`<button type=button data-action=reindex-index data-table="${table}" data-index="${issue.index}" u2-confirm="Rebuild invalid index ${issue.index} on ${table}? This may lock the table.">rebuild</button>`;
    } else if (issue.actionable && issue.kind === "missing") {
      action = html`<button type=button data-action=create-index data-table="${table}" data-field="${issue.field}" u2-confirm="Create the missing ${issue.wanted} for ${table}.${issue.field}? This may lock a large table.">create</button>`;
    } else if (issue.actionable) {
      action = html`<button type=button data-action=drop-index data-table="${table}" data-index="${issue.index}" u2-confirm="Delete redundant index ${issue.index} from ${table}?">delete</button>`;
    }
    return html`<tr>
      <td>${issue.kind}
      <td><code>${issue.field ?? issue.index ?? "primary"}</code>
      <td>${issue.wanted ?? issue.other ?? "–"}
      <td>${action}`;
  });
  const indexBody = html`<h3>Index issues in ${table}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>Issue
        <th>Index / field
        <th>Expected / covered by
        <th>Action
      <tbody>${html.join(indexRows)}
    </table>`;

  const sequence = await sequenceIssue(db, table);
  const sequenceBody = sequence ? html`<h3>Auto-id sequence in ${table}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>Field
        <th>Current
        <th>Required
        <th>Action
      <tbody><tr>
        <td><code>${sequence.field}</code>
        <td>${sequence.current}
        <td>${sequence.max}
        <td><button type=button data-action=sync-sequence data-table="${table}" u2-confirm="Move the auto-id sequence for ${table}.${sequence.field} from ${sequence.current} to ${sequence.max}?">synchronize</button>
    </table>` : html``;

  const issueCount = tableOrphans.length + schemaRows.length + indexes.length + Number(Boolean(sequence));
  const issueCell = issueCount ? html`${issueBadge("orphans", "Orphans", orphanCount, orphanBody)}
      ${issueBadge("schema", "Schema", schemaRows.length, schemaBody)}
      ${issueBadge("indexes", "Indexes", indexes.length, indexBody)}
      ${issueBadge("sequence", "Sequence", Number(Boolean(sequence)), sequenceBody)}`
    : html`<u2-ico inline icon=check_circle aria-label=ok>✓</u2-ico>`;

  const actions = maintenanceActions(db, status).map((maintenance) => {
    const warning = isLarge(status) ? " This is a large table and the database may be blocked for a long time." : " This may lock the table.";
    return html`<li><button data-action=maintenance data-maintenance="${maintenance}" data-table="${table}" u2-confirm="Run ${maintenance} on ${table}?${warning}">${maintenance}</button>`;
  });
  return html`<tr data-table-name="${table}">
    <td data-value="${table}">${table} <small>${status.engine}</small> ${isLarge(status) ? html`<small class=u2-badge title="Maintenance may take a long time and block the database">large</small>` : ""}
    <td data-value="${status.rows ?? -1}" style="text-align:right">${status.rows ?? "?"}
    <td data-value="${status.bytes ?? -1}">${status.bytes != null ? html`<u2-bytes>${status.bytes}</u2-bytes>` : "?"}
    <td data-value="${status.overhead ?? status.deadRows ?? -1}">${status.overhead != null ? html`<u2-bytes>${status.overhead}</u2-bytes>` : status.deadRows ? html`<small class=u2-badge>${status.deadRows} dead rows</small>` : "–"}
    <td data-value="${issueCount}" style="white-space:nowrap">${issueCell}
    <td data-value="${actions.length}" style="white-space:nowrap"><u2-menubutton>
      <button>Tools ▾</button>
      <menu>
        <li><button data-action=validate data-table="${table}" u2-confirm="Validate portable schema rules for ${table}? This reads the table and may take a while.">validate</button>
        ${html.join(actions)}
      </menu>
    </u2-menubutton>`;
}

async function tableRows(node: Node): Promise<HtmlString> {
  const orphans = await findOrphans(node.app.db);
  const extras = schemaExtras(node.app.db);
  return html.join(await Promise.all(Object.keys(node.app.db.tables).sort().map((table) => renderRow(node, table, orphans, extras))));
}

export async function render(node: Node): Promise<HtmlString> {
  const freeBytes = await sqliteFreeBytes(node.app.db);
  return html`<div class="u2-card -full">
    <div class=-head>Database cleanup</div>
    <div class=-body>
      <small>Maintenance can take a long time, lock tables and require additional disk space. Tables outside the schema can belong to modules that are currently not loaded.${freeBytes ? html` SQLite has <u2-bytes>${freeBytes}</u2-bytes> reusable free pages.` : ""}</small>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.5rem">
        <input type=search data-table-search placeholder="Search tables…">
        <button data-action=clean-orphans-all u2-confirm="Apply every declared cascade/set-null rule to one batch of orphan references?">Clean orphans</button>
        <button data-action=validate-all u2-confirm="Validate all tables not marked as large? This may take a while.">Validate all</button>
        ${node.app.db.dialect !== "sqlite" ? html`<button data-action=optimize-all u2-confirm="Optimize all supported tables that are not marked as large? This may lock tables.">Optimize all</button>` : ""}
        ${node.app.db.dialect === "sqlite" ? html`<button data-action=vacuum u2-confirm="Vacuum the complete SQLite database? This can take a long time, needs free disk space and blocks the database.">Vacuum database</button>` : ""}
      </div>
    </div>
    <u2-table style="padding:0;max-height:85vh;overflow:auto">
      <table class="u2-table -Sticky">
        <thead><tr>
          <th data-sort-handler>Table
          <th data-sort-handler>Rows
          <th data-sort-handler>Size
          <th data-sort-handler title="Freed space or dead tuples still attached to the table">Overhead
          <th data-sort-handler>Issues
          <th data-sort-handler>Tools
        <tbody>${await tableRows(node)}
      </table>
    </u2-table>
  </div>`;
}
