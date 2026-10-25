// deno-lint-ignore-file no-explicit-any
import { fs, sql, unhee } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { fieldName } from "@qino/qino/cms.cont.form.fields";

import type { App } from "@qino/qino";

/** Both field blocks of form1 keep their inputs alike; fields3 only adds a label position. */
const FIELDS = sql.join(["cms.cont.form1.fields2", "cms.cont.form1.fields3"].map((m) => sql`${m}`));

async function settingId(app: App, path: string[]): Promise<number | null> {
  let basis = 0;
  for (const offset of path) {
    const id = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${basis} AND ${sql.id("offset")} = ${offset} ORDER BY id LIMIT 1`;
    if (!id) return null;
    basis = Number(id);
  }
  return basis;
}

/** form1.fields2/3 used each setting row id as its text/input id, not the row offset. Preserve that
 *  relation before the generic page-settings migration removes the legacy rows. */
export async function prepareForm1Settings(app: App): Promise<void> {
  const nodes = await app.db.query`SELECT id FROM page WHERE module IN (${FIELDS})`;
  let changed = 0;
  for (const node of nodes) {
    const pageSettings = await settingId(app, ["cms", "pages", String(node.id)]);
    if (!pageSettings) continue;
    const inputs = await app.db.one`SELECT id FROM qg_setting WHERE basis = ${pageSettings} AND ${sql.id("offset")} = 'inputs'`;
    if (!inputs) continue;
    const rows = await app.db.query`SELECT id, ${sql.id("offset")} FROM qg_setting WHERE basis = ${Number(inputs)}`;
    const ids = new Map(rows.map((row) => [String(row.offset), String(row.id)]));
    for (const row of rows) {
      if (String(row.offset) === String(row.id)) continue;
      await app.db.exec`UPDATE qg_setting SET ${sql.id("offset")} = ${String(row.id)} WHERE id = ${row.id}`;
      changed++;
    }
    // the field order lists the same offsets
    const sort = await app.db.row`SELECT id, value FROM qg_setting WHERE basis = ${pageSettings} AND ${sql.id("offset")} = 'sort'`;
    if (sort) {
      const value = String(sort.value ?? "").split(",").map((key) => ids.get(key) ?? key).join(",");
      await app.db.exec`UPDATE qg_setting SET value = ${value} WHERE id = ${sort.id}`;
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
  const order = String(settings.sort ?? "").split(",").map((id) => names[id]).filter(Boolean).join(",");
  const next = { fields, ...order && { field_order: order } };
  await app.db.exec`UPDATE page SET module = 'cms.cont.form.fields', settings = ${JSON.stringify(next)} WHERE id = ${page}`;
}

export async function migrateForm1(app: App): Promise<void> {
  const forms = await app.db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.form1'`;
  const langsId = await settingId(app, ["core", "langs"]);
  const lang = String(langsId ? await app.db.one`SELECT value FROM qg_setting WHERE id = ${langsId}` ?? "" : "").split(",")[0];
  for (const form of forms) {
    const wrapper = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '1' ORDER BY id LIMIT 1`;
    const fields = await app.db.row`SELECT id FROM page WHERE basis = ${(wrapper ?? form).id} AND module IN (${FIELDS}) ORDER BY id LIMIT 1`;
    const success = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '2' ORDER BY id LIMIT 1`;
    // the area "1" is what PHP rendered; holding more than the field block, it stays as the form's content
    const alone = !wrapper || Number(await app.db.one`SELECT COUNT(*) FROM page WHERE basis = ${wrapper.id}`) === 1;

    const settings = json(form.settings);
    delete settings["send with mail1"];
    settings.__inited = true; // the legacy children and confirmation text already exist
    // a buttons1 inside a "flexible" field was the submit button; form.fields has no such field
    if (await app.db.one`WITH RECURSIVE sub(id) AS (SELECT id FROM page WHERE basis = ${form.id}
        UNION ALL SELECT p.id FROM page p JOIN sub ON p.basis = sub.id)
      SELECT 1 FROM page WHERE id IN (SELECT id FROM sub) AND module = 'cms.cont.form1.buttons1' LIMIT 1`) {
      // buttons1 said "Senden"; a text of the form's own, hidden button was never shown
      if (!Number(settings.button_submit)) await app.db.exec`DELETE FROM page_text WHERE page_id = ${form.id} AND name = 'button_submit'`;
      settings.button_submit = "1";
    }

    if (fields && alone) {
      await app.db.exec`UPDATE page SET basis = ${form.id}, name = 'main' WHERE id = ${fields.id}`;
      await migrateFields(app, Number(fields.id), lang);
    } else if (wrapper) {
      await app.db.exec`UPDATE page SET name = 'main' WHERE id = ${wrapper.id}`;
    }
    if (success) await app.db.exec`UPDATE page SET name = 'success' WHERE id = ${success.id}`;
    await app.db.exec`UPDATE page SET module = 'cms.cont.form', settings = ${JSON.stringify(settings)} WHERE id = ${form.id}`;

    if (wrapper && alone && !await app.db.one`SELECT id FROM page WHERE basis = ${wrapper.id} LIMIT 1`) {
      await (await cms(app).node(Number(form.id))).removeChild(Number(wrapper.id));
    }
  }

  // fields outside a form1 or nested in its area (the editor warns about the first) still get their names
  for (const id of await app.db.col`SELECT id FROM page WHERE module IN (${FIELDS})`) await migrateFields(app, Number(id), lang);

  await moveData(app, "cms.cont.form1", "cms.cont.form");
  await moveData(app, "cms.cont.form1.fields2", "cms.cont.form.fields");
  await moveData(app, "cms.cont.form1.fields3", "cms.cont.form.fields");
  if (forms.length) console.log(`[migrate_from_php] form1 → form: ${forms.length} forms`);
}

async function moveData(app: App, from: string, to: string): Promise<void> {
  const source = app.dir + "data/" + from;
  const target = app.dir + "data/" + to;
  if (!await fs.stat(source, { ttl: 0 }) || await fs.stat(target, { ttl: 0 })) return;
  await fs.rename(source, target);
}
