// deno-lint-ignore-file no-explicit-any
import { $item, fs, sql } from "@qino/qino";

import { migrateContacts } from "./migrateContacts.ts";
import { migrateL1 } from "./migrateL1.ts";
import { migrateLegacyPageSettings } from "./migrateLegacyPageSettings.ts";
import { migrateFiles } from "./moveFiles.ts";
import { migrateCss } from "./migrateCss.ts";
import { migrateForm1, prepareForm1Settings } from "./migrateForm1.ts";
import { migrateTable1 } from "./migrateTable1.ts";
import { unparkText } from "./migrateText.ts";
import { renamedModules } from "./renamedModules.ts";

import type { App } from "@qino/qino";

export async function install({ app }: { app: App }): Promise<void> {
  await unparkText(app.db); // the texts parked by migrate(), before anything reads them
  await dropLegacyColumns(app);
  await removeObsoleteSettings(app);
  const moved = await migrateAppSettings(app);
  const json = await migrateJsonSettings(app);
  await prepareForm1Settings(app);
  await migrateLegacyPageSettings(app);
  await migrateLayoutFonts(app);
  await migrateLegacyContact(app);
  await migrateAppIcon(app);
  await migrateAccessLevels(app);
  await migrateContacts(app); // usr.username is the login handle from here on, usr_contact the address
  await migrateFiles(app); // qg/ → data/ first, the css lives there
  await migrateCss(app); // reads the still-legacy page.module, so before the rename
  await migrateForm1(app);
  await migrateTable1(app); // still the legacy module name, so before the rename
  await migrateL1(app);
  await migrateRenamedModules(app);

  const langsId = await settingId(app, ["core", "langs"]);
  const langsRaw = String(langsId ? await app.db.one`SELECT value FROM qg_setting WHERE id = ${langsId}` ?? "" : "");
  app.settings.core.langs[$item].set(langsRaw, { local: true }); // core cached the pre-migration value
  app.languages.setLangs(langsRaw.split(","));

  if (moved || json) console.log(`[migrate_from_php] migrated ${moved} app settings, ${json} json settings`);
}

/** Remove settings whose legacy value-plus-children shape has no qino equivalent. */
export async function removeObsoleteSettings(app: App): Promise<boolean> {
  const id = await settingId(app, ["cms", "backend", "lastpage"]);
  if (!id) return false;
  await removeSetting(app, id);
  console.log("[migrate_from_php] removed obsolete cms.backend.lastpage setting");
  return true;
}

/** Legacy setting → qino setting, where both modules are there; a value already set is kept. */
const legacyContact: [string[], string, string[]][] = [
  [["app1", "name"], "identity", ["name"]],
  [["app1", "short_name"], "identity", ["alternateName"]],
  [["app1", "description"], "identity", ["description"]],
  [["app1", "owner", "company"], "identity", ["organization", "name"]],
  [["app1", "owner", "address"], "identity", ["organization", "address", "streetAddress"]],
  [["app1", "owner", "zip"], "identity", ["organization", "address", "postalCode"]],
  [["app1", "owner", "city"], "identity", ["organization", "address", "addressLocality"]],
  [["app1", "owner", "country"], "identity", ["organization", "address", "addressCountry"]],
  [["app1", "owner", "name"], "identity", ["contact", "name"]],
  [["app1", "owner", "email"], "identity", ["contact", "email"]],
  [["app1", "owner", "phone"], "identity", ["contact", "telephone"]],
  [["app1", "theme_color"], "identity", ["brand", "primaryColor"]], // webapp's theme_color, as app1's was
  [["app1", "background_color"], "identity", ["brand", "backgroundColor"]],
  [["qg", "mail", "defSender"], "messaging.email", ["address"]],
  [["qg", "mail", "smtp", "host"], "messaging.email", ["transport", "smtp", "host"]],
  [["qg", "mail", "smtp", "port"], "messaging.email", ["transport", "smtp", "port"]],
  [["qg", "mail", "smtp", "username"], "messaging.email", ["transport", "smtp", "user"]],
  [["qg", "mail", "smtp", "password"], "messaging.email", ["transport", "smtp", "pass"]],
];

/** Who the site is and how it mails: PHP's app1 and qg.mail, into identity and messaging.email.
 *  Written to the table: those modules may install after this one. */
