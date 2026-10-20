import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { today } from "@qino/qino/fin";
import { create, issue } from "@qino/qino/fin.invoice";

import api from "../nodeApi.ts";
import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { render } from "../render.ts";
import { backendRowWidget, cms } from "../plugin.ts";

type Answer = { ok: boolean; message?: string; url?: string };

Deno.test("customers and suppliers follow from the invoices; a new one keeps its address here", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.payment.credit"], async (app) => {
    const node = backendNode(app, "/backend/parties");
    const as = (url: string, run: () => Promise<unknown>) => inRequest(app, url, run);
    const base = "http://qino.test/backend/parties";

    const made = await as(base, () => api(node, { create: { organization: "Druck AG" } })) as Answer;
    const id = Number(new URL(made.url!, "http://-").searchParams.get("usr"));
    assertEquals((await app.db.row`SELECT active FROM usr WHERE id = ${id}`)?.active, 0); // no login
    const address = {
      street_address: "Seeweg 2", postal_code: "3000", address_locality: "Bern", address_country: "ch",
    };
    await as(base, () => api(node, { save: { organization: "Druck AG", ...address, id: String(id) } }));
    assertEquals((await app.db.row`SELECT address_country FROM usr WHERE id = ${id}`)?.address_country, "CH");
    assertEquals(String(await as(base, () => render(node))).includes("Druck AG"), false); // no invoice yet

    const lines = [{ name: "Print", price: 10000 }];
    await issue(app, await create(app, { direction: "in", number: "R-1", currency: "CHF", lines, usrId: id }));
    let page = String(await as(base, () => render(node)));
    assertStringIncludes(page, "Druck AG");
    assertStringIncludes(page, "supplier");
    assert(!String(await as(`${base}?role=customer`, () => render(node))).includes("Druck AG"));

    await issue(app, await create(app, { currency: "CHF", lines, usrId: id })); // it buys too
    assertStringIncludes(String(await as(`${base}?role=customer`, () => render(node))), "Druck AG");
    await as(base, () => api(node, { credit: { id: String(id), amount: "5", currency: "CHF", text: "Start" } }));
    assertStringIncludes(String(await as(base, () => render(node))), "5.00</span>"); // credit in the list
    page = String(await as(`${base}?usr=${id}`, () => render(node)));
    const parts = ['value="Seeweg 2"', `data-save="${id}"`, `data-credit="${id}"`]; // its invoices: a card of fin.invoice
    for (const part of parts) assertStringIncludes(page, part);
    const goodwill = { id: String(id), amount: "12.50", currency: "chf", text: "Goodwill" };
    await as(base, () => api(node, { credit: goodwill }));
    assertStringIncludes(String(await as(`${base}?usr=${id}`, () => render(node))), "Goodwill");
  });
});

Deno.test("the page speaks with the texts of the namespace fin", async () => {
  await withFinApp(["fin.payment", "fin.invoice"], async (app) => {
    app.languages.setLangs(["en", "de"]);
    const node = backendNode(app, "/backend/parties");
    const page = String(await inRequest(app, "http://qino.test/backend/parties", () =>
      app.languages.with({ lang: "de" }, () => cms.node.render(node))));
    assertStringIncludes(page, "Kunden &amp; Lieferanten");
  });
});

Deno.test("the list shows current parties; former ones on request or when searched for", async () => {
  await withFinApp(["fin.payment", "fin.invoice"], async (app) => {
    const node = backendNode(app, "/backend/parties");
    const base = "http://qino.test/backend/parties";
    const party = (organization: string) =>
      app.db.table("usr").insert({ active: 0, pw: "", superuser: 0, given_name: "", family_name: "", organization }).then(Number);
    const lines = [{ name: "Hosting", price: 24000 }];
    const [old, open, recent] = [await party("Alt AG"), await party("Offen AG"), await party("Neu AG")];
    for (const [usrId, date] of [[old, "2019-03-01"], [open, "2019-03-01"], [recent, today()]] as const) {
      const id = Number((await issue(app, await create(app, { currency: "CHF", date, lines, usrId })))?.id);
      if (usrId !== open) await app.db.exec`UPDATE invoice SET status = 'paid', paid = total WHERE id = ${id}`;
    }
    const list = (query = "") => inRequest(app, base + query, () => render(node)).then(String);
    const page = await list();
    assert(page.includes("Offen AG") && page.includes("Neu AG") && !page.includes("Alt AG"));
    assertStringIncludes(page, `<td><a href="/backend/parties?usr=${recent}">${recent}</a>`);
    assertStringIncludes(await list("?former=1"), "Alt AG");
    assertStringIncludes(await list("?search=Alt"), "Alt AG");
  });
});

Deno.test("a user's address and credit, as a card on other pages, links to where they are kept", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.payment.credit"], async (app) => {
    const node = backendNode(app, "/backend/parties");
    const id = Number(await app.db.table("usr").insert({
      active: 0, pw: "", superuser: 0, given_name: "", family_name: "", organization: "Druck AG",
      street_address: "Seeweg 2", postal_code: "3000", address_locality: "Bern", iban: "CH9300762011623852957",
    }));
    await app.db.table("payment_credit").insert({ usr_id: id, currency: "CHF", amount: 500, text: "", created: 1 });
    const out = await inRequest(app, "http://qino.test/", async () => backendRowWidget.usr(app, id, await node.page()));
    assertEquals(out && out.title, "Address");
    const card = String(out && out.body);
    assertStringIncludes(card, `<a href="/backend/parties?usr=${id}">Druck AG</a><br>Seeweg 2<br>3000 Bern`);
    assertStringIncludes(card, "CH9300762011623852957");
    assert(/Credit[\s\S]*5\.00/.test(card));
    assertEquals(String(await inRequest(app, "http://qino.test/", async () => backendRowWidget.usr(app, id + 99, await node.page()))), "");
  });
});
