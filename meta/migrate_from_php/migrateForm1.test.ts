import { Db, sql } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { migrateForm1 } from "./migrateForm1.ts";

import type { App } from "@qino/qino";

Deno.test("migrateForm1: form1 becomes cms.cont.form, its fields are named after their labels", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE qg_setting (id INTEGER PRIMARY KEY AUTOINCREMENT, basis INTEGER, ${sql.id("offset")} TEXT, value TEXT)`;
  await db.query`CREATE TABLE page (id INTEGER PRIMARY KEY, basis INTEGER, name TEXT, module TEXT, settings TEXT)`;
  await db.query`CREATE TABLE page_text (page_id INTEGER, name TEXT, text_id INTEGER)`;
  await db.query`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT)`;
  const core = (await db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}) VALUES (0, 'core')`).insertId;
  await db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${core}, 'langs', 'de,en')`;

  const form = { recipients: "a@example.com", button_submit: 1, "send with mail1": 1 };
  const inputs = { 5: { type: "email-reply-to", "is-recipient": true, required: true }, 7: { type: "text" }, 9: { type: "flexible" } };
  await db.exec`INSERT INTO page VALUES (1, 0, '', 'cms.cont.form1', ${JSON.stringify(form)})`;
  await db.exec`INSERT INTO page VALUES (2, 1, 'fields', 'cms.cont.form1.fields2', ${JSON.stringify({ labelPosition: "top", sort: "7,5", inputs })})`;
  await db.exec`INSERT INTO page VALUES (3, 1, '2', 'cms.cont.text', '')`;
  for (const [id, name, lang, text] of [[1, "5_title", "en", "Your e-mail"], [1, "5_title", "de", "Ihre E-Mail"], [2, "7_title", "de", "<b>Name</b>"], [3, "7_placeholder", "de", "Max"]] as const) {
    await db.exec`INSERT INTO page_text (page_id, name, text_id) SELECT 2, ${name}, ${id} WHERE NOT EXISTS (SELECT 1 FROM page_text WHERE text_id = ${id})`;
    await db.exec`INSERT INTO text_lang VALUES (${id}, ${lang}, ${text})`;
  }

  await migrateForm1({ db, dir: await Deno.makeTempDir() + "/" } as unknown as App);

  const page = async (id: number): Promise<Record<string, unknown>> => {
    const row: Record<string, unknown> = (await db.row`SELECT basis, name, module, settings FROM page WHERE id = ${id}`)!;
    return { ...row, settings: JSON.parse(String(row.settings || "{}")) };
  };
  assertEquals(await page(1), {
    basis: 0, name: "", module: "cms.cont.form",
    settings: { recipients: "a@example.com", button_submit: 1, __inited: true },
  });
  assertEquals(await page(2), {
    basis: 1, name: "main", module: "cms.cont.form.fields",
    settings: { fields: { ihre_e_mail: { type: "email", copy_to_sender: true, required: true }, name: { type: "text" } }, field_order: "name,ihre_e_mail" },
  });
  assertEquals((await page(3)).name, "success");
  assertEquals(await db.col`SELECT name FROM page_text ORDER BY text_id`, ["ihre_e_mail_title", "name_title", "name_placeholder"]);

  await db.close();
});

Deno.test("migrateForm1: an area with layout around its fields stays the form's content", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE qg_setting (id INTEGER PRIMARY KEY AUTOINCREMENT, basis INTEGER, ${sql.id("offset")} TEXT, value TEXT)`;
  await db.query`CREATE TABLE page (id INTEGER PRIMARY KEY, basis INTEGER, name TEXT, module TEXT, settings TEXT)`;
  await db.query`CREATE TABLE page_text (page_id INTEGER, name TEXT, text_id INTEGER)`;
  await db.query`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT)`;

  await db.exec`INSERT INTO page VALUES (1, 0, '', 'cms.cont.form1', ${JSON.stringify({ button_submit: "" })})`;
  await db.exec`INSERT INTO page VALUES (2, 1, '1', 'cms.cont.flexible', '')`;
  await db.exec`INSERT INTO page VALUES (3, 2, '', 'cms.cont.cd.cols', '')`;
  await db.exec`INSERT INTO page VALUES (4, 3, 'left', 'cms.cont.form1.fields3', ${JSON.stringify({ labelPosition: "left", inputs: { 8: { type: "text" } } })})`;
  await db.exec`INSERT INTO page VALUES (5, 4, 'f8', 'cms.cont.flexible', '')`;
  await db.exec`INSERT INTO page VALUES (6, 5, '', 'cms.cont.form1.buttons1', '')`;
  await db.exec`INSERT INTO page_text VALUES (4, '8_title', 1)`;
  await db.exec`INSERT INTO text_lang VALUES (1, 'de', 'Vorname')`;
  await db.exec`INSERT INTO page_text VALUES (1, 'button_submit', 2)`; // never shown, the button was off
  await db.exec`INSERT INTO text_lang VALUES (2, 'de', 'Formular absenden')`;

  await migrateForm1({ db, dir: await Deno.makeTempDir() + "/" } as unknown as App);

  const row = (id: number) => db.row`SELECT basis, name, module FROM page WHERE id = ${id}`;
  assertEquals(await row(2), { basis: 1, name: "main", module: "cms.cont.flexible" }); // layout kept
  assertEquals(await row(4), { basis: 3, name: "left", module: "cms.cont.form.fields" });
  assertEquals(JSON.parse(String(await db.one`SELECT settings FROM page WHERE id = 4`)).fields, { vorname: { type: "text" } });
  assertEquals(JSON.parse(String(await db.one`SELECT settings FROM page WHERE id = 1`)).button_submit, "1"); // buttons1 was the button
  assertEquals(await db.col`SELECT name FROM page_text WHERE page_id = 1`, []); // its "Senden" is the default

  await db.close();
});
