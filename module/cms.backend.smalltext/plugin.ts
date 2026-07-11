import { hee, getCtx, sql, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.smalltext";
export const needs = ["cms.backend", "cms.text"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.smalltext", { en: "Translate", de: "Übersetzen" });
}

export async function table(node: Node, { vars }: { vars?: Record<string, unknown> } = {}): Promise<string> {
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

  const langTh = langs.map(l => `<th data-sort="${hee(l)}" data-dir="${hee(nextDir(l))}">${hee(l)}${sortMark(l)}`).join("");
  const codeLogTh = isSuperuser ? "<th>code_logs" : "";

  let rowsHtml = "";
  for (const row of rows) {
    const langTds = langs.map(l => `<td><textarea data-lang="${hee(l)}">${hee(row[l] ?? "")}</textarea>`).join("");
    let codeLogTd = "";
    if (isSuperuser) {
      const logs = await db.query`SELECT * FROM smalltext_code_log WHERE hash = ${row.hash} AND namespace = ${row.namespace}`;
      codeLogTd = `<td>${logs.map(r => `<a href="${hee(r.file)}:${hee(String(r.line))}">${hee(r.file)}:${hee(String(r.line))}</a>`).join("<br>")}`;
    }
    rowsHtml += `<tr data-hash="${hee(String(row.hash))}" data-ns="${hee(String(row.namespace))}">
      <td class=-namespace>${hee(row.namespace)}
      <td><div class=-original>${hee(row.original)}</div>
      ${langTds}
      <td>${hee(String(row.count))}
      ${codeLogTd}
      <td><button class=u2-unstyle data-action="translate_entry"><u2-ico icon=translate>↻</u2-ico></button>
      <td><button class=u2-unstyle data-action="delete_entry"><u2-ico icon=delete>✕</u2-ico></button>
    `;
  }

  return `
  <table class="u2-table -Sticky">
    <thead><tr>
      <th data-sort=namespace data-dir="${hee(nextDir("namespace"))}">NS${sortMark("namespace")}
      <th data-sort=original data-dir="${hee(nextDir("original"))}">original${sortMark("original")}
      ${langTh}
      <th data-sort=count data-dir="${hee(nextDir("count"))}">count${sortMark("count")}
      ${codeLogTh}
      <th width=10>
      <th width=10>
    <tbody>${rowsHtml}
  </table>
  <div class=-count>${hee(String(rows.length))} / ${hee(String(total))} entries</div>`;
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const langs = app.languages.all;
  const counterActive = !!(await app.settings.core.smalltext.counter);
  const codeLogActive = !!(await app.settings.core.smalltext.code_logger);
  const search = String(ctx.req.query.search ?? "").trim();
  const missingWhere = sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " OR ");
  const missing = missingWhere.parts.length ? Number(await app.db.one`SELECT count(*) FROM smalltext WHERE ${missingWhere}`) : 0;

  return `<div class=u2-card>
  <div class=-head>${await app.t`Translate`}</div>
  <div class=-body>
    <input data-search value="${hee(search)}" placeholder="${await app.t`Search`}…">
    <label><input type=checkbox data-set=toggle_counter ${counterActive ? "checked" : ""}> ${await app.t`Counter`}</label>
    &nbsp;
    <button data-action=count_clean>${await app.t`Clear counter`}</button>
    &nbsp;&nbsp;
    <label><input type=checkbox data-set=toggle_code_log ${codeLogActive ? "checked" : ""}> ${await app.t`Code logger`}</label>
    &nbsp;
    <button data-action=code_log_clean>${await app.t`Clear log`}</button>
    &nbsp;&nbsp;
    <button data-action=delete_not_used>${await app.t`Delete unused`}</button>
    &nbsp;&nbsp;
    <button data-action=translate_untranslated>${await app.t`Translate missing`} (${hee(String(missing))})</button>
    <br>
  </div>
  <div style="overflow:auto; padding:0; max-height:90vh" cms-part="table">
    ${await table(node)}
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const db = app.db;
  const langs = app.languages.all;
  const total = Number(await db.one`SELECT count(*) FROM smalltext`);
  const missing = Number(await db.one`SELECT count(*) FROM smalltext WHERE ${sql.join(langs.map(l => sql`COALESCE(${sql.id(l)}, '') = ''`), " OR ")}`);
  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${await app.t`Entries`}:<td>${hee(String(total))}
  <tr><td>${await app.t`Missing translations`}:<td>${hee(String(missing))}
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
