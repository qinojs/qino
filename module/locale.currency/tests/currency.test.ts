import { assertEquals } from "@std/assert";
import { App } from "../../core/mod.ts";
import { currency } from "../mod.ts";

Deno.test("locale.currency: a row per currency, rates on top", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("locale.currency");
  await app.init();
  try {
    assertEquals(Number(await app.db.one`SELECT count(*) FROM currency`), currency.codes().length);
    assertEquals(await currency.rate(app.db, "CHF", "CHF"), 1);
    assertEquals(await currency.rate(app.db, "CHF", "EUR"), undefined); // no rates stored yet

    await app.db.table("currency").update({ id: "CHF", rate_to_usd: 1.25 });
    await app.db.table("currency").update({ id: "EUR", rate_to_usd: 1.1 });
    assertEquals(await currency.rate(app.db, "CHF", "EUR"), 1.1 / 1.25);
  } finally {
    await app.db.close();
  }
});

Deno.test("locale.currency: names, symbols and amounts come from Intl", () => {
  assertEquals(currency.name("CHF", "de"), "Schweizer Franken");
  assertEquals(currency.symbol("EUR", "de"), "€");
  assertEquals(currency.format(12.5, "CHF", "de-CH").replace(/\s/, " "), "CHF 12.50"); // Intl separates with NBSP
});
