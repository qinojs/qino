import { hee, sql, type App } from "../core/mod.ts";
import { getHealthTypes, type CheckResult } from "./lib/healthRegistry.ts";
export { healthChecks } from "./healthChecks.ts";
import statistic, { dbTableStats, details as statisticDetails } from "./parts/statistic.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.system";
export const description = "Shows runtime, database, cache, and health information.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.system", { en: "System", de: "System" });
}

async function render(node: Node): Promise<string> {
  const { t, db } = node.app;
  const app  = node.app;

  // ── server info ────────────────────────────────────────────────────────

  const mem = Deno.memoryUsage();
  const appUptimeSec = performance.now() / 1000;
  const osUptimeSec = Deno.osUptime(); // requires --allow-sys
  const load = Deno.loadavg();

  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  const osStartIso  = new Date(Date.now() - osUptimeSec  * 1000).toISOString();

  const serverInfoHtml = `
<div class=u2-card>
  <div class=-head>${await t`System info`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <tr><td>${await t`Deno Version`}:<td>${hee(Deno.version.deno)}
      <tr><td>${await t`PID`}:<td>${hee(Deno.pid)}
      <tr><td>${await t`App Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
      <tr><td>${await t`Server Uptime`}:<td><u2-time datetime="${osStartIso}" second type=relative></u2-time>
      <tr><td>${await t`System Load`}:<td>${hee(load[0].toFixed(2))} (1m) / ${hee(load[1].toFixed(2))} (5m)
      <tr><td>${await t`Heap (Used/Total)`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>
      <tr><td>${await t`External`}:<td><u2-bytes>${mem.external}</u2-bytes>
      <tr><td>${await t`RSS (actual RAM)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
      <tr><td>${await t`APP-Path`}:<td>${hee(app.appPATH)}
    </table>
  </div>
</div>`;

  // ── health checks ──────────────────────────────────────────────────────
  const types = await getHealthTypes(app);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let healthHtml = "";
  for (const [type, checks] of Object.entries(types)) {
    const items: string[] = [];
    for (const [name, checkFn] of Object.entries(checks)) {
      let data: CheckResult;
      try { data = await checkFn(); } catch { continue; }
      if (!data) continue;

      const solutions = Object.entries(data.solutions ?? {});
      let solutionsHtml = "";
      if (solutions.length === 1) {
        const [solution, solveData] = solutions[0];
        let formFields = "";
        for (const [fname, field] of Object.entries(solveData.form ?? {})) {
          const inputType = typeof field.type === "string" ? field.type : "text";
          formFields += `<tr><td>${hee(cap(fname))}:<td><input name="${hee(fname)}" type="${hee(inputType)}">`;
        }
        solutionsHtml = `<form>
  ${formFields ? `<table><tbody style="vertical-align:baseline">${formFields}</table>` : ""}
  <button data-type="${hee(type)}" data-item="${hee(name)}" data-solution="${hee(solution)}">${hee(cap(solution))}</button>
</form>`;
      } else if (solutions.length > 1) {
        const menuItems = solutions.map(([solution]) =>
          `<li><button data-type="${hee(type)}" data-item="${hee(name)}" data-solution="${hee(solution)}">${hee(cap(solution))}</button>`
        ).join("");
        solutionsHtml = `<form><u2-menubutton>
  <button type=button>solve ▾</button>
  <menu>${menuItems}</menu>
</u2-menubutton></form>`;
      }

      items.push(`<div class="healty_item -${hee(type)}" data-type="${hee(type)}" data-item="${hee(name)}">
  ${checkFn.mod ? ` <small>${hee(checkFn.mod)}</small><br>` : ""}
  <strong>${hee(cap(name))}</strong>
  ${data.info ? `<p>${data.info}</p>` : ""}
  <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;margin-top:.5rem">${solutionsHtml}</div>
</div>`);
    }
    if (!items.length) continue;
    healthHtml += `<div class=u2-card>
  <div class=-head>${hee(cap(type))}</div>
  <div class=-body style="max-height:43.75rem;overflow:auto">
    <div class=healty_container>${items.join("")}</div>
  </div>
</div>`;
  }


  // ── db config (per dialect) ──────────────────────────────────────────────
  const dbBox = await renderDbBox(node);

  // ── locales / time ─────────────────────────────────────────────────────
  const osIso   = new Date().toISOString();
  const dbRaw   = await db.one`${sql.raw(dbUtcNowSql(db.dialect))}`;
  const dbIso   = (dbRaw instanceof Date ? dbRaw : new Date(String(dbRaw))).toISOString();
  const localesBox = `
<div class=u2-card>
  <div class=-head>${await t`Time`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table>
      <tr>
        <td>${await t`OS`}
        <td>${osIso.slice(0, 19).replace("T", " ")}
        <td>UTC+0
      <tr>
        <td>${await t`DB`}
        <td>${dbIso.slice(0, 19).replace("T", " ")}
        <td>UTC+0
      <tr>
        <td>${await t`Browser`}
        <td class=-browser-time>
        <td class=-browser-tz>
    </table>
  </div>
</div>`;

  // ── storage ───────────────────────────────────────────────────────────
  const statsBox = `
<div class=u2-card style="flex-grow:0">
  <div class=-head>${await t`Storage`}</div>
  ${await statistic(node)}
</div>`;

  return `
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
  ${healthHtml}
  ${dbBox}
  ${localesBox}
  ${statsBox}
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
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
    n ? `<span style="background:${color};color:#fff;border-radius:.1875rem;padding:1px .4375rem;margin-right:.25rem">${n} ${label}</span>` : "";

  const statusHtml = (errors || warnings)
    ? badge(errors, await t`Errors`, "hsl(0,80%,45%)") + badge(warnings, await t`Warnings`, "hsl(40,90%,40%)")
    : `<span style="color:green">&#10003; ${await t`All OK`}</span>`;

  // DB top tables
  const tables = await dbTableStats(app.db).catch(() => []);
  tables.sort((a, b) => b.bytes - a.bytes);
  const dbRows = tables.slice(0, 3).map((tbl) =>
    `<tr><td>${hee(tbl.name)}<td style="text-align:right"><u2-bytes>${tbl.bytes}</u2-bytes>`
  ).join("");

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

  return `<div class=-body>${statusHtml}</div>
<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">` + await systemInfoRows(app) + `</table>
<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${await t`Top DB tables`}<th style="text-align:right">${await t`Size`}
  <tbody>${dbRows}
</table>
<table class=u2-table style="white-space:nowrap;margin-top:1px">
  <tr><td>${await t`Cache files`}:<td>${hee(cacheCount)}
  <tr><td>${await t`Cache size`}:<td><u2-bytes>${cacheSize}</u2-bytes>
</table>
</div>`;
}

async function systemInfoRows(app: App): Promise<string> {
  const t = app.t;
  const mem = Deno.memoryUsage();
  const load = Deno.loadavg();
  const appUptimeSec = performance.now() / 1000;
  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  return `
  <tr><td>${await t`Deno`}:<td>${hee(Deno.version.deno)}
  <tr><td>${await t`Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
  <tr><td>${await t`Load (1m/5m/15m)`}:<td>${hee(load[0].toFixed(2))} / ${hee(load[1].toFixed(2))} / ${hee(load[2].toFixed(2))}
  <tr><td>${await t`RAM (RSS)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
  <tr><td>${await t`Heap`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>
  <tr><td>${await t`External`}:<td><u2-bytes>${mem.external}</u2-bytes>`;
}

// SQL for "now in UTC" per dialect (MySQL gives 'YYYY-MM-DD HH:MM:SS', others ISO).
function dbUtcNowSql(dialect: string): string {
  if (dialect === "postgres") return "SELECT now() AT TIME ZONE 'UTC'";
  if (dialect === "sqlite") return "SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')";
  return "SELECT UTC_TIMESTAMP()";
}

const kvTable = (rows: [string, string][]) =>
  `<table class=u2-table><tbody>${rows.map(([k, v]) => `<tr><td>${hee(k)}<td>${hee(v)}`).join("")}</table>`;

// Summary card with a "Details" button that lazy-loads the dialect-specific `db-details` part.
function dbCard(title: string, summaryRows: string): string {
  return `
<div class=u2-card>
  <div class=-head>${hee(title)}</div>
  <table class=u2-table style="width:auto"><tbody>${summaryRows}</table>
  <div class=-body cms-part=db-details style="max-width:30rem; max-height:30rem; overflow:auto">
    <button data-load-part=db-details>Details</button>
  </div>
</div>`;
}

function renderDbBox(node: Node): Promise<string> {
  if (node.app.db.dialect === "postgres") return postgresBox(node);
  if (node.app.db.dialect === "sqlite") return sqliteBox(node);
  return mysqlBox(node);
}

async function mysqlBox(node: Node): Promise<string> {
  const db = node.app.db;
  const RELEVANT = ["version", "max_allowed_packet", "innodb_buffer_pool_size", "max_connections"];
  const vars = await db.query`SHOW VARIABLES`;
  const map = new Map(vars.map((r: Record<string, string>) => [r.Variable_name, r.Value]));
  const fmt = (name: string, value: string) =>
    (name === "max_allowed_packet" || name === "innodb_buffer_pool_size")
      ? (Number(value) / 1024 / 1024).toFixed(1) + " MB" : value;
  const rows = RELEVANT.map((n) => `<tr><td>${hee(n)}<td>${hee(fmt(n, map.get(n) ?? ""))}`).join("");
  return dbCard("MySQL", rows);
}

async function postgresBox(node: Node): Promise<string> {
  const db = node.app.db;
  const NAMES = ["server_version", "max_connections", "shared_buffers", "work_mem"];
  const rows = await db.query`SELECT name, setting, unit FROM pg_settings WHERE name IN (${sql.join(NAMES.map((n) => sql`${n}`))}) ORDER BY name`;
  const body = rows.map((r: Record<string, string>) => `<tr><td>${hee(r.name)}<td>${hee(r.setting + (r.unit ? " " + r.unit : ""))}`).join("");
  return dbCard("PostgreSQL", body);
}

async function sqliteBox(node: Node): Promise<string> {
  const db = node.app.db;
  const PRAGMAS = ["journal_mode", "page_size", "foreign_keys"];
  let rows = `<tr><td>version<td>${hee(await db.one`SELECT sqlite_version()`)}`;
  for (const p of PRAGMAS) {
    const r = await db.row`PRAGMA ${sql.raw(p)}`;
    rows += `<tr><td>${hee(p)}<td>${hee(r ? Object.values(r)[0] : "")}`;
  }
  return dbCard("SQLite", rows);
}

async function dbDetails(node: Node): Promise<string> {
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
