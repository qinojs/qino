import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { withFinApp } from "../../tests/app.ts";
import { attach, create, document, issue, print } from "../mod.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.bank", "fin.payment.qrbill", "fin.invoice"], fn);

const invoice = {
  currency: "CHF",
  party: { name: "Kunde & Co", address: { streetAddress: "Seeweg 2", postalCode: "3000", addressLocality: "Bern" } },
  lines: [
    { name: "Design <draft>", quantity: 2.5, unit: "h", price: 12000, taxRate: 8.1 },
    { name: "Book", description: "Second edition\nhardcover", price: 3990, taxRate: 2.6 },
    { name: "Power", quantity: 100, unit: "kWh", price: 23.45, taxRate: 8.1 },
  ],
  text: "Thank you.\nPayable within 30 days.",
  date: "2026-10-07",
};

Deno.test("the document shows sender, recipient, lines and tax per rate, escaped", async () => {
  await withApp(async (app) => {
    const id = Number((await issue(app, await create(app, invoice)))?.id);
    const doc = (await document(app, id)).replaceAll("\u00a0", " "); // Intl keeps "CHF" and the amount together
    for (const part of [
      "Atelier Muster\nHauptgasse 1\n3280 Murten\nVAT ID CHE-123.456.789 MWST", // no country: not abroad
      "Kunde &amp; Co\nSeeweg 2\n3000 Bern",
      "Design &lt;draft&gt;",
      "<div class=description>Second edition\nhardcover</div>",
      "2026-1",
      '<span class=currency>CHF </span>120.00', // a unit price in the currency's decimals …
      '<span class=currency>CHF </span>0.2345', // … and finer where it is
      'Unit price <span class=currency>CHF</span>', // the lines' currency is in their head
      "8.1 %",
      "2.6 %",
      "Thank you.\nPayable within 30 days.",
    ]) assertStringIncludes(doc, part);
  });
});

Deno.test("across a border both addresses show their country", async () => {
  await withApp(async (app) => {
    const party = { name: "Client SA", address: { addressLocality: "Paris", addressCountry: "FR" } };
    const doc = await document(app, Number((await issue(app, await create(app, { ...invoice, party })))?.id));
    assertStringIncludes(doc, "3280 Murten\nCH");
    assertStringIncludes(doc, "Paris\nFR");
  });
});

Deno.test("an issued invoice prints to a PDF kept as its file", async () => {
  if ((await Deno.permissions.query({ name: "run" })).state !== "granted") return; // no browser to start
  await withApp(async (app) => {
    const id = Number((await issue(app, await create(app, invoice)))?.id);
    const pdf = await print(app, id).catch((e) => {
      if (!String(e.message).includes("no Chromium")) throw e;
    });
    if (!pdf) return;
    assertEquals((await app.db.row`SELECT file_id FROM invoice WHERE id = ${id}`)?.file_id, pdf.id);
    const again = await print(app, id);
    assertEquals((await app.db.row`SELECT file_id FROM invoice WHERE id = ${id}`)?.file_id, again.id);
    assertEquals(await app.db.one`SELECT id FROM file WHERE id = ${pdf.id}`, undefined); // the old print is gone
  });
});

Deno.test("with a method set, an issued invoice asks for its payment and carries its slip", async () => {
  await withApp(async (app) => {
    await app.settings["fin.payment.qrbill"].iban("CH44 3199 9123 0008 8901 2");
    await app.settings["fin.invoice"].method("qrbill");
    const id = await create(app, invoice);
    assertStringIncludes(await document(app, id), "<svg"); // the draft shows the QR bill it will get
    await issue(app, id);
    const asked = await app.db.row`SELECT provider, amount, status FROM payment WHERE ref = ${"fin.invoice:" + id}`;
    assertEquals([asked?.provider, asked?.status], ["qrbill", "pending"]);
    assertStringIncludes(await document(app, id), "<svg"); // the QR bill on its page
  });
});

Deno.test("a received invoice keeps its original as its file: attached, never replaced by a print", async () => {
  await withApp(async (app) => {
    const original = await app.dbFiles.add(new File([new Uint8Array([37, 80, 68, 70])], "bill.pdf", { type: "application/pdf" }));
    const id = await create(app, { ...invoice, direction: "in", number: "R-77" });
    await attach(app, id, original);
    assertEquals(Number(await app.db.one`SELECT file_id FROM invoice WHERE id = ${id}`), original.id);
    await issue(app, id);
    await assertRejects(() => print(app, id), Error, "original");
    const other = await app.dbFiles.add(new File(["x"], "other.pdf", { type: "application/pdf" }));
    await assertRejects(() => attach(app, id, other), Error, "keeps its file");
  });
});

Deno.test("an invoice speaks its own language, with the texts the module brings", async () => {
  await withApp(async (app) => {
    app.languages.setLangs(["en", "de"]); // a site that speaks German
    const doc = await document(app, Number((await issue(app, await create(app, { ...invoice, lang: "de" })))?.id));
    const draft = await document(app, await create(app, { ...invoice, lang: "de" }));
    assertStringIncludes(draft, "<h1>Rechnung (Entwurf)</h1>"); // no number yet
    for (const part of ["<h1>Rechnung 2026-1</h1>", "Zahlbar innerhalb von 30 Tagen", "Einzelpreis", '<th class="n rate">MwSt.', "Netto"]) assertStringIncludes(doc, part);
  });
});

Deno.test("a language the site has no texts for falls back to its default one", async () => {
  await withApp(async (app) => {
    const doc = await document(app, Number((await issue(app, await create(app, { ...invoice, lang: "ru" })))?.id));
    assertStringIncludes(doc, `<html lang="${app.languages.def}">`);
  });
});

Deno.test("one rate shows below the lines, no tax shows no tax rows", async () => {
  await withApp(async (app) => {
    const of = (lines: { name: string; price: number; taxRate?: number }[]) =>
      create(app, { ...invoice, lines }).then((id) => document(app, id));
    const one = await of([{ name: "Design", price: 10000, taxRate: 8.1 }]);
    assert(!one.includes('class="n rate"')); // no column: the rate is in the tax row
    assertStringIncludes(one, "Tax 8.1 %");
    const none = await of([{ name: "Design", price: 10000 }]);
    for (const part of ["Net", "Tax "]) assert(!none.includes(`<th colspan=4>${part}`), part);
  });
});
