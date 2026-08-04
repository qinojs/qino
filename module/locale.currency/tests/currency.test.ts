import { assertEquals, assertRejects } from "@std/assert";
import { App } from "../../core/mod.ts";
import { currency, updateRates } from "../mod.ts";
import { cron } from "../plugin.ts";

Deno.test("locale.currency: a row per currency, rates on top", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.currency");
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

// The shape the ECB publishes; the rates are EUR-based, the column is USD-based.
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
 <Cube><Cube time='2026-08-03'>
  <Cube currency='USD' rate='1.1600'/>
  <Cube currency='CHF' rate='0.9280'/>
  <Cube currency='JPY' rate='170.00'/>
  <Cube currency='XYZ' rate='2.0'/>
 </Cube></Cube>
</gesmes:Envelope>`;

/** Answers the requests updateRates() makes, so the tests need no network. Per URL substring,
 *  so a source can fail while the next one answers. */
function serve(...answers: { match?: string; body: string; status?: number }[]) {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const hit = answers.find((a) => !a.match || url.includes(a.match));
    return Promise.resolve(hit ? new Response(hit.body, { status: hit.status ?? 200 }) : new Response("", { status: 404 }));
  };
  return { asked, stop: () => { globalThis.fetch = real; } };
}

Deno.test("locale.currency: rates arrive as units per 1 USD", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.currency");
  await app.init();
  const source = serve({ body: ECB_XML });
  try {
    const { written, source: used } = await updateRates(app);
    assertEquals(used, "ecb"); // the first that answers
    assertEquals(written, 4); // USD, CHF, JPY and EUR itself — XYZ is no currency here

    assertEquals(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"USD"}`, 1); // the anchor
    assertEquals(Number(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"EUR"}`).toFixed(4), "0.8621");
    assertEquals(Number(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"CHF"}`).toFixed(4), "0.8000");

    // and that is what the conversion runs on: 1 CHF buys 1.25 USD
    assertEquals(Number(await currency.rate(app.db, "CHF", "USD")).toFixed(4), "1.2500");
    assertEquals(Number(await app.settings["locale.currency"].updated) > 0, true);
  } finally {
    source.stop();
    await app.db.close();
  }
});

Deno.test("locale.currency: a source that cannot answer says so", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.currency");
  await app.init();
  try {
    // every source down
    let source = serve({ body: "nope", status: 503 });
    await assertRejects(() => updateRates(app), Error, "503");
    source.stop();

    // answering, but with nothing to convert to
    source = serve({ body: "<Cube><Cube currency='CHF' rate='0.93'/></Cube>" });
    await assertRejects(() => updateRates(app), Error, "no USD rate");
    source.stop();

    assertEquals(Number(await app.settings["locale.currency"].updated), 0); // nothing was stamped
  } finally {
    await app.db.close();
  }
});

Deno.test("locale.currency: the job asks how old the rates may get", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.currency");
  await app.init();
  const set = app.settings["locale.currency"];
  let fetched = 0;
  const source = serve({ body: ECB_XML });
  const tick = async () => { await cron.rates.run(app); };
  try {
    await tick(); // "never" by default
    assertEquals(Number(await set.updated), 0);

    await set.update("hourly");
    await tick();
    fetched = Number(await set.updated);
    assertEquals(fetched > 0, true);

    await set.update("daily");
    await tick(); // fetched minutes ago — a daily job leaves it alone
    assertEquals(Number(await set.updated), fetched);

    await set.updated(fetched - 24 * 3600); // a day old
    await tick();
    assertEquals(Number(await set.updated) >= fetched, true); // stamped again
  } finally {
    source.stop();
    await app.db.close();
  }
});

Deno.test("locale.currency: a source that is down hands over to the next", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.currency");
  await app.init();
  // the ECB is down, the JSON source answers — USD-based, so the rates land as they are
  const source = serve(
    { match: "ecb.europa.eu", body: "", status: 503 },
    { match: "frankfurter", body: JSON.stringify({ base: "USD", rates: { CHF: 0.8, EUR: 0.86, JPY: 147, ZZZ: 1, AUD: 1.5, CAD: 1.4, GBP: 0.75, SEK: 9.6, NOK: 10.2, DKK: 6.4 } }) },
  );
  try {
    const { source: used, written } = await updateRates(app);
    assertEquals(used, "frankfurter");
    assertEquals(written, 10); // nine rates plus USD itself; ZZZ is no currency here
    assertEquals(await app.db.one`SELECT rate_to_usd FROM currency WHERE id = ${"CHF"}`, 0.8);
    assertEquals(String(await app.settings["locale.currency"].source), "frankfurter");
    assertEquals(source.asked.length, 2); // it did not ask further
  } finally {
    source.stop();
    await app.db.close();
  }
});
