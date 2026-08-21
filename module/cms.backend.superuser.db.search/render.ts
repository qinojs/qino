import { getCtx, html } from "@qino/qino";

import { LIMIT, search, SMALL_ROWS, words } from "./lib/search.ts";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { TableSearch } from "./lib/search.ts";

const MAX_CELL = 200; // longer values are shown as a snippet around the first hit

export async function render(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const term = String(getCtx().req.query.db_search ?? "").trim();

  const t0 = performance.now();
  const results = term ? await search(app.db, term) : [];
  const total = performance.now() - t0;

  const terms = words(term);
  const tables = await Promise.all(results.map((result) => renderTable(app, result, terms)));
  const summary = !term
    ? html.async`<small>${t`Indexed fields are searched by word prefix (fulltext where available); tables with fewer than ${String(SMALL_ROWS)} rows are scanned for substrings.`}</small>`
    : html.async`<small>${results.length} ${t`tables with hits`} · ${total.toFixed(1)} ms</small>`;

  return html.async`<div>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`Search database`}</div>
    <div class=-body>
      <form>
        <input type=search name=db_search value="${term}" placeholder="${t`Search all tables`}…" autofocus>
        <button>${t`Search`}</button>
      </form>
      ${summary}
    </div>
  </div>
  ${tables}
</div>`;
}

function renderTable(app: App, result: TableSearch, terms: string[]): Promise<HtmlString> {
  const t = app.t;
  const how = result.parts.map((part) => `${part.mode}: ${part.fields.join(", ")}`).join(" · ");
  const fields = result.parts.flatMap((part) => part.fields);
  const head = html.join(Object.keys(result.rows[0] ?? {}).map((field) => html`<th>${field}`));
  const rows = html.join(result.rows.map((row) => renderRow(row, fields, terms)));
  const more = result.more ? html.async` · ${t`showing first`} ${String(LIMIT)}` : "";
  const body = result.error
    ? html.async`<u2-alert open variant=danger>${result.error}</u2-alert>`
    : html.async`<u2-table style="padding:0;max-height:60vh;overflow:auto">
      <table class="u2-table -Sticky">
        <thead><tr>${head}
        <tbody>${rows}
      </table>
    </u2-table>`;

  return html.async`<div class=u2-card>
    <div class=-head>${result.table} <small>${result.rows.length} ${t`rows`}${more}</small></div>
    ${body}
    <div>
      <small>${result.ms.toFixed(1)} ms</small>
      <small>${how}</small>
    </div>
  </div>`;
}

function renderRow(row: Row, fields: string[], terms: string[]): HtmlString {
  const cells = Object.entries(row).map(([field, value]) =>
    html`<td>${cell(value, fields.includes(field) ? terms : [])}`
  );
  return html`<tr>${cells}`;
}

function cell(value: unknown, terms: string[]): HtmlString | unknown {
  if (value == null) return html`<small>NULL</small>`;
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return mark(snippet(text, terms), terms);
}

/** Cut a window around the first hit so long texts stay readable. */
function snippet(text: string, terms: string[]): string {
  if (text.length <= MAX_CELL) return text;
  const at = terms.length ? text.toLowerCase().indexOf(terms[0]) : -1;
  if (at < 0) return text.slice(0, MAX_CELL) + "…";
  const from = Math.max(0, at - MAX_CELL / 4);
  return (from ? "…" : "") + text.slice(from, from + MAX_CELL) + "…";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap every search word in <mark>; the parts stay escaped by html``. */
function mark(text: string, terms: string[]): HtmlString {
  if (!terms.length) return html`${text}`;
  const parts = text.split(new RegExp(`(${terms.map(escapeRe).join("|")})`, "ig"));
  return html.join(parts.map((part, i) => i % 2 ? html`<mark>${part}</mark>` : html`${part}`));
}
