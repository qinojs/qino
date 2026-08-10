import { sql, type App } from "../../module/core/mod.ts";
import { cms } from "../../module/cms/mod.ts";

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
      await app.db.query`UPDATE qg_setting SET ${sql.id("offset")} = ${String(row.id)} WHERE id = ${row.id}`;
      changed++;
    }
  }
  if (changed) console.log(`[migrate_from_php] form1: preserved ${changed} field ids`);
}

export async function migrateForm1(app: App): Promise<void> {
  const forms = await app.db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.form1'`;
  for (const form of forms) {
    const wrapper = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '1' ORDER BY id LIMIT 1`;
    const fields = wrapper
      ? await app.db.row`SELECT id FROM page WHERE basis = ${wrapper.id} AND module = 'cms.cont.form1.fields2' ORDER BY id LIMIT 1`
      : await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND module = 'cms.cont.form1.fields2' ORDER BY id LIMIT 1`;
    const success = await app.db.row`SELECT id FROM page WHERE basis = ${form.id} AND name = '2' ORDER BY id LIMIT 1`;

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(String(form.settings || "{}")); } catch { /* keep the usable empty defaults */ }
    if (!("button" in settings) && "button_submit" in settings) settings.button = settings.button_submit;
    if (!("reset" in settings) && "button_reset" in settings) settings.reset = settings.button_reset;
    delete settings.button_submit;
    delete settings.button_reset;
    delete settings["send with mail1"];
    settings.__inited = true; // the legacy children and confirmation text already exist

    if (fields) {
      await app.db.query`UPDATE page SET basis = ${form.id}, name = 'main', module = 'cms.cont.form2.fields1' WHERE id = ${fields.id}`;
    }
    if (success) await app.db.query`UPDATE page SET name = 'success' WHERE id = ${success.id}`;
    await app.db.query`UPDATE page SET module = 'cms.cont.form2', settings = ${JSON.stringify(settings)} WHERE id = ${form.id}`;

    if (wrapper && !await app.db.one`SELECT id FROM page WHERE basis = ${wrapper.id} LIMIT 1`) {
      await (await cms(app).node(Number(form.id))).removeChild(Number(wrapper.id));
    }
  }

  await moveData(app, "cms.cont.form1", "cms.cont.form2");
  await moveData(app, "cms.cont.form1.fields2", "cms.cont.form2.fields1");
  if (forms.length) console.log(`[migrate_from_php] form1 → form2: ${forms.length} forms`);
}

async function moveData(app: App, from: string, to: string): Promise<void> {
  const source = app.appPATH + "data/" + from;
  const target = app.appPATH + "data/" + to;
  if (!await Deno.stat(source).catch(() => null) || await Deno.stat(target).catch(() => null)) return;
  await Deno.rename(source, target);
}
