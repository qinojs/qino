import { test } from "node:test";
import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { migrateImage2 } from "./migrateImage2.ts";

import type { App } from "@qino/qino";

test("migrate_from_php: image2 language variants become image <lang>", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE page (id INTEGER PRIMARY KEY, module TEXT)`;
  await db.query`CREATE TABLE page_file (page_id INTEGER, name TEXT, file_id INTEGER, PRIMARY KEY (page_id, name))`;
  await db.exec`INSERT INTO page (id, module) VALUES (1, ${"cms.cont.image2"}), (2, ${"cms.cont.text"})`;
  await db.exec`INSERT INTO page_file (page_id, name, file_id) VALUES
    (1, ${"image"}, 10), (1, ${"image_de"}, 11), (1, ${"_x1"}, 12), (2, ${"image_de"}, 13)`;

  await migrateImage2({ db } as App);
  const names = async (id: number) => (await db.query`SELECT name FROM page_file WHERE page_id = ${id} ORDER BY name`).map((r) => r.name);
  assertEquals(await names(1), ["_x1", "image", "image de"]);
  assertEquals(await names(2), ["image_de"]); // other modules keep their names

  await db.close();
});
