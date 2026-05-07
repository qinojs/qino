/**
 * cms.backend.system/mod.ts
 * Port of cms.backend.system/index.php
 */

// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/context.ts";
import type { Node } from "../cms/lib/Node.ts";
import { getTypes } from "./health_check.ts";
import statistic from "./parts/statistic.ts";
import { backend } from "../cms.backend/mod.ts";
import pageApi from "./page_api.ts";

export const name = "cms.backend.system";
export const needs = ["cms.backend"];

/**
 * cms.backend.system install()
 * Port of cms.backend.system/install.php
 */
export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.system");
  if (P) {
    await P.title("en", "System");
    await P.title("de", "System");
  }
}

async function render(node: Node): Promise<string> {
  const ctx    = getCtx();
  const get    = ctx.get as Record<string, string>;
  const open   = get.open ?? null;
  const db     = node.app.db;
  const app    = node.app as any;

  // ── health checks ──────────────────────────────────────────────────────
  // Provide ctx on app so health_check.ts can read server/usr/settings info
  (app as any)._lastCtx = ctx;
  const types = await getTypes(app);

  // Collect health-check results per category
  const sections: Record<string, string[]> = {};
  for (const [type, checks] of Object.entries(types)) {
    const items: string[] = [];
    for (const [name, checkFn] of Object.entries(checks)) {
      let data: any;
      try { data = await checkFn(); } catch { continue; }
      if (!data) continue;

      let solutionsHtml = "";
      for (const [solution, solveData] of Object.entries(data.solutions ?? {}) as any) {
        let formFields = "";
        for (const [fname, field] of Object.entries(solveData.form ?? {})) {
          formFields += `<tr><td>${hee(fname.charAt(0).toUpperCase() + fname.slice(1))}:<td><input name="${hee(fname)}" type="${hee((field as any).type ?? "text")}">`;
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
<div class="c1-box">
  <div class="-head">${hee(type.charAt(0).toUpperCase() + type.slice(1))}</div>
  <div class="-body" style="max-height:700px; overflow:auto">
    <div class="healty_container">${items.join("")}</div>
  </div>
</div>`;
  }

  // ── server info ────────────────────────────────────────────────────────

  const serverIP  = ctx.server?.SERVER_ADDR ?? "";
  const appPATH   = app.appPATH ?? "";

  const mem = Deno.memoryUsage();
  const pid = Deno.pid; // Die Prozess-ID
  const appUptimeSec = performance.now() / 1000;
  const osUptimeSec = Deno.osUptime(); // Benötigt --allow-sys
  const load = Deno.loadavg();

  // Zeit-Formatierer (Minuten oder Stunden/Minuten)
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m.toFixed(2)}m`;
  };

  const serverInfoHtml = `
<div class="c1-box">
  <div class="-head">Systeminfos</div>
  <div style="overflow:auto">
    <div class="-body">
      <table class="c1-style" style="white-space:nowrap">
        <tr><td>Deno Version:<td>${hee(Deno.version.deno)}
        <tr><td>PID:<td>${hee(pid)}
        <tr><td>App Uptime:<td>${hee(formatTime(appUptimeSec))}
        <tr><td>Server Uptime:<td>${hee(formatTime(osUptimeSec))}
        <tr><td>System Load:<td>${hee(load[0].toFixed(2))} (1m) / ${hee(load[1].toFixed(2))} (5m)
        <tr><td>Heap (Used/Total):<td>${hee((mem.heapUsed / 1024 / 1024).toFixed(2))} / ${hee((mem.heapTotal / 1024 / 1024).toFixed(2))} MB
        <tr><td>RSS (Echter RAM):<td>${hee((mem.rss / 1024 / 1024).toFixed(2))} MB
        <tr><td>Server-IP:<td>${hee(serverIP)}
        <tr><td>APP-Path:<td>${hee(appPATH)}
      </table>
    </div>
  </div>
</div>`;

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
    mysqlHtml = `<table class="c1-style"><tbody>${rows}</table>`;
  }

  const mysqlBox = `
<div class="c1-box">
  <a class="-head" href="?open=mysql">mysql</a>
  <div class="-body">${mysqlHtml}</div>
</div>`;

  // ── locales / time ─────────────────────────────────────────────────────
  const osDate  = new Date().toISOString().replace("T", " ").slice(0, 19);
  const dbNow   = String(await db.one("SELECT NOW()") ?? "");

  const localesBox = `
<div class="c1-box">
  <div class="-head">Locales</div>
  <div class="-body">
    <table class="c1-style">
      <tr><td>Date()<td>${hee(osDate)}
      <tr><td>database<td>${hee(dbNow)}
      <tr>
        <td>Your Browser
        <td id="uaDateTest">
          <script>
          const now = new Date();
          const f = new Intl.DateTimeFormat(navigator.language, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
          });
          const p = f.formatToParts(now);
          const s = p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value+'-'+p.find(x=>x.type==='day').value
            +' '+p.find(x=>x.type==='hour').value+':'+p.find(x=>x.type==='minute').value+':'+p.find(x=>x.type==='second').value;
          document.getElementById('uaDateTest').textContent = s + ' (' + navigator.language + ')';
          </script>
    </table>
  </div>
</div>`;

  // ── statistics ─────────────────────────────────────────────────────────
  const statsBox = `
<div class="c1-box">
  <div class="-head">Statistics</div>
  <div class="-body" data-part="statistic">
    <button onclick="$fn('page::loadPart')(${node.id}, 'statistic')">run</button>
  </div>
</div>`;

  return `
<div class="beBoxCont">
  <style>
    .healty_container { display:grid; grid-gap:8px; }
    .healty_item { padding:8px; background:#eee; }
    .healty_item.-error   { background:hsl(0,100%,90%); }
    .healty_item.-warning { background:hsl(40,100%,90%); }
    .healty_item.-notice  { background:hsl(200,100%,90%); }
  </style>
  ${healthHtml}
  ${serverInfoHtml}
  ${mysqlBox}
  ${localesBox}
  ${statsBox}
</div>`;
}

export const cms = {
  node: {
    render,
    pageApi,
    parts: {
      statistic,
    },
  },
};
