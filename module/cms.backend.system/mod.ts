import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import { getTypes, type CheckResult, type Solution } from "./health_check.ts";
import statistic from "./parts/statistic.ts";
import { backend } from "../cms.backend/mod.ts";
import pageApi from "./page_api.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.system";
export const needs = ["cms.backend"];

/**
 * cms.backend.system install()
 * Port of cms.backend.system/install.php
 */
export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.system");
  if (P) {
    await P.title("en", "System");
    await P.title("en", "System");
  }
}

async function render(node: Node): Promise<string> {
  const ctx    = getCtx();
  const get    = ctx.get as Record<string, string>;
  const open   = get.open ?? null;
  const db     = node.app.db;
  const app    = node.app;



  // ── server info ────────────────────────────────────────────────────────

  const appPATH   = app.appPATH;

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
      <tr><td>${await app.t`APP-Path`}:<td>${hee(appPATH)}
    </table>
  </div>
</div>`;


  // ── health checks ──────────────────────────────────────────────────────
  const types = await getTypes(app);

  // Collect health-check results per category
  const sections: Record<string, string[]> = {};
  for (const [type, checks] of Object.entries(types)) {
    const items: string[] = [];
    for (const [name, checkFn] of Object.entries(checks)) {
      let data: CheckResult;
      try { data = await checkFn(); } catch { continue; }
      if (!data) continue;

      let solutionsHtml = "";
      for (const [solution, solveData] of Object.entries(data.solutions ?? {}) as [string, Solution][]) {
        let formFields = "";
        for (const [fname, field] of Object.entries(solveData.form ?? {})) {
          const inputType = typeof field.type === "string" ? field.type : "text";
          formFields += `<tr><td>${hee(fname.charAt(0).toUpperCase() + fname.slice(1))}:<td><input name="${hee(fname)}" type="${hee(inputType)}">`;
        }
        solutionsHtml += `
<form style="margin:8px;">
  ${formFields ? `<table><tbody style="vertical-align:baseline">${formFields}</table>` : ""}
  <button data-type="${hee(type)}" data-item="${hee(name)}" data-solution="${hee(solution)}"
          style="background-color:var(--cms-dark); display:block; margin-left:auto">
    ${hee(solution.charAt(0).toUpperCase() + solution.slice(1))}
  </button>
</form>`;
      }

      items.push(`
<div class="healty_item -${hee(type)}" data-type="${hee(type)}" data-item="${hee(name)}">
  ${hee(name.charAt(0).toUpperCase() + name.slice(1))}<br>
  <small>${data.info ?? ""}</small>
  <div style="display:flex; flex-wrap:wrap; justify-content:flex-end">${solutionsHtml}</div>
</div>`);
    }
    sections[type] = items;
  }

  let healthHtml = "";
  for (const [type, items] of Object.entries(sections)) {
    healthHtml += `
<div class="u2-card">
  <div class="-head">${hee(type.charAt(0).toUpperCase() + type.slice(1))}</div>
  <div class="-body" style="max-height:700px; overflow:auto">
    <div class="healty_container">${items.join("")}</div>
  </div>
</div>`;
  }


  // ── mysql config ───────────────────────────────────────────────────────
  let mysqlHtml = "";
  if (open === "mysql") {
    const vars = await db.all("SHOW VARIABLES");
    const relevant = new Set(["max_allowed_packet"]);
    let rows = "";
    for (const row of vars) {
      const name  = row.Variable_name;
      const mark  = relevant.has(name);
      let   value = row.Value;
      if (name === "max_allowed_packet") value = (Number(value) / 1024).toFixed(1) + " KB";
      rows += `<tr><td ${mark ? 'style="font-weight:bold"' : ""}>${hee(name)}<td>${hee(String(value))}`;
    }
    mysqlHtml = `<table class="u2-table"><tbody>${rows}</table>`;
  }

  const mysqlBox = `
<div class="u2-card">
  <a class="-head" href="?open=mysql">mysql</a>
  <div class="-body">${mysqlHtml}</div>
</div>`;

  // ── locales / time ─────────────────────────────────────────────────────
  const osIso   = new Date().toISOString();
  const dbRaw   = await db.one("SELECT UTC_TIMESTAMP()");
  const dbIso   = (dbRaw instanceof Date ? dbRaw : new Date(String(dbRaw))).toISOString();
  const localesBox = `
<div class="u2-card">
  <div class="-head">${await app.t`Locales`}</div>
  <div class="-body" style="padding:0">
    <table class=u2-table>
      <tr><td>${await app.t`OS`}<td>${osIso.slice(0, 19).replace("T", " ")}<td>UTC+0
      <tr><td>${await app.t`DB`}<td>${dbIso.slice(0, 19).replace("T", " ")}<td>UTC+0
      <tr><td>${await app.t`Browser`}<td class="-browser-time"><td class="-browser-tz">
    </table>
  </div>
</div>`;

  // ── statistics ─────────────────────────────────────────────────────────
  const statsBox = `
<div class="u2-card">
  <div class="-head">${await app.t`Statistics`}</div>
  <div class="-body" data-part="statistic">
    <button onclick="import('${getCtx().sysURL}core/pub/js/apt.js').then(m=>m.apt.cms.node(${node.id}).html.part('statistic').get()).then(h=>{this.closest('[data-part]').innerHTML=h})">${await app.t`run`}</button>
  </div>
</div>`;

  return `
<div class="u2-flex -m-cms-backend-system">
  <style>
    .healty_container { display:grid; grid-gap:8px; }
    .healty_item { padding:8px; background:#eee; }
    .healty_item.-error   { background:hsl(0,100%,90%); }
    .healty_item.-warning { background:hsl(40,100%,90%); }
    .healty_item.-notice  { background:hsl(200,100%,90%); }
  </style>
  ${ctx.dev ? `<div style="flex:1 1 100%;background:#f90;color:#000;font-weight:bold;padding:10px 16px;font-size:1.1em">⚠ ${await app.t`Dev mode active`}</div>` : ""}
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

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    pageApi,
    parts: {
      statistic,
    },
  },
};
