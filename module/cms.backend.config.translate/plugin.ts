import { html, getCtx, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";

import type { HtmlString, App, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.config.translate", { en: "Translate", de: "Übersetzen" });
}

/** The translations of a smalltext row `s` are the smalltext_lang rows `l` with its key. */
export const own = sql`l.hash = s.hash AND l.namespace = s.namespace`;
/** How many of `langs` a row `s` has no translation in. */
export const missing = (langs: string[]) =>
  sql`(${langs.length} - (SELECT count(*) FROM smalltext_lang l WHERE ${own} AND l.lang IN (${sql.join(langs.map((l) => sql`${l}`))})))`;
export const key = (row: Row) => `${row.hash}|${row.namespace}`;

/** The translations of `rows`, by key(row): { lang: text }. One query. */
export async function textsOf(app: App, rows: Row[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (!rows.length) return out;
  for (const l of await app.db.query`SELECT hash, namespace, lang, text FROM smalltext_lang
    WHERE hash IN (${sql.join([...new Set(rows.map((r) => String(r.hash)))].map((h) => sql`${h}`))})`) {
    out.getOrInsertComputed(key(l), () => ({}))[String(l.lang)] = String(l.text);
  }
  return out;
}

async function table(node: Node, { vars }: { vars?: Record<string, unknown> } = {}) {
  const ctx = getCtx();
  const db = node.app.db;
  const langs = node.app.languages.all;

  const v = vars ?? ctx.req.query;
  const search = String(v.search ?? "").trim();
  const orderRaw = String(v.order ?? "missing");
  const dir = String(v.dir ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortable = ["namespace", "original", "count", "missing", ...langs];
  const order = sortable.includes(orderRaw) ? orderRaw : "missing";

  const like = `%${search}%`;
  const where = search
    ? sql`WHERE s.namespace LIKE ${like} OR s.original LIKE ${like} OR EXISTS (SELECT 1 FROM smalltext_lang l WHERE ${own} AND l.text LIKE ${like})`
    : sql``;
  const orderExpr = order === "missing" ? missing(langs)
    : langs.includes(order) ? sql`(SELECT l.text FROM smalltext_lang l WHERE ${own} AND l.lang = ${order})` : sql.id(order);
  const [rows, total] = await Promise.all([
    db.query`SELECT s.* FROM smalltext s ${where} ORDER BY ${orderExpr} ${sql.raw(dir)} LIMIT 100`,
    db.one`SELECT count(*) FROM smalltext`,
  ]);
  const texts = await textsOf(node.app, rows);

  const nextDir = (col: string) => col === order && dir === "DESC" ? "asc" : "desc";
  const sortMark = (col: string) => col === order ? (dir === "ASC" ? " ↑" : " ↓") : "";

  const langTh = langs.map(l => html`<th data-sort="${l}" data-dir="${nextDir(l)}">${l}${sortMark(l)}`);

  const rowsHtml = rows.map((row) => {
    const langTds = langs.map(l => html`<td><textarea data-lang="${l}">${texts.get(key(row))?.[l] ?? ""}</textarea>`);
    return html`<tr data-hash="${row.hash}" data-ns="${row.namespace}">
      <td class=-namespace>${row.namespace}
      <td><div class=-original>${row.original}</div>
      ${langTds}
      <td>${row.count}
      <td><button class=u2-unstyle data-action=translate_entry><u2-ico icon=translate>↻</u2-ico></button>
      <td><button class=u2-unstyle data-action=delete_entry><u2-ico icon=delete>✕</u2-ico></button>
    `;
  });

  return html`
  <table class="u2-table -Sticky">
    <thead><tr>
      <th data-sort=namespace data-dir="${nextDir("namespace")}">NS${sortMark("namespace")}
      <th data-sort=original data-dir="${nextDir("original")}">original${sortMark("original")}
      ${langTh}
      <th data-sort=count data-dir="${nextDir("count")}">count${sortMark("count")}
      <th width=10>
      <th width=10>
    <tbody>${rowsHtml}
  </table>
  <div class=-count>${rows.length} / ${total} entries</div>`;
}

async function render(node: Node) {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const langs = app.languages.all;
  const counterActive = !!(await app.settings.core.smalltext.counter);
  const search = (ctx.req.query.search ?? "").trim();
  const missingCount = Number(await app.db.one`SELECT count(*) FROM smalltext s WHERE ${missing(langs)} > 0`);

  return html.async`<div class=u2-card>
  <div class=-head>${t`Translate`}</div>
  <div>
    <input data-search value="${search}" placeholder="${t`Search`}…">
    <label><input type=checkbox data-set=toggle_counter ${counterActive ? "checked" : ""}> ${t`Counter`}</label>
    &nbsp;
    <button data-action=count_clean>${t`Clear counter`}</button>
    &nbsp;&nbsp;
    <button data-action=delete_not_used>${t`Delete unused`}</button>
    &nbsp;&nbsp;
    <button data-action=translate_untranslated>${t`Translate missing`} (${missingCount})</button>
    <br>
  </div>
  <div style="overflow:auto; padding:0; max-height:90vh" cms-part=table>
    ${table(node)}
  </div>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const db = app.db;
  const t = app.t;
  const langs = app.languages.all;
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${t`Entries`}:<td>${db.one`SELECT count(*) FROM smalltext`}
  <tr><td>${t`Missing translations`}:<td>${db.one`SELECT count(*) FROM smalltext s WHERE ${missing(langs)} > 0`}
</table>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { table },
  },
};
