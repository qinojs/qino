import { html, type HtmlString, sql, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { versedTables, versTable, thinHistory } from "../cms.versions/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.versions";
export const needs = ["cms.backend", "cms.versions"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Versions", de: "Versionen" });
}

async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const db = app.db;

  // table sizes (MySQL)
  const status = await db.query`SHOW TABLE STATUS`.catch(() => []);
  const sizeOf = new Map(status.map((r) => [String(r.Name), Number(r.Data_length ?? 0) + Number(r.Index_length ?? 0)]));

  // ── per-table history storage ────────────────────────────────────────────
  const rows: HtmlString[] = [];
  for (const tbl of Object.keys(versedTables(db))) {
    const vt = await versTable(db, tbl);
    if (!vt) continue;
    const [entries, rowsCount, spaces] = await Promise.all([
      db.one`SELECT COUNT(*) FROM ${sql.id(vt)} WHERE _vers_log > 0`,
      db.one`SELECT COUNT(DISTINCT _vers_log) FROM ${sql.id(vt)} WHERE _vers_log > 0`,
      db.one`SELECT COUNT(DISTINCT _vers_space) FROM ${sql.id(vt)}`,
    ]);
    rows.push(html`<tr><td>${tbl}<td style="text-align:right">${String(entries)}<td style="text-align:right">${String(rowsCount)}<td style="text-align:right">${String(spaces)}<td style="text-align:right"><u2-bytes>${sizeOf.get(vt) ?? 0}</u2-bytes>`);
  }

  const storageBox = html.async`
<div class=u2-card>
  <div class=-head>${t`History storage`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${t`Table`}<th style="text-align:right">${t`Entries`}<th style="text-align:right">${t`Log entries`}<th style="text-align:right">${t`Spaces`}<th style="text-align:right">${t`Size`}
      <tbody>${html.join(rows)}
    </table>
  </div>
</div>`;

  // ── spaces (vers_space holds non-live spaces; 0 = live, deletable) ──────────
  const spaceRows = html.join(await Promise.all(
    (await db.query`SELECT space, time_created FROM vers_space ORDER BY space`.catch(() => []))
      .map((s) => html.async`<tr><td>${String(s.space)}<td>${String(s.time_created ?? "")}<td><button class=-del-space data-space="${String(s.space)}" u2-confirm="${t`Delete space ${String(s.space)} (draft + its history)?`}">✕</button>`)
  ));
  const spacesBox = html.async`
<div class=u2-card style="flex-grow:0">
  <div class=-head>${t`Spaces`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table>
      <thead><tr><th>${t`Space`}<th>${t`Created`}<th>
      <tbody><tr><td>0<td>${t`live`}<td>${spaceRows}
    </table>
  </div>
</div>`;

  // ── maintenance ────────────────────────────────────────────────────────────
  const thinnable = await thinHistory(db, true);
  const maintenanceBox = html.async`
<div class=u2-card style="flex-grow:0">
  <div class=-head>${t`Maintenance`}</div>
  <div class=-body>
    <p>${t`Thinnable entries`}: <strong>${String(thinnable)}</strong></p>
    <p><small>${t`Old bursts are collapsed (fine while fresh, coarser with age).`}</small></p>
    <button class=-thin ${thinnable ? "" : "disabled"}>${t`Thin out`}</button>
    <hr>
    <p><small>${t`Delete the entire version history (live + all spaces).`}</small></p>
    <button class=-purge u2-confirm="${t`Delete the entire version history?`}">${t`Delete all history`}</button>
  </div>
</div>`;

  return html.async`<div class=u2-flex>${storageBox}${spacesBox}${maintenanceBox}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
