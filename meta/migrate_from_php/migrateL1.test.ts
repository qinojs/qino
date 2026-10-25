import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { migrateL1 } from "./migrateL1.ts";

import type { App } from "@qino/qino";

Deno.test("migrateL1: a l1 list becomes cms.cont.dbtable, renamed columns followed, its filter folded in", async () => {
  const db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE page (id INTEGER PRIMARY KEY, module TEXT, settings TEXT)`;
  await db.exec`CREATE TABLE page_text (page_id INTEGER, name TEXT, text_id INTEGER)`;
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY, given_name TEXT, family_name TEXT)`;
  await db.exec`CREATE TABLE cd_student (id INTEGER PRIMARY KEY, firstname TEXT, moderator_id INTEGER)`;
  db.schema = { properties: { cd_student: { additionalProperties: { properties: { moderator_id: { "x-qg-parent": "usr" } } } } } };
  await db.loadTables();

  // the student's own firstname comes first and keeps its name; the moderator's was s_1
  const query = { sub: { id: { use: true }, firstname: { use: true }, moderator_id: { use: true, sub: { firstname: { use: true }, lastname: { use: true } } } } };
  const field = { handler: "default", showList: "1", editable: "1", search: "1", searchable: "1", orderable: "1" };
  const settings = {
    table: "cd_student", query: JSON.stringify(query), deletable: "1", detailLink: "437", limit: "200",
    fieldSort: JSON.stringify(["id", "firstname", "moderator_id", "s_1", "lastname"]),
    orders: JSON.stringify({ firstname: "ASC", lastname: "DESC" }),
    field_firstname: field, field_s_1: field, field_lastname: { ...field, showList: "" },
    field_moderator_id: { handler: "fkSelect", fix: "1", defaultValue: "#get_id#", options: "select=CONCAT(firstname,' ',lastname)" },
  };
  await db.exec`INSERT INTO page VALUES (1, 'cms.cont.l1.table1', ${JSON.stringify(settings)})`;
  await db.exec`INSERT INTO page VALUES (2, 'cms.cont.l1.table1.filter', ${JSON.stringify({ "list-content-id": "1", fields: { firstname: { disable: "" }, s_1: { disable: "1" } } })})`;
  await db.exec`INSERT INTO page_text VALUES (1, 'field_lastname', 7), (1, 'field_firstname', 8), (2, 'title', 9)`;

  await migrateL1({ db } as unknown as App);

  const [row] = await db.query`SELECT module, settings FROM page WHERE id = 1`;
  const after = JSON.parse(String(row.settings));
  assertEquals(row.module, "cms.cont.dbtable");
  assertEquals(after.field_order, "id,firstname,moderator_id,given_name,family_name");
  assertEquals(after.order, "family_name DESC, firstname"); // PHP: the last ordered weighed most
  assertEquals([after.delete, after.copy, after.detail_page, after.limit], [true, false, "437", 200]);
  assertEquals(after.fields.given_name, { path: "moderator_id.given_name", type: "text", list: true, list_edit: false, detail: false, edit: true, insert: false, search: true, sort: true, fix: false });
  assertEquals(after.fields.family_name.list, false);
  assertEquals([after.fields.firstname.filter, after.fields.given_name.filter], [true, undefined]);
  assertEquals(after.fields.moderator_id.type, "reference");
  assertEquals([after.fields.moderator_id.fix, after.fields.moderator_id.default], [true, "{id}"]);
  assertEquals(after.fields.moderator_id.ref_label, "CONCAT(given_name,' ',family_name)");
  assertEquals(await db.col`SELECT name FROM page_text ORDER BY text_id`, ["family_name_title", "firstname_title"]);
  assertEquals(await db.col`SELECT id FROM page`, [1]); // the filter lives in its list now
  await db.close();
});
