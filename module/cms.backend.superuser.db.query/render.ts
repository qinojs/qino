// deno-lint-ignore-file no-explicit-any
import { getCtx, html, HtmlString, sql, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { askDbAi } from "./lib/ai.ts";

const MAX_ROWS = 1000; // cap rendered rows; the query itself is not limited

// Statements that return rows go through query(); everything else through exec() for affectedRows/insertId.
const READ_RE = /^\s*(?:SELECT|SHOW|PRAGMA|EXPLAIN|DESCRIBE|DESC|WITH|VALUES)\b/i;

// SQL keywords offered by the autocomplete next to table/field names.
const KEYWORDS = "SELECT FROM WHERE GROUP BY ORDER LIMIT OFFSET INSERT INTO VALUES UPDATE SET DELETE JOIN LEFT INNER OUTER ON AS AND OR NOT NULL LIKE IN IS DISTINCT COUNT SUM AVG MIN MAX DESC ASC".split(" ");

type Table = { name: string; fields: { name: string; type: string }[] };

const raw = (s: string): HtmlString => new HtmlString(s);
const join = (parts: Array<HtmlString | string>): HtmlString => new HtmlString(parts.join(""));

export async function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  if (!await ctx.user?.get("superuser")) return raw("<div></div>");

  const tables = await buildSchema(app);
  const token = ctx.post?.qgToken === ctx.token;
  const isAsk = ctx.post?.ask != null; // AI form vs. run form
  const question = String(ctx.post?.prompt ?? "").trim();

  // AI prompt prefills the editor with generated SQL (using the current query as context); the user reviews and runs it.
  let sql = String(ctx.post?.sql ?? "").trim();
  let aiNote = "";
  if (isAsk && question && token) {
    const ai = await askDbAi(app, question, await schemaText(app), sql);
    sql = ai.sql || sql;
    aiNote = ai.note;
  }

  const result = !isAsk && sql && token ? runQuery(app, sql) : "";

  return html.async`<div style="flex:1 1 auto">
  ${renderAi(app, question, aiNote)}
  <form method=post class=-console>
    <input type=hidden name=qgToken value="${ctx.token}">
    <u2-code trim language=sql class=-editor><textarea name=sql placeholder="SELECT * FROM …">${sql}</textarea></u2-code>
    <div class=-bar>
      <button>${app.t`Run`}</button>
      <small>${app.t`Ctrl/⌘ + Enter`} · ${app.t`one statement`}</small>
    </div>
  </form>
  ${result}
  ${renderHelper(app, tables)}
  <script type=application/json class=-schema>${raw(JSON.stringify({ keywords: KEYWORDS, tables }))}</script>
</div>`;
}

function renderAi(app: App, question: string, note: string): Promise<HtmlString> | string {
  if (!app.ai) return "";
  const msg = note ? html`<u2-alert open variant=danger style="margin-top:4px">${note}</u2-alert>` : "";
  return html.async`<form method=post class=-ai>
    <input type=hidden name=qgToken value="${getCtx().token}">
    <input type=hidden name=sql class=-aisql>
    <div class=-bar>
      <input name=prompt class=-prompt placeholder="${app.t`Ask the database in plain language…`}" value="${question}">
      <button name=ask>${app.t`Generate SQL`}</button>
    </div>
    ${msg}
  </form>`;
}

async function runQuery(app: App, text: string): Promise<HtmlString> {
  const t0 = performance.now();
  try {
    if (READ_RE.test(text)) {
      const rows = await app.db.query(sql.raw(text));
      return await renderRows(app, rows, performance.now() - t0);
    }
    const res = await app.db.exec(sql.raw(text));
    const ms = (performance.now() - t0).toFixed(1);
    const insert = res.insertId ? ` · insertId ${res.insertId}` : "";
    return await html.async`<u2-alert open variant=success class=-result>${res.affectedRows} ${app.t`rows affected`}${insert} · ${ms} ms</u2-alert>`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return await html.async`<u2-alert open variant=danger class=-result>${msg}</u2-alert>`;
  }
}

