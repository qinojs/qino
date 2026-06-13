import { hee, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { versedTables, versTable, thinHistory } from "../cms.versions/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.versions";
export const needs = ["cms.backend", "cms.versions"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Versions", de: "Versionen" });
}

async function render(node: Node): Promise<string> {
  const app = node.app;
  const db = app.db;

  // table sizes (MySQL)
  const status = await db.all("SHOW TABLE STATUS").catch(() => []);
  const sizeOf = new Map(status.map((r) => [String(r.Name), Number(r.Data_length ?? 0) + Number(r.Index_length ?? 0)]));

  // ── per-table history storage ────────────────────────────────────────────
  let rows = "";
  for (const t of Object.keys(versedTables(db))) {
    const vt = await versTable(db, t);
    if (!vt) continue;
    const [entries, rowsCount, spaces] = await Promise.all([
      db.one(`SELECT COUNT(*) FROM \`${vt}\` WHERE _vers_log > 0`),
      db.one(`SELECT COUNT(DISTINCT _vers_log) FROM \`${vt}\` WHERE _vers_log > 0`),
      db.one(`SELECT COUNT(DISTINCT _vers_space) FROM \`${vt}\``),
    ]);
    rows += `<tr><td>${hee(t)}<td style="text-align:right">${hee(String(entries))}<td style="text-align:right">${hee(String(rowsCount))}<td style="text-align:right">${hee(String(spaces))}<td style="text-align:right"><u2-bytes>${sizeOf.get(vt) ?? 0}</u2-bytes>`;
  }

  const storageBox = `
<div class=u2-card>
  <div class=-head>${await app.t`History storage`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${await app.t`Table`}<th style="text-align:right">${await app.t`Entries`}<th style="text-align:right">${await app.t`Log entries`}<th style="text-align:right">${await app.t`Spaces`}<th style="text-align:right">${await app.t`Size`}
      <tbody>${rows}
    </table>
  </div>
</div>`;

  // ── spaces (vers_space holds non-live spaces; 0 = live, deletable) ──────────
  const spaceRows = (await Promise.all(
    (await db.all("SELECT space, time_created FROM vers_space ORDER BY space").catch(() => []))
      .map(async (s) => `<tr><td>${hee(String(s.space))}<td>${hee(String(s.time_created ?? ""))}<td><button class=-del-space data-space="${hee(String(s.space))}" u2-confirm="${await app.t`Delete space ${String(s.space)} (draft + its history)?`}">✕</button>`)
  )).join("");
  const spacesBox = `
<div class=u2-card style="flex-grow:0">
  <div class=-head>${await app.t`Spaces`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table>
      <thead><tr><th>${await app.t`Space`}<th>${await app.t`Created`}<th>
      <tbody><tr><td>0<td>${await app.t`live`}<td>${spaceRows}
    </table>
  </div>
</div>`;

  // ── maintenance ────────────────────────────────────────────────────────────
  const thinnable = await thinHistory(db, true);
  const maintenanceBox = `
<div class=u2-card style="flex-grow:0">
  <div class=-head>${await app.t`Maintenance`}</div>
  <div class=-body>
    <p>${await app.t`Thinnable entries`}: <strong>${hee(String(thinnable))}</strong></p>
    <p><small>${await app.t`Old bursts are collapsed (fine while fresh, coarser with age).`}</small></p>
    <button class=-thin ${thinnable ? "" : "disabled"}>${await app.t`Thin out`}</button>
    <hr>
    <p><small>${await app.t`Delete the entire version history (live + all spaces).`}</small></p>
    <button class=-purge u2-confirm="${await app.t`Delete the entire version history?`}">${await app.t`Delete all history`}</button>
  </div>
</div>`;

  return `<div class=u2-flex>${storageBox}${spacesBox}${maintenanceBox}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
