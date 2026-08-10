// deno-lint-ignore-file no-explicit-any

import { sql, type App } from "../../module/core/mod.ts";
import { migrateLegacyPageSettings } from "./migrateLegacyPageSettings.ts";
import { migrateFiles } from "./moveFiles.ts";

export const name = "migrate_from_php";
export const needs = ["core", "cms"];

export async function install({ app }: { app: App }): Promise<void> {
  await dropLegacyColumns(app);
  const moved = await migrateAppSettings(app);
  const json = await migrateJsonSettings(app);
  await migrateLegacyPageSettings(app);
  await migrateAccessLevels(app);
  await migrateFiles(app);

  const langsRaw = String(await app.settings.core.langs ?? "");
  app.languages.setLangs(langsRaw.split(","));

  if (moved || json) console.log(`[migrate_from_php] migrated ${moved} app settings, ${json} json settings`);
}

// A legacy column that is NOT NULL without a default blocks every insert into its table, because
// qino never writes it. Dead ones go, ones still holding data only lose the constraint.
const dropColumns = [["qg_setting", "w"], ["module", "title_id"], ["page", "_cache"]];
const nullableColumns = [["client", "client1_request_json"], ["client", "client1_response_json"], ["mail", "mail1_template"]];

/** `qg_setting.w` is read before any module installs, so it has to be gone before qino first
 *  opens a legacy database — see MIGRATION.md. The rest is repaired here. */
async function dropLegacyColumns(app: App): Promise<void> {
  for (const [table, column] of dropColumns) {
    const field = await legacyField(app, table, column);
    if (!field) continue;
    await app.db.query`ALTER TABLE ${sql.id(table)} DROP COLUMN ${sql.id(column)}`;
    console.log(`[migrate_from_php] dropped ${table}.${column}`);
  }
  // Columns of PHP-only modules (client1, mail1): keep the content for a later port of the module.
  for (const [table, column] of nullableColumns) {
    const field = await legacyField(app, table, column);
    if (!field || field.vs.Null === "YES") continue;
    await app.db.query`ALTER TABLE ${sql.id(table)} MODIFY COLUMN ${sql.id(column)} ${sql.raw(field.vs.Type)} NULL`;
    console.log(`[migrate_from_php] ${table}.${column} is nullable now`);
  }
}

async function legacyField(app: App, table: string, column: string) {
  const t = app.db.table(table);
  await t.reloadFields();
  return t.field(column);
}

/** Legacy on/off access flags → cms_access levels: module 1 → 2 (0 keeps the column default 1), grp 1 → 2. */
async function migrateAccessLevels(app: App): Promise<void> {
  // module.access is NOT NULL without a default, so a leftover column blocks every new module row.
  const mod = app.db.table("module");
  await mod.reloadFields();
  if (mod.field("access")) {
    const modules = await app.db.exec`UPDATE module SET cms_access = 2, access = 0 WHERE access > 0`;
    await app.db.query`ALTER TABLE module DROP COLUMN access`;
    console.log(`[migrate_from_php] module.access → cms_access: ${modules.affectedRows} rows`);
  }

  // grp.page_access is gone from the schema; migrate then drop the legacy column.
  try { await app.db.one`SELECT page_access FROM grp LIMIT 1`; } catch { return; }
  const grps = await app.db.exec`UPDATE grp SET cms_access = 2 WHERE page_access > 0`;
  await app.db.query`ALTER TABLE grp DROP COLUMN page_access`;
  console.log(`[migrate_from_php] grp.page_access → cms_access: ${grps.affectedRows} rows`);
}

async function migrateAppSettings(app: App): Promise<number> {
  let moved = 0;
  for (const key of ["langs", "HSTS", "csp"]) {
    moved += await moveSetting(app, ["qg", key], ["core", key]);
  }
  return moved;
}

async function moveSetting(app: App, fromPath: string[], toPath: string[]): Promise<number> {
  const fromId = await settingId(app, fromPath);
  if (!fromId) return 0;
  const toBasis = await ensurePath(app, toPath.slice(0, -1));
  const moved = await copySetting(app, fromId, toBasis, toPath[toPath.length - 1]);
  await removeSetting(app, fromId);
  return moved;
}

