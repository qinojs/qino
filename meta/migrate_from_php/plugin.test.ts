import { assertEquals } from "../../module/core/tests/deps.ts";
import { sql, type App } from "../../module/core/mod.ts";
import { Db } from "../../module/core/lib/db/Db.ts";
import { removeObsoleteSettings } from "./plugin.ts";

Deno.test("migrate_from_php: cms.backend stays a scalar leaf", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE qg_setting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    basis INTEGER NOT NULL DEFAULT 0,
    ${sql.id("offset")} TEXT NOT NULL DEFAULT '',
    value TEXT
  )`;
  const cmsId = (await db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}) VALUES (0, ${"cms"})`).insertId;
  const backendId = (await db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${cmsId}, ${"backend"}, ${"83"})`).insertId;
  await db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${backendId}, ${"lastpage"}, ${"83"})`;

  assertEquals(await removeObsoleteSettings({ db } as App), true);
  assertEquals(await removeObsoleteSettings({ db } as App), false);
  assertEquals(await db.one`SELECT value FROM qg_setting WHERE id = ${backendId}`, "83");
  assertEquals(Number(await db.one`SELECT count(*) FROM qg_setting WHERE basis = ${backendId}`), 0);

  await db.close();
});