async function migrateLegacyContact(app: App): Promise<void> {
  let moved = 0;
  for (const [from, mod, to] of legacyContact) {
    if (!app.modules.get(mod)) continue;
    const id = await settingId(app, from);
    const value = String(id ? await app.db.one`SELECT value FROM qg_setting WHERE id = ${id}` ?? "" : "").trim();
    if (!value) continue;
    const basis = await ensurePath(app, [mod, ...to.slice(0, -1)]);
    const key = to.at(-1)!;
    const target = await app.db.row`SELECT id, value FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${key} ORDER BY id LIMIT 1`;
    if (String(target?.value ?? "")) continue;
    if (target) await app.db.exec`UPDATE qg_setting SET value = ${value} WHERE id = ${target.id}`;
    else await app.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${basis}, ${key}, ${value})`;
    moved++;
  }
  if (moved) console.log(`[migrate_from_php] ${moved} legacy contact settings → identity, messaging.email`);
}

/** PHP's app1 kept the app icon as files `app<size>` of the root page; its biggest becomes the
 *  site's icon and, where none is set, its logo — the invoices print it. */
async function migrateAppIcon(app: App): Promise<void> {
  if (!(await app.db.listTables()).includes("identity_file")) return;
  const icons = await app.db.query`SELECT pf.name, f.id FROM page_file pf JOIN file f ON f.id = pf.file_id
    WHERE pf.page_id = 1 AND pf.name LIKE 'app%' AND f.md5 IS NOT NULL AND f.md5 <> ''`;
  const size = (name: unknown) => Number(String(name).slice(3)) || 0;
  const biggest = icons.filter((row) => size(row.name)).sort((a, b) => size(b.name) - size(a.name))[0];
  if (!biggest) return;
  for (const name of ["icon", "logo"]) {
    if (await app.db.one`SELECT 1 FROM identity_file WHERE name = ${name}`) continue;
    await app.db.exec`INSERT INTO identity_file (name, file_id) VALUES (${name}, ${biggest.id})`;
    console.log(`[migrate_from_php] app icon ${biggest.name} → identity ${name}`);
  }
}

/** PHP kept a custom layout's font on its layout page; the qino layouts read it from the app
 *  settings of the module — one font per site. */
async function migrateLayoutFonts(app: App): Promise<void> {
  const rows = await app.db.query`SELECT module, settings FROM page WHERE module LIKE 'cms.layout.%' AND settings LIKE '%font-css-file%'`;
  for (const { module, settings } of rows) {
    let font;
    try { font = String(JSON.parse(String(settings))["font-css-file"] ?? ""); } catch { continue; }
    if (!font || String(await app.settings[module]["font-css-file"] ?? "")) continue;
    app.settings[module]["font-css-file"](font);
    console.log(`[migrate_from_php] ${module}: font-css-file → app settings`);
  }
}

// Legacy NOT NULL columns without default block inserts (qino doesn't write them). Unused ones are
// dropped, others become nullable.
const dropColumns = [["qg_setting", "w"], ["module", "title_id"], ["page", "_cache"]];
const nullableColumns = [["client", "client1_request_json"], ["client", "client1_response_json"], ["mail", "mail1_template"]];

/** `qg_setting.w` must be removed before qino first opens a legacy database (see MIGRATION.md).
 *  The rest is repaired here. */
async function dropLegacyColumns(app: App): Promise<void> {
  for (const [table, column] of dropColumns) {
    // cms.versions mirrors tables column by column; drop the column in both, or the baseline insert
    // fails ("Unknown column t._cache").
    for (const t of [table, "_vers_" + table]) {
      const field = await legacyField(app, t, column);
      if (!field) continue;
      await app.db.query`ALTER TABLE ${sql.id(t)} DROP COLUMN ${sql.id(column)}`;
      console.log(`[migrate_from_php] dropped ${t}.${column}`);
    }
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
  let t;
  try { t = app.db.table(table); } catch { return; } // not every table has a _vers_ mirror
  await t.reloadFields();
  return t.field(column);
}

/** Update module names in nodes and the frontend setting — otherwise nodes render empty and the
 *  editor doesn't load. */
async function migrateRenamedModules(app: App): Promise<void> {
  for (const [legacy, current] of Object.entries(renamedModules)) {
    const r = await app.db.exec`UPDATE page SET module = ${current} WHERE module = ${legacy}`;
    if (r.affectedRows) console.log(`[migrate_from_php] ${r.affectedRows} nodes: ${legacy} → ${current}`);
  }
  await moveNodeCode(app);

  const frontend = String(await app.settings.cms.frontend ?? "");
  const successor = renamedModules[frontend];
  if (!successor) return;
  app.settings.cms.frontend(successor);
  console.log(`[migrate_from_php] cms.frontend ${frontend} → ${successor}`);
}

/** Move `cms.cont.phpfile` sources (qg/cmsPhpFiles/) to where `cms.cont.ts` expects them, for
 *  porting. `cms.cont.phpfile1` kept a folder per node: `<id>/index.php`, `<id>/pub/main.css|js`. */
async function moveNodeCode(app: App): Promise<void> {
  const to = app.dir + "data/cms.cont.ts/";
  const from = app.dir + "data/cmsPhpFiles/";
  const files = await fs.list(from).catch(() => []);
  if (files.length) {
    await fs.mkdir(to);
    for (const file of files) await fs.rename(from + file.name, to + file.name).catch(() => {});
    await fs.remove(from).catch(() => {});
    console.log(`[migrate_from_php] ${files.length} cmsPhpFiles → data/cms.cont.ts/ (still PHP, port by hand)`);
  }

  const dir1 = app.dir + "data/cms.cont.phpfile1/";
  const nodes = (await fs.list(dir1).catch(() => [])).filter((e) => e.isDirectory && /^\d+$/.test(e.name));
  if (!nodes.length) return;
  await fs.mkdir(to + "pub/");
  for (const { name: id } of nodes) {
    // a ported file already in place wins over its legacy source
    const move = async (src: string, dst: string) =>
      await fs.stat(to + dst, { ttl: 0 }) || await fs.rename(dir1 + id + "/" + src, to + dst).catch(() => {});
    await move("index.php", id + ".php");
    await move("pub/main.css", "pub/" + id + ".css");
    await move("pub/main.js", "pub/" + id + ".js");
  }
  await fs.remove(dir1, { recursive: true }).catch(() => {});
  console.log(`[migrate_from_php] ${nodes.length} cms.cont.phpfile1 nodes → data/cms.cont.ts/ (still PHP, port by hand)`);
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

export async function settingId(app: App, path: string[]): Promise<number | null> {
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
    id ||= (await app.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${basis}, ${offset}, '')`).insertId;
    basis = Number(id);
  }
  return basis;
}

