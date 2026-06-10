import { hee, type App } from "../core/mod.ts";
import { getTypes, type CheckResult, type Solution } from "./health_check.ts";
export { healthChecks } from "./healthChecks.ts";
import statistic, { details as statisticDetails } from "./parts/statistic.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.system";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.system", { en: "System", de: "System" });
}

async function render(node: Node): Promise<string> {
  const db   = node.app.db;
  const app  = node.app;

  // ── server info ────────────────────────────────────────────────────────

  const mem = Deno.memoryUsage();
  const pid = Deno.pid;
  const appUptimeSec = performance.now() / 1000;
  const osUptimeSec = Deno.osUptime(); // requires --allow-sys
  const load = Deno.loadavg();

  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  const osStartIso  = new Date(Date.now() - osUptimeSec  * 1000).toISOString();

  const serverInfoHtml = `
<div class=u2-card>
  <div class=-head>${await app.t`System info`}</div>
  <div class=-body style="padding:0">
    <table class="u2-table" style="white-space:nowrap">
      <tr><td>${await app.t`Deno Version`}:<td>${hee(Deno.version.deno)}
      <tr><td>${await app.t`PID`}:<td>${hee(pid)}
      <tr><td>${await app.t`App Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
      <tr><td>${await app.t`Server Uptime`}:<td><u2-time datetime="${osStartIso}" second type=relative></u2-time>
      <tr><td>${await app.t`System Load`}:<td>${hee(load[0].toFixed(2))} (1m) / ${hee(load[1].toFixed(2))} (5m)
      <tr><td>${await app.t`Heap (Used/Total)`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>
      <tr><td>${await app.t`RSS (actual RAM)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
      <tr><td>${await app.t`APP-Path`}:<td>${hee(app.appPATH)}
    </table>
  </div>
</div>`;

  // ── health checks ──────────────────────────────────────────────────────
  const types = await getTypes(app);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let healthHtml = "";
  for (const [type, checks] of Object.entries(types)) {
    const items: string[] = [];
    for (const [name, checkFn] of Object.entries(checks)) {
      let data: CheckResult;
      try { data = await checkFn(); } catch { continue; }
      if (!data) continue;

      const solutions = Object.entries(data.solutions ?? {}) as [string, Solution][];
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
  <button type="button">solve ▾</button>
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
    healthHtml += `<div class="u2-card">
  <div class="-head">${hee(cap(type))}</div>
  <div class="-body" style="max-height:700px;overflow:auto">
    <div class="healty_container">${items.join("")}</div>
  </div>
</div>`;
  }

  // ── mysql config ───────────────────────────────────────────────────────
  const mysqlRelevant = new Set(["version", "max_allowed_packet", "innodb_buffer_pool_size", "max_connections"]);
  const mysqlVars = await db.all("SHOW VARIABLES");
  const mysqlMap = new Map(mysqlVars.map((r: Record<string, string>) => [r.Variable_name, r.Value]));

  const fmtMysql = (name: string, value: string) => {
    if (name === "max_allowed_packet" || name === "innodb_buffer_pool_size") return (Number(value) / 1024 / 1024).toFixed(1) + " MB";
    return value;
  };

  let mysqlSummaryRows = "";
  for (const name of mysqlRelevant) {
    const value = mysqlMap.get(name) ?? "";
    mysqlSummaryRows += `<tr><td>${hee(name)}<td>${hee(fmtMysql(name, value))}`;
  }

  const mysqlLoadBtn = `<button data-load-part="mysql-details">Details</button>`;

  const mysqlBox = `
<div class="u2-card">
  <div class="-head">MySQL</div>
  <table class="u2-table" style="width:auto"><tbody>${mysqlSummaryRows}</table>
  <div class="-body" data-part="mysql-details" style="max-width:30rem; max-height:30rem; overflow:auto">
    ${mysqlLoadBtn}
  </div>
</div>`;

  // ── locales / time ─────────────────────────────────────────────────────
  const osIso   = new Date().toISOString();
  const dbRaw   = await db.one("SELECT UTC_TIMESTAMP()");
  const dbIso   = (dbRaw instanceof Date ? dbRaw : new Date(String(dbRaw))).toISOString();
  const localesBox = `
<div class="u2-card">
  <div class="-head">${await app.t`Time`}</div>
  <div class="-body" style="padding:0">
    <table class=u2-table>
      <tr><td>${await app.t`OS`}<td>${osIso.slice(0, 19).replace("T", " ")}<td>UTC+0
      <tr><td>${await app.t`DB`}<td>${dbIso.slice(0, 19).replace("T", " ")}<td>UTC+0
      <tr><td>${await app.t`Browser`}<td class="-browser-time"><td class="-browser-tz">
    </table>
  </div>
</div>`;

  // ── storage ───────────────────────────────────────────────────────────
  const statsBox = `
<div class="u2-card" style="flex-grow:0">
  <div class="-head">Speicher</div>
  ${await statistic(node)}
</div>`;

  return `
<div class="u2-flex">
  <style>
    .u2-card {
      min-width:25rem;
    }
    .healty_container { display:grid; grid-gap:8px; }
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
  ${mysqlBox}
  ${localesBox}
  ${statsBox}
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const types = await getTypes(app);

  let errors = 0, warnings = 0;
  for (const [type, checks] of Object.entries(types)) {
    for (const checkFn of Object.values(checks)) {
      let result;
      try { result = await (checkFn as () => Promise<unknown>)(); } catch { continue; }
      if (!result) continue;
      if (type === "error") errors++;
      else if (type === "warning") warnings++;
    }
  }

  const badge = (n: number, label: string, color: string) =>
    n ? `<span style="background:${color};color:#fff;border-radius:3px;padding:1px 7px;margin-right:4px">${n} ${label}</span>` : "";

  const statusHtml = (errors || warnings)
    ? badge(errors, await app.t`Errors`, "hsl(0,80%,45%)") + badge(warnings, await app.t`Warnings`, "hsl(40,90%,40%)")
    : `<span style="color:green">&#10003; ${await app.t`All OK`}</span>`;

  // DB top tables
  const tables = await app.db.all("SHOW TABLE STATUS").catch(() => []);
  tables.sort((a, b) => ((b.Data_length ?? 0) + (b.Index_length ?? 0)) - ((a.Data_length ?? 0) + (a.Index_length ?? 0)));
  const dbRows = tables.slice(0, 3).map((t) => {
    const size = (t.Data_length ?? 0) + (t.Index_length ?? 0);
    return `<tr><td>${hee(t.Name)}<td style="text-align:right"><u2-bytes>${size}</u2-bytes>`;
  }).join("");

  // Cache size
  const cacheDir = app.appPATH + "cache/";
  let cacheSize = 0, cacheCount = 0;
  try {
    for await (const entry of Deno.readDir(cacheDir)) {
      if (entry.isFile) { const s = await Deno.stat(cacheDir + entry.name).catch(() => null); cacheSize += s?.size ?? 0; cacheCount++; }
    }
  } catch { /* cache dir may not exist */ }

  return `<div class=-body>${statusHtml}</div>
<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">` + await systemInfoRows(app) + `</table>
<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${await app.t`Top DB tables`}<th style="text-align:right">${await app.t`Size`}
  <tbody>${dbRows}
</table>
<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <tr><td>${await app.t`Cache files`}:<td>${hee(String(cacheCount))}
  <tr><td>${await app.t`Cache size`}:<td><u2-bytes>${cacheSize}</u2-bytes>
</table>
</div>`;
}

async function systemInfoRows(app: App): Promise<string> {
  const mem = Deno.memoryUsage();
  const load = Deno.loadavg();
  const appUptimeSec = performance.now() / 1000;
  const appStartIso = new Date(Date.now() - appUptimeSec * 1000).toISOString();
  return `
  <tr><td>${await app.t`Deno`}:<td>${hee(Deno.version.deno)}
  <tr><td>${await app.t`Uptime`}:<td><u2-time datetime="${appStartIso}" second type=relative></u2-time>
  <tr><td>${await app.t`Load (1m/5m/15m)`}:<td>${hee(load[0].toFixed(2))} / ${hee(load[1].toFixed(2))} / ${hee(load[2].toFixed(2))}
  <tr><td>${await app.t`RAM (RSS)`}:<td><u2-bytes>${mem.rss}</u2-bytes>
  <tr><td>${await app.t`Heap`}:<td><u2-bytes>${mem.heapUsed}</u2-bytes> / <u2-bytes>${mem.heapTotal}</u2-bytes>`;
}

async function mysqlDetails(node: Node): Promise<string> {
  const db = node.app.db;
  const vars = await db.all("SHOW VARIABLES");
  let rows = "";
  for (const row of vars) {
    rows += `<tr><td>${hee(row.Variable_name)}<td>${hee(String(row.Value))}`;
  }
  return `<table class="u2-table"><tbody>${rows}</table>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: {
      statistic,
      "statistic-details": statisticDetails,
      "mysql-details": mysqlDetails,
    },
  },
};
