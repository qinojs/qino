// deno-lint-ignore-file no-explicit-any
import { fs, sql, unhee } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { fieldName } from "@qino/qino/cms.cont.form.fields";

import type { App } from "@qino/qino";

async function settingId(app: App, path: string[]): Promise<number | null> {
  let basis = 0;
  for (const offset of path) {
    const id = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${offset} ORDER BY id LIMIT 1`;
    if (!id) return null;
    basis = Number(id);
  }
  return basis;
}

/** form1.fields2 used each setting row id as its text/input id, not the row offset. Preserve that
 *  relation before the generic page-settings migration removes the legacy rows. */
export async function prepareForm1Settings(app: App): Promise<void> {
  const nodes = await app.db.query`SELECT id FROM page WHERE module = 'cms.cont.form1.fields2'`;
  let changed = 0;
  for (const node of nodes) {
    const pageSettings = await settingId(app, ["cms", "pages", String(node.id)]);
    if (!pageSettings) continue;
    const inputs = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${pageSettings} AND ${sql.id("offset")} = 'inputs'`;
    if (!inputs) continue;
    const rows = await app.db.query`SELECT id, ${sql.id("offset")} FROM qg_setting WHERE basis = ${Number(inputs)}`;
    for (const row of rows) {
      if (String(row.offset) === String(row.id)) continue;
      await app.db.exec`UPDATE qg_setting SET ${sql.id("offset")} = ${String(row.id)} WHERE id = ${row.id}`;
      changed++;
    }
  }
  if (changed) console.log(`[migrate_from_php] form1: preserved ${changed} field ids`);
}

const json = (value: unknown): Record<string, any> => {
  try { return JSON.parse(String(value || "{}")) ?? {}; } catch { return {}; }
};

/** A node text in the site's first language (else any), without markup. */
async function label(app: App, page: number, name: string, lang: string) {
  const text = await app.db.one`SELECT l.text FROM page_text p JOIN text_lang l ON l.text_id = p.text_id
    WHERE p.page_id = ${page} AND p.name = ${name} AND l.text != '' ORDER BY l.lang = ${lang} DESC LIMIT 1`;
  return unhee(String(text ?? "").replace(/<[^>]*>/g, "")).trim();
}

/** fields2 keys its inputs by setting id, form.fields by a name made from the label: settings and
 *  texts (`<key>_title`, `_placeholder`, `_options`) move to that name. */
async function migrateFields(app: App, page: number, lang: string) {
  const settings = json(await app.db.one`SELECT settings FROM page WHERE id = ${page}`);
  const inputs: Record<string, any> = settings.inputs ?? {};
  const names: Record<string, string> = {}, fields: Record<string, any> = {};
  for (const [id, input] of Object.entries(inputs)) {
    if (input.type === "flexible") {
      console.warn(`[migrate_from_php] form1: field ${id} of node ${page} is "flexible" content — cms.cont.form has no such field, left out`);
      continue;
    }
    let name = fieldName(String(input.name ?? "") || await label(app, page, id + "_title", lang) || id);
    while (name in fields) name += "_";
    names[id] = name;
    const { name: _, type, "is-recipient": copy, ...rest } = input;
    fields[name] = { ...rest, ...type && { type: type === "email-reply-to" ? "email" : type }, ...copy && { copy_to_sender: copy } };
    for (const suffix of ["_title", "_placeholder", "_options"]) {
      await app.db.exec`UPDATE page_text SET name = ${name + suffix} WHERE page_id = ${page} AND name = ${id + suffix}`;
    }
  }
  const sort = String(settings.sort ?? "").split(",").map((id) => names[id]).filter(Boolean).join(",");
  const next = { fields, ...sort && { sort } };
  await app.db.exec`UPDATE page SET module = 'cms.cont.form.fields', settings = ${JSON.stringify(next)} WHERE id = ${page}`;
}

export async function migrateForm1(app: App): Promise<void> {
  const forms = await app.db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.form1'`;
  const langsId = await settingId(app, ["core", "langs"]);
  const lang = String(langsId ? await app.db.one`SELECT value FROM qg_setting WHERE id = ${langsId}` ?? "" : "").split(",")[0];
  for (const form of forms) {
    const wrapper = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '1' ORDER BY id LIMIT 1`;
    const fields = wrapper
      ? await app.db.row`SELECT id FROM page WHERE basis = ${wrapper.id} AND module = 'cms.cont.form1.fields2' ORDER BY id LIMIT 1`
      : await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND module = 'cms.cont.form1.fields2' ORDER BY id LIMIT 1`;
    const success = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '2' ORDER BY id LIMIT 1`;

    const settings = json(form.settings);
    delete settings["send with mail1"];
    settings.__inited = true; // the legacy children and confirmation text already exist

    if (fields) {
      await app.db.exec`UPDATE page SET basis = ${form.id}, name = 'main' WHERE id = ${fields.id}`;
      await migrateFields(app, Number(fields.id), lang);
    }
    if (success) await app.db.exec`UPDATE page SET name = 'success' WHERE id = ${success.id}`;
    await app.db.exec`UPDATE page SET module = 'cms.cont.form', settings = ${JSON.stringify(settings)} WHERE id = ${form.id}`;

    if (wrapper && !await app.db.one`SELECT id FROM page WHERE basis = ${wrapper.id} LIMIT 1`) {
      await (await cms(app).node(Number(form.id))).removeChild(Number(wrapper.id));
    }
  }

  // fields outside a form1 (the editor warns about them) still get their names
  for (const id of await app.db.col`SELECT id FROM page WHERE module = 'cms.cont.form1.fields2'`) await migrateFields(app, Number(id), lang);

  await moveData(app, "cms.cont.form1", "cms.cont.form");
  await moveData(app, "cms.cont.form1.fields2", "cms.cont.form.fields");
  if (forms.length) console.log(`[migrate_from_php] form1 → form: ${forms.length} forms`);
}

async function moveData(app: App, from: string, to: string): Promise<void> {
  const source = app.dir + "data/" + from;
  const target = app.dir + "data/" + to;
  if (!await fs.stat(source, { ttl: 0 }) || await fs.stat(target, { ttl: 0 })) return;
  await fs.rename(source, target);
}
