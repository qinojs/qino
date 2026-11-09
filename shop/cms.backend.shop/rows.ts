// A module's rows as an editable table — most of the shop's backend pages are nothing else. A column
// says what a cell shows and how it is typed in; the page lists its tables, so a request reaches
// only those tables and columns. Key columns are typed in once, when a row is added.
import { html, sql } from "@qino/qino";
import { fromMinor, toMinor } from "@qino/qino/fin";
import { shopT } from "@qino/qino/cms.shop";

import type { HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export type Column = {
  /** The table's column; none: a cell that only shows (`show`). */
  name?: string;
  label: unknown;
  /** money: minor units shown as major ones. date: unix time, a day in UTC. page: a page's id. */
  type?: "text" | "number" | "money" | "date" | "checkbox" | "select" | "page";
  /** select: value → what it reads. */
  options?: [string, string][];
  /** money: the row's currency. */
  currency?: (row: Row) => string;
  /** date: holds through this day — stored as the moment after it. */
  until?: boolean;
  show?: (row: Row) => unknown;
};
export type Rows = {
  table: string;
  title: unknown;
  columns: Column[];
  /** What all its rows have in common; new rows get it too. */
  where?: Record<string, unknown>;
  order?: string[];
  /** Rows are changed, not added or removed. */
  fixed?: boolean;
  /** Sent along with every change, for the page to find this table again. */
  vars?: Record<string, unknown>;
};

const DAY = 86400;
const whereOf = (node: Node, spec: Rows) => {
  const where = spec.where && node.app.db.table(spec.table).valuesToFragment(spec.where);
  return where?.parts.length ? sql`WHERE ${where}` : sql``;
};

/** What a cell holds, as an input shows it. */
function shown(column: Column, row: Row): string {
  const value = row[column.name!];
  if (value == null || value === "") return "";
  if (column.type === "money") return String(fromMinor(1, column.currency?.(row) ?? "") * Number(value));
  if (column.type === "date") return Number(value) ? new Date((Number(value) - (column.until ? 1 : 0)) * 1000).toISOString().slice(0, 10) : "";
  return String(value);
}

/** What was typed in, as the column holds it; empty is none. */
function parsed(column: Column, value: unknown, row: Row): unknown {
  if (column.type === "checkbox") return !!value;
  if (value === "" || value == null) return column.type === "date" ? 0 : null;
  if (column.type === "number" || column.type === "page") return Number(value);
  if (column.type === "money") return Math.round(Number(value) * toMinor(1, column.currency?.(row) ?? "") * 10 ** 6) / 10 ** 6;
  if (column.type === "date") return Date.parse(String(value)) / 1000 + (column.until ? DAY : 0);
  return String(value);
}

function input(column: Column, row?: Row): HtmlString {
  const name = column.name!, value = row ? shown(column, row) : "";
  if (column.type === "checkbox") return html`<input type=checkbox name="${name}" ${row && Number(row[name]) ? html`checked` : ""} aria-label="${column.label}">`;
  if (column.type === "select") {
    return html`<select name="${name}" aria-label="${column.label}">${column.options!.map(([v, label]) => html`<option value="${v}" ${v === value ? html`selected` : ""}>${label}`)}</select>`;
  }
  const type = { number: "number", money: "number", date: "date", page: "qgcms-page" }[String(column.type)] ?? "text";
  const step = column.type === "number" || column.type === "money" ? html`step=any` : "";
  return html`<input type=${type} ${step} name="${name}" value="${value}" aria-label="${column.label}">`;
}

/** The table: a row saves when a cell changes, the last row adds one. */
export async function renderRows(node: Node, spec: Rows): Promise<HtmlString> {
  const t = shopT(node.app), table = node.app.db.table(spec.table);
  await table.init();
  const columns = await Promise.all(spec.columns.map(async (c) => ({ ...c, label: await c.label }))); // texts are promises
  const order = spec.order?.length ? sql`ORDER BY ${sql.join(spec.order.map((c) => sql.id(c)), ", ")}` : sql``;
  const rows = await node.app.db.query`SELECT * FROM ${sql.id(table)} ${whereOf(node, spec)} ${order}`;
  const cell = (c: Column, row: Row, key: Set<string>) =>
    c.show ? c.show(row) : key.has(c.name!) ? shown(c, row) : input(c, row);
  return html.async`<div class=u2-card data-rows="${spec.table}" data-vars="${JSON.stringify(spec.vars ?? {})}">
  <div class=-head>${spec.title}</div>
  <table class=u2-table>
    <thead><tr>
      ${columns.map((c) => html`<th>${c.label}`)}
      ${spec.fixed ? "" : html`<th>`}
    <tbody>${rows.map((row) => {
      const key = new Set(Object.keys(table.entryIdValues(row) ?? {}));
      return html.async`<tr data-id="${table.entryId(row)}">
      ${columns.map((c) => html`<td>${cell(c, row, key)}`)}
      ${spec.fixed ? "" : html.async`<td><button type=button class=-remove u2-confirm>${t`Remove`}</button>`}`;
    })}
    ${spec.fixed ? "" : html.async`<tfoot><tr class=-add>
      ${columns.map((c) => html`<td>${c.show ? "" : input(c)}`)}
      <td><button type=button class=-create>${t`Add`}</button>`}
  </table>
</div>`;
}

/** A change from `renderRows`' table; undefined if it names none of the page's tables. */
export async function saveRows(node: Node, specs: Rows[], vars: Record<string, unknown>): Promise<{ ok: boolean; error?: string } | undefined> {
  const spec = specs.find((s) => s.table === vars.table);
  if (!spec) return;
  const table = node.app.db.table(spec.table);
  await table.init();
  if (vars.remove != null) {
    if (spec.fixed) return { ok: false };
    return { ok: await table.delete(String(vars.remove)) };
  }
  const given = (vars.values ?? {}) as Record<string, unknown>;
  const before = vars.id != null ? await table.selectByID(String(vars.id)) : undefined;
  if (vars.id != null && !before) return { ok: false };
  if (vars.id == null && spec.fixed) return { ok: false };
  const key = before ? new Set(Object.keys(table.entryIdValues(before) ?? {})) : new Set<string>();
  const columns = spec.columns.filter((c) => c.name && !key.has(c.name) && c.name in given);
  const row: Row = { ...before, ...given, ...spec.where };
  const values = Object.fromEntries(columns.map((c) => [c.name!, parsed(c, given[c.name!], row)]));
  if (before) {
    if (Object.keys(values).length) await table.update(String(vars.id), values);
    return { ok: true };
  }
  await table.ensure({ ...values, ...spec.where });
  return { ok: true };
}