async function renderRows(app: App, rows: any[], ms: number): Promise<HtmlString> {
  if (!rows.length) return await html.async`<u2-alert open class=-result>${app.t`0 rows`} · ${ms.toFixed(1)} ms</u2-alert>`;

  const cols = Object.keys(rows[0]);
  const shown = rows.slice(0, MAX_ROWS);
  const head = join(cols.map(c => html`<th>${c}`));
  const body = join(shown.map(r => html`<tr>${join(cols.map(c => html`<td>${cell(r[c])}`))}`));
  const more = rows.length > MAX_ROWS ? html.async` · ${app.t`showing first`} ${MAX_ROWS}` : "";

  return await html.async`<div class="u2-card -full -result">
    <div class="-head">${rows.length} ${app.t`rows`} · ${ms.toFixed(1)} ms${more}</div>
    <u2-table style="padding:0">
      <table class=u2-table>
        <thead><tr>${head}<tbody>${body}
      </table>
    </u2-table>
  </div>`;
}

function cell(v: unknown): unknown {
  if (v == null) return raw(`<span class=-null>NULL</span>`);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return html`<code>${JSON.stringify(v)}</code>`;
  return v;
}

// Tables (without internal `_`-prefixed ones) with their fields — used by helper, autocomplete and AI.
async function buildSchema(app: App): Promise<Table[]> {
  const tables = Object.values(app.db.tables ?? {})
    .filter((t) => !t.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(tables.map(async (t) => {
    const fields = await t.init();
    return {
      name: t.name,
      fields: Object.entries(fields).map(([name, f]) => ({ name, type: f.vs?.Type ?? "" })),
    };
  }));
}

// AI context from the documented JSON schema — types, primary keys, foreign keys (x-qg-parent), descriptions and ~row counts.
async function schemaText(app: App): Promise<string> {
  const props = app.db.schema?.properties ?? {};
  const counts = await rowCounts(app);
  return Object.entries(props as Record<string, any>)
    .filter(([table]) => !table.startsWith("_"))
    .map(([table, def]) => {
      const fields = def.additionalProperties?.properties ?? {};
      const cols = Object.entries(fields as Record<string, any>).map(([name, f]) => {
        const parts = [name, f.type ?? "any"];
        if (f["x-index"] === "primary") parts.push("PK");
        if (f["x-qg-parent"]) parts.push(`FK->${f["x-qg-parent"]}${f["x-qg-parent-field"] ? "." + f["x-qg-parent-field"] : ""}`);
        if (f.description) parts.push(`-- ${f.description}`);
        return "  " + parts.join(" ");
      });
      const rows = table in counts ? ` -- ~${counts[table]} rows` : "";
      return `${table}(${rows}\n${cols.join(",\n")}\n)`;
    }).join("\n\n");
}

// Approximate row counts for all tables in a single fast query (no COUNT(*) scan). MySQL only; other dialects → empty.
async function rowCounts(app: App): Promise<Record<string, number>> {
  if (app.db.dialect !== "mysql") return {};
  const rows = await app.db.query`SELECT table_name AS t, table_rows AS n FROM information_schema.tables WHERE table_schema = DATABASE()`;
  return Object.fromEntries(rows.map((r: any) => [r.t, Number(r.n)]));
}

// Reference list, clickable to insert into the editor.
function renderHelper(app: App, tables: Table[]): Promise<HtmlString> {
  const items = join(tables.map((t) => {
    const fieldList = join(t.fields.map((f) =>
      html`<button type=button class=-field data-field="${f.name}" title="${f.type}">${f.name}</button>`
    ));
    return html`<details class=-table>
      <summary><button type=button class=-tname data-table="${t.name}">${t.name}</button> <small>${t.fields.length}</small></summary>
      <div class=-fields>${fieldList}</div>
    </details>`;
  }));

  return html.async`<div class="u2-card -full -helper">
    <div class="-head">${app.t`Tables & fields`} (${tables.length})</div>
    <div class="-body">
      <input type=search class=-tsearch placeholder="${app.t`Filter`}…">
      <div class=-tables>${items}</div>
    </div>
  </div>`;
}