async function settingId(app: App, path: string[]): Promise<number | null> {
  let basis = 0;
  for (const offset of path) {
    const id = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${offset} ORDER BY id LIMIT 1`;
    if (!id) return null;
    basis = Number(id);
  }
  return basis;
}

async function ensurePath(app: App, path: string[]): Promise<number> {
  let basis = 0;
  for (const offset of path) {
    let id = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${offset} ORDER BY id LIMIT 1`;
    if (!id) id = (await app.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${basis}, ${offset}, '')`).insertId;
    basis = Number(id);
  }
  return basis;
}

async function copySetting(app: App, fromId: number, toBasis: number, toOffset: string): Promise<number> {
  const src = await app.db.row`SELECT value FROM qg_setting WHERE id = ${fromId}`;
  if (!src) return 0;
  let changed = 0;
  const dst = await app.db.row`SELECT id, value FROM qg_setting WHERE basis = ${toBasis} AND ${sql.id("offset")} = ${toOffset} ORDER BY id LIMIT 1`;
  let dstId: number;
  if (!dst) {
    const res = await app.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${toBasis}, ${toOffset}, ${src.value ?? ""})`;
    dstId = res.insertId;
    changed++;
  } else if (!String(dst.value ?? "") && String(src.value ?? "")) {
    dstId = Number(dst.id);
    await app.db.query`UPDATE qg_setting SET value = ${src.value} WHERE id = ${dst.id}`;
    changed++;
  } else {
    dstId = Number(dst.id);
  }

  const children = await app.db.query`SELECT id, ${sql.id("offset")} FROM qg_setting WHERE basis = ${fromId} ORDER BY id`;
  for (const child of children) changed += await copySetting(app, Number(child.id), dstId, String(child.offset));
  return changed;
}

async function removeSetting(app: App, id: number): Promise<void> {
  const children = await app.db.query`SELECT id FROM qg_setting WHERE basis = ${id}`;
  for (const child of children) await removeSetting(app, Number(child.id));
  await app.db.query`DELETE FROM qg_setting WHERE id = ${id}`;
}

async function migrateJsonSettings(app: App): Promise<number> {
  return await migrateJsonTable(app, "usr") + await migrateJsonTable(app, "sess");
}

async function migrateJsonTable(app: App, table: "usr" | "sess"): Promise<number> {
  let changed = 0;
  const rows = await app.db.query`SELECT id, settings FROM ${sql.id(table)} WHERE settings IS NOT NULL AND settings != ''`;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(String(row.settings));
    } catch {
      continue;
    }
    if (!moveJsonPath(data, ["qg", "lang_ns"], ["core", "lang_ns"])) continue;
    await app.db.query`UPDATE ${sql.id(table)} SET settings = ${JSON.stringify(data)} WHERE id = ${row.id}`;
    changed++;
  }
  return changed;
}

function moveJsonPath(obj: any, from: string[], to: string[]): boolean {
  const value = getJsonPath(obj, from);
  if (value === undefined) return false;
  const current = getJsonPath(obj, to);
  if (current === undefined) setJsonPath(obj, to, value);
  else if (isObj(current) && isObj(value)) {
    for (const key in value) if (!(key in current)) current[key] = value[key];
  }
  unsetJsonPath(obj, from);
  return true;
}

function getJsonPath(obj: any, path: string[]): any {
  for (const key of path) {
    if (!isObj(obj) || !(key in obj)) return;
    obj = obj[key];
  }
  return obj;
}

function setJsonPath(obj: any, path: string[], value: any): void {
  for (const key of path.slice(0, -1)) obj = obj[key] ??= {};
  obj[path[path.length - 1]] = value;
}

function unsetJsonPath(obj: any, path: string[]): void {
  const stack: [any, string][] = [];
  for (const key of path) {
    if (!isObj(obj) || !(key in obj)) return;
    stack.push([obj, key]);
    obj = obj[key];
  }
  const last = stack.pop();
  if (last) delete last[0][last[1]];
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    if (isObj(parent[key]) && !Object.keys(parent[key]).length) delete parent[key];
  }
}

function isObj(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
