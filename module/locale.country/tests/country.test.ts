import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { App, fs } from "@qino/qino";

import { country } from "../mod.ts";
import { install } from "../plugin.ts";

async function app() {
  const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("locale.country");
  await app.init();
  return app;
}

test("locale.country: the list is seeded once and keeps edited rows", async () => {
  await using a = await app();
  assertEquals(Number(await a.db.one`SELECT count(*) FROM country`), 250);
  assertEquals(await country.get(a.db, "CH"), { id: "CH", iso3: "CHE", currency: "CHF", calling: "41", internet_domain: ".ch" });

  await a.db.table("country").update({ id: "CH", calling: "0041" });
  await install({ app: a });
  assertEquals((await country.get(a.db, "CH"))!.calling, "0041"); // not overwritten
});

test("locale.country: names and order come from the language, not the table", async () => {
  await using a = await app();
  assertEquals(country.name("CH", "de"), "Schweiz");
  assertEquals(country.name("CH", "en"), "Switzerland");
  assertEquals(country.name("QQ", "en"), "QQ"); // no name, no crash

  const de = await country.sorted(a.db, "de");
  assertEquals(de.indexOf("EG") < de.indexOf("DE"), true); // Ägypten before Deutschland
});
