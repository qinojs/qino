import { html, sql, type App, type HtmlString } from "@qino/qino";
import { getHealthTypes, type CheckResult } from "./lib/healthRegistry.ts";
export { healthChecks } from "./healthChecks.ts";
import statistic, { dbTableStats, details as statisticDetails } from "./parts/statistic.ts";
import { backend } from "@qino/qino/cms.backend";
import api from "./nodeApi.ts";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.system", { en: "System", de: "System" });
}

async function render(node: Node): Promise<HtmlString> {
  const { t, db } = node.app;
  const app  = node.app;

  // ── server info ────────────────────────────────────────────────────────

  const mem = Deno.memoryUsage();
  const appUptimeSec = performance.now() / 1000;
  const osUptimeSec = Deno.osUptime(); // requires --allow-sys
  const load = Deno.loadavg();

  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  const osStartIso  = new Date(Date.now() - osUptimeSec  * 1000).toISOString();

  const serverInfoHtml = html.async`
<div class=u2-card style="flex-basis: auto">
  <div class=-head>${t`System info`}</div>
  <div style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <tr><td>${t`Deno Version`}:<td>${Deno.version.deno}
      <tr><td>${t`PID`}:<td>${Deno.pid}
      <tr><td>${t`App Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
      <tr><td>${t`Server Uptime`}:<td><u2-time datetime="${osStartIso}" second type=relative></u2-time>
      <tr><td>${t`System Load`}:<td>${load[0].toFixed(2)} (1m) / ${load[1].toFixed(2)} (5m)
      <tr><td>${t`Heap (Used/Total)`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>
      <tr><td>${t`External`}:<td><u2-bytes>${mem.external}</u2-bytes>
      <tr><td>${t`RSS (actual RAM)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
      <tr><td>${t`APP-Path`}:<td>${app.appPATH}
    </table>
  </div>
</div>`;

  // ── health checks ──────────────────────────────────────────────────────
  const types = await getHealthTypes(app);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const healthCards: HtmlString[] = [];
  for (const [type, checks] of Object.entries(types)) {
    const items: HtmlString[] = [];
    for (const [name, checkFn] of Object.entries(checks)) {
      let data: CheckResult;
      try { data = await checkFn(); } catch { continue; }
      if (!data) continue;

      const solutions = Object.entries(data.solutions ?? {});
      let solutionsHtml: HtmlString | string = "";
      if (solutions.length === 1) {
        const [solution, solveData] = solutions[0];
        const formFields: HtmlString[] = [];
        for (const [fname, field] of Object.entries(solveData.form ?? {})) {
          const inputType = typeof field.type === "string" ? field.type : "text";
          formFields.push(html`<tr><td>${cap(fname)}:<td><input name="${fname}" type="${inputType}">`);
        }
        solutionsHtml = html`<form>
  ${formFields.length ? html`<table><tbody style="vertical-align:baseline">${formFields}</table>` : ""}
  <button data-type="${type}" data-item="${name}" data-solution="${solution}">${cap(solution)}</button>
</form>`;
      } else if (solutions.length > 1) {
        const menuItems = solutions.map(([solution]) =>
          html`<li><button data-type="${type}" data-item="${name}" data-solution="${solution}">${cap(solution)}</button>`
        );
        solutionsHtml = html`<form><u2-menubutton>
  <button type=button>solve ▾</button>
  <menu>${menuItems}</menu>
</u2-menubutton></form>`;
      }

      items.push(html`<div class="healty_item -${type}" data-type="${type}" data-item="${name}">
  ${checkFn.mod ? html` <small>${checkFn.mod}</small><br>` : ""}
  <strong>${cap(name)}</strong>
  ${data.info ? html`<p>${html.raw(data.info)}</p>` : ""}
  <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;margin-top:.5rem">${solutionsHtml}</div>
</div>`);
    }
    if (!items.length) continue;
    healthCards.push(html`<div class=u2-card>
  <div class=-head>${cap(type)}</div>
  <div class=-body style="max-height:43.75rem;overflow:auto">
    <div class=healty_container>${items}</div>
  </div>
</div>`);
  }

  // ── db config (per dialect) ──────────────────────────────────────────────
  const dbBox = await renderDbBox(node);

  // ── locales / time ─────────────────────────────────────────────────────
  const osIso   = new Date().toISOString();
  const dbRaw   = await db.one`${sql.raw(dbUtcNowSql(db.dialect))}`;
  const dbIso   = (dbRaw instanceof Date ? dbRaw : new Date(String(dbRaw))).toISOString();
  const localesBox = html.async`
<div class=u2-card>
  <div class=-head>${t`Time`}</div>
  <div style="padding:0">
    <table class=u2-table>
      <tr>
        <td>${t`OS`}
        <td>${osIso.slice(0, 19).replace("T", " ")}
        <td>UTC+0
      <tr>
        <td>${t`DB`}
        <td>${dbIso.slice(0, 19).replace("T", " ")}
        <td>UTC+0
      <tr>
        <td>${t`Browser`}
        <td class=-browser-time>
        <td class=-browser-tz>
    </table>
  </div>
</div>`;

  // ── storage ───────────────────────────────────────────────────────────
  const statsBox = html.async`
<div class=u2-card style="flex-grow:0">
  <div class=-head>${t`Storage`}</div>
  ${statistic(node)}
</div>`;

  return html.async`
<div class=u2-flex>
  <style>
    .u2-card {
      flex-basis:28rem;
    }
    .healty_container {
      display:grid; gap:.5rem;
    }
    .healty_item {
      padding:.5rem;
      background:color-mix(in srgb, var(--gray), #fff 80%);
      border-radius:var(--radius);
      &.-error   { background: color-mix(in srgb, var(--red), #fff 80%); }
      &.-warning { background: color-mix(in srgb, var(--orange), #fff 80%); }
      &.-notice  { background: color-mix(in srgb, var(--blue), #fff 80%); }
      button { background-color: var(--color-text); border-radius: .2rem; margin: 0;  }
    }
  </style>
  ${serverInfoHtml}
  ${healthCards}
  ${dbBox}
  ${localesBox}
  ${statsBox}
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const t = app.t;
  const types = await getHealthTypes(app);

  let errors = 0, warnings = 0;
  for (const [type, checks] of Object.entries(types)) {
    for (const checkFn of Object.values(checks)) {
      let result;
      try { result = await checkFn(); } catch { continue; }
      if (!result) continue;
      if (type === "error") errors++;
      else if (type === "warning") warnings++;
    }
  }

  const badge = (n: number, label: string, color: string) =>
    n ? html`<span style="background:${color};color:#fff;border-radius:.1875rem;padding:1px .4375rem;margin-right:.25rem">${n} ${label}</span>` : "";

  const statusHtml = (errors || warnings)
    ? html`${badge(errors, await t`Errors`, "hsl(0,80%,45%)")}${badge(warnings, await t`Warnings`, "hsl(40,90%,40%)")}`
    : html`<span style="color:green">&#10003; ${await t`All OK`}</span>`;

  // DB top tables
  const tables = await dbTableStats(app.db).catch(() => []);
  tables.sort((a, b) => b.bytes - a.bytes);
  const dbRows = html.join(tables.slice(0, 3).map((tbl) =>
    html`<tr><td>${tbl.name}<td style="text-align:right"><u2-bytes>${tbl.bytes}</u2-bytes>`
  ));

  // Cache size
  let cacheSize = 0, cacheCount = 0;
  async function measureCache(dir: string) {
    for (const entry of await Array.fromAsync(Deno.readDir(dir)).catch(() => [])) {
      if (entry.isDirectory) { await measureCache(dir + entry.name + "/"); continue; }
      cacheSize += (await Deno.stat(dir + entry.name).catch(() => null))?.size ?? 0;
      cacheCount++;
    }
  }
  await measureCache(app.appPATH + "cache/");

  return html.async`<div class=-body>${statusHtml}</div>
<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">${systemInfoRows(app)}</table>
<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${t`Top DB tables`}<th style="text-align:right">${t`Size`}
  <tbody>${dbRows}
</table>
<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <tr><td>${t`Cache files`}:<td>${cacheCount}
  <tr><td>${t`Cache size`}:<td><u2-bytes>${cacheSize}</u2-bytes>
</table>
</div>`;
}

function systemInfoRows(app: App): Promise<HtmlString> {
  const t = app.t;
  const mem = Deno.memoryUsage();
  const load = Deno.loadavg();
  const appUptimeSec = performance.now() / 1000;
  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  return html.async`
  <tr><td>${t`Deno`}:<td>${Deno.version.deno}
  <tr><td>${t`Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
  <tr><td>${t`Load (1m/5m/15m)`}:<td>${load[0].toFixed(2)} / ${load[1].toFixed(2)} / ${load[2].toFixed(2)}
  <tr><td>${t`RAM (RSS)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
  <tr><td>${t`Heap`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>
  <tr><td>${t`External`}:<td><u2-bytes>${mem.external}</u2-bytes>`;
}

// SQL for "now in UTC" per dialect (MySQL gives 'YYYY-MM-DD HH:MM:SS', others ISO).
function dbUtcNowSql(dialect: string): string {
  if (dialect === "postgres") return "SELECT now() AT TIME ZONE 'UTC'";
  if (dialect === "sqlite") return "SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')";
  return "SELECT UTC_TIMESTAMP()";
}

const kvTable = (rows: [string, string][]) =>
  html`<table class=u2-table><tbody>${rows.map(([k, v]) => html`<tr><td>${k}<td>${v}`)}</table>`;

// Summary card with a "Details" button that lazy-loads the dialect-specific `db-details` part.
function dbCard(title: string, summaryRows: HtmlString): HtmlString {
  return html`
<div class=u2-card>
  <div class=-head>${title}</div>
  <table class=u2-table style="width:auto"><tbody>${summaryRows}</table>
  <div class=-body cms-part=db-details style="max-width:30rem; max-height:30rem; overflow:auto">
    <button data-load-part=db-details>Details</button>
  </div>
</div>`;
}

function renderDbBox(node: Node): Promise<HtmlString> {
  if (node.app.db.dialect === "postgres") return postgresBox(node);
  if (node.app.db.dialect === "sqlite") return sqliteBox(node);
  return mysqlBox(node);
}

async function mysqlBox(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  const RELEVANT = ["version", "max_allowed_packet", "innodb_buffer_pool_size", "max_connections"];
  const vars = await db.query`SHOW VARIABLES`;
  const map = new Map(vars.map((r: Record<string, string>) => [r.Variable_name, r.Value]));
  const fmt = (name: string, value: string) =>
    (name === "max_allowed_packet" || name === "innodb_buffer_pool_size")
      ? (Number(value) / 1024 / 1024).toFixed(1) + " MB" : value;
  const rows = RELEVANT.map((n) => html`<tr><td>${n}<td>${fmt(n, map.get(n) ?? "")}`);
  return dbCard("MySQL", html.join(rows));
}

async function postgresBox(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  const NAMES = ["server_version", "max_connections", "shared_buffers", "work_mem"];
  const rows = await db.query`SELECT name, setting, unit FROM pg_settings WHERE name IN (${sql.join(NAMES.map((n) => sql`${n}`))}) ORDER BY name`;
  const body = rows.map((r: Record<string, string>) => html`<tr><td>${r.name}<td>${r.setting + (r.unit ? " " + r.unit : "")}`);
  return dbCard("PostgreSQL", html.join(body));
}

async function sqliteBox(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  const PRAGMAS = ["journal_mode", "page_size", "foreign_keys"];
  const rows = [html`<tr><td>version<td>${await db.one`SELECT sqlite_version()`}`];
  for (const p of PRAGMAS) {
    const r = await db.row`PRAGMA ${sql.raw(p)}`;
    rows.push(html`<tr><td>${p}<td>${r ? Object.values(r)[0] : ""}`);
  }
  return dbCard("SQLite", html.join(rows));
}

async function dbDetails(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  if (db.dialect === "postgres") {
    const rows = await db.query`SELECT name, setting FROM pg_settings ORDER BY name`;
    return kvTable(rows.map((r: Record<string, string>) => [r.name, String(r.setting)]));
  }
  if (db.dialect === "sqlite") {
    const PRAGMAS = ["journal_mode", "page_size", "cache_size", "foreign_keys", "synchronous", "auto_vacuum"];
    const rows: [string, string][] = [];
    for (const p of PRAGMAS) { const r = await db.row`PRAGMA ${sql.raw(p)}`; rows.push([p, String(r ? Object.values(r)[0] : "")]); }
    return kvTable(rows);
  }
  const vars = await db.query`SHOW VARIABLES`;
  return kvTable(vars.map((r: Record<string, string>) => [r.Variable_name, String(r.Value)]));
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: {
      statistic,
      "statistic-details": statisticDetails,
      "db-details": dbDetails,
    },
  },
};
