import dbSchema from "./dbschema.json" with { type: "json" };
import { html, type HtmlString, getCtx, sql, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.smalltext";
export const needs = ["cms.backend", "cms.text"];
export { dbSchema };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.smalltext", { en: "Translate", de: "Übersetzen" });
}

export async function table(node: Node, { vars }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  const db = node.app.db;
  const langs = node.app.languages.all;
  const isSuperuser = !!(await ctx.user?.get("superuser"));

  const v = vars ?? ctx.req.query;
  const search = String(v.search ?? "").trim();
  const orderRaw = String(v.order ?? "missing");
  const dir = String(v.dir ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortable = ["namespace", "original", "count", "missing", ...langs];
  const order = sortable.includes(orderRaw) ? orderRaw : "missing";

  const like = `%${search}%`;
  const where = search
    ? sql`WHERE (${sql.join(["namespace", "original", ...langs].map(c => sql`${sql.id(c)} LIKE ${like}`), " OR ")})`
    : sql.raw("");

  const missingExpr = sql.join(langs.map(l => sql`CASE WHEN COALESCE(${sql.id(l)}, '') = '' THEN 1 ELSE 0 END`), " + ");
  const orderExpr = order === "missing" ? sql`(${missingExpr})` : sql.id(order);
  const rows = await db.query`SELECT * FROM smalltext ${where} ORDER BY ${orderExpr} ${sql.raw(dir)} LIMIT 100`;
  const total = Number(await db.one`SELECT count(*) FROM smalltext`);

  const nextDir = (col: string) => col === order && dir === "DESC" ? "asc" : "desc";
  const sortMark = (col: string) => col === order ? (dir === "ASC" ? " ↑" : " ↓") : "";

  const langTh = html.join(langs.map(l => html`<th data-sort="${l}" data-dir="${nextDir(l)}">${l}${sortMark(l)}`));
  const codeLogTh = isSuperuser ? html.raw("<th>code_logs") : "";

  const rowsHtml: HtmlString[] = [];
  for (const row of rows) {
    const langTds = html.join(langs.map(l => html`<td><textarea data-lang="${l}">${row[l]}</textarea>`));
    let codeLogTd: HtmlString | string = "";
    if (isSuperuser) {
      const logs = await db.query`SELECT * FROM smalltext_code_log WHERE hash = ${row.hash} AND namespace = ${row.namespace}`;
      codeLogTd = html`<td>${html.join(
        logs.map(r => html`<a href="${r.file}:${r.line}">${r.file}:${r.line}</a>`), "<br>"
      )}`;
    }
    rowsHtml.push(html`<tr data-hash="${row.hash}" data-ns="${row.namespace}">
      <td class=-namespace>${row.namespace}
      <td><div class=-original>${row.original}</div>
      ${langTds}
      <td>${row.count}
      ${codeLogTd}
      <td><button class=u2-unstyle data-action=translate_entry><u2-ico icon=translate>↻</u2-ico></button>
      <td><button class=u2-unstyle data-action=delete_entry><u2-ico icon=delete>✕</u2-ico></button>
    `);
  }

  return html`
  <table class="u2-table -Sticky">
    <thead><tr>
      <th data-sort=namespace data-dir="${nextDir("namespace")}">NS${sortMark("namespace")}
      <th data-sort=original data-dir="${nextDir("original")}">original${sortMark("original")}
      ${langTh}
      <th data-sort=count data-dir="${nextDir("count")}">count${sortMark("count")}
      ${codeLogTh}
      <th width=10>
      <th width=10>
    <tbody>${html.join(rowsHtml)}
  </table>
  <div class=-count>${rows.length} / ${total} entries</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const langs = app.languages.all;
  const counterActive = !!(await app.settings.core.smalltext.counter);
  const codeLogActive = !!(await app.settings.core.smalltext.code_logger);
  const search = String(ctx.req.query.search ?? "").trim();
  const missingWhere = sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " OR ");
  const missing = missingWhere.parts.length ? Number(await app.db.one`SELECT count(*) FROM smalltext WHERE ${missingWhere}`) : 0;

  return html.async`<div class=u2-card>
  <div class=-head>${t`Translate`}</div>
  <div class=-body>
    <input data-search value="${search}" placeholder="${t`Search`}…">
    <label><input type=checkbox data-set=toggle_counter ${counterActive ? "checked" : ""}> ${t`Counter`}</label>
    &nbsp;
    <button data-action=count_clean>${t`Clear counter`}</button>
    &nbsp;&nbsp;
    <label><input type=checkbox data-set=toggle_code_log ${codeLogActive ? "checked" : ""}> ${t`Code logger`}</label>
    &nbsp;
    <button data-action=code_log_clean>${t`Clear log`}</button>
    &nbsp;&nbsp;
    <button data-action=delete_not_used>${t`Delete unused`}</button>
    &nbsp;&nbsp;
    <button data-action=translate_untranslated>${t`Translate missing`} (${missing})</button>
    <br>
  </div>
  <div style="overflow:auto; padding:0; max-height:90vh" cms-part=table>
    ${await table(node)}
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
  <tr><td>${t`Missing translations`}:<td>${db.one`SELECT count(*) FROM smalltext WHERE ${sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " OR ")}`}
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