async function copySetting(app: App, fromId: number, toBasis: number, toOffset: string): Promise<number> {
  const src = await app.db.row`SELECT value FROM qg_setting WHERE id = ${fromId}`;
  if (!src) return 0;
  let changed = 0;
  const dst = await app.db.row`SELECT id, value FROM qg_setting WHERE basis = ${toBasis} AND ${sql.id("offset")} = ${toOffset} ORDER BY id LIMIT 1`;
  const dstId = dst
    ? Number(dst.id)
    : (await app.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${toBasis}, ${toOffset}, ${src.value ?? ""})`).insertId;
  if (!dst) changed++;
  else if (!String(dst.value ?? "") && String(src.value ?? "")) {
    await app.db.exec`UPDATE qg_setting SET value = ${src.value} WHERE id = ${dst.id}`;
    changed++;
  }

  const children = await app.db.query`SELECT id, ${sql.id("offset")} FROM qg_setting WHERE basis = ${fromId} ORDER BY id`;
  for (const child of children) changed += await copySetting(app, Number(child.id), dstId, String(child.offset));
  return changed;
}

async function removeSetting(app: App, id: number): Promise<void> {
  const children = await app.db.query`SELECT id FROM qg_setting WHERE basis = ${id}`;
  for (const child of children) await removeSetting(app, Number(child.id));
  await app.db.exec`DELETE FROM qg_setting WHERE id = ${id}`;
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
    await app.db.exec`UPDATE ${sql.id(table)} SET settings = ${JSON.stringify(data)} WHERE id = ${row.id}`;
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
  for (const [parent, key] of stack.toReversed()) {
    if (isObj(parent[key]) && !Object.keys(parent[key]).length) delete parent[key];
  }
}

function isObj(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
